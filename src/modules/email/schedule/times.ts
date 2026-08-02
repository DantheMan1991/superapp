/**
 * When a held message goes out.
 *
 * Pure, and free of `server-only`, for the reason `triage/snooze-times.ts` is:
 * "tomorrow morning" is a statement about the USER'S calendar and the server's
 * clock is UTC. Resolving it server-side would schedule mail for 08:00 UTC —
 * the middle of the night for a good share of the people being written to, and
 * the wrong hour for every one of them.
 *
 * So the browser computes the instant and the server BOUNDS it. The server
 * cannot recompute it: the timezone is not in the request, and inventing one
 * would be worse than trusting a value it can sanity-check.
 */

/** How long Undo lasts. Long enough to notice a mistake, short enough to forget. */
export const UNDO_SECONDS = 15;

/**
 * The furthest ahead a message may be queued.
 *
 * A bound rather than a policy: the draft sits on the mail server the whole
 * time, and a year-long queue is a message nobody remembers writing arriving
 * from an address that may no longer be theirs.
 */
export const MAX_SCHEDULE_DAYS = 90;

/** Nothing may be scheduled closer than this; below it, use Undo. */
export const MIN_SCHEDULE_SECONDS = 60;

export interface ScheduleChoice {
  id: string;
  label: string;
  /** Absolute instant, computed in the browser from the user's own clock. */
  at: Date;
}

/**
 * The offered times, from the user's local `now`.
 *
 * Deliberately few. A schedule picker with fifteen options is one people read
 * instead of using; these are the four that cover almost every real case, plus
 * a custom field for the rest.
 */
export function scheduleChoices(now: Date): ScheduleChoice[] {
  const choices: ScheduleChoice[] = [];

  const laterToday = new Date(now);
  laterToday.setHours(now.getHours() + 3, 0, 0, 0);
  // Only offered while it is still today AND still a civil hour to arrive.
  if (laterToday.getDate() === now.getDate() && laterToday.getHours() < 19) {
    choices.push({ id: "later", label: "Later today", at: laterToday });
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  choices.push({ id: "tomorrow", label: "Tomorrow morning", at: tomorrow });

  // The next Monday, and never today even if today is Monday: "Monday morning"
  // said on a Monday means the one coming, not the one already happening.
  const monday = new Date(now);
  const untilMonday = (8 - monday.getDay()) % 7 || 7;
  monday.setDate(monday.getDate() + untilMonday);
  monday.setHours(8, 0, 0, 0);
  choices.push({ id: "monday", label: "Monday morning", at: monday });

  return choices;
}

export type ScheduleProblem =
  | "in the past"
  | "too soon"
  | "too far ahead"
  | "not a time";

/**
 * Bound an instant the browser computed.
 *
 * REJECTS rather than clamps, in both directions and for different reasons. A
 * past time clamped to "now" would send immediately, which is the one thing
 * somebody choosing a schedule did not ask for. A too-distant one clamped to
 * the maximum would queue a message for a date nobody picked.
 */
export function validateSendAt(at: Date, now: Date): ScheduleProblem | null {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return "not a time";
  const seconds = (at.getTime() - now.getTime()) / 1000;
  if (seconds <= 0) return "in the past";
  if (seconds < MIN_SCHEDULE_SECONDS) return "too soon";
  if (seconds > MAX_SCHEDULE_DAYS * 86_400) return "too far ahead";
  return null;
}

/** "Tomorrow at 08:00" — how the composer confirms what it queued. */
export function describeSendAt(at: Date, now: Date): string {
  const time = at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const sameDay = at.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `today at ${time}`;
  if (at.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  return `${at.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} at ${time}`;
}
