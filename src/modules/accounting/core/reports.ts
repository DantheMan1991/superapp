import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { toSafeCents } from "../lib/money";
import {
  addDaysIso,
  fiscalYearStart,
  monthsInRange,
  previousPeriod,
  previousYear,
  shiftYearsIso,
} from "../lib/dates";
import { LedgerError } from "./errors";
import { getBalances, type AccountingBasis } from "./balances";
import { entityScopeCondition, type EntityScope } from "./entities";
import { listAccounts } from "./coa";
import { listDimensionMembers } from "./dimensions";
import { getSettings } from "./guards";
import {
  buildBalanceSheet,
  buildCashActivity,
  buildGeneralLedger,
  buildProfitAndLoss,
  displayCents,
  type BalanceSheetReport,
  type CashActivityReport,
  type GeneralLedgerInputLine,
  type GeneralLedgerReport,
  type ProfitAndLossReport,
} from "./report-builders";
import {
  buildTaxSummary,
  type TaxSummaryInvoice,
  type TaxSummaryReport,
} from "./tax-summary";

/**
 * Thin fetch wrappers: listAccounts + 1–4 getBalances calls + a pure
 * builder. Read-only; compute-on-read per the balances.ts design note.
 *
 * EVERY ONE OF THEM STATES AN ENTITY SCOPE, and it is a required parameter
 * rather than an optional one (ADR 0010). Two of the reports here decline to
 * take one, each for its own stated reason — see `getTaxSummary` and the note
 * on aging in docs/modules/accounting.md. Declining is a decision written down;
 * an optional parameter is a decision nobody makes.
 */

/**
 * Months one P&L may spread across.
 *
 * Each column is its own `getBalances` call, so this is a query budget as much
 * as a legibility one — and thirty-odd columns is past the point where anybody
 * reads a row anyway. Over the cap the report REFUSES rather than showing the
 * first two years of a five-year range: a silently shortened P&L is a wrong
 * one, unlike the General Ledger's truncation, which still shows real lines.
 */
export const MAX_MONTH_COLUMNS = 24;

export async function getProfitAndLoss(
  tx: Tx,
  tenantId: string,
  opts: {
    scope: EntityScope;
    from: string;
    to: string;
    compare?: "prev-period" | "prev-year";
    /** Ignored when compare is set (v1 pin: mutually exclusive). */
    dimensionType?: string;
    /** One column per calendar month. Also mutually exclusive with the above. */
    spread?: "month";
    showZero?: boolean;
    basis?: AccountingBasis;
  },
): Promise<ProfitAndLossReport> {
  const accounts = await listAccounts(tx, tenantId);
  // The column axis has one occupant. Compare wins over a dimension (the
  // existing pin); a month spread wins over both, because asking for it is
  // the more specific request.
  const spread = opts.spread;
  const dimensionType = opts.compare || spread ? undefined : opts.dimensionType;
  const basis = opts.basis ?? "accrual";
  const current = await getBalances(tx, tenantId, {
    scope: opts.scope,
    from: opts.from,
    to: opts.to,
    basis,
    ...(dimensionType ? { groupByDimensionType: dimensionType } : {}),
  });
  let periods;
  if (spread === "month") {
    const buckets = monthsInRange(opts.from, opts.to);
    if (buckets.length > MAX_MONTH_COLUMNS) {
      throw new LedgerError(
        "PNL_TOO_MANY_MONTHS",
        `a monthly P&L covers at most ${MAX_MONTH_COLUMNS} months`,
      );
    }
    periods = await Promise.all(
      buckets.map(async (b) => ({
        key: b.key,
        label: b.label,
        // Every column on the SAME basis AND the same entity scope as the
        // report as a whole — a cash month next to an accrual one, or one
        // company's January beside every company's February, would be two
        // different questions in one table.
        rows: await getBalances(tx, tenantId, {
          scope: opts.scope,
          from: b.from,
          to: b.to,
          basis,
        }),
      })),
    );
  }
  let comparison;
  // Skipped entirely when a month spread is asked for, not merely ignored
  // downstream: building it anyway would leave the rows carrying a
  // `comparisonCents` nothing renders, and the page header saying "vs …"
  // about a comparison that is not on screen.
  if (opts.compare && !spread) {
    const range =
      opts.compare === "prev-period"
        ? previousPeriod(opts.from, opts.to)
        : previousYear(opts.from, opts.to);
    comparison = {
      mode: opts.compare,
      ...range,
      // The comparison period is computed on the SAME basis — comparing cash
      // against accrual would be two different questions in one column pair.
      rows: await getBalances(tx, tenantId, { ...range, scope: opts.scope, basis }),
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
    periods,
    showZero: opts.showZero,
  });
}

