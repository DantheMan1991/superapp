/**
 * Calendar arithmetic on `yyyy-mm-dd` strings. NO IMPORTS AND NO DIRECTIVE —
 * the week strip renders in the browser.
 *
 * EVERY DATE HERE IS A CALENDAR FACT, NOT AN INSTANT, and all arithmetic runs
 * in UTC for one reason: UTC has no daylight saving, so "add a day" is always
 * exactly 86,400,000 ms. Do the same sum in a local zone and two mornings a
 * year it lands on the wrong date — the bug the reader experiences as a week
 * that starts on Saturday twice a year. `tenants.timezone` decides what TODAY
 * is (`todayInTimezone`); once you hold the string, the zone has done its job
 * and must not be consulted again.
 *
 * Slice 2 builds the WORKWEEK on top of this — the fixed recurring period
 * overtime is computed over, which is not the pay period. `startOfWeek` is
 * already that boundary; what slice 2 adds is what happens inside it.
 */

const DAY_MS = 86_400_000;

/** Sunday first, matching `Date.prototype.getUTCDay()` and `week_starts_on`. */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a real day, spelled the way the database stores one?
 *
 * The format check alone accepts `2026-02-31`, which Postgres refuses and a
 * `Date` silently rolls into March — so the round trip is the test.
 */
export function isDateString(value: string): boolean {
  if (!DATE_FORMAT.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return toDateString(ms) === value;
}

function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return toDateString(toMs(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

/**
 * The first day of the week `date` falls in, for a business whose week starts
 * on `weekStartsOn` (0 = Sunday … 6 = Saturday).
 *
 * The `+ 7) % 7` is not decoration: a Monday-start business looking at a Sunday
 * would otherwise get -1 and land six days into the future.
 */
export function startOfWeek(date: string, weekStartsOn: number): string {
  const day = new Date(toMs(date)).getUTCDay();
  const back = (day - weekStartsOn + 7) % 7;
  return addDays(date, -back);
}

/** The seven days of the week beginning `start`, in order. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * "Mon 8 Sep" — enough to place a day without the year everybody already knows.
 * Formatted in UTC for the reason the whole file is: the string is a calendar
 * fact, and letting the reader's browser re-interpret it in its own zone is
 * what makes a date show as the day before.
 */
export function dayLabel(date: string): string {
  return new Date(toMs(date)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "8 – 14 Sep" for a week strip heading. */
export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  };
  const from = new Date(toMs(start)).toLocaleDateString("en-US", opts);
  const to = new Date(toMs(end)).toLocaleDateString("en-US", opts);
  return `${from} – ${to}`;
}
