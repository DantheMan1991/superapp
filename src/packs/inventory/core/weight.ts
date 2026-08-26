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

import { convert, getUnit, roundQuantity } from "./units";

/** A movement, as the weight fold sees it. */
export interface WeighedMovement {
  /** Signed, in the item's stocking unit. */
  quantity: number;
  /** Total pounds for this movement, not a rate. Null when nobody weighed it. */
  weightLb: number | null;
}

/**
 * Pounds per stocking unit, unrounded, from what actually arrived weighed.
 *
 * **ONLY WHAT CAME IN WITH A WEIGHT COUNTS**, which is `averageCostRate`'s rule
 * and is load-bearing for the same reason: an outbound movement's pounds are
 * this rate applied to a quantity, so folding one back in would be circular.
 * The database refuses an outbound weight outright
 * (`inventory_movements_weight_inbound`); the skip here is what makes this
 * function correct on its own, without depending on that.
 *
 * Unrounded on purpose — rounding belongs at the moment a number is shown or
 * stored, once, not at every step of a fold.
 */
export function averagePackageWeight(
  movements: WeighedMovement[],
): number | null {
  let quantity = 0;
  let lb = 0;
  for (const movement of movements) {
    if (movement.weightLb === null) continue;
    if (movement.quantity <= 0) continue;
    quantity += movement.quantity;
    lb += movement.weightLb;
  }
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
 * predicate, and every caller is fixed at once.
 */
export function hasRecordedWeight(movements: WeighedMovement[]): boolean {
  return averagePackageWeight(movements) !== null;
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
  const shown = Number(roundQuantity(reading.lb).toFixed(4)).toString();
  return `${reading.approximate ? "about " : ""}${shown} lb`;
}
