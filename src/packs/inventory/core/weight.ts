/**
 * What a package weighs. PURE — no database.
 *
 * **THE THING THIS FILE EXISTS TO NOT BE.** `core/units.ts` names three kinds
 * of conversion and refuses the third — *"a steer goes in at 1,150 lb live and
 * hangs at 690. That is not a conversion at all. Modelling it as a factor bakes
 * a permanent unauditable fudge into the books."* A package weight looks like
 * that third kind and is not: **it is a MEASUREMENT, recorded when the stock
 * arrives, and this file only ever averages figures somebody wrote down.**
 * Nothing here invents a pound.
 *
 * **THE SHAPE IS `core/costing.ts`'s, DELIBERATELY.** A receipt carries a total
 * (47.5 lb for 38 packages, exactly as $340 for 12 bags), the rate is a fold
 * over receipts that carried one, and a receipt that carried nothing is skipped
 * rather than counted as zero. If that sounds familiar it is because it is
 * `averageCostRate` with a different numerator, and the two should stay
 * recognisable as the same idea.
 *
 * ── THE TWO RULES ───────────────────────────────────────────────────────────
 *
 * **UNWEIGHED IS NOT ZERO.** A batch nobody weighed and a batch of nothing both
 * come out as no pounds, and only the second weighs nothing. Every function
 * here returns `null` for the first, and `hasRecordedWeight` is the
 * discriminator — the same arrangement `hasRecordedCost` has in
 * `core/valuation.ts`, and for the same reason: a screen that prints "0 lb"
 * over stock nobody has measured is stating a fact that is not true.
 *
 * **POUNDS ON HAND ARE APPROXIMATE AND ALWAYS SAY SO.** A batch's average is
 * the only thing there is: 38 packages at an average of 1.25 lb is 47.5 lb, and
 * the actual 38 packages are each a little more or less. **That is what catch
 * weight IS, it does not reconcile with the pounds actually sold, and it never
 * needs to** — one is a shelf estimate and the other is a transaction record.
 * `WeightReading.approximate` carries that to the screen so no caller can
 * quietly drop it.
 */

import {
  convert,
  formatQuantity,
  getUnit,
  roundQuantity,
  type EntryBasis,
} from "./units";

/** A movement, as the weight fold sees it. */
export interface WeighedMovement {
  /** Signed, in the item's stocking unit. */
  quantity: number;
  /** Total pounds for this movement, not a rate. Null when nobody weighed it. */
  weightLb: number | null;
}

/**
 * A correction to a batch's pounds — one row of `inventory_weight_adjustments`.
 * Signed, total, and only meaningful beside receipts that were weighed.
 */
export interface WeightCorrection {
  deltaLb: number;
}

/**
 * What a batch's receipts say it weighs, and how much of it they weighed.
 *
 * **ONLY WHAT CAME IN WITH A WEIGHT COUNTS**, which is `averageCostRate`'s rule
 * and is load-bearing for the same reason: an outbound movement's pounds are
 * the rate applied to a quantity, so folding one back in would be circular.
 * The database refuses an outbound weight outright
 * (`inventory_movements_weight_inbound`); the skip here is what makes this
 * correct on its own, without depending on that.
 *
 * **CORRECTIONS LAND IN THE POUNDS AND ONLY WHERE SOMETHING WAS WEIGHED.** A
 * correction cannot weigh a batch nobody weighed — there would be nothing to
 * divide by — so `adjustLotWeight` refuses one, and this ignores any that
 * exist against an unweighed batch rather than inventing a denominator.
 */
export function weighedTotals(
  movements: WeighedMovement[],
  corrections: WeightCorrection[] = [],
): { quantity: number; lb: number } {
  let quantity = 0;
  let lb = 0;
  for (const movement of movements) {
    if (movement.weightLb === null) continue;
    if (movement.quantity <= 0) continue;
    quantity += movement.quantity;
    lb += movement.weightLb;
  }
  if (quantity <= 0) return { quantity: 0, lb: 0 };
  for (const correction of corrections) lb += correction.deltaLb;
  return { quantity, lb };
}

/**
 * Pounds per stocking unit, unrounded, from what actually arrived weighed —
 * plus whatever an owner has since said it really weighed.
 *
 * Unrounded on purpose — rounding belongs at the moment a number is shown or
 * stored, once, not at every step of a fold.
 */
export function averagePackageWeight(
  movements: WeighedMovement[],
  corrections: WeightCorrection[] = [],
): number | null {
  const { quantity, lb } = weighedTotals(movements, corrections);
  if (quantity <= 0) return null;
  return lb / quantity;
}

/**
 * Has anybody ever said what one of these weighs?
 *
 * **ONE FUNCTION, NOT A TEST EVERY CALLER WRITES.** `hasRecordedCost` earned
 * this rule the hard way — it was two independent expressions of two different
 * shapes in two files, and when cost corrections arrived neither counted one.
 * Anything that adds a second way for a weight to reach a batch changes this
 * predicate, and every caller is fixed at once. Corrections arrived 2026-09-08
 * and changed nothing here, because they cannot weigh an unweighed batch.
 */
export function hasRecordedWeight(
  movements: WeighedMovement[],
  corrections: WeightCorrection[] = [],
): boolean {
  return averagePackageWeight(movements, corrections) !== null;
}

