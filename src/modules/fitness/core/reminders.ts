/**
 * WORKOUT REMINDERS (docs/modules/fitness.md, F4a; ADR 0116).
 *
 * The founder's calls, 2026-09-28, from a mockup: a time for the morning and
 * one for the evening (the program allows a day's sets to be split), each on
 * or off, sent as a push to the Yosher app on his phone; and **a day whose
 * sets are done is skipped**. That last rule is the notifications dossier's
 * test for anything that nags: it clears by doing the work.
 *
 * Nothing is stored about a day but that the reminder was taken
 * (`last_handled_on`). Whether the day is done is worked out at the minute
 * the reminder goes, from the sessions that have reached the server, the
 * same `dayProgress` a split day uses.
 *
 * Pure: the cron (`reminder-ops.ts`), the save and the card all compute with
 * it, and every word the phone shows is tested here.
 */

import { z } from "zod";
import type { DayProgress } from "./day";
import { countOf } from "./program";

export const REMINDER_SLOTS = ["morning", "evening"] as const;
export type ReminderSlot = (typeof REMINDER_SLOTS)[number];

/** Where each starts the first time it is turned on: before work, and after dinner. */
export const DEFAULT_REMINDER_MINUTE: Record<ReminderSlot, number> = { morning: 7 * 60, evening: 19 * 60 + 30 };

/**
 * The cron runs every ten minutes, so a time is kept in tens: the screen never
 * promises a minute the platform cannot keep (Marketing's post reminders chose
 * the same).
 */
export const REMINDER_STEP_MINUTES = 10;

/** How late a reminder may still go. A cron down for two hours does not send the morning's at lunch. */
export const REMINDER_GRACE_MINUTES = 60;

/** "07:30" as the minute of the day, rounded to the step; null for anything that is not a time. */
export function minuteOfTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const rounded = Math.round((hours * 60 + minutes) / REMINDER_STEP_MINUTES) * REMINDER_STEP_MINUTES;
  // 23:56 rounds to midnight; the last time a day has is 23:50.
  return Math.min(rounded, 24 * 60 - REMINDER_STEP_MINUTES);
}

/** The minute of the day as a time input's value: 450 is "07:30". */
export function timeOfMinute(minute: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** The minute of the day in words: 450 is "7:30 AM", 1170 "7:30 PM". */
export function clockWords(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = String(minute % 60).padStart(2, "0");
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** The minute of the day on a space's clock. */
export function minuteIn(timeZone: string, now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  } catch {
    // An unknown zone: UTC, as `localDayIn` falls back.
  }
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

/** Now, on the space's clock: its day and the minute of it. */
export interface SpaceNow {
  day: string;
  minute: number;
}

/**
 * Whether a reminder goes now: its time has come today, within the grace, and
 * the cron has not already taken it today.
 */
export function reminderDue(reminder: { atMinute: number; lastHandledOn: string | null }, now: SpaceNow): boolean {
  if (reminder.lastHandledOn === now.day) return false;
  return now.minute >= reminder.atMinute && now.minute < reminder.atMinute + REMINDER_GRACE_MINUTES;
}

/**
 * The day a reminder counts as taken, once it is saved. A time already past
 * today starts tomorrow, rather than going off the moment it is set; and one
 * that already went today does not go twice because its time moved.
 */
export function handledOnWhenSaved(atMinute: number, now: SpaceNow, previous: string | null): string | null {
  return previous === now.day || now.minute >= atMinute ? now.day : previous;
}

/**
 * What the phone shows, or null for a day with nothing left: done, or a phase
 * with nothing in it. "Today's workout" before anything is done; "The rest of
 * today" once some of it is, with what is left.
 */
export function reminderMessage(
  day: DayProgress,
  context: { phaseName: string; exercises: number },
): { title: string; body: string } | null {
  if (day.complete || day.left === 0) return null;
  const phase = context.phaseName.trim();
  if (day.done === 0) {
    const what = `${countOf(context.exercises, "exercise", "exercises")}, ${countOf(day.left, "set", "sets")}`;
    return { title: "Today's workout", body: phase ? `${phase} · ${what}` : what };
  }
  const left = `${countOf(day.left, "set", "sets")} left`;
  return { title: "The rest of today", body: phase ? `${left} · ${phase}` : left };
}

/** What the card sends when a reminder is changed: its time and whether it is on. */
export const reminderInputSchema = z.object({
  programId: z.string().uuid(),
  slot: z.enum(REMINDER_SLOTS),
  time: z.string().max(5),
  enabled: z.boolean(),
});

export type ReminderInput = z.infer<typeof reminderInputSchema>;

/** A reminder as the card shows it: a slot never saved is off, at its default time. */
export interface ReminderView {
  slot: ReminderSlot;
  atMinute: number;
  enabled: boolean;
}

export function reminderViews(saved: readonly { slot: ReminderSlot; atMinute: number; enabled: boolean }[]): ReminderView[] {
  return REMINDER_SLOTS.map((slot) => {
    const row = saved.find((r) => r.slot === slot);
    return row
      ? { slot, atMinute: row.atMinute, enabled: row.enabled }
      : { slot, atMinute: DEFAULT_REMINDER_MINUTE[slot], enabled: false };
  });
}
