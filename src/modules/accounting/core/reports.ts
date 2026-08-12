import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { toSafeCents } from "../lib/money";
import {
  addDaysIso,
  fiscalYearStart,
  previousPeriod,
  previousYear,
  shiftYearsIso,
} from "../lib/dates";
import { getBalances, type AccountingBasis } from "./balances";
import { listAccounts } from "./coa";
import { listDimensionMembers } from "./dimensions";
import { getSettings } from "./guards";
import {
  buildBalanceSheet,
  buildCashActivity,
  buildGeneralLedger,
  buildProfitAndLoss,
  type BalanceSheetReport,
  type CashActivityReport,
  type GeneralLedgerInputLine,
  type GeneralLedgerReport,
  type ProfitAndLossReport,
} from "./report-builders";

/**
 * Thin fetch wrappers: listAccounts + 1–4 getBalances calls + a pure
 * builder. Read-only; compute-on-read per the balances.ts design note.
 */

export async function getProfitAndLoss(
  tx: Tx,
  tenantId: string,
  opts: {
    from: string;
    to: string;
    compare?: "prev-period" | "prev-year";
    /** Ignored when compare is set (v1 pin: mutually exclusive). */
    dimensionType?: string;
    showZero?: boolean;
    basis?: AccountingBasis;
  },
): Promise<ProfitAndLossReport> {
  const accounts = await listAccounts(tx, tenantId);
  const dimensionType = opts.compare ? undefined : opts.dimensionType;
  const basis = opts.basis ?? "accrual";
  const current = await getBalances(tx, tenantId, {
    from: opts.from,
    to: opts.to,
    basis,
    ...(dimensionType ? { groupByDimensionType: dimensionType } : {}),
  });
  let comparison;
  if (opts.compare) {
    const range =
      opts.compare === "prev-period"
        ? previousPeriod(opts.from, opts.to)
        : previousYear(opts.from, opts.to);
    comparison = {
      mode: opts.compare,
      ...range,
      // The comparison period is computed on the SAME basis — comparing cash
      // against accrual would be two different questions in one column pair.
      rows: await getBalances(tx, tenantId, { ...range, basis }),
    };
  }
  let dimension;
  if (dimensionType) {
    dimension = {
      type: dimensionType,
      members: await listDimensionMembers(tx, tenantId, dimensionType),
    };
  }
  return buildProfitAndLoss(accounts, current, {
    from: opts.from,
    to: opts.to,
    comparison,
    dimension,
    showZero: opts.showZero,
  });
}

export async function getBalanceSheet(
  tx: Tx,
  tenantId: string,
  opts: {
    asOf: string;
    compare?: "prev-year";
    showZero?: boolean;
    basis?: AccountingBasis;
  },
): Promise<BalanceSheetReport> {
  const accounts = await listAccounts(tx, tenantId);
  const settings = await getSettings(tx, tenantId);
  const fyStart = fiscalYearStart(opts.asOf, settings.fiscalYearStartMonth);
  const basis = opts.basis ?? "accrual";
  const fetchPair = async (asOf: string, fy: string) => ({
    cumulative: await getBalances(tx, tenantId, { asOf, basis }),
    priorFyBoundary: await getBalances(tx, tenantId, {
      asOf: addDaysIso(fy, -1),
      basis,
    }),
  });
  const current = await fetchPair(opts.asOf, fyStart);
  let comparison;
  if (opts.compare === "prev-year") {
    const asOf = shiftYearsIso(opts.asOf, -1);
    const fy = fiscalYearStart(asOf, settings.fiscalYearStartMonth);
    comparison = { ...(await fetchPair(asOf, fy)), asOf, fyStart: fy };
  }
  return buildBalanceSheet(
    accounts,
    { ...current, comparison },
    { asOf: opts.asOf, fyStart, showZero: opts.showZero },
  );
}

/**
 * No `basis` here, deliberately: this report reads only bank, cash and
 * credit-card accounts, and the cash-basis adjustment never touches those —
 * it moves income and expense between AR/AP and the P&L, leaving every
 * register line exactly where it was. Cash Activity is the same report on
 * either basis, so offering a toggle would only invite the reader to look for
 * a difference that cannot exist.
 */
export async function getCashActivity(
  tx: Tx,
  tenantId: string,
  opts: { from: string; to: string },
): Promise<CashActivityReport> {
  const accounts = await listAccounts(tx, tenantId);
  const cashIds = accounts
    .filter((a) => ["bank", "cash", "credit_card"].includes(a.subtype))
    .map((a) => a.id);
  if (cashIds.length === 0) {
    return buildCashActivity(accounts, [], [], opts);
  }
  const opening = await getBalances(tx, tenantId, {
    asOf: addDaysIso(opts.from, -1),
    accountIds: cashIds,
  });
  const activity = await getBalances(tx, tenantId, {
    from: opts.from,
    to: opts.to,
    accountIds: cashIds,
  });
  return buildCashActivity(accounts, opening, activity, opts);
}

