/**
 * The Job cost tab's arithmetic: how full a code is, what the totals row adds
 * up, and which codes a filter keeps.
 *
 * Pure, no imports — the same discipline as `wip-math.ts`, so a client
 * component may read it and `tests/jobs-cost-math.test.ts` can pin every rule
 * without a database.
 *
 * ── THE TOTALS ROW COUNTS BUDGETED CODES ONLY ───────────────────────────────
 *
 * A code somebody ordered against and never budgeted is the most interesting
 * row on the page, and it must not be added into a comparison it has no budget
 * side of: "$140k budget against $180k ordered" would be a lie if $40k of that
 * ordering sits on codes with no budget at all. The page has always applied
 * this filter to its headline sentence; the totals row now applies the same one
 * through the same function, so the sentence and the row cannot disagree.
 */

/** A rate in parts per million, so 100% is a million — the pack's convention. */
export const COST_PPM = 1_000_000;

export interface CostRowLike {
  budgetCents: number;
  committedCents: number;
  actualCents: number;
  /** The greater of committed and actual: what the code will cost at least. */
  projectedCents: number;
  varianceCents: number;
  changesCents: number;
  hasBudget: boolean;
}

/**
 * How much of a code's budget is spoken for, in parts per million.
 *
 * Measured on `projectedCents`, NOT on spend alone — the same figure `Left`
 * subtracts, so the bar and the number beside it can never tell different
 * stories. Null when there is no budget: a code with money against it and no
 * budget is not "0% full", it is unmeasurable, and the cell says so instead.
 *
 * NOT capped. A code 140% through its budget is exactly the row somebody needs
 * to see, and flattening it to 100% would hide the size of the problem — the
 * BAR clamps itself (`barWidthPercent`), the figure does not.
 */
export function ofBudgetPpm(row: CostRowLike): number | null {
  if (!row.hasBudget || row.budgetCents <= 0) return null;
  if (row.projectedCents <= 0) return 0;
  return Math.round((row.projectedCents * COST_PPM) / row.budgetCents);
}

/** The bar's width. Clamped, because a track cannot be 140% long. */
export function barWidthPercent(ppm: number | null): number {
  if (ppm === null || ppm <= 0) return 0;
  return Math.min(100, ppm / 10_000);
}

/** 1_400_000 → "140", 333_333 → "33.3", null → "—". One decimal, no trailing zero. */
export function ofBudgetLabel(ppm: number | null): string {
  if (ppm === null) return "—";
  const pct = Math.round(ppm / 1_000) / 10;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

export const COST_FILTERS = ["all", "over", "unbudgeted"] as const;

export type CostFilterKey = (typeof COST_FILTERS)[number];

export function isCostFilterKey(value: unknown): value is CostFilterKey {
  return typeof value === "string" && (COST_FILTERS as readonly string[]).includes(value);
}

export const COST_FILTER_LABELS: Record<CostFilterKey, string> = {
  all: "All codes",
  over: "Over budget",
  unbudgeted: "Not budgeted",
};

/**
 * `over` is a budgeted code whose variance has gone negative — a code with no
 * budget cannot be "over" one, however much has been spent on it, and putting
 * it under that pill would be the same category error the totals row avoids.
 */
export function matchesCostFilter(row: CostRowLike, filter: CostFilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "unbudgeted") return !row.hasBudget;
  return row.hasBudget && row.varianceCents < 0;
}

export function costFilterCounts(
  rows: readonly CostRowLike[],
): Record<CostFilterKey, number> {
  return {
    all: rows.length,
    over: rows.filter((r) => matchesCostFilter(r, "over")).length,
    unbudgeted: rows.filter((r) => matchesCostFilter(r, "unbudgeted")).length,
  };
}

export interface CostTotals {
  budgetCents: number;
  committedCents: number;
  actualCents: number;
  projectedCents: number;
  varianceCents: number;
  changesCents: number;
  /** How many codes carry a budget — what the totals are over. */
  budgetedCount: number;
  /** Codes with money on them and no budget, excluded from every figure above. */
  unbudgetedCount: number;
}

export function costTotals(rows: readonly CostRowLike[]): CostTotals {
  const budgeted = rows.filter((r) => r.hasBudget);
  const sum = (pick: (r: CostRowLike) => number) =>
    budgeted.reduce((total, r) => total + pick(r), 0);
  return {
    budgetCents: sum((r) => r.budgetCents),
    committedCents: sum((r) => r.committedCents),
    actualCents: sum((r) => r.actualCents),
    projectedCents: sum((r) => r.projectedCents),
    varianceCents: sum((r) => r.varianceCents),
    changesCents: sum((r) => r.changesCents),
    budgetedCount: budgeted.length,
    unbudgetedCount: rows.length - budgeted.length,
  };
}
