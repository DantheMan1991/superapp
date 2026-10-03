import { z } from "zod";

/**
 * THE PERSON'S OWN HABITS (H1, docs/modules/health.md; the founder's call): a
 * sauna, stretching, a supplement. A habit has a name, and a unit when it is
 * counted ("min", "g"); it is marked done for a day with a tap, with its
 * amount when it has a unit. Once a day: a second tap undoes it. Pure.
 */

export const HABIT_NAME_MAX = 60;
export const HABIT_UNIT_MAX = 20;
/** Enough for a morning's list; a list longer than this is a spreadsheet. */
export const HABITS_MAX = 30;

export const habitInputSchema = z.object({
  name: z.string().trim().min(1).max(HABIT_NAME_MAX),
  unit: z
    .string()
    .trim()
    .max(HABIT_UNIT_MAX)
    .transform((u) => (u === "" ? null : u))
    .nullable(),
});

export type HabitInput = z.infer<typeof habitInputSchema>;

export const habitDayInputSchema = z.object({
  habitId: z.string().uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Done (with its amount when counted), or not done. */
  done: z.boolean(),
  amount: z.number().positive().max(100_000).nullable(),
  /** The page showed the day as today (H2, `core/days.ts`). */
  asToday: z.boolean().default(true),
});

/** What the ops keep: the page's `asToday` is the action's to check. */
export type HabitDayInput = Omit<z.infer<typeof habitDayInputSchema>, "asToday">;

/** An amount as typed, or null when it is not a positive number. */
export function typedAmount(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 && value <= 100_000 ? Math.round(value * 100) / 100 : null;
}

/** "20 min", "5 g", "1 glass": an amount with its unit. */
export function amountWords(amount: number, unit: string | null): string {
  const n = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  return unit ? `${n} ${unit}` : n;
}
