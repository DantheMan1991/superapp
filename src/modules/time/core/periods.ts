/**
 * Pay periods, and the workweeks inside them. Imports only `@/lib/timezone`,
 * which is deliberately client-safe, so this bundles to the browser.
 *
 * ── A PAY PERIOD IS NOT A WORKWEEK ───────────────────────────────────────────
 *
 * The workweek is the unit of OVERTIME and lives in `overtime.ts`. This file is
 * the unit of PAYMENT, and the two are allowed to disagree:
 *
 *   weekly        one workweek, exactly. The only frequency where they agree.
 *   biweekly      TWO workweeks. Each is evaluated separately — averaging them
 *                 is the most common payroll error there is.
 *   semi-monthly  the 1st to the 15th and the 16th to the end of the month.
 *                 Does not align to weeks at all, so a workweek straddles two
 *                 periods and something has to decide which one pays it.
 *   monthly       the calendar month. Same straddling problem.
 *
 * ── THE STRADDLE RULE ────────────────────────────────────────────────────────
 *
 * **Overtime is paid in the period where the workweek ENDS.** A week running
 * from the 29th to the 4th is paid in the period containing the 4th. One rule,
 * stated once, applied by `workweeksPaidIn` — the alternative (splitting a
 * week's overtime across two periods) cannot be done without deciding which
 * hours were the overtime ones, which is a question with no true answer.
 */
import { addDays, datesBetween, startOfWeek } from "@/lib/timezone";

export const PAY_FREQUENCIES = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
] as const;

export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export function isPayFrequency(value: string): value is PayFrequency {
  return (PAY_FREQUENCIES as readonly string[]).includes(value);
}

export function payFrequencyLabel(value: string): string {
  switch (value) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every two weeks";
    case "semimonthly":
      return "Twice a month";
    case "monthly":
      return "Monthly";
    default:
      return value;
  }
}

export interface PayPeriodSettings {
  frequency: PayFrequency;
  /** 0 = Sunday … 6 = Saturday. Decides the workweek, and the weekly period. */
  weekStartsOn: number;
  /**
   * The first day of some period, for `biweekly` only — the one frequency
   * whose boundaries cannot be derived from the calendar or the week start.
   * Null means "use the workweek containing the epoch", which the settings
   * screen never lets happen.
   */
  anchor: string | null;
}

export interface PayPeriod {
  start: string;
  end: string;
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** The period `date` falls in. */
export function payPeriodFor(date: string, s: PayPeriodSettings): PayPeriod {
  const [y, m, d] = date.split("-").map(Number);

  switch (s.frequency) {
    case "weekly": {
      const start = startOfWeek(date, s.weekStartsOn);
      return { start, end: addDays(start, 6) };
    }
    case "biweekly": {
      /*
       * Anchored, because nothing in the calendar says which of two weeks
       * starts a period. The anchor is normalised to a week start so a period
       * is always exactly two workweeks — an anchor typed mid-week would
       * otherwise produce periods that cut a workweek in half, and the overtime
       * inside it could never be paid whole.
       */
      const anchor = startOfWeek(s.anchor ?? "1970-01-04", s.weekStartsOn);
      const days = datesBetween(
        anchor <= date ? anchor : date,
        anchor <= date ? date : anchor,
      ).length - 1;
      const periods = anchor <= date ? Math.floor(days / 14) : -Math.ceil(days / 14);
      const start = addDays(anchor, periods * 14);
      return { start, end: addDays(start, 13) };
    }
    case "semimonthly": {
      if (d <= 15) {
        return {
          start: `${date.slice(0, 8)}01`,
          end: `${date.slice(0, 8)}15`,
        };
      }
      const last = lastDayOfMonth(y, m);
      return {
        start: `${date.slice(0, 8)}16`,
        end: `${date.slice(0, 8)}${String(last).padStart(2, "0")}`,
      };
    }
    case "monthly": {
      const last = lastDayOfMonth(y, m);
      return {
        start: `${date.slice(0, 8)}01`,
        end: `${date.slice(0, 8)}${String(last).padStart(2, "0")}`,
      };
    }
  }
}

/** The period before or after this one. `step` is -1 or 1. */
export function adjacentPayPeriod(
  period: PayPeriod,
  step: number,
  s: PayPeriodSettings,
): PayPeriod {
  const probe = step < 0 ? addDays(period.start, -1) : addDays(period.end, 1);
  return payPeriodFor(probe, s);
}

/**
 * The workweeks this period PAYS — the ones whose last day falls inside it.
 *
 * For weekly and biweekly this is exactly one and exactly two. For the two
 * calendar frequencies it is however many weeks end in the month or half-month,
 * which is the straddle rule doing its job: a week beginning on the 29th is
 * paid in the period containing its end, not split.
 */
export function workweeksPaidIn(
  period: PayPeriod,
  weekStartsOn: number,
): PayPeriod[] {
  const out: PayPeriod[] = [];
  // Start from the week containing the period's first day; its end may fall
  // before the period starts, in which case it belongs to the period before.
  let start = startOfWeek(period.start, weekStartsOn);
  while (start <= period.end) {
    const end = addDays(start, 6);
    if (end >= period.start && end <= period.end) out.push({ start, end });
    start = addDays(start, 7);
  }
  return out;
}

/** "Sep 6 – Sep 19, 2026" for a period heading. */
export function periodLabel(period: PayPeriod): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  };
  const from = new Date(`${period.start}T00:00:00Z`).toLocaleDateString("en-US", opts);
  const to = new Date(`${period.end}T00:00:00Z`).toLocaleDateString("en-US", {
    ...opts,
    year: "numeric",
  });
  return `${from} – ${to}`;
}
