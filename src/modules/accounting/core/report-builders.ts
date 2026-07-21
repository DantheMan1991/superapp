import type { Account, DimensionMember } from "@/db/schema";
import type { BalanceRow } from "./balances";

/**
 * Pure report builders — no "server-only", no database imports (BalanceRow
 * is a type-only import). Everything here is fixture-testable without a
 * connection and implements the pinned accounting policies P1–P7 from the
 * session-2 plan. All math is integer cents; no division exists in this
 * file (P5).
 */

export type AccountTypeValue = Account["accountType"];

/** Which side a positive balance sits on. Derived from type, never stored. */
export const NORMAL_BALANCE: Record<AccountTypeValue, "debit" | "credit"> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
};

/** P6: display value of an account's net (positive = its natural side). */
export function displayCents(type: AccountTypeValue, netCents: number): number {
  return NORMAL_BALANCE[type] === "debit" ? netCents : -netCents;
}

// ---------------------------------------------------------------- row model

export type ReportRowKind =
  | "section"
  | "account"
  | "subtotal"
  | "computed"
  | "total";

export interface ReportRow {
  kind: ReportRowKind;
  label: string;
  depth: number;
  accountId?: string;
  code?: string;
  cents?: number;
  comparisonCents?: number;
  /** Aligned with ProfitAndLossReport.columns; by-dimension only. */
  perMemberCents?: number[];
}

export interface ReportColumn {
  key: string; // memberId | "unassigned" | "other" | "total"
  label: string;
  memberId: string | null;
}

export interface ProfitAndLossReport {
  rows: ReportRow[];
  columns?: ReportColumn[];
  grossProfitCents?: number;
  netOperatingIncomeCents?: number;
  netIncomeCents: number;
  comparisonNetIncomeCents?: number;
  period: { from: string; to: string };
  comparison?: { mode: "prev-period" | "prev-year"; from: string; to: string };
}

export interface BalanceSheetReport {
  rows: ReportRow[];
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityCents: number;
  balanced: boolean;
  asOf: string;
  fyStart: string;
  comparison?: { asOf: string; fyStart: string };
}

export interface CashActivityRow {
  accountId: string;
  code: string;
  label: string;
  openingCents: number;
  inCents: number;
  outCents: number;
  netCents: number;
  closingCents: number;
}

export interface CashActivityReport {
  groups: Array<{
    key: "cash" | "credit_card";
    label: string;
    rows: CashActivityRow[];
    totals: Omit<CashActivityRow, "accountId" | "code">;
  }>;
  period: { from: string; to: string };
}

// ---------------------------------------------------------- section mapping

export type PnlSectionKey =
  | "income"
  | "cogs"
  | "expenses"
  | "other_income"
  | "other_expense";

export const PNL_SECTION_BY_SUBTYPE: Record<string, PnlSectionKey> = {
  operating_revenue: "income",
  contra_revenue: "income",
  cogs: "cogs",
  operating_expense: "expenses",
  payroll_expense: "expenses",
  other_income: "other_income",
  other_expense: "other_expense",
};

/** Unknown subtypes (packs add them) degrade to the main sections. */
export function pnlSectionFor(account: Account): PnlSectionKey | null {
  const mapped = PNL_SECTION_BY_SUBTYPE[account.subtype];
  if (mapped) return mapped;
  if (account.accountType === "income") return "income";
  if (account.accountType === "expense") return "expenses";
  return null;
}

const PNL_SECTION_LABELS: Record<PnlSectionKey, string> = {
  income: "Income",
  cogs: "Cost of Goods Sold",
  expenses: "Expenses",
  other_income: "Other Income",
  other_expense: "Other Expense",
};

export type BsGroupKey =
  | "current_assets"
  | "fixed_assets"
  | "other_assets"
  | "current_liabilities"
  | "long_term_liabilities"
  | "other_liabilities"
  | "equity";

export const BS_GROUP_BY_SUBTYPE: Record<string, BsGroupKey> = {
  bank: "current_assets",
  cash: "current_assets",
  undeposited_funds: "current_assets",
  accounts_receivable: "current_assets",
  inventory: "current_assets",
  other_current_asset: "current_assets",
  fixed_asset: "fixed_assets",
  accumulated_depreciation: "fixed_assets",
  accounts_payable: "current_liabilities",
  credit_card: "current_liabilities",
  sales_tax: "current_liabilities",
  payroll_liability: "current_liabilities",
  other_current_liability: "current_liabilities",
  long_term_liability: "long_term_liabilities",
  opening_balance: "equity",
  owner_equity: "equity",
  // retained_earnings deliberately absent: merged into the computed line (P2).
};

