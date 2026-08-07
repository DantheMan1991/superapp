/**
 * The business day. Shared by server and client (no "server-only"), because
 * both need to answer the same question the same way.
 *
 * One rule underpins every function here: **a date is not an instant.** A
 * timestamp is a point on the world's timeline and needs no timezone; "what
 * day is it", "is this overdue", "which month does this belong to" are
 * questions about somebody's calendar and are meaningless without one. Mixing
 * the two is why a task due tomorrow nags you tonight.
 *
 * So: `yyyy-mm-dd` strings compared lexically for calendar facts, timestamptz
 * for instants, and this module as the only bridge between them. The zone
 * comes from `tenants.timezone` — never from the server, never from the
 * browser, never invented.
 */

/** What a tenant gets before anyone chooses. Also the pre-0086 default. */
export const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Zones offered in the picker. Deliberately a curated list rather than the
 * ~600 `Intl.supportedValuesOf("timeZone")` returns: the platform serves North
 * American small businesses, and a scrolling wall of Etc/GMT+7 and
 * America/Argentina/ComodRivadavia is a worse way to find "Denver" than a
 * short list is. `isValidTimeZone` still accepts anything real, so a row
 * carrying a zone from outside this list keeps working and displays correctly —
 * the list constrains the UI, not the data.
 */
export const COMMON_TIMEZONES: ReadonlyArray<{ value: string; label: string }> =
  [
    { value: "America/New_York", label: "Eastern (New York)" },
    { value: "America/Chicago", label: "Central (Chicago)" },
    { value: "America/Denver", label: "Mountain (Denver)" },
    { value: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
    { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
    { value: "America/Anchorage", label: "Alaska (Anchorage)" },
    { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
    { value: "America/Toronto", label: "Eastern — Canada (Toronto)" },
    { value: "America/Vancouver", label: "Pacific — Canada (Vancouver)" },
    { value: "America/Halifax", label: "Atlantic (Halifax)" },
    { value: "America/St_Johns", label: "Newfoundland (St. John's)" },
    { value: "Europe/London", label: "United Kingdom (London)" },
    { value: "Europe/Dublin", label: "Ireland (Dublin)" },
    { value: "UTC", label: "UTC" },
  ];

/**
 * True if `tz` is a real IANA zone this runtime knows.
 *
 * Asks the runtime rather than pattern-matching the string, because the ONLY
 * thing that matters is whether the formatter below will accept it — a zone
 * that looks plausible and throws at format time would take down whichever
 * page next asked what day it was. Validate at the boundary, and every later
 * call is safe.
 */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Today's calendar date in `timeZone`, as `yyyy-mm-dd`.
 *
 * "en-CA" is not a locale preference — it is the shortest way to get ISO
 * ordering out of Intl. The output is compared lexically against `date`
 * columns everywhere in the product, so the format is load-bearing.
 */
export function todayInTimezone(
  timeZone: string,
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The `yyyy-mm-dd` for an instant, in `timeZone`. Same rule as above. */
export function dateInTimezone(at: Date, timeZone: string): string {
  return todayInTimezone(timeZone, at);
}

/**
 * The local hour (0–23) in `timeZone` right now.
 *
 * This is what lets ONE hourly cron serve every tenant: it wakes up, asks each
 * tenant what time it is there, and sends to the ones where it is 7am. The
 * alternative — a cron per timezone, or storing a UTC send-time per tenant —
 * needs re-computing twice a year when the offset shifts, and gets it wrong in
 * Arizona. Asking the zone is always right and never needs maintenance.
 */
export function localHourInTimezone(
  timeZone: string,
  now: Date = new Date(),
): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(now);
  // en-GB renders midnight as "24" in some ICU versions; normalise it.
  return Number(hour) % 24;
}

// Calendar arithmetic (add-days, days-between) deliberately lives with its
// callers for now — src/modules/accounting/lib/dates.ts and the CRM task
// grouper each already have what they need. A shared version belongs here the
// moment a second module wants the same one, not before.
