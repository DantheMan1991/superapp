import "server-only";
import { type Tx } from "@/db";
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
  buildProfitAndLoss,
  type BalanceSheetReport,
  type CashActivityReport,
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