export async function getBalanceSheet(
  tx: Tx,
  tenantId: string,
  opts: {
    scope: EntityScope;
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
    cumulative: await getBalances(tx, tenantId, { scope: opts.scope, asOf, basis }),
    priorFyBoundary: await getBalances(tx, tenantId, {
      scope: opts.scope,
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
  opts: { scope: EntityScope; from: string; to: string },
): Promise<CashActivityReport> {
  const accounts = await listAccounts(tx, tenantId);
  const cashIds = accounts
    .filter((a) => ["bank", "cash", "credit_card"].includes(a.subtype))
    .map((a) => a.id);
  if (cashIds.length === 0) {
    return buildCashActivity(accounts, [], [], opts);
  }
  // It DOES take an entity scope, unlike a basis: a bank account is shared
  // between entities only until slice 4 gives it an owner, but the MOVEMENTS
  // through it already belong to one company or another, and "what did Maple
  // Street move through the account this month" is a real question today.
  const opening = await getBalances(tx, tenantId, {
    scope: opts.scope,
    asOf: addDaysIso(opts.from, -1),
    accountIds: cashIds,
  });
  const activity = await getBalances(tx, tenantId, {
    scope: opts.scope,
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
    scope: EntityScope;
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
    // ...and the same entity scope, or the report would stop tying back to the
    // trial balance, which is the one thing an accountant does with it first.
    entityScopeCondition(opts.scope),
    gte(je.entryDate, opts.from),
    lte(je.entryDate, opts.to),
    ...(narrowed ? [inArray(jl.accountId, narrowed)] : []),
  );

  const [opening, countRows, rows] = await Promise.all([
    // The balance carried INTO the period — the same engine every other
    // report uses, so the opening column cannot drift from the balance sheet.
    getBalances(tx, tenantId, {
      scope: opts.scope,
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

/**
 * Sales tax collected, by rate, for a period — plus what the ledger says is
 * owed. The reasoning for reading BOTH sources is in `tax-summary.ts`.
 *
 * NO `basis` PARAMETER, and it is the third report to refuse one for its own
 * reason (Cash Activity: the adjustment cannot touch registers; the General
 * Ledger: cash basis produces adjustments, not lines). Here it is that a
 * cash-basis tax summary means pro-rating each invoice's tax across its
 * payments PER RATE, which is a real feature rather than a toggle — and a tax
 * return computed on the wrong basis is not slightly wrong.
 *
 * Invoices are selected by ISSUE DATE, which is when the liability arises.
 *
 * NO `scope` PARAMETER EITHER, and it is the first report to decline one.
 * This report reads two sources and shows the gap between them: the per-rate
 * figures come from INVOICES, the amount owed comes from the LEDGER. An invoice
 * does not carry an entity yet (ADR 0010 slice 1 puts one only on the entry),
 * so scoping the ledger half while the document half stayed tenant-wide would
 * make the difference between the two columns meaningless — and that difference
 * is the whole report. Combined on both sides is honest; half-scoped is not.
 * When invoices gain an entity, this takes a scope like everything else.
 */
export async function getTaxSummary(
  tx: Tx,
  tenantId: string,
  opts: { from: string; to: string },
): Promise<TaxSummaryReport> {
  const inv = schema.invoices;
  const il = schema.invoiceLines;

  // The taxable base is SUMMED from the frozen lines rather than derived from
  // the tax — exact, and no division (P5). Grouped in the database because an
  // invoice can have a hundred lines and this report can span a year.
  const lineTotals = await tx
    .select({
      invoiceId: il.invoiceId,
      taxable: sql<string>`coalesce(sum(${il.amountCents}) filter (where ${il.isTaxable}), 0)`,
      exempt: sql<string>`coalesce(sum(${il.amountCents}) filter (where not ${il.isTaxable}), 0)`,
    })
    .from(il)
    .innerJoin(inv, and(eq(inv.tenantId, il.tenantId), eq(inv.id, il.invoiceId)))
    .where(
      and(
        eq(il.tenantId, tenantId),
        gte(inv.issueDate, opts.from),
        lte(inv.issueDate, opts.to),
      ),
    )
    .groupBy(il.invoiceId);
  const basesOf = new Map(lineTotals.map((r) => [r.invoiceId, r]));

  const invoiceRows = await tx
    .select({
      id: inv.id,
      taxRateId: inv.taxRateId,
      taxRatePpm: inv.taxRatePpm,
      taxCents: inv.taxCents,
      status: inv.status,
    })
    .from(inv)
    .where(
      and(
        eq(inv.tenantId, tenantId),
        gte(inv.issueDate, opts.from),
        lte(inv.issueDate, opts.to),
      ),
    );

  const invoices: TaxSummaryInvoice[] = invoiceRows.map((r) => {
    const base = basesOf.get(r.id);
    return {
      taxRateId: r.taxRateId,
      taxRatePpm: r.taxRatePpm,
      taxableCents: toSafeCents(base?.taxable ?? 0),
      exemptCents: toSafeCents(base?.exempt ?? 0),
      taxCents: r.taxCents,
      status: r.status,
    };
  });

  const rateNames = await tx
    .select({ id: schema.salesTaxRates.id, name: schema.salesTaxRates.name })
    .from(schema.salesTaxRates)
    .where(eq(schema.salesTaxRates.tenantId, tenantId));

  // BY SUBTYPE, never by code — a tenant may have renumbered. Null when there
  // is no such account, which the report renders as "no comparison available"
  // rather than as a zero balance.
  const accounts = await listAccounts(tx, tenantId);
  const taxAccount = accounts.find((a) => a.subtype === "sales_tax");
  let liabilityCents: number | null = null;
  if (taxAccount) {
    const balances = await getBalances(tx, tenantId, {
      // Combined DELIBERATELY, to match the invoice half above. See the note on
      // this function — a scoped ledger figure beside an unscoped document
      // figure would be worse than two unscoped ones.
      scope: { kind: "combined" },
      asOf: opts.to,
      accountIds: [taxAccount.id],
    });
    // Natural side (P6): `displayCents` already flips a credit-normal account,
    // so tax collected and not yet remitted comes out POSITIVE. Do not negate
    // it again — that reads correct on an empty account and inverts on a real
    // one.
    liabilityCents = displayCents(
      taxAccount.accountType,
      balances.find((b) => b.accountId === taxAccount.id)?.netCents ?? 0,
    );
  }

  return buildTaxSummary(invoices, rateNames, {
    from: opts.from,
    to: opts.to,
    liabilityCents,
  });
}
