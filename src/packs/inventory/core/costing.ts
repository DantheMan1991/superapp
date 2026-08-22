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
export function issueCostCents(
  rate: number | null,
  quantity: number,
  /**
   * What the item still holds — everything that came in with a price, less
   * everything already issued out. Omitted means "do not cap", which is what
   * every caller before the ledger existed wanted.
   */
  unreleasedCents?: number | null,
): number | null {
  if (rate === null) return null;
  const stamped = Math.round(rate * Math.abs(quantity));
  if (unreleasedCents === undefined || unreleasedCents === null) return stamped;
  // Never release more than came in. See below for why that is not a tidy-up.
  return Math.max(0, Math.min(stamped, unreleasedCents));
}

/**
 * **YOU CANNOT ISSUE OUT MORE COST THAN CAME IN**, and without the cap above
 * this pack did.
 *
 * `averageCostRate` is deliberately the average of what arrived **with a
 * price** — it divides priced cost by priced quantity. Applying that rate to a
 * quantity that includes UNPRICED stock invents money. Receive 100 lb at $100
 * and 100 lb with no price on the ticket: the rate is $1.00/lb, and issuing all
 * 200 lb stamps $200 against $100 that ever existed. Once inventory posts, that
 * drives `1300` to a credit balance with stock still sitting on the shelf.
 *
 * Including unpriced receipts in the DENOMINATOR instead would have been the
 * other repair, and it is worse: it treats stock nobody has costed as costing
 * nothing, which is the one thing `carriedValue` and the whole valuation slice
 * exist to refuse.
 *
 * So the rate is unchanged and the release is bounded. The unpriced half stays
 * uncosted — which is true, and which the valuation screen already reports in
 * its "what this figure leaves out" card rather than hiding in a total.
 *
 * The cap applies to the STAMP, not only to the posting, so the two cannot
 * disagree: the ledger and `carriedValue` are the same number by construction
 * rather than by a second calculation that has to be kept in step.
 */

/**
 * **A CORRECTION TO WHAT A BATCH COST**, as the fold sees it. ADR 0012 §A.4.
 *
 * Not a movement, and not a column edit. `inventory_movements` refuses it
 * twice — `quantity <> 0` rules out a pure-money row and `cost_cents >= 0`
 * rules out a correction downwards — and the header of this file rules out the
 * edit. So it is an appended record in its own table, and this is the shape it
 * folds in as.
 */
export interface CostAdjustment {
  /** The whole correction, signed. */
  amountCents: number;
  /** The stored half that landed on stock still on hand. */
  onHandCents: number;
  /** The stored half that landed on stock already issued. */
  issuedCents: number;
}

/**
 * **HOW MUCH OF A CORRECTION IS STILL ON THE SHELF.**
 *
 * A ticket that understated a delivery by $60 is not $60 of asset if a third of
 * the delivery has already been eaten. The part covering stock still on hand
 * raises what the batch is carried at; the part covering stock already issued
 * has to be expensed, because capitalising it would put cost back on the
 * balance sheet for feed that is gone.
 *
 * **THE CALLER STORES WHAT THIS RETURNS AND NEVER ASKS AGAIN.** The proportion
 * is what the ledger believed at the moment somebody corrected it, and a
 * movement backdated tomorrow must not restate a posting that already happened
 * — the same rule, for the same reason, as a count line's `expected_quantity`.
 *
 * `quantityReceived` is everything that has ever come INTO the batch rather
 * than its current balance, because the question is what proportion of the
 * batch the correction is still holding. It cannot be less than `quantityOnHand`
 * arithmetically; both are clamped anyway, because **negative stock is allowed
 * in this pack** and a batch issued below zero would otherwise send more than
 * the whole correction to consumption.
 *
 * A batch nothing has ever come into keeps the whole correction: nothing has
 * left it, so there is nothing to expense.
 *
 * The rounding lands ONCE, on the on-hand half, and the issued half takes the
 * remainder — so the two always sum to the correction exactly and the CHECK
 * that says so can never be the thing that fails.
 */
export function splitCostAdjustment(input: {
  amountCents: number;
  quantityOnHand: number;
  quantityReceived: number;
}): { onHandCents: number; issuedCents: number } {
  const received = input.quantityReceived;
  const onHandFraction =
    received > 0 ? Math.min(1, Math.max(0, input.quantityOnHand / received)) : 1;
  const onHandCents = Math.round(input.amountCents * onHandFraction);
  return { onHandCents, issuedCents: input.amountCents - onHandCents };
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
  /**
   * Corrections landing on stock that was STILL ON HAND when they were made.
   * They raise what the batch is carried at, so they are part of
   * `remainingCents`.
   */
  adjustedOnHandCents: number;
  /**
   * Corrections landing on stock that had ALREADY BEEN ISSUED. Expensed where
   * they were written and never carried — kept as a figure of its own so
   * `carriedValue` can still tell that somebody costed this batch, which is the
   * whole difference between a zero and an unknown.
   */
  adjustedIssuedCents: number;
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
  /**
   * Appended cost corrections against this lot (ADR 0012 §A.4).
   *
   * **REQUIRED RATHER THAN DEFAULTED, on purpose.** ADR 0012's consequences
   * name the exact hazard: *"a second table now feeds the cost fold... any
   * caller that reaches for movements directly to compute cost will be quietly
   * wrong"*. An optional parameter is a caller forgetting it and getting a
   * plausible number, which is the failure mode this whole file is written
   * against. Pass `[]` where there genuinely are none.
   */
  adjustments: CostAdjustment[],
): LotCarriedCost {
  const base = lotCost(ownMovements, consumedMovements);
  let releasedCents = 0;
  for (const movement of ownMovements) {
    if (movement.costCents === null) continue;
    if (movement.quantity >= 0) continue;
    releasedCents += movement.costCents;
  }
  let adjustedOnHandCents = 0;
  let adjustedIssuedCents = 0;
  for (const adjustment of adjustments) {
    adjustedOnHandCents += adjustment.onHandCents;
    adjustedIssuedCents += adjustment.issuedCents;
  }
  return {
    ...base,
    releasedCents,
    adjustedOnHandCents,
    adjustedIssuedCents,
    /**
     * **ONLY THE ON-HAND HALF IS CARRIED.** The issued half was expensed at the
     * moment of the correction, and adding it here would capitalise cost for
     * stock that has already gone — the same double-count in miniature that
     * ADR 0012 opens with.
     */
    remainingCents:
      base.purchasedCents +
      base.consumedCents +
      adjustedOnHandCents -
      releasedCents,
  };
}

/**
 * **A CORRECTION DOES NOT MOVE THE ITEM'S AVERAGE, AND THAT IS A DECISION.**
 *
 * `averageCostRate` folds MOVEMENTS at the ITEM level; a correction belongs to
 * one batch. Feeding it into the average would spread one mis-ticketed delivery
 * across every other batch of that item and re-price future issues out of
 * batches that had nothing to do with it — which is the exact re-averaging the
 * lot spine exists to prevent, and the reason `valueLine` puts carried cost
 * before the average rather than after it.
 *
 * The consequence is real and is not hidden: stock issued out of a corrected
 * batch is still stamped at the uncorrected average, so the correction stays
 * standing in the batch instead of leaving with the stock. That is the same
 * drift item-level average costing already produces whenever two batches of one
 * item arrived at different prices, and `remainingCents` is deliberately left
 * as it falls — negative included — so it can be seen rather than tidied away.
 */


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
