/**
 * What a lot cost. PURE — no imports, no database.
 *
 * **COST IS A LEDGER, NOT A COLUMN**, exactly as quantity is. Nothing stores an
 * average, a valuation or a running total; every figure here is a fold over the
 * movements `core/balances.ts` already folds for quantity. The same property
 * follows: a cost can never silently disagree with the movements it came from.
 *
 * **THIS IS LAYER TWO OF THREE, AND THE THIRD IS NOT HERE.** The design splits
 * inventory into quantities (always on), cost accumulation (always on — "cost
 * per finished hog is wanted regardless of tax basis") and financial
 * presentation (basis-dependent, derived at read time, per ADR 0007). This file
 * is the middle layer. **Nothing in this slice posts to the ledger**: no 1300,
 * no 5000, no journal line. Slice 3 does that through the existing basis lens
 * rather than by writing a second set of numbers that must agree forever.
 *
 * Money is integer CENTS throughout, the house convention. The only division in
 * the file is the average, and where its result is stored the rounding is
 * stated rather than hidden.
 */

export interface CostedMovement {
  /** Signed, in the item's stocking unit. */
  quantity: number;
  /** Total money for this movement, not a rate. Null when it carried no cost. */
  costCents: number | null;
  movementKind: string;
}

/**
 * Cents per stocking unit, unrounded.
 *
 * **AVERAGE COST, WHICH THE DESIGN SAYS IS FINE FOR FUNGIBLE THINGS** — feed,
 * seed, cartons. It is emphatically NOT fine for specific identity (meat from
 * animal #47, where traceability forbids averaging) and there is no such thing
 * for raised stock with no purchase basis. Both are lots of their own, and both
 * are the reason this returns a rate for an ITEM rather than pretending one
 * number values everything.
 *
 * Unrounded on purpose: rounding belongs at the moment a number is stored, once,
 * not at every step of a fold.
 */
export function averageCostRate(movements: CostedMovement[]): number | null {
  let quantity = 0;
  let cents = 0;
  for (const movement of movements) {
    // Only what came IN with a price. An issue's cost is derived from this
    // average, so folding issues back in would be circular.
    if (movement.costCents === null) continue;
    if (movement.quantity <= 0) continue;
    quantity += movement.quantity;
    cents += movement.costCents;
  }
  if (quantity <= 0) return null;
  return cents / quantity;
}

/**
 * What to stamp on an issue.
 *
 * **STAMPED AT ISSUE, NEVER DERIVED LATER, AND THAT IS THE WHOLE POINT.** If a
 * pen's feed cost were computed from today's average, then buying feed next
 * month would retroactively change what that pen cost last month — and every
 * FCR comparison across batches would shift under its own feet. The cost of a
 * thing is what it cost when it happened.
 *
 * The rounding remainder is real and stays in the item: issue 3 lots of a
 * 100-cent, 3-unit delivery and the pieces sum to 99. That is ordinary average
 * costing, it does not compound, and it is visible because the receipts and the
 * issues are both on the ledger to compare.
 */
export function issueCostCents(rate: number | null, quantity: number): number | null {
  if (rate === null) return null;
  return Math.round(rate * Math.abs(quantity));
}

export interface LotCost {
  /** Everything issued INTO this lot — feed eaten by this pen. */
  consumedCents: number;
  /** What the lot's own contents were bought for. */
  purchasedCents: number;
}

/**
 * What has been spent on one lot.
 *
 * Two numbers rather than one total, because they answer different questions
 * and adding them would answer neither: **`purchasedCents` is what this batch
 * cost to buy** (a delivery of feed, a box of chicks) and **`consumedCents` is
 * what was fed into it** (that feed, issued to this pen). A pen of broilers has
 * both — the chicks and their feed — and a lot of feed has only the first.
 */
export function lotCost(
  ownMovements: CostedMovement[],
  consumedMovements: CostedMovement[],
): LotCost {
  let purchasedCents = 0;
  for (const movement of ownMovements) {
    if (movement.costCents === null) continue;
    if (movement.quantity <= 0) continue;
    purchasedCents += movement.costCents;
  }
  let consumedCents = 0;
  for (const movement of consumedMovements) {
    consumedCents += movement.costCents ?? 0;
  }
  return { consumedCents, purchasedCents };
}

export interface LotCarriedCost extends LotCost {
  /**
   * What has already LEFT this lot carrying a cost — feed issued out of a
   * delivery, head taken out of a pen by a production run.
   */
  releasedCents: number;
  /** Everything spent on the lot, less everything that has already left it. */
  remainingCents: number;
}

/**
 * `lotCost`, plus what has gone back out again.
 *
 * **THE REASON THIS EXISTS IS PARTIAL PROCESSING, and it is a real farm week.**
 * A pen of broilers costs $1,000 in chicks and feed. Half of them are processed
 * on Saturday and carry $500 into the freezer. A fortnight later the rest go —
 * and if the run pro-rates the GROSS accumulated cost again, the second half
 * takes 100% of a total that never went down, and the pen has cost $1,500. The
 * ledger is not wrong; the fold was.
 *
 * `remainingCents` is what is still standing in the lot, and it is what a
 * production run must pro-rate against. It can go negative in principle — a
 * correction on a receipt after stock has left — and is left as it falls rather
 * than clamped, because a negative here is a real disagreement somebody should
 * see rather than a number to tidy away.
 */
export function lotCarried(
  ownMovements: CostedMovement[],
  consumedMovements: CostedMovement[],
): LotCarriedCost {
  const base = lotCost(ownMovements, consumedMovements);
  let releasedCents = 0;
  for (const movement of ownMovements) {
    if (movement.costCents === null) continue;
    if (movement.quantity >= 0) continue;
    releasedCents += movement.costCents;
  }
  return {
    ...base,
    releasedCents,
    remainingCents: base.purchasedCents + base.consumedCents - releasedCents,
  };
}

/**
 * Cost per head, or per anything.
 *
 * Returns null rather than zero when there is nothing to divide by. **A pen
 * showing $0.00 per bird because the count is zero reads as "free", which is
 * the opposite of "not known yet"** — the same rule `mortalityRate` follows in
 * `livestock`.
 */
export function costPerUnit(cents: number, units: number): number | null {
  if (units <= 0) return null;
  return Math.round(cents / units);
}
