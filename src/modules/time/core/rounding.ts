/**
 * Turning a punch's real minutes into payable minutes. NO IMPORTS AND NO
 * DIRECTIVE — the picker and the clock panel render these in the browser.
 *
 * ── ROUNDING IS ALWAYS TO THE NEAREST INCREMENT ──────────────────────────────
 *
 * There is no direction to choose, and the omission is the design. Rounding a
 * timesheet is lawful only while it is NEUTRAL — it has to cost the worker as
 * often as it pays them, which over any real month it does. A policy that
 * always rounds down is wage theft at any increment, so the product does not
 * offer one; that is why the setting is a single integer and not a pair with a
 * mode beside it.
 *
 * The raw punch is kept forever either way (`time_punches`), so the screen can
 * always show both numbers and the rounding can be changed later without
 * rewriting what actually happened.
 */

/**
 * What a business may round to. 0 is to the minute and is the default, because
 * it is the only value that is right without anybody having to think about it.
 *
 * 6 is a tenth of an hour, which is how professional services have billed for
 * decades; 15 is the quarter hour most timeclocks use.
 */
export const ROUNDING_CHOICES = [0, 5, 6, 10, 15, 30] as const;

export type RoundingMinutes = (typeof ROUNDING_CHOICES)[number];

export function isRoundingChoice(value: number): value is RoundingMinutes {
  return (ROUNDING_CHOICES as readonly number[]).includes(value);
}

/**
 * `raw` minutes, rounded to the nearest `increment`.
 *
 * Half rounds UP (`Math.round`'s own rule): at a 15-minute increment, 7 minutes
 * goes to 0 and 8 goes to 15. Ties are rare enough that either choice is
 * neutral over a month, and rounding a tie toward the worker is the one to
 * prefer when it is free.
 *
 * **Can return 0, and that is correct rather than a bug to guard.** Somebody
 * who clocks in and out inside seven minutes on a quarter-hour policy has
 * worked no payable time by that policy — the same policy that pays them a
 * full quarter hour for eight minutes. The caller writes no entry and says so
 * on screen; hiding it by forcing a minimum would break the neutrality that
 * makes rounding lawful at all.
 */
export function roundMinutes(raw: number, increment: number): number {
  if (raw <= 0) return 0;
  if (increment <= 1) return Math.round(raw);
  return Math.round(raw / increment) * increment;
}

/** Whole minutes between two instants. Negative spans are refused upstream. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

export function roundingLabel(minutes: number): string {
  if (minutes === 0) return "To the minute";
  if (minutes === 6) return "6 minutes (a tenth of an hour)";
  if (minutes === 15) return "15 minutes (a quarter hour)";
  return `${minutes} minutes`;
}

/**
 * How long a punch may run before the screen asks about it.
 *
 * Sixteen hours rather than twenty-four: a real shift can pass twelve, almost
 * none pass sixteen, and a clock left running overnight should be noticed the
 * next morning rather than the next day. Nothing closes it automatically —
 * inventing a clock-out puts hours somebody never worked on a timesheet, with
 * a paper trail pointing at us.
 */
export const LONG_PUNCH_MINUTES = 16 * 60;
