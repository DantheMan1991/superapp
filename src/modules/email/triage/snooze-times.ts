/**
 * When "tomorrow" is.
 *
 * Computed in the BROWSER and sent as an absolute instant, because "tomorrow
 * morning" is a statement about the user's calendar and the server's clock is
 * in UTC. A server that resolved these would wake a message at 08:00 UTC, which
 * is the middle of the night for a chunk of the people it is reminding.
 *
 * The server does not trust the result — it bounds it — but it does not try to
 * recompute it either, because it cannot: the timezone is not in the request
 * and would be one more thing to get wrong.
 *
 * Pure so the edges can be tested. All of the bugs in this kind of code are at
 * the edges: snoozing at 11pm, snoozing on a Saturday, asking for "next week"
 * on a Monday.
 */

export type SnoozePreset =
  | "later_today"
  | "tomorrow"
  | "this_weekend"
  | "next_week";

/** Morning, for every preset that lands on a future day. */
const MORNING_HOUR = 8;

/**
 * "Later today" is three hours off, unless three hours from now is the middle
 * of the night — in which case it is tomorrow morning, and the label stops
 * being true. That is the honest trade: a reminder that fires at 2am is not
 * later today in any sense the person meant.
 */
const LATER_TODAY_HOURS = 3;
const TOO_LATE_HOUR = 21;

const SATURDAY = 6;
const MONDAY = 1;

function atHour(from: Date, addDays: number, hour: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Days from `day` forward to the next `target`, never 0 — always next week's. */
function daysUntilNext(day: number, target: number): number {
  const delta = (target - day + 7) % 7;
  return delta === 0 ? 7 : delta;
}

export function snoozeDueAt(preset: SnoozePreset, now: Date): Date {
  switch (preset) {
    case "later_today": {
      const later = new Date(now.getTime() + LATER_TODAY_HOURS * 3_600_000);
      if (later.getHours() >= TOO_LATE_HOUR || later.getDate() !== now.getDate()) {
        return atHour(now, 1, MORNING_HOUR);
      }
      return later;
    }
    case "tomorrow":
      return atHour(now, 1, MORNING_HOUR);
    case "this_weekend": {
      // On a Saturday or Sunday, "this weekend" has to mean the next one.
      // Otherwise it resolves to a time that has already passed today, and the
      // sweep wakes it immediately — a snooze that does nothing.
      return atHour(now, daysUntilNext(now.getDay(), SATURDAY), MORNING_HOUR);
    }
    case "next_week":
      return atHour(now, daysUntilNext(now.getDay(), MONDAY), MORNING_HOUR);
  }
}

export const SNOOZE_PRESETS: ReadonlyArray<{
  preset: SnoozePreset;
  label: string;
}> = [
  { preset: "later_today", label: "Later today" },
  { preset: "tomorrow", label: "Tomorrow" },
  { preset: "this_weekend", label: "This weekend" },
  { preset: "next_week", label: "Next week" },
];

/**
 * The furthest ahead a message may be parked.
 *
 * Not arbitrary caution: a snooze is invisible mail, and a year is already long
 * enough that whoever set it will have forgotten. Beyond that it stops being a
 * reminder and becomes a way to lose things — with the added sting that the
 * message really is gone from the inbox, not merely hidden.
 */
export const MAX_SNOOZE_MS = 365 * 24 * 3_600_000;

/** The name of the folder messages are parked in. Ordinary, and findable. */
export const SNOOZE_FOLDER_NAME = "Snoozed";

/**
 * Is this a time the server will accept?
 *
 * The past is rejected rather than clamped. A client that sends a time already
 * gone is broken, and quietly rewriting it to "now" would move somebody's mail
 * into a folder and straight back out, which looks like the feature flickering
 * rather than like a bug worth reporting.
 */
export function isAcceptableDueAt(dueAt: Date, now: Date): boolean {
  const ms = dueAt.getTime();
  if (!Number.isFinite(ms)) return false;
  if (ms <= now.getTime()) return false;
  return ms - now.getTime() <= MAX_SNOOZE_MS;
}
