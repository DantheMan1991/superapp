import "server-only";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { formatCents, toSafeCents } from "@/lib/money";
import {
  entityScopeCondition,
  type EntityScope,
  type FilterScope,
} from "./entities";

/**
 * CONSOLIDATION: the group's figures with intercompany eliminated.
 * ADR 0010 slice 3.
 *
 * ELIMINATE BY FOLLOWING THE LINK, NEVER BY MATCHING AMOUNTS. That is the line
 * in the ADR that made the pair worth building, and it is what makes this
 * mechanical rather than a judgement call: a consolidated report drops exactly
 * the affiliate legs of entries carrying an `intercompany_id`, and touches
 * nothing else in those entries.
 *
 * On the two shapes the module can produce today:
 *
 *   Bill paid by an affiliate       Oak    Dr AP 500   / Cr Due-to 500
 *                                   Maple  Dr Due-from / Cr Checking 500
 *     eliminated -> Dr AP 500 (Oak) + Cr Checking 500 (Maple), and with the
 *     bill's own entry the group shows Dr expense / Cr cash. The group paid a
 *     vendor, which is what happened.
 *
 *   A plain transfer                Test   Dr Due-from / Cr Checking 3,100
 *                                   Oak    Dr Checking / Cr Due-to  3,100
 *     eliminated -> cash out of one register and into another, so the GROUP is
 *     unchanged. Nothing at all, which is what happened.
 *
 * WHY THIS CANNOT UNBALANCE A STATEMENT: a pair's two affiliate legs are always
 * +X and −X (`postIntercompanyPair` generates them; a reversal negates both), so
 * removing them removes zero. The consolidated trial balance still ties, with no
 * plug and no balancing figure invented anywhere.
 *
 * AND EXPLICITLY NOT FULL GAAP CONSOLIDATION. No investment-in-subsidiary
 * elimination, no minority interest, no purchase accounting. These are commonly
 * owned LLCs rather than a parent holding subsidiaries — combining them and
 * eliminating intercompany IS the whole job, and the rest would mostly be wrong
 * here.
 */

/** Subtypes of the two shared affiliate accounts. By SUBTYPE, never by code. */
export const AFFILIATE_SUBTYPES = [
  "due_from_affiliate",
  "due_to_affiliate",
] as const;

/**
 * Treat a scope as a plain row filter, because the thing being read cannot
 * contain an intercompany leg.
 *
 * DELIBERATELY NOT EXPORTED FROM `core/index.ts`: this is the one way past the
 * compile error that `FilterScope` exists to cause, so it stays inside the core
 * where each of its (currently one) call sites states why nothing there is
 * eliminable. A page or an action that wants it wants `ledgerScopeConditions`
 * instead.
 */
export function asFilterScope(scope: EntityScope): FilterScope {
  return scope.kind === "consolidated" ? { kind: "combined" } : scope;
}