/**
 * What a correction has to add for a batch to read the figure somebody just
 * gave — "they weigh a pound each", or "6 lb in all".
 *
 * **THE PERSON STATES THE TRUTH, NOT THE DIFFERENCE.** Nobody at a freezer
 * knows "+4 lb"; they know what the packages weigh. So the caller hands over a
 * figure and how it was read, and the delta is derived — and **THIS IS THE
 * SAME FUNCTION THE SERVER CALLS**, so the dialog's preview and the stored
 * row cannot disagree, exactly as `splitCostAdjustment` is shared.
 *
 * Both figures rounded to the quantity column's scale, once, here: the delta
 * is what gets stored, and the target is what gets shown.
 */
export function weightCorrectionDelta(input: {
  basis: EntryBasis;
  /** What was typed. Must be more than nothing. */
  typed: number;
  /** The weighed quantity received — the rate's denominator. */
  quantityWeighed: number;
  /** What the batch reads now: the receipts' pounds plus earlier corrections. */
  recordedLb: number;
}): { targetLb: number; deltaLb: number } {
  const target =
    input.basis === "each" ? input.typed * input.quantityWeighed : input.typed;
  const targetLb = roundQuantity(target);
  return { targetLb, deltaLb: roundQuantity(targetLb - input.recordedLb) };
}

export interface WeightReading {
  /** Pounds, or null when nothing here has ever been weighed. */
  lb: number | null;
  /**
   * True when `lb` came from an average rather than from the quantity itself.
   * **A caller that prints the figure must print this too** — see the file
   * header.
   */
  approximate: boolean;
}

const UNWEIGHED: WeightReading = { lb: null, approximate: false };

/**
 * What some quantity of an item weighs.
 *
 * **AN ITEM STOCKED BY MASS IS NOT AN ESTIMATE AND MUST NOT READ AS ONE.** 840
 * pounds of feed is 840 pounds; a ton of it is exactly 2,000. The quantity IS
 * the weight, `convert` is exact, and `approximate` is false — which is why
 * this takes the unit rather than being handed a rate. Recording a weight
 * against a mass-stocked item is redundant and `production_run_outputs` has
 * said so since it was written.
 *
 * Anything else — packages, head, dozens — has no weight at all until somebody
 * weighs a delivery of it.
 */
export function weightOf(input: {
  unit: string;
  quantity: number;
  /**
   * Pounds per stocking unit, from `averagePackageWeight`. Null when nothing
   * has been weighed, and IGNORED for a mass-stocked item.
   *
   * Takes the rate rather than the movements because the fold belongs to the
   * one query the page already runs (`weightRatesForItems`) — handing every
   * caller the movements would mean folding the same rows once per row shown.
   */
  rate: number | null;
}): WeightReading {
  const definition = getUnit(input.unit);
  if (definition?.dimension === "mass") {
    return { lb: convert(input.quantity, input.unit, "lb"), approximate: false };
  }
  if (input.rate === null) return UNWEIGHED;
  return { lb: roundQuantity(input.quantity * input.rate), approximate: true };
}

/**
 * "about 47.5 lb", "47.5 lb", or null when nobody has weighed any of it.
 *
 * **NULL RATHER THAN AN EMPTY STRING**, so a caller has to decide what an
 * unweighed item looks like on its own screen instead of rendering a stray
 * "lb" beside nothing.
 */
export function formatWeight(reading: WeightReading): string | null {
  if (reading.lb === null) return null;
  return `${reading.approximate ? "about " : ""}${formatLb(reading.lb)}`;
}

/** "47.5 lb" — the one place pounds are turned into text. */
export function formatLb(lb: number): string {
  return `${Number(roundQuantity(lb).toFixed(4)).toString()} lb`;
}

// ────────────────────────────────────────────────────────── typing one in ───

/**
 * **THE LEDGER ONLY EVER STORES THE TOTAL** — `weight_lb` is a total on the
 * receipt (ADR 0016) and that does not change here. What changed is the box.
 * On 2026-09-08 five one-pound packages were recorded by typing `1` into a box
 * labelled "What it weighed", which meant the whole delivery, and the batch
 * read "about 2 lb" for six packages. A box that can be read two ways will be,
 * so the form now asks which way (`EntryBasis`, shared with the cost box, which
 * was misread the same way the same day) and this converts the answer.
 *
 * Unrounded, like `averagePackageWeight` — `receiveStock` rounds once when it
 * stores. Null only when nothing was typed: an empty box means "nobody weighed
 * it". A typed zero is passed through so the op can refuse it with its own
 * sentence, rather than being swallowed into "unweighed" here.
 */
export function deliveryWeightLb(input: {
  basis: EntryBasis;
  typed: number | null;
  quantity: number;
}): number | null {
  if (input.typed === null) return null;
  if (input.basis === "total") return input.typed;
  return input.typed * input.quantity;
}

/**
 * The figure somebody did NOT type, read back as they type the other one —
 * "5 packages, 5 lb in all." under a per-package entry, "5 packages, 0.2 lb
 * each." under a total. Null until there is a quantity and a weight to speak of.
 *
 * **THIS LINE IS THE FIX**, more than the toggle is. Whichever way the box is
 * read, the other reading sits directly under it, and 0.2 lb a package is a
 * figure nobody standing at a chest freezer believes for a second.
 */
export function describeWeightEntry(input: {
  basis: EntryBasis;
  typed: number | null;
  quantity: number;
  /** The stocking unit's code, so "1 package" and "5 packages" come out right. */
  unit: string;
}): string | null {
  if (input.typed === null || !Number.isFinite(input.typed) || input.typed <= 0) {
    return null;
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  const count = formatQuantity(input.quantity, input.unit);
  if (input.basis === "each") {
    return `${count}, ${formatLb(input.typed * input.quantity)} in all.`;
  }
  return `${count}, ${formatLb(input.typed / input.quantity)} each.`;
}
