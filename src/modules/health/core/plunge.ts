import { z } from "zod";

/**
 * A COLD PLUNGE (H1, docs/modules/health.md; the founder's call): timed on the
 * phone, counting up with a soft tone each minute, kept as the time in the
 * water and the water's temperature, then how the person feels, 0 to 10. Or
 * typed in after. Pure.
 *
 * The timer is an epoch start, not a count, kept on the phone
 * (`components/plunge-store.ts`), so a phone that locks, or a reload, comes
 * back to the right time in the water.
 */

/** The longest plunge kept: an hour. Anything longer is a timer left running. */
export const PLUNGE_SECONDS_MAX = 3600;

/** The water range a plunge accepts, in °F: ice to a hot tub. */
export const WATER_F_MIN = 28;
export const WATER_F_MAX = 110;

export const plungeInputSchema = z.object({
  /** The phone's id for this plunge, so a Save sent twice is one. */
  id: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  seconds: z.number().int().min(1).max(PLUNGE_SECONDS_MAX),
  waterF: z.number().min(WATER_F_MIN).max(WATER_F_MAX).nullable(),
  feelAfter: z.number().int().min(0).max(10).nullable(),
});

export type PlungeInput = z.infer<typeof plungeInputSchema>;

/** The timer as a clock: "0:07", "2:45", "12:03". */
export function timerFace(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "3 min 10 s", "45 s", "4 min". */
export function plungeWords(seconds: number): string {
  const s = Math.round(seconds);
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** "48°F", "48.5°F". */
export function waterWords(waterF: number): string {
  return `${Number.isInteger(waterF) ? waterF : waterF.toFixed(1)}°F`;
}

/** The whole minutes passed since the start, to sound a tone as each one turns. */
export function wholeMinutes(ms: number): number {
  return Math.max(0, Math.floor(ms / 60_000));
}

/** The seconds a timer comes to, held to what a plunge may be. */
export function timedSeconds(startedAt: number, now: number): number {
  return Math.min(PLUNGE_SECONDS_MAX, Math.max(1, Math.round((now - startedAt) / 1000)));
}

/** "Minutes" and "seconds" typed in, as a plunge's seconds; null when they come to nothing or too much. */
export function typedSeconds(minutes: string, seconds: string): number | null {
  const m = minutes.trim() === "" ? 0 : Number(minutes);
  const s = seconds.trim() === "" ? 0 : Number(seconds);
  if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s > 59) return null;
  const total = m * 60 + s;
  return total >= 1 && total <= PLUNGE_SECONDS_MAX ? total : null;
}

/** A typed temperature: a number in range, "" for none, or null for one that is not. */
export function typedWater(text: string): number | null | "" {
  if (text.trim() === "") return "";
  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value) || value < WATER_F_MIN || value > WATER_F_MAX) return null;
  return Math.round(value * 10) / 10;
}
