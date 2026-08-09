import { addDays, dayOfWeek, zonedTimeToInstant } from "@/lib/timezone";

/**
 * Repeating events: parsing an RRULE, and expanding it into occurrences.
 *
 * Pure. No database, no `server-only` — the event form needs to describe a rule
 * in words on the client, and the read path needs to expand it on the server,
 * and both must agree.
 *
 * ── THE ONE RULE THAT MAKES THIS CORRECT ─────────────────────────────────────
 *
 * **EXPANSION HAPPENS IN LOCAL DATES, NOT IN MILLISECONDS.** "Every Tuesday at
 * 8am" means 8am on the wall clock, and adding 7 × 86,400,000ms to an instant
 * lands at 7am or 9am the week the clocks change. So the algorithm walks
 * `yyyy-mm-dd` strings — where a week is always seven days — and converts each
 * one to an instant at the END, with `zonedTimeToInstant`.
 *
 * That is the entire reason `zonedTimeToInstant` exists and why it handles the
 * spring-forward gap: a weekly 2:30am series has one occurrence a year that
 * does not exist, and it lands at 3:30 rather than vanishing or moving to 1:30.
 *
 * ── WHAT IS AND IS NOT SUPPORTED ─────────────────────────────────────────────
 *
 * A deliberate subset of RFC 5545: FREQ (daily/weekly/monthly/yearly),
 * INTERVAL, BYDAY for weekly, and COUNT or UNTIL. That covers "every weekday",
 * "every other Tuesday and Thursday", "monthly on the 15th", "every year".
 *
 * NOT supported, and the parser REFUSES rather than silently ignoring: BYSETPOS
 * and ordinal BYDAY ("the third Tuesday"), BYMONTHDAY lists, BYMONTH, WKST.
 * Refusing matters — a rule that quietly dropped "the third Tuesday" would
 * generate a series on the wrong days, which is worse than not offering it.
 */

export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  freq: Frequency;
  /** Every N periods. Always ≥ 1. */
  interval: number;
  /** WEEKLY only. Empty means "the weekday the series starts on". */
  byDay: Weekday[];
  /** Stop after this many occurrences. Mutually exclusive with `until`. */
  count?: number;
  /** Last date an occurrence may START on, `yyyy-mm-dd`. Inclusive. */
  until?: string;
}

/** Hard ceiling on generated occurrences, so a malformed rule cannot hang. */
const MAX_OCCURRENCES = 750;

/**
 * Parse an RRULE value (no `RRULE:` prefix).
 *
 * Returns null for anything unsupported — see the header. A caller that gets
 * null must treat the item as NON-recurring rather than guessing, which is why
 * `listRange` falls back to a single occurrence.
 */
export function parseRule(text: string): RecurrenceRule | null {
  if (!text || text.trim().length === 0) return null;
  const parts = new Map<string, string>();
  for (const chunk of text.trim().toUpperCase().split(";")) {
    const [key, value] = chunk.split("=");
    if (!key || value === undefined) return null;
    parts.set(key, value);
  }

  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    return null;
  }

  // Anything we do not implement is a refusal, not a shrug.
  for (const unsupported of ["BYSETPOS", "BYMONTHDAY", "BYMONTH", "BYYEARDAY", "BYWEEKNO"]) {
    if (parts.has(unsupported)) return null;
  }

  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 366) return null;

  let byDay: Weekday[] = [];
  const rawByDay = parts.get("BYDAY");
  if (rawByDay) {
    if (freq !== "WEEKLY") return null;
    const days = rawByDay.split(",");
    for (const day of days) {
      // An ordinal prefix ("2TU") is the unsupported case that must refuse.
      if (!WEEKDAYS.includes(day as Weekday)) return null;
    }
    byDay = days as Weekday[];
  }

  const count = parts.has("COUNT") ? Number(parts.get("COUNT")) : undefined;
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES)) {
    return null;
  }

  let until: string | undefined;
  const rawUntil = parts.get("UNTIL");
  if (rawUntil) {
    // RFC form is 20261231T000000Z; the date part is what a calendar day needs.
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(rawUntil);
    if (!match) return null;
    until = `${match[1]}-${match[2]}-${match[3]}`;
  }

  if (count !== undefined && until !== undefined) return null;

  return { freq, interval, byDay, count, until };
}

/** Back to an RRULE value, for storage and for the ICS feed. */
export function formatRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) {
    parts.push(`UNTIL=${rule.until.replace(/-/g, "")}T000000Z`);
  }
  return parts.join(";");
}

