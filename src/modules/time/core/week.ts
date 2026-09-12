/**
 * How a week READS in the Time module: the day names an owner picks from, and
 * the labels on the week strip. NO IMPORTS BEYOND `@/lib/timezone`, which is
 * deliberately client-safe, so this bundles to the browser.
 *
 * THE ARITHMETIC IS NOT HERE. `addDays`, `dayOfWeek`, `startOfWeek`,
 * `datesBetween` and `isDateString` all live in `@/lib/timezone`, which has
 * done UTC calendar maths since the scheduling module needed it. Slice 0 of
 * this module wrote its own copies before noticing, and slice 1 deleted them:
 * two implementations of "what day does this week start on" is exactly the
 * drift that makes two screens disagree about which week an hour falls in.
 *
 * The rule they both follow is worth restating, because it is the one that
 * bites: `tenants.timezone` decides what TODAY is, and after that a
 * `yyyy-mm-dd` is a calendar fact whose arithmetic runs in UTC — the only zone
 * where "add a day" is always 86,400,000 ms. Do the sum in a local zone and two
 * mornings a year it lands on the wrong date.
 */
import { addDays, datesBetween } from "@/lib/timezone";

/** Sunday first, matching `getUTCDay()` and `time_settings.week_starts_on`. */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** What a `yyyy-mm-dd` looks like. The shape half of a date check. */
export const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** The seven days of the week beginning `start`, in order. */
export function weekDays(start: string): string[] {
  return datesBetween(start, addDays(start, 6));
}

/**
 * "Fri, Sep 11" — enough to place a day without the year everybody knows.
 *
 * Formatted in UTC: the string is a calendar fact, and letting the reader's
 * browser re-interpret it in its own zone is what makes a date show as the day
 * before.
 */
export function dayLabel(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "Sep 6 – Sep 12" for a week strip heading. */
export function weekLabel(start: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  };
  const from = new Date(start + "T00:00:00Z").toLocaleDateString("en-US", opts);
  const to = new Date(addDays(start, 6) + "T00:00:00Z").toLocaleDateString(
    "en-US",
    opts,
  );
  return from + " – " + to;
}
