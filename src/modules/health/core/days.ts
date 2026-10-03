import { z } from "zod";

/**
 * THE DAYS HEALTH CAN FILL IN (H2, docs/modules/health.md; the founder's
 * call, 2026-10-03): today, and the two weeks before it, as Food's log. A
 * night slept through, a habit or a weigh-in forgotten can be put on its own
 * day afterwards, from Today's day switcher. Pure.
 *
 * A page drawn as today says so (`asToday`), and an action refuses it once the
 * space's day has moved on (`NEW_DAY`): a Today left open overnight would
 * otherwise file this morning's sleep under yesterday, which is now a day
 * that may be filled in.
 */

/** A `YYYY-MM-DD` moved by whole days (as `progress.ts`'s, kept here so the inputs import nothing). */
function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

/** How far back a day can be filled in, as Food's `LOG_BACK_DAYS`. */
export const FILL_BACK_DAYS = 14;

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const dayField = z.string().regex(DAY);

/** Whether `day` can be filled in on `today`: not ahead of it, not more than two weeks back. */
export function inReach(day: string, today: string): boolean {
  return DAY.test(day) && day <= today && day >= shiftDay(today, -FILL_BACK_DAYS);
}

/**
 * Why a day cannot be filled in, or null when it can: a page drawn as today
 * that has fallen behind the space's day (`NEW_DAY`), or a day out of reach
 * (`DAY`).
 */
export function dayRefused(day: string, today: string, asToday: boolean): "NEW_DAY" | "DAY" | null {
  if (asToday && day !== today) return "NEW_DAY";
  return inReach(day, today) ? null : "DAY";
}

/** The day a `?day=` asks for, when it can be filled in; otherwise today. */
export function askedDay(asked: string | null, today: string): string {
  return asked !== null && inReach(asked, today) ? asked : today;
}

/** "Thursday, Oct 2". */
export function dayName(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Today", "Yesterday", or "Thursday, Oct 1". */
export function dayWords(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === shiftDay(today, -1)) return "Yesterday";
  return dayName(day);
}

/** "today", "yesterday", or "on Thursday, Oct 1": a day inside a sentence. */
export function dayPhrase(day: string, today: string): string {
  if (day === today) return "today";
  if (day === shiftDay(today, -1)) return "yesterday";
  return `on ${dayName(day)}`;
}

/** "Oct 1", or "Oct 1, 2025" when it is not this year. */
export function shortDay(day: string, today: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysFrom(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}
