/**
 * Depreciation schedules. PURE — no imports, no `server-only`, no database.
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD:
 *
 *   sum(every period's amount) === cost − salvage, EXACTLY.
 *
 * Not approximately, and not "within a cent". An asset whose schedule sums to
 * one cent less than its depreciable base leaves a permanent orphan on the
 * balance sheet that nobody can explain and no journal entry will clear.
 *
 * That is the same discipline `cash-basis-allocate.ts` describes as "THE ONE
 * PLACE IN REPORT MATH THAT DIVIDES" — division quarantined in one file, an
 * exact remainder rule, tested to the cent. This is the second such place, and
 * it follows the first deliberately rather than inventing its own rounding.
 *
 * Integer cents throughout. No float ever holds money here.
 */

export const DEPRECIATION_METHODS = ["none", "straight_line"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export function isDepreciationMethod(v: string): v is DepreciationMethod {
  return (DEPRECIATION_METHODS as readonly string[]).includes(v);
}

export interface DepreciationInput {
  /** Acquisition cost in cents. Required for any method other than `none`. */
  costCents: number;
  /** Expected value at the end of life. Depreciation stops here, never below. */
  salvageValueCents: number;
  method: DepreciationMethod;
  /** Months, not years — a 7-year life is 84. */
  usefulLifeMonths: number;
  /** ISO date the asset was placed in service. NOT the acquisition date. */
  inServiceOn: string;
}

export interface DepreciationPeriod {
  /** `YYYY-MM`. One row per month of the asset's life. */
  period: string;
  amountCents: number;
  /** Running total through this period, inclusive. */
  accumulatedCents: number;
  /** cost − accumulated. Lands exactly on salvage in the final period. */
  bookValueCents: number;
}

/** Depreciable base: what will be written off over the whole life. */
export function depreciableBaseCents(input: {
  costCents: number;
  salvageValueCents: number;
}): number {
  return Math.max(0, input.costCents - input.salvageValueCents);
}

function addMonths(iso: string, months: number): string {
  // Parsed by hand rather than through Date, because `new Date("2026-01-31")`
  // plus a month is a well-known source of "March 3rd" bugs. Periods here are
  // month buckets, so day-of-month is irrelevant and never reintroduced.
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)); // 1-12
  const zeroBased = month - 1 + months;
  const y = year + Math.floor(zeroBased / 12);
  const m = ((zeroBased % 12) + 12) % 12;
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * The full monthly schedule, from the in-service month onward.
 *
 * Straight-line, monthly, with **no convention applied** — depreciation starts
 * in the month the asset was placed in service and runs for exactly
 * `usefulLifeMonths` periods. Half-year, mid-quarter and mid-month conventions
 * are tax rules and are NOT modelled here; see the dossier's open items for why
 * that is a deliberate line rather than an omission.
 *
 * Rounding: every period gets `floor(base / n)`, and the remainder is spread
 * one cent at a time across the EARLIEST periods. Earliest rather than last
 * because the final period should be the plain per-month figure — a schedule
 * whose last row is visibly different reads as a mistake to whoever checks it,
 * and front-loading a cent is invisible and equally exact.
 */
export function buildSchedule(input: DepreciationInput): DepreciationPeriod[] {
  if (input.method === "none") return [];
  if (input.usefulLifeMonths <= 0) return [];

  const base = depreciableBaseCents(input);
  if (base === 0) return [];

  const n = input.usefulLifeMonths;
  const perMonth = Math.floor(base / n);
  const remainder = base - perMonth * n; // 0 <= remainder < n

  const rows: DepreciationPeriod[] = [];
  let accumulated = 0;
  for (let i = 0; i < n; i++) {
    const amount = perMonth + (i < remainder ? 1 : 0);
    accumulated += amount;
    rows.push({
      period: addMonths(input.inServiceOn, i),
      amountCents: amount,
      accumulatedCents: accumulated,
      bookValueCents: input.costCents - accumulated,
    });
  }
  return rows;
}

/** The single period, if this asset depreciates in it. */
export function periodAmountCents(
  input: DepreciationInput,
  period: string,
): number {
  const row = buildSchedule(input).find((r) => r.period === period);
  return row?.amountCents ?? 0;
}

/**
 * Every period from the start of the schedule up to and including `through`
 * that has not already been posted.
 *
 * Catch-up is the normal case, not an edge case: nobody opens this app on the
 * last day of every month. An asset placed in service in March and first looked
 * at in September owes six periods, and they are posted as six dated entries
 * rather than one lump — so a P&L for April shows April's depreciation.
 */
export function unpostedPeriods(
  input: DepreciationInput,
  through: string,
  alreadyPosted: Iterable<string>,
): DepreciationPeriod[] {
  const posted = new Set(alreadyPosted);
  return buildSchedule(input).filter(
    (row) => row.period <= through && !posted.has(row.period),
  );
}

/** `YYYY-MM` for an ISO date. The period a date falls in. */
export function periodOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * The last day of a period, as an ISO date.
 *
 * Depreciation is dated to the end of the month it covers, which is both the
 * convention and the only choice that keeps a monthly P&L honest — dating it to
 * the first would push a month's expense into the prior period on any report
 * cut on a month boundary.
 */
export function periodEndDate(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  // Day 0 of the NEXT month is the last day of this one, and it handles leap
  // years without a table.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}