/**
 * Lines one general-ledger run will render.
 *
 * A year of a busy tenant's ledger is tens of thousands of lines, and a report
 * page that tries to render all of them helps nobody. The cap is generous
 * enough that a normal month or quarter never reaches it, and when it does bite
 * the report SAYS SO rather than quietly showing a prefix.
 */
export const GENERAL_LEDGER_LINE_CAP = 5000;

/**
 * The general ledger: every posted line in the period, by account.
 *
 * ACCRUAL ONLY, and deliberately — the same shape of decision as Cash
 * Activity's missing basis toggle, for a different reason. Cash basis in this
 * system is a re-recognition computed at read time
 * (`core/cash-basis-allocate.ts`): it produces per-account ADJUSTMENTS, not
 * re-dated journal lines, because no second ledger exists and nothing about
 * cash basis is ever posted (ADR 0007). A line-level cash-basis ledger would
 * therefore have to show synthetic rows that no journal entry backs and
 * nobody can drill into — a ledger you cannot tie back to an entry is worse
 * than one that honestly covers a single basis. If cash-basis GL is ever
 * wanted, the thing to build first is line-level re-dating, not a toggle here.
 *
 * The line cap is applied in CHRONOLOGICAL order, so a truncated report is the
 * earliest part of the period rather than an arbitrary sample. Note that a
 * truncated report no longer reconciles to the trial balance at `to` — its
 * closing balances are as at the last line shown.
 */
export async function getGeneralLedger(
  tx: Tx,
  tenantId: string,
  opts: {
    from: string;
    to: string;
    /** Narrow to specific accounts; empty/absent means every account. */
    accountIds?: string[];
    limit?: number;
  },
): Promise<GeneralLedgerReport> {
  const jl = schema.journalLines;
  const je = schema.journalEntries;
  const limit = opts.limit ?? GENERAL_LEDGER_LINE_CAP;
  const narrowed = opts.accountIds?.length ? opts.accountIds : undefined;

  const accounts = await listAccounts(tx, tenantId);
  const scoped = narrowed
    ? accounts.filter((a) => narrowed.includes(a.id))
    : accounts;
  if (scoped.length === 0) {
    return buildGeneralLedger([], [], [], { from: opts.from, to: opts.to });
  }

  const where = and(
    eq(jl.tenantId, tenantId),
    // Only posted entries count, exactly as getBalances does — a general
    // ledger that included drafts would disagree with every other report.
    eq(je.status, "posted" as const),
    gte(je.entryDate, opts.from),
    lte(je.entryDate, opts.to),
    ...(narrowed ? [inArray(jl.accountId, narrowed)] : []),
  );

  const [opening, countRows, rows] = await Promise.all([
    // The balance carried INTO the period — the same engine every other
    // report uses, so the opening column cannot drift from the balance sheet.
    getBalances(tx, tenantId, {
      asOf: addDaysIso(opts.from, -1),
      ...(narrowed ? { accountIds: narrowed } : {}),
    }),
    tx
      .select({ n: sql<string>`count(*)` })
      .from(jl)
      .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
      .where(where),
    tx
      .select({
        accountId: jl.accountId,
        entryId: je.id,
        entryDate: je.entryDate,
        source: je.source,
        entryMemo: je.memo,
        lineMemo: jl.memo,
        amountCents: jl.amountCents,
        lineNo: jl.lineNo,
      })
      .from(jl)
      .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
      .where(where)
      // Must match the builder's sort, so the cap takes a chronological
      // prefix rather than whatever the planner returned first.
      .orderBy(asc(je.entryDate), asc(je.id), asc(jl.lineNo))
      .limit(limit),
  ]);

  const lines: GeneralLedgerInputLine[] = rows.map((r) => ({
    accountId: r.accountId,
    entryId: r.entryId,
    entryDate: r.entryDate,
    source: r.source,
    entryMemo: r.entryMemo,
    lineMemo: r.lineMemo,
    amountCents: r.amountCents,
    lineNo: r.lineNo,
  }));

  return buildGeneralLedger(scoped, opening, lines, {
    from: opts.from,
    to: opts.to,
    matchedLineCount: toSafeCents(countRows[0]?.n ?? 0),
  });
}
