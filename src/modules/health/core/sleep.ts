import { z } from "zod";

/**
 * SLEEP (H1, docs/modules/health.md; the founder's call): bed and wake times,
 * filled in from the night before so most mornings it is one tap, the hours
 * worked out, and how rested, 0 to 10. A night is logged the morning it ended
 * (`woke_on`), one a morning.
 *
 * Kept as the clock times the person gave. The minutes are the wake time less
 * the bed time, going round midnight when bed is later on the clock than
 * waking ("22:50" to "06:10" is 7 h 20 min), so no timezone is in the sum; a
 * night across a clock change is an hour off, twice a year. Pure.
 */

/** "HH:MM", 24-hour, as a time input gives it. */
export const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minuteOfDay(clock: string): number | null {
  const m = CLOCK.exec(clock);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The night from `bed` to `woke`, in minutes; null when they are the same time or not times. */
export function sleepMinutes(bed: string, woke: string): number | null {
  const from = minuteOfDay(bed);
  const to = minuteOfDay(woke);
  if (from === null || to === null || from === to) return null;
  return (to - from + 1440) % 1440;
}

/** "7 h 20 min", "45 min", "8 h". */
export function durationWords(minutes: number): string {
  const m = Math.round(minutes);
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "10:50 pm", "6:10 am", "12:30 am". */
export function clockWords(clock: string): string {
  const minutes = minuteOfDay(clock);
  if (minutes === null) return clock;
  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, "0");
  const half = hours < 12 ? "am" : "pm";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${mins} ${half}`;
}

/** A time from the database ("22:50:00") as the form's "HH:MM". */
export function clockOf(time: string): string {
  return time.slice(0, 5);
}

/** The times to start a morning's form with: last night's, or a usual night's. */
export const USUAL_NIGHT = { bedTime: "22:30", wokeTime: "06:30" } as const;

export const sleepInputSchema = z
  .object({
    wokeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    bedTime: z.string().regex(CLOCK),
    wokeTime: z.string().regex(CLOCK),
    rested: z.number().int().min(0).max(10).nullable(),
    /** The page showed the morning as today's (H2, `core/days.ts`). */
    asToday: z.boolean().default(true),
  })
  .refine((v) => sleepMinutes(v.bedTime, v.wokeTime) !== null, { message: "SAME_TIME" });

/** What the ops keep: the page's `asToday` is the action's to check. */
export type SleepInput = Omit<z.infer<typeof sleepInputSchema>, "asToday">;
