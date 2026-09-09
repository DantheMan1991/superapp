/**
 * Counting, the pure half. No imports, no database.
 *
 * A count is walked on a phone in a freezer, one shelf at a time, and three
 * questions come up on every shelf that the ledger alone cannot answer: has
 * this shelf already been written down on this walk, what is the difference
 * once the record is known, and can the walk be posted on the day somebody
 * typed. All three are arithmetic over rows the page already holds, so they
 * live here — where a test can pin them, and where the dialog previews them
 * with the same function the server runs.
 */

export interface CountedLine {
  itemId: string;
  lotId: string | null;
  countedQuantity: number;
  notes: string;
}

/** `numeric(18,4)` — the scale a count is kept at. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The line already on this count for the same shelf, or null.
 *
 * **THE SAME SHELF IS THE SAME ITEM AND THE SAME BATCH, AND "NO BATCH" IS A
 * BATCH FOR THIS PURPOSE.** `recordCountLine` upserts on exactly this key, so
 * a second entry replaces the first rather than doubling it — which is right,
 * and which nothing on the screen said until the dialog started asking this
 * before saving. `null` and `undefined` mean the same no-batch, because the
 * client sends one and the row stores the other.
 */
export function existingLineFor<T extends CountedLine>(
  lines: readonly T[],
  itemId: string,
  lotId: string | null | undefined,
): T | null {
  const wanted = lotId ?? null;
  return (
    lines.find(
      (line) => line.itemId === itemId && (line.lotId ?? null) === wanted,
    ) ?? null
  );
}

/**
 * Counted less what the record said, at the count's own scale — or null before
 * posting, when the record has deliberately not been consulted.
 */
export function lineVariance(
  countedQuantity: number,
  expectedQuantity: number | null,
): number | null {
  if (expectedQuantity === null) return null;
  return round4(countedQuantity - expectedQuantity);
}

/**
 * A count is posted on the day it was walked, or after it — never before.
 *
 * The table refuses the reverse too, but a CHECK failing surfaces as
 * `Something went wrong saving that.`; this is what lets the op say it in a
 * sentence and the dialog say it before the click. ISO dates compare as
 * strings, which is the whole reason the pack stores them that way.
 */
export function postedOnAllowed(countedOn: string, postedOn: string): boolean {
  return postedOn >= countedOn;
}