/** The two shared accounts, or [] on a tenant provisioned before slice 2. */
export async function affiliateAccountIds(
  tx: Tx,
  tenantId: string,
): Promise<string[]> {
  const rows = await tx.query.accounts.findMany({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      inArray(schema.accounts.subtype, [...AFFILIATE_SUBTYPES]),
    ),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * EVERY SCOPE CONDITION A LEDGER REPORT NEEDS, in one list to spread.
 *
 * This is the seam slice 3 turns on. The failure it is built against: a scope
 * has been an ENTRY-level predicate since slice 1, and elimination is a
 * LINE-level exclusion, so a consolidated report that reused the entry-level
 * shape would eliminate nothing and produce a statement that looks right,
 * balances, and double-counts every intercompany transaction. Returning both
 * conditions together means a report cannot take one and forget the other —
 * and `entityScopeCondition` refuses a consolidated scope at compile time, so
 * there is no second way to ask.
 *
 * Both queries that read journal lines go through it: `getBalances`, which is
 * every summary report, and `getGeneralLedger`, which is the drill-down that
 * has to tie back to them.
 *
 * The predicate is `not (line is in an affiliate account and its entry is
 * linked)`. `intercompany_id IS NOT NULL` is the whole test because `0149`
 * enforces exactly two entries in two companies per link, deferred — a
 * committed pair is always a complete pair. An affiliate line with NO link is
 * left alone, and `consolidationResidual` below is what says so out loud.
 */
export async function ledgerScopeConditions(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
): Promise<Array<SQL | undefined>> {
  if (scope.kind !== "consolidated") {
    // Byte-identical to what it was: one company filters on the entry,
    // combined filters on nothing and eliminates nothing.
    return [entityScopeCondition(scope)];
  }
  const affiliateIds = await affiliateAccountIds(tx, tenantId);
  if (affiliateIds.length === 0) return [];
  return [
    or(
      // inArray, never an array interpolated into raw sql.
      not(inArray(schema.journalLines.accountId, affiliateIds)),
      isNull(schema.journalEntries.intercompanyId),
    ),
  ];
}

export interface ConsolidationResidual {
  /** Affiliate lines elimination did NOT remove, because they have no link. */
  lineCount: number;
  /** Their net, ledger convention (positive = debit = still owed to us). */
  netCents: number;
}

/**
 * What consolidation could not eliminate, so the report can SAY so.
 *
 * A MANUAL JOURNAL INTO AN AFFILIATE ACCOUNT HAS NO LINK, so there is nothing
 * to follow and nothing to eliminate. It is allowed on purpose — a journal has
 * to be able to name any account, the way it can already name AR or AP — and it
 * leaves a residual affiliate balance on the consolidated statement.
 *
 * SURFACED, NOT HIDDEN, and the argument is stronger than consistency with the
 * tax summary's gap: the line has no counterparty leg to remove with it, so
 * suppressing it would leave assets short against liabilities-plus-equity and
 * hiding it would require INVENTING an equity plug. A fabricated number to make
 * a statement look tidy is the one thing this module never does.
 *
 * Defined as the exact complement of the elimination predicate above, so this
 * number is always precisely what survived on the face of the statement.
 */
export async function consolidationResidual(
  tx: Tx,
  tenantId: string,
  window: { asOf?: string; from?: string; to?: string },
): Promise<ConsolidationResidual> {
  const affiliateIds = await affiliateAccountIds(tx, tenantId);
  if (affiliateIds.length === 0) return { lineCount: 0, netCents: 0 };
  const je = schema.journalEntries;
  const jl = schema.journalLines;
  const rows = await tx
    .select({
      n: sql<string>`count(*)`,
      net: sql<string>`coalesce(sum(${jl.amountCents}), 0)`,
    })
    .from(jl)
    .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
    .where(
      and(
        eq(jl.tenantId, tenantId),
        eq(je.status, "posted" as const),
        inArray(jl.accountId, affiliateIds),
        isNull(je.intercompanyId),
        window.asOf ? lte(je.entryDate, window.asOf) : undefined,
        window.from ? gte(je.entryDate, window.from) : undefined,
        window.to ? lte(je.entryDate, window.to) : undefined,
      ),
    );
  return {
    lineCount: toSafeCents(rows[0]?.n ?? 0),
    netCents: toSafeCents(rows[0]?.net ?? 0),
  };
}

/**
 * `consolidationResidual` for a report that only needs it when consolidating.
 *
 * One call rather than the same conditional written on four report pages — the
 * fourth is where somebody forgets, and a consolidated statement that silently
 * stops mentioning its residual is the version of this feature that misleads.
 */
export async function residualIfConsolidated(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
  window: { asOf?: string; from?: string; to?: string },
): Promise<ConsolidationResidual | null> {
  if (scope.kind !== "consolidated") return null;
  const residual = await consolidationResidual(tx, tenantId, window);
  return residual.lineCount === 0 ? null : residual;
}

/**
 * The one sentence that explains a residual, so the page and the CSV say the
 * SAME thing about it.
 *
 * It counts LINES rather than only reporting the net, because two hand-written
 * affiliate journals can offset to nothing while still meaning something went
 * in unlinked — the balance sheet would show no residual line, and the reader
 * still wants to know the group's numbers rest on entries elimination could not
 * follow.
 */
export function residualNote(residual: ConsolidationResidual): string {
  const lines =
    residual.lineCount === 1 ? "1 journal line" : `${residual.lineCount} journal lines`;
  return (
    `Not eliminated: ${lines} in the affiliate accounts with no linked ` +
    `transfer to follow (net ${formatCents(Math.abs(residual.netCents))} ` +
    `${residual.netCents < 0 ? "credit" : "debit"}).`
  );
}
