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

/**
 * What a disposal does to the books.
 *
 * Selling or scrapping an asset has to take three things off the balance sheet
 * and recognise the difference:
 *
 *   Dr  Accumulated depreciation   everything written off so far
 *   Dr  Proceeds account           whatever was received, if anything
 *       Cr  Fixed asset account    the original cost
 *   Dr/Cr Gain (Loss)              the plug
 *
 * The plug is `proceeds − net book value`. Positive is a gain and lands as a
 * credit; negative is a loss and lands as a debit. Scrapping something with
 * book value left is a loss of exactly that book value, which is correct and
 * is the case people find surprising.
 *
 * Pure, integer cents, and it balances by construction — the gain is DEFINED as
 * the residual, so the four legs always sum to zero. That is deliberate: a
 * disposal that did not balance would be rejected by the ledger, and the useful
 * failure is the one that says the cost is unknown, not one about arithmetic.
 */
export interface DisposalMaths {
  costCents: number;
  accumulatedCents: number;
  proceedsCents: number;
  /** cost − accumulated. What the books still carry it at. */
  bookValueCents: number;
  /** proceeds − book value. Positive is a gain, negative a loss. */
  gainCents: number;
}

export function disposalMaths(input: {
  costCents: number;
  accumulatedCents: number;
  proceedsCents: number;
}): DisposalMaths {
  const bookValueCents = input.costCents - input.accumulatedCents;
  return {
    ...input,
    bookValueCents,
    gainCents: input.proceedsCents - bookValueCents,
  };
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
 * Idempotency keys, which double as the record of WHICH periods an entry
 * covers.
 *
 * A per-period entry covers one period and its date says which. A catch-up
 * entry covers many periods and its date says none of them — so the range has
 * to live somewhere, and the key is the one place it can live without a new
 * table. `through:` means "every scheduled period up to and including this
 * one". `listPostedPeriods` reads these back and expands them.
 */
export function periodKey(assetId: string, period: string): string {
  return `depreciation:${assetId}:${period}`;
}

export function catchUpKey(assetId: string, throughPeriod: string): string {
  return `depreciation:${assetId}:through:${throughPeriod}`;
}

/** The periods a stored key covers, given the asset's full schedule. */
export function periodsCoveredByKey(
  key: string,
  schedule: DepreciationPeriod[],
): string[] {
  const through = /:through:(\d{4}-\d{2})$/.exec(key);
  if (through) {
    return schedule
      .filter((r) => r.period <= through[1])
      .map((r) => r.period);
  }
  const single = /:(\d{4}-\d{2})$/.exec(key);
  return single ? [single[1]] : [];
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
 * The earliest period this ledger will still accept an entry in.
 *
 * A period is postable when its month-end date falls after `closedThrough`,
 * because that is the date depreciation entries carry. Returns null when
 * nothing is closed, which is the common case and means every period is open.
 */
export function firstOpenPeriod(closedThrough: string | null): string | null {
  if (!closedThrough) return null;
  const candidate = periodOf(closedThrough);
  // A close mid-month still leaves that month's END date open, so the month
  // containing `closedThrough` is only closed when its month-end is covered.
  return periodEndDate(candidate) > closedThrough
    ? candidate
    : addMonths(`${candidate}-01`, 1);
}

/**
 * Split what is due into what the ledger will take now, and what is stranded
 * behind a close.
 *
 * THE PROBLEM THIS SOLVES: any asset entered with a truthful backdated
 * in-service date has periods before the last close — which is most assets,
 * because a business adopting this app already owns things. Posting those
 * individually is refused, and because the run is atomic, one closed month
 * blocks every open month behind it. Found in production 2026-08-15.
 *
 * The stranded periods are not dropped. They are summed into ONE catch-up
 * entry dated in the first open period, which is what a bookkeeper does by
 * hand: the expense is recognised, the accumulated balance ends up correct,
 * and no closed period is reopened to achieve it.
 */
export function splitAtClose(
  due: DepreciationPeriod[],
  closedThrough: string | null,
): { stranded: DepreciationPeriod[]; open: DepreciationPeriod[] } {
  if (!closedThrough) return { stranded: [], open: due };
  const stranded: DepreciationPeriod[] = [];
  const open: DepreciationPeriod[] = [];
  for (const row of due) {
    if (periodEndDate(row.period) <= closedThrough) stranded.push(row);
    else open.push(row);
  }
  return { stranded, open };
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
