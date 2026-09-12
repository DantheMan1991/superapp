/**
 * Turning a week's buckets into money. NO IMPORTS AND NO DIRECTIVE — pure
 * arithmetic over minutes and cents.
 *
 * ── THE REGULAR RATE IS NOT THE BASE RATE ────────────────────────────────────
 *
 * This is the rule that makes `hours × 1.5 × rate` wrong, and it is wrong
 * quietly: it gives the right answer for everybody on a single rate and a
 * different answer for everybody else. Under the FLSA, overtime is paid on the
 * **regular rate**, which is total straight-time pay divided by hours worked —
 * a WEIGHTED AVERAGE when somebody worked at more than one rate that week.
 *
 *     20h at $20 and 20h at $30 is $1,000 straight time over 40 hours.
 *     The regular rate is $25. Not $20, and not $30.
 *
 * And the premium is HALF that on top of straight time already paid, not one
 * and a half times it: every worked hour is paid once at its own rate, and
 * overtime hours get an extra 0.5 × the regular rate. Double time gets an extra
 * 1.0. Paying 1.5 × rate for overtime hours double-counts the straight half.
 *
 * ── WHAT IS DELIBERATELY EXCLUDED ────────────────────────────────────────────
 *
 * **Paid leave never touches the regular rate.** It is not hours worked, so it
 * neither raises nor dilutes the average; it is paid at its own rate and added
 * at the end. Including it is the same family of error as counting it toward
 * the 40.
 *
 * Non-discretionary bonuses, shift differentials and on-call pay DO belong in
 * the regular rate and are not modelled yet — nothing in this product can
 * record one. When they arrive they come in as extra straight-time earnings
 * here, which is why this takes earnings rather than a single rate.
 *
 * **Burden is not pay.** Employer taxes and insurance are what an hour COSTS;
 * they are never part of what somebody is paid, so they are computed separately
 * and never reach gross.
 *
 * ── THE PARTS ALWAYS ADD UP ──────────────────────────────────────────────────
 *
 * Each component is rounded to whole cents and the gross is their SUM, rather
 * than the gross being rounded separately. A reader checking a payslip adds the
 * lines up, and lines that do not sum to the total are a support ticket
 * whatever the rounding rule says.
 */

/** Minutes worked at one rate. Several of these make a week. */
export interface RatedMinutes {
  minutes: number;
  /** Cents per hour in force for those minutes. */
  rateCents: number;
}

export interface PayInput {
  /** Worked minutes grouped by the rate in force. */
  worked: readonly RatedMinutes[];
  /** From `evaluateWeek`. Already excludes leave. */
  overtimeMinutes: number;
  doubleTimeMinutes: number;
  /** Paid but not worked. Kept out of the regular rate; paid at its own rate. */
  leave: readonly RatedMinutes[];
}

export interface PayResult {
  /** Every worked hour once, at whatever rate was in force. */
  straightTimeCents: number;
  /** The weighted average, cents per hour. Zero when nothing was worked. */
  regularRateCents: number;
  /** The extra half on overtime hours. */
  overtimePremiumCents: number;
  /** The extra whole on double-time hours. */
  doubleTimePremiumCents: number;
  leaveCents: number;
  /** The sum of the four components above. */
  grossCents: number;
  /** True when some worked minutes had no rate behind them. */
  incomplete: boolean;
}

function earnings(parts: readonly RatedMinutes[]): number {
  return parts.reduce((sum, p) => sum + (p.minutes / 60) * p.rateCents, 0);
}

function minutesOf(parts: readonly RatedMinutes[]): number {
  return parts.reduce((sum, p) => sum + p.minutes, 0);
}

/**
 * One worker, one workweek, in cents.
 *
 * `incomplete` is not a failure. A business part-way through entering rates has
 * people with none, and the honest answer is a figure for those who have one
 * plus a flag saying it is not the whole story — better than refusing to show
 * anything, and far better than quietly treating a missing rate as zero without
 * saying so.
 */
export function payForWeek(input: PayInput): PayResult {
  const workedMinutes = minutesOf(input.worked);
  const straightTime = earnings(input.worked);
  const leave = earnings(input.leave);

  const regularRate =
    workedMinutes > 0 ? straightTime / (workedMinutes / 60) : 0;

  const straightTimeCents = Math.round(straightTime);
  const overtimePremiumCents = Math.round(
    0.5 * regularRate * (input.overtimeMinutes / 60),
  );
  const doubleTimePremiumCents = Math.round(
    1.0 * regularRate * (input.doubleTimeMinutes / 60),
  );
  const leaveCents = Math.round(leave);

  return {
    straightTimeCents,
    regularRateCents: Math.round(regularRate),
    overtimePremiumCents,
    doubleTimePremiumCents,
    leaveCents,
    grossCents:
      straightTimeCents +
      overtimePremiumCents +
      doubleTimePremiumCents +
      leaveCents,
    incomplete: input.worked.some((p) => p.rateCents <= 0),
  };
}

/**
 * What an hour COSTS the business: the wage plus the employer's on-cost.
 *
 * Kept apart from `payForWeek` because it answers a different question and must
 * never leak into one another's figure. Gross is what somebody receives; this
 * is what the business spends, and it is the number slice 6 posts to the books.
 */
export function costWithBurden(payCents: number, burdenPercent: number): number {
  return Math.round(payCents * (1 + burdenPercent / 100));
}

/** "$24.50" from 2450. Money is formatted once, here. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** A rate history row, newest or oldest first — this sorts for itself. */
export interface DatedRate {
  effectiveOn: string;
  payRateCents: number;
}

/**
 * The rate in force on a day: the newest row that starts on or before it.
 *
 * Returns 0 when the history begins after that day, which happens whenever
 * somebody worked before anybody wrote down what they were paid. Zero rather
 * than the earliest rate on purpose — projecting today's wage backwards over
 * work done before it was agreed invents a number, and `payForWeek` reports the
 * gap as `incomplete` instead.
 */
export function rateOnDate(rates: readonly DatedRate[], date: string): number {
  let best: DatedRate | null = null;
  for (const rate of rates) {
    if (rate.effectiveOn > date) continue;
    if (!best || rate.effectiveOn > best.effectiveOn) best = rate;
  }
  return best?.payRateCents ?? 0;
}

/**
 * Group minutes by the rate that was in force, which is what `payForWeek`
 * takes. Several days at one rate collapse into one entry; a raise mid-week
 * produces two.
 */
export function groupByRate(
  days: readonly { workDate: string; minutes: number }[],
  rates: readonly DatedRate[],
): RatedMinutes[] {
  const byRate = new Map<number, number>();
  for (const day of days) {
    const rate = rateOnDate(rates, day.workDate);
    byRate.set(rate, (byRate.get(rate) ?? 0) + day.minutes);
  }
  return [...byRate.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([rateCents, minutes]) => ({ rateCents, minutes }));
}
