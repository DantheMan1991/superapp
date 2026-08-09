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

/* -- Calendar arithmetic -------------------------------------------------- *
 *
 * This section used to be a note saying calendar arithmetic lived with its
 * callers, and belonged here "the moment a second module wants the same one".
 * Scheduling is that module: a calendar grid has to turn a local day into an
 * instant to query, and an instant back into a position in a column, dozens of
 * times per render.
 *
 * EVERYTHING BELOW IS `Intl`-ONLY. There is no date library in this project and
 * this is not the place to add one — the whole job is four functions, and a
 * dependency that owns the meaning of "midnight" is a dependency you cannot
 * reason about at 2am on the second Sunday in March.
 */

/** yyyy-mm-dd for a UTC-based Date. Internal; callers want the ones below. */
function isoDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** The zone's wall-clock fields for an instant, as numbers. */
function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Midnight renders as "24" in some ICU versions — same normalisation
    // `localHourInTimezone` already does.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * How far `timeZone` is from UTC at a given INSTANT, in minutes.
 *
 * At an instant, not in general: America/New_York is -300 in January and -240
 * in July, and a function that answered without being told when would be wrong
 * half the year.
 */
export function offsetMinutes(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

/**
 * A wall-clock time in a zone → the instant it names.
 *
 * TWO PASSES, AND THE SECOND ONE IS THE POINT. The offset to subtract depends
 * on the instant, which is what we are trying to find. So: guess by treating
 * the wall clock as UTC, look up the offset there, correct, then look up the
 * offset at the corrected instant and correct again. One pass is wrong for
 * roughly one hour twice a year — exactly the hours somebody schedules a 2am
 * job and then argues with you about it.
 *
 * THEN A THIRD STEP, FOR THE SPRING-FORWARD GAP. On the morning clocks jump
 * 02:00 → 03:00, the time 02:30 does not exist. Two passes converge on an
 * instant that renders as **01:30** — silently EARLIER than asked for, which is
 * the worst of the three possible answers: a 2:30 site visit quietly becomes
 * 1:30. Verified, not assumed: the two-pass result for 02:30 on 2026-03-08 in
 * America/New_York is 06:30Z, and 06:30Z is 01:30 EST.
 *
 * So the result is rendered back and compared. If it does not say what was
 * asked for, the time is inside a gap and the first guess — which lands after
 * the transition, at 03:30 — is returned instead. Forward, like Google and
 * Outlook, so an event moves in the direction the clocks did.
 *
 * The autumn AMBIGUITY (01:30 happens twice) needs no special case: the passes
 * settle on the first occurrence, deterministically, which is also what most
 * calendars pick.
 */
export function zonedTimeToInstant(
  date: string,
  timeOfDay: string,
  timeZone: string,
): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = timeOfDay.split(":").map(Number);
  const hour = hh || 0;
  const minute = mm || 0;
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  const settled = new Date(naive - offsetMinutes(firstGuess, timeZone) * 60_000);
  const rendered = zonedParts(settled, timeZone);
  if (rendered.hour !== hour || rendered.minute !== minute) return firstGuess;
  return settled;
}

/** The instant a local calendar day begins. The grid's left edge. */
export function startOfDayInTimezone(date: string, timeZone: string): Date {
  return zonedTimeToInstant(date, "00:00", timeZone);
}

/**
 * Add days to a `yyyy-mm-dd`, staying in calendar-land.
 *
 * Done in UTC deliberately: adding 86,400,000 milliseconds to a LOCAL instant
 * lands on the same clock time only when no transition intervenes, so "a week
 * from Sunday" quietly becomes a Saturday in March. UTC has no transitions, and
 * the result is a date string rather than an instant, so nothing is lost.
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return isoDate(new Date(Date.UTC(y, m - 1, d) + days * 86_400_000));
}

/** Day of week for a calendar date: 0 = Sunday. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The `yyyy-mm-dd` the week containing `date` starts on. */
export function startOfWeek(date: string, weekStartsOn: 0 | 1 = 0): string {
  return addDays(date, -(((dayOfWeek(date) - weekStartsOn) + 7) % 7));
}

/** Inclusive run of calendar dates. The columns of a week, the cells of a month. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * How far into its local day an instant falls, in minutes.
 *
 * What positions an event in a day column. Returns 0–1439; an instant that is
 * midnight locally is 0, which is what makes an all-day item sit flush with the
 * top of the grid.
 */
export function minutesIntoDay(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * "14:30" in the zone — the form's `<input type="time">` value.
 *
 * 24-hour and zero-padded because it round-trips through
 * `zonedTimeToInstant`, unlike `formatTimeInTimezone` below, which is for
 * reading and must never be parsed back.
 */
export function timeOfDayInTimezone(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "9:30 AM" in the tenant's zone. Presentation only; never parsed back. */
export function formatTimeInTimezone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}