export function bsGroupFor(account: Account): BsGroupKey | null {
  if (account.subtype === "retained_earnings") return null; // P2 merge
  const mapped = BS_GROUP_BY_SUBTYPE[account.subtype];
  if (mapped) return mapped;
  if (account.accountType === "asset") return "other_assets";
  if (account.accountType === "liability") return "other_liabilities";
  if (account.accountType === "equity") return "equity";
  return null;
}

// -------------------------------------------------------- hierarchy engine

interface TreeNode {
  account: Account;
  children: TreeNode[];
}

/**
 * P7: build parent trees among the accounts of one section; a child whose
 * section differs from its parent's is promoted to a top-level row of its
 * own section (the parent link is only honored within a section).
 */
function sectionTrees(sectionAccounts: Account[]): TreeNode[] {
  const inSection = new Map(sectionAccounts.map((a) => [a.id, a]));
  const nodes = new Map<string, TreeNode>(
    sectionAccounts.map((a) => [a.id, { account: a, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const a of sectionAccounts) {
    const parentInSection = a.parentId ? inSection.get(a.parentId) : undefined;
    if (parentInSection) {
      nodes.get(a.parentId!)!.children.push(nodes.get(a.id)!);
    } else {
      roots.push(nodes.get(a.id)!);
    }
  }
  const byCode = (x: TreeNode, y: TreeNode) =>
    x.account.code.localeCompare(y.account.code);
  const sortRec = (list: TreeNode[]) => {
    list.sort(byCode);
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

interface AccountAmounts {
  cents: number;
  comparisonCents?: number;
  perMemberCents?: number[];
}

const ZERO = (n: number | undefined) => n === undefined || n === 0;

function amountsVisible(a: AccountAmounts | undefined): boolean {
  if (!a) return false;
  if (!ZERO(a.cents) || !ZERO(a.comparisonCents)) return true;
  return (a.perMemberCents ?? []).some((c) => c !== 0);
}

function addAmounts(into: AccountAmounts, from: AccountAmounts | undefined): void {
  if (!from) return;
  into.cents += from.cents;
  if (from.comparisonCents !== undefined) {
    into.comparisonCents = (into.comparisonCents ?? 0) + from.comparisonCents;
  }
  if (from.perMemberCents) {
    into.perMemberCents = into.perMemberCents ?? from.perMemberCents.map(() => 0);
    from.perMemberCents.forEach((c, i) => (into.perMemberCents![i] += c));
  }
}

/**
 * Emit the rows of one section's account trees (P7): own-activity row per
 * account, children indented, "Total {parent}" subtotal for parents with
 * visible children. Returns the rows plus the section's summed amounts.
 */
function emitSection(
  label: string,
  trees: TreeNode[],
  amounts: Map<string, AccountAmounts>,
  showZero: boolean,
  hasComparison: boolean,
  columnCount: number,
): { rows: ReportRow[]; total: AccountAmounts } {
  const blank = (): AccountAmounts => ({
    cents: 0,
    ...(hasComparison ? { comparisonCents: 0 } : {}),
    ...(columnCount > 0 ? { perMemberCents: Array(columnCount).fill(0) } : {}),
  });

  function subtreeSum(node: TreeNode): AccountAmounts {
    const sum = blank();
    addAmounts(sum, amounts.get(node.account.id));
    node.children.forEach((c) => addAmounts(sum, subtreeSum(c)));
    return sum;
  }

  function visible(node: TreeNode): boolean {
    if (showZero) return true;
    return (
      amountsVisible(amounts.get(node.account.id)) || node.children.some(visible)
    );
  }

  function emit(node: TreeNode, depth: number, out: ReportRow[]): void {
    if (!visible(node)) return;
    const own = amounts.get(node.account.id) ?? blank();
    out.push({
      kind: "account",
      label: node.account.name,
      depth,
      accountId: node.account.id,
      code: node.account.code,
      cents: own.cents,
      ...(hasComparison ? { comparisonCents: own.comparisonCents ?? 0 } : {}),
      ...(columnCount > 0
        ? { perMemberCents: own.perMemberCents ?? Array(columnCount).fill(0) }
        : {}),
    });
    const visibleChildren = node.children.filter(visible);
    visibleChildren.forEach((c) => emit(c, depth + 1, out));
    if (visibleChildren.length > 0) {
      const sub = subtreeSum(node);
      out.push({
        kind: "subtotal",
        label: `Total ${node.account.name}`,
        depth,
        cents: sub.cents,
        ...(hasComparison ? { comparisonCents: sub.comparisonCents ?? 0 } : {}),
        ...(columnCount > 0 ? { perMemberCents: sub.perMemberCents } : {}),
      });
    }
  }

  const rows: ReportRow[] = [];
  const body: ReportRow[] = [];
  trees.forEach((t) => emit(t, 1, body));
  const total = blank();
  trees.forEach((t) => addAmounts(total, subtreeSum(t)));
  if (body.length === 0) return { rows: [], total };
  rows.push({ kind: "section", label, depth: 0 });
  rows.push(...body);
  rows.push({
    kind: "subtotal",
    label: `Total ${label}`,
    depth: 0,
    cents: total.cents,
    ...(hasComparison ? { comparisonCents: total.comparisonCents ?? 0 } : {}),
    ...(columnCount > 0 ? { perMemberCents: total.perMemberCents } : {}),
  });
  return { rows, total };
}

// ---------------------------------------------------------- profit & loss

const DEFAULT_MAX_MEMBER_COLUMNS = 8;

export function buildProfitAndLoss(
  accounts: Account[],
  current: BalanceRow[],
  opts: {
    from: string;
    to: string;
    comparison?: {
      mode: "prev-period" | "prev-year";
      from: string;
      to: string;
      rows: BalanceRow[];
    };
    dimension?: {
      type: string;
      members: Array<Pick<DimensionMember, "id" | "displayName">>;
    };
    maxMemberColumns?: number;
    showZero?: boolean;
  },
): ProfitAndLossReport {
  const pnlAccounts = accounts.filter((a) => pnlSectionFor(a) !== null);
  const byId = new Map(pnlAccounts.map((a) => [a.id, a]));
  const hasComparison = !!opts.comparison;

  // ---- columns (by-dimension only)
  let columns: ReportColumn[] | undefined;
  let columnKeyForMember: ((memberId: string | null) => string) | undefined;
  if (opts.dimension) {
    const activity = new Map<string, number>(); // memberId -> Σ|display|
    let unassignedActivity = 0;
    for (const row of current) {
      const account = byId.get(row.accountId);
      if (!account) continue;
      const d = Math.abs(displayCents(account.accountType, row.netCents));
      if (row.memberId === null) unassignedActivity += d;
      else activity.set(row.memberId, (activity.get(row.memberId) ?? 0) + d);
    }
    const cap = opts.maxMemberColumns ?? DEFAULT_MAX_MEMBER_COLUMNS;
    const active = [...activity.entries()].filter(([, v]) => v !== 0);
    const kept = active
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap)
      .map(([id]) => id);
    const keptSet = new Set(kept);
    const hasOther = active.length > kept.length;
    const nameOf = new Map(opts.dimension.members.map((m) => [m.id, m.displayName]));
    const memberColumns: ReportColumn[] = kept
      .map((id) => ({
        key: id,
        label: nameOf.get(id) ?? "Unknown",
        memberId: id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    columns = [
      ...memberColumns,
      ...(hasOther ? [{ key: "other", label: "Other", memberId: null }] : []),
      ...(unassignedActivity !== 0
        ? [{ key: "unassigned", label: "Unassigned", memberId: null }]
        : []),
      { key: "total", label: "Total", memberId: null },
    ];
    columnKeyForMember = (memberId) =>
      memberId === null ? "unassigned" : keptSet.has(memberId) ? memberId : "other";
  }
  const columnIndex = new Map((columns ?? []).map((c, i) => [c.key, i]));
  const columnCount = columns?.length ?? 0;

  // ---- per-account amounts
  const amounts = new Map<string, AccountAmounts>();
  const ensure = (id: string): AccountAmounts => {
    let a = amounts.get(id);
    if (!a) {
      a = {
        cents: 0,
        ...(hasComparison ? { comparisonCents: 0 } : {}),
        ...(columnCount > 0 ? { perMemberCents: Array(columnCount).fill(0) } : {}),
      };
      amounts.set(id, a);
    }
    return a;
  };
  for (const row of current) {
    const account = byId.get(row.accountId);
    if (!account) continue;
    const d = displayCents(account.accountType, row.netCents);
    const a = ensure(row.accountId);
    a.cents += d;
    if (columns && columnKeyForMember) {
      const key = columnKeyForMember(row.memberId);
      const idx = columnIndex.get(key);
      if (idx !== undefined) a.perMemberCents![idx] += d;
      a.perMemberCents![columnIndex.get("total")!] += d;
    }
  }
  for (const row of opts.comparison?.rows ?? []) {
    const account = byId.get(row.accountId);
    if (!account) continue;
    const a = ensure(row.accountId);
    a.comparisonCents =
      (a.comparisonCents ?? 0) + displayCents(account.accountType, row.netCents);
  }

  // ---- sections
  const bySection = new Map<PnlSectionKey, Account[]>();
  for (const a of pnlAccounts) {
    const s = pnlSectionFor(a)!;
    const list = bySection.get(s) ?? [];
    list.push(a);
    bySection.set(s, list);
  }
  const section = (key: PnlSectionKey) =>
    emitSection(
      PNL_SECTION_LABELS[key],
      sectionTrees(bySection.get(key) ?? []),
      amounts,
      opts.showZero ?? false,
      hasComparison,
      columnCount,
    );

  const income = section("income");
  const cogs = section("cogs");
  const expenses = section("expenses");
  const otherIncome = section("other_income");
  const otherExpense = section("other_expense");

  const hasCogs = cogs.rows.length > 0;
  const hasOther = otherIncome.rows.length > 0 || otherExpense.rows.length > 0;

  const combine = (
    label: string,
    kind: ReportRowKind,
    parts: AccountAmounts[],
    signs: number[],
  ): { row: ReportRow; value: AccountAmounts } => {
    const value: AccountAmounts = {
      cents: 0,
      ...(hasComparison ? { comparisonCents: 0 } : {}),
      ...(columnCount > 0 ? { perMemberCents: Array(columnCount).fill(0) } : {}),
    };
    parts.forEach((p, i) => {
      value.cents += signs[i] * p.cents;
      if (hasComparison) {
        value.comparisonCents =
          (value.comparisonCents ?? 0) + signs[i] * (p.comparisonCents ?? 0);
      }
      if (columnCount > 0 && p.perMemberCents) {
        p.perMemberCents.forEach(
          (c, j) => (value.perMemberCents![j] += signs[i] * c),
        );
      }
    });
    return {
      row: {
        kind,
        label,
        depth: 0,
        cents: value.cents,
        ...(hasComparison ? { comparisonCents: value.comparisonCents ?? 0 } : {}),
        ...(columnCount > 0 ? { perMemberCents: value.perMemberCents } : {}),
      },
      value,
    };
  };

  const rows: ReportRow[] = [...income.rows, ...cogs.rows];
  let grossProfit: AccountAmounts | undefined;
  if (hasCogs) {
    const gp = combine("Gross Profit", "computed", [income.total, cogs.total], [1, -1]);
    rows.push(gp.row);
    grossProfit = gp.value;
  }
  rows.push(...expenses.rows);
  let netOperating: AccountAmounts | undefined;
  if (hasCogs || hasOther) {
    const base = grossProfit ?? income.total;
    const noi = combine(
      "Net Operating Income",
      "computed",
      [base, expenses.total],
      [1, -1],
    );
    rows.push(noi.row);
    netOperating = noi.value;
  }
  rows.push(...otherIncome.rows, ...otherExpense.rows);
  const net = combine(
    "Net Income",
    "total",
    [income.total, cogs.total, expenses.total, otherIncome.total, otherExpense.total],
    [1, -1, -1, 1, -1],
  );
  rows.push(net.row);

  return {
    rows,
    ...(columns ? { columns } : {}),
    ...(grossProfit ? { grossProfitCents: grossProfit.cents } : {}),
    ...(netOperating ? { netOperatingIncomeCents: netOperating.cents } : {}),
    netIncomeCents: net.value.cents,
    ...(hasComparison
      ? { comparisonNetIncomeCents: net.value.comparisonCents ?? 0 }
      : {}),
    period: { from: opts.from, to: opts.to },
    ...(opts.comparison
      ? {
          comparison: {
            mode: opts.comparison.mode,
            from: opts.comparison.from,
            to: opts.comparison.to,
          },
        }
      : {}),
  };
}

// ----------------------------------------------------------- balance sheet

const BS_GROUP_LABELS: Record<BsGroupKey, string> = {
  current_assets: "Current Assets",
  fixed_assets: "Fixed Assets",
  other_assets: "Other Assets",
  current_liabilities: "Current Liabilities",
  long_term_liabilities: "Long-Term Liabilities",
  other_liabilities: "Other Liabilities",
  equity: "Equity",
};

interface BsData {
  cumulative: BalanceRow[];
  priorFyBoundary: BalanceRow[];
}

/** P2 math over one dataset. All values display-signed. */
function bsFigures(accounts: Account[], data: BsData) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const netOf = new Map<string, number>();
  for (const row of data.cumulative) {
    netOf.set(row.accountId, (netOf.get(row.accountId) ?? 0) + row.netCents);
  }
  let priorYearsNI = 0;
  for (const row of data.priorFyBoundary) {
    const t = byId.get(row.accountId)?.accountType;
    if (t === "income" || t === "expense") priorYearsNI += -row.netCents;
  }
  let totalNI = 0;
  let retainedAccounts = 0;
  for (const [id, net] of netOf) {
    const account = byId.get(id);
    if (!account) continue;
    if (account.accountType === "income" || account.accountType === "expense") {
      totalNI += -net;
    }
    if (account.subtype === "retained_earnings") {
      retainedAccounts += displayCents(account.accountType, net);
    }
  }
  const currentFyNI = totalNI - priorYearsNI;
  return {
    display: (a: Account) => displayCents(a.accountType, netOf.get(a.id) ?? 0),
    retainedEarningsLine: retainedAccounts + priorYearsNI,
    netIncomeLine: currentFyNI,
  };
}

export function buildBalanceSheet(
  accounts: Account[],
  data: {
    cumulative: BalanceRow[];
    priorFyBoundary: BalanceRow[];
    comparison?: BsData & { asOf: string; fyStart: string };
  },
  opts: { asOf: string; fyStart: string; showZero?: boolean },
): BalanceSheetReport {
  const showZero = opts.showZero ?? false;
  const cur = bsFigures(accounts, data);
  const cmp = data.comparison ? bsFigures(accounts, data.comparison) : undefined;
  const hasComparison = !!cmp;

  const amounts = new Map<string, AccountAmounts>();
  for (const a of accounts) {
    amounts.set(a.id, {
      cents: cur.display(a),
      ...(hasComparison ? { comparisonCents: cmp!.display(a) } : {}),
    });
  }

  const byGroup = new Map<BsGroupKey, Account[]>();
  for (const a of accounts) {
    const g = bsGroupFor(a);
    if (!g) continue;
    const list = byGroup.get(g) ?? [];
    list.push(a);
    byGroup.set(g, list);
  }
  const group = (key: BsGroupKey) =>
    emitSection(
      BS_GROUP_LABELS[key],
      sectionTrees(byGroup.get(key) ?? []),
      amounts,
      showZero,
      hasComparison,
      0,
    );

  const mk = (
    kind: ReportRowKind,
    label: string,
    cents: number,
    comparisonCents?: number,
  ): ReportRow => ({
    kind,
    label,
    depth: 0,
    cents,
    ...(hasComparison ? { comparisonCents: comparisonCents ?? 0 } : {}),
  });

  const rows: ReportRow[] = [];

  // Assets
  const assetGroups = (["current_assets", "fixed_assets", "other_assets"] as const)
    .map(group)
    .filter((g) => g.rows.length > 0);
  rows.push({ kind: "section", label: "Assets", depth: 0 });
  assetGroups.forEach((g) => rows.push(...g.rows));
  const totalAssets = assetGroups.reduce((s, g) => s + g.total.cents, 0);
  const cmpAssets = assetGroups.reduce(
    (s, g) => s + (g.total.comparisonCents ?? 0),
    0,
  );
  rows.push(mk("total", "Total Assets", totalAssets, cmpAssets));

  // Liabilities
  const liabilityGroups = (
    ["current_liabilities", "long_term_liabilities", "other_liabilities"] as const
  )
    .map(group)
    .filter((g) => g.rows.length > 0);
  rows.push({ kind: "section", label: "Liabilities", depth: 0 });
  liabilityGroups.forEach((g) => rows.push(...g.rows));
  const totalLiabilities = liabilityGroups.reduce((s, g) => s + g.total.cents, 0);
  const cmpLiabilities = liabilityGroups.reduce(
    (s, g) => s + (g.total.comparisonCents ?? 0),
    0,
  );
  rows.push(mk("total", "Total Liabilities", totalLiabilities, cmpLiabilities));

  // Equity (account rows + the two computed lines per P2)
  const equity = group("equity");
  rows.push({ kind: "section", label: "Equity", depth: 0 });
  // Strip the emitted group's own header/total rows: equity renders flat
  // under its section header with a single Total Equity that includes the
  // computed lines.
  const equityBody = equity.rows.filter(
    (r) => !(r.kind === "section") && r.label !== "Total Equity",
  );
  rows.push(...equityBody);
  if (
    showZero ||
    cur.retainedEarningsLine !== 0 ||
    (cmp && cmp.retainedEarningsLine !== 0)
  ) {
    rows.push(
      mk(
        "computed",
        "Retained Earnings",
        cur.retainedEarningsLine,
        cmp?.retainedEarningsLine,
      ),
    );
  }
  rows.push(mk("computed", "Net Income", cur.netIncomeLine, cmp?.netIncomeLine));
  const totalEquity =
    equity.total.cents + cur.retainedEarningsLine + cur.netIncomeLine;
  const cmpEquity = cmp
    ? (equity.total.comparisonCents ?? 0) +
      cmp.retainedEarningsLine +
      cmp.netIncomeLine
    : undefined;
  rows.push(mk("total", "Total Equity", totalEquity, cmpEquity));
  rows.push(
    mk(
      "total",
      "Total Liabilities & Equity",
      totalLiabilities + totalEquity,
      cmp !== undefined ? cmpLiabilities + (cmpEquity ?? 0) : undefined,
    ),
  );

  return {
    rows,
    totalAssetsCents: totalAssets,
    totalLiabilitiesCents: totalLiabilities,
    totalEquityCents: totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
    asOf: opts.asOf,
    fyStart: opts.fyStart,
    ...(data.comparison
      ? { comparison: { asOf: data.comparison.asOf, fyStart: data.comparison.fyStart } }
      : {}),
  };
}

// ----------------------------------------------------------- cash activity

export function buildCashActivity(
  accounts: Account[],
  opening: BalanceRow[],
  activity: BalanceRow[],
  opts: { from: string; to: string },
): CashActivityReport {
  const openingNet = new Map(opening.map((r) => [r.accountId, r.netCents]));
  const act = new Map(activity.map((r) => [r.accountId, r]));

  function rowsFor(
    subtypes: string[],
    owed: boolean,
  ): CashActivityRow[] {
    return accounts
      .filter((a) => subtypes.includes(a.subtype))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => {
        const net0 = openingNet.get(a.id) ?? 0;
        const r = act.get(a.id);
        const debits = r?.debitCents ?? 0;
        const credits = r?.creditCents ?? 0;
        // Cash accounts (debit-normal): in = debits, out = credits.
        // Credit cards (owed-positive): charges = credits, payments = debits.
        const opening = owed ? -net0 : net0;
        const inCents = owed ? credits : debits;
        const outCents = owed ? debits : credits;
        const netCents = inCents - outCents;
        return {
          accountId: a.id,
          code: a.code,
          label: a.name,
          openingCents: opening,
          inCents,
          outCents,
          netCents,
          closingCents: opening + netCents,
        };
      })
      .filter(
        (r) => r.openingCents !== 0 || r.inCents !== 0 || r.outCents !== 0,
      );
  }

  const sum = (rows: CashActivityRow[]) => ({
    label: "Total",
    openingCents: rows.reduce((s, r) => s + r.openingCents, 0),
    inCents: rows.reduce((s, r) => s + r.inCents, 0),
    outCents: rows.reduce((s, r) => s + r.outCents, 0),
    netCents: rows.reduce((s, r) => s + r.netCents, 0),
    closingCents: rows.reduce((s, r) => s + r.closingCents, 0),
  });

  const cashRows = rowsFor(["bank", "cash"], false);
  const cardRows = rowsFor(["credit_card"], true);
  const groups: CashActivityReport["groups"] = [];
  if (cashRows.length > 0 || cardRows.length === 0) {
    groups.push({ key: "cash", label: "Cash accounts", rows: cashRows, totals: sum(cashRows) });
  }
  if (cardRows.length > 0) {
    groups.push({ key: "credit_card", label: "Credit cards", rows: cardRows, totals: sum(cardRows) });
  }
  return { groups, period: { from: opts.from, to: opts.to } };
}
