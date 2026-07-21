import "server-only";
import { type Tx } from "@/db";
import {
  addDaysIso,
  fiscalYearStart,
  previousPeriod,
  previousYear,
  shiftYearsIso,
} from "../lib/dates";
import { getBalances } from "./balances";
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
  },
): Promise<ProfitAndLossReport> {
  const accounts = await listAccounts(tx, tenantId);
  const dimensionType = opts.compare ? undefined : opts.dimensionType;
  const current = await getBalances(tx, tenantId, {
    from: opts.from,
    to: opts.to,
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
      rows: await getBalances(tx, tenantId, range),
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
  opts: { asOf: string; compare?: "prev-year"; showZero?: boolean },
): Promise<BalanceSheetReport> {
  const accounts = await listAccounts(tx, tenantId);
  const settings = await getSettings(tx, tenantId);
  const fyStart = fiscalYearStart(opts.asOf, settings.fiscalYearStartMonth);
  const fetchPair = async (asOf: string, fy: string) => ({
    cumulative: await getBalances(tx, tenantId, { asOf }),
    priorFyBoundary: await getBalances(tx, tenantId, {
      asOf: addDaysIso(fy, -1),
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