/** Plain English, for the form. */
export function describeRule(rule: RecurrenceRule): string {
  const every = rule.interval === 1 ? "" : ` ${rule.interval}`;
  const noun =
    rule.freq === "DAILY"
      ? rule.interval === 1 ? "day" : "days"
      : rule.freq === "WEEKLY"
        ? rule.interval === 1 ? "week" : "weeks"
        : rule.freq === "MONTHLY"
          ? rule.interval === 1 ? "month" : "months"
          : rule.interval === 1 ? "year" : "years";
  let text = `Every${every} ${noun}`;
  if (rule.freq === "WEEKLY" && rule.byDay.length > 0) {
    const names: Record<Weekday, string> = {
      SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat",
    };
    text += ` on ${rule.byDay.map((d) => names[d]).join(", ")}`;
  }
  if (rule.count !== undefined) text += `, ${rule.count} times`;
  if (rule.until !== undefined) text += `, until ${rule.until}`;
  return text;
}

/** Add whole months to a `yyyy-mm-dd`, clamping to the month's length. */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  // CLAMPED, not rolled over: a monthly series starting on the 31st occurs on
  // the 30th in April and the 28th in February. Rolling over would silently
  // move it into the next month and shift every later occurrence.
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ty}-${String(tm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ExpandInput {
  rule: RecurrenceRule;
  /** The series' first occurrence, as a local calendar date. */
  startDate: string;
  /** Wall clock, `HH:mm`. Ignored for all-day series. */
  timeOfDay: string;
  /** How long each occurrence lasts. */
  durationMs: number;
  timeZone: string;
  /** Window to return, as instants. Half-open: [from, to). */
  from: Date;
  to: Date;
}

export interface Occurrence {
  /** The local date this occurrence falls on — the override key. */
  date: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Every occurrence overlapping the window.
 *
 * Walks LOCAL DATES and converts at the end — see the header. The generation
 * loop is bounded twice: by `MAX_OCCURRENCES`, and by walking past `to`, so a
 * rule with no COUNT and no UNTIL is still finite per query.
 */
export function expandOccurrences(input: ExpandInput): Occurrence[] {
  const { rule, startDate, timeOfDay, durationMs, timeZone, from, to } = input;
  const out: Occurrence[] = [];

  /** Turn a local date into the occurrence, or null if it misses the window. */
  const materialise = (date: string): Occurrence | null => {
    const startsAt = zonedTimeToInstant(date, timeOfDay, timeZone);
    const endsAt = new Date(startsAt.getTime() + durationMs);
    // Overlap, not containment: a three-hour meeting starting before the window
    // still belongs to it.
    if (endsAt.getTime() <= from.getTime()) return null;
    if (startsAt.getTime() >= to.getTime()) return null;
    return { date, startsAt, endsAt };
  };

  let emitted = 0;
  let generated = 0;

  const consider = (date: string): "stop" | "continue" => {
    if (rule.until && date > rule.until) return "stop";
    generated += 1;
    if (rule.count !== undefined && generated > rule.count) return "stop";
    // Past the window entirely — nothing later can come back into it.
    if (zonedTimeToInstant(date, timeOfDay, timeZone).getTime() >= to.getTime()) {
      return "stop";
    }
    const occurrence = materialise(date);
    if (occurrence) {
      out.push(occurrence);
      emitted += 1;
    }
    return emitted >= MAX_OCCURRENCES || generated >= MAX_OCCURRENCES
      ? "stop"
      : "continue";
  };

  if (rule.freq === "WEEKLY" && rule.byDay.length > 0) {
    // Walk week by week, emitting the named days IN ORDER within each week.
    const wanted = new Set(rule.byDay.map((d) => WEEKDAYS.indexOf(d)));
    // The week containing the series start, so BYDAY entries earlier in that
    // week than the start are correctly skipped rather than back-dated.
    let weekStart = addDays(startDate, -dayOfWeek(startDate));
    for (;;) {
      for (let offset = 0; offset < 7; offset += 1) {
        if (!wanted.has(offset)) continue;
        const date = addDays(weekStart, offset);
        if (date < startDate) continue;
        if (consider(date) === "stop") return out;
      }
      weekStart = addDays(weekStart, 7 * rule.interval);
      // Guard against a rule whose window never terminates.
      if (generated >= MAX_OCCURRENCES) break;
      if (zonedTimeToInstant(weekStart, timeOfDay, timeZone).getTime() >= to.getTime()) {
        break;
      }
    }
    return out;
  }

  // EVERY OCCURRENCE IS COMPUTED FROM THE SERIES START, never from the one
  // before it. Stepping incrementally drifts: a monthly series starting on the
  // 31st clamps to the 28th in February, and the next step measured from THAT
  // stays on the 28th for the rest of the year. Measuring from the start means
  // March is the 31st again, which is what every calendar does and what the
  // test asserts.
  for (let n = 0; ; n += 1) {
    const date =
      rule.freq === "DAILY"
        ? addDays(startDate, n * rule.interval)
        : rule.freq === "WEEKLY"
          ? addDays(startDate, 7 * n * rule.interval)
          : rule.freq === "MONTHLY"
            ? addMonths(startDate, n * rule.interval)
            : addMonths(startDate, 12 * n * rule.interval);
    if (consider(date) === "stop") return out;
  }
}
