import "server-only";
import { and, asc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Account } from "@/db/schema";
import { toSafeCents } from "../lib/money";
import { cashBasisAdjustment } from "./cash-basis";

/**
 * The one query engine reports use. Compute-on-read by design: at this
 * scale indexed SUMs are milliseconds, and a materialized balance table
 * would introduce accounting software's worst bug class (drift).
 * Only posted entries count — draft and void are invisible here.
 */

export interface BalanceRow {
  accountId: string;
  /** Dimension member id when groupByDimensionType is set; null = untagged. */
  memberId: string | null;
  debitCents: number;
  creditCents: number;
  netCents: number;
}

/**
 * Which basis a report is computed on. Accrual is the ledger as posted; cash
 * recognises invoice income and bill expense on their payment dates instead.
 * See docs/decisions/0007-cash-basis-reporting.md.
 */
export type AccountingBasis = "accrual" | "cash";

/** Sum two sets of rows by (account, dimension member). */
function mergeRows(base: BalanceRow[], delta: BalanceRow[]): BalanceRow[] {
  if (delta.length === 0) return base;
  const byKey = new Map<string, BalanceRow>();
  for (const row of [...base, ...delta]) {
    const key = `${row.accountId}|${row.memberId ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row });
      continue;
    }
    existing.debitCents += row.debitCents;
    existing.creditCents += row.creditCents;
    existing.netCents += row.netCents;
  }
  return [...byKey.values()];
}

export async function getBalances(
  tx: Tx,
  tenantId: string,
  opts: {
    asOf?: string;
    from?: string;
    to?: string;
    accountIds?: string[];
    groupByDimensionType?: string;
    /** Defaults to accrual: the accrual path is byte-identical to before. */
    basis?: AccountingBasis;
  } = {},
): Promise<BalanceRow[]> {
  const jl = schema.journalLines;
  const je = schema.journalEntries;
  const ld = schema.lineDimensions;
  const cash = opts.basis === "cash";

  const conditions = [
    eq(jl.tenantId, tenantId),
    eq(je.status, "posted" as const),
    opts.asOf ? lte(je.entryDate, opts.asOf) : undefined,
    opts.from ? gte(je.entryDate, opts.from) : undefined,
    opts.to ? lte(je.entryDate, opts.to) : undefined,
    opts.accountIds?.length ? inArray(jl.accountId, opts.accountIds) : undefined,
    // Cash basis drops the accrual recognition entirely; cash-basis.ts puts
    // the income and expense back on the dates the money actually moved.
    cash ? notInArray(je.source, ["invoice", "bill"] as const) : undefined,
    // ...and so must any reversal OF one, or the reversal would survive its
    // original and flip the sign of a document nobody is recognising.
    // reverseEntry is not guarded in core (only the journal action is), so
    // this is cheap insurance rather than a currently reachable case.
    cash
      ? sql`not exists (
          select 1 from ${je} as reversed_src
           where reversed_src.tenant_id = ${je.tenantId}
             and reversed_src.id = ${je.reversesEntryId}
             and reversed_src.source in ('invoice', 'bill')
        )`
      : undefined,
  ].filter(Boolean);

  const base = tx
    .select({
      accountId: jl.accountId,
      memberId: opts.groupByDimensionType
        ? ld.memberId
        : sql<string | null>`null`.as("member_id"),
      debitCents: sql<string>`sum(case when ${jl.amountCents} > 0 then ${jl.amountCents} else 0 end)`,
      creditCents: sql<string>`sum(case when ${jl.amountCents} < 0 then -${jl.amountCents} else 0 end)`,
      netCents: sql<string>`sum(${jl.amountCents})`,
    })
    .from(jl)
    .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)));

  const joined = opts.groupByDimensionType
    ? base.leftJoin(
        ld,
        and(
          eq(ld.tenantId, jl.tenantId),
          eq(ld.journalLineId, jl.id),
          eq(ld.dimensionType, opts.groupByDimensionType),
        ),
      )
    : base;

  const rows = await joined
    .where(and(...conditions))
    .groupBy(
      jl.accountId,
      ...(opts.groupByDimensionType ? [ld.memberId] : []),
    );

  const accrualRows = rows.map((r) => ({
    accountId: r.accountId,
    memberId: r.memberId ?? null,
    debitCents: toSafeCents(r.debitCents),
    creditCents: toSafeCents(r.creditCents),
    netCents: toSafeCents(r.netCents),
  }));
  if (!cash) return accrualRows;

  return mergeRows(
    accrualRows,
    await cashBasisAdjustment(tx, tenantId, {
      asOf: opts.asOf,
      from: opts.from,
      to: opts.to,
      accountIds: opts.accountIds,
      groupByDimensionType: opts.groupByDimensionType,
    }),
  );
}

export interface TrialBalanceRow {
  account: Account;
  debitCents: number;
  creditCents: number;
  /** Signed net (positive = debit balance). */
  netCents: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  /** Σ net over all accounts — must be 0 for a healthy ledger. */
  totalNetCents: number;
}

/**
 * Trial balance as of a date: each account's cumulative balance shown on
 * its natural side. The grand totals being equal is a free integrity
 * check surfaced in the UI.
 */
export async function getTrialBalance(
  tx: Tx,
  tenantId: string,
  asOf: string,
  basis: AccountingBasis = "accrual",
): Promise<TrialBalance> {
  const balances = await getBalances(tx, tenantId, { asOf, basis });
  const byAccount = new Map(balances.map((b) => [b.accountId, b]));
  const accounts = await tx.query.accounts.findMany({
    where: eq(schema.accounts.tenantId, tenantId),
    orderBy: asc(schema.accounts.code),
  });
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  let totalNet = 0;
  for (const account of accounts) {
    const b = byAccount.get(account.id);
    if (!b || b.netCents === 0) continue;
    // Trial-balance convention: show the NET balance on its natural side.
    const debit = b.netCents > 0 ? b.netCents : 0;
    const credit = b.netCents < 0 ? -b.netCents : 0;
    rows.push({ account, debitCents: debit, creditCents: credit, netCents: b.netCents });
    totalDebit += debit;
    totalCredit += credit;
    totalNet += b.netCents;
  }
  return {
    rows,
    totalDebitCents: totalDebit,
    totalCreditCents: totalCredit,
    totalNetCents: totalNet,
  };
}

/** Σ signed cents over all posted lines — zero for a healthy ledger. */
export async function ledgerIsBalanced(tx: Tx, tenantId: string): Promise<boolean> {
  const balances = await getBalances(tx, tenantId);
  return balances.reduce((acc, b) => acc + b.netCents, 0) === 0;
}
