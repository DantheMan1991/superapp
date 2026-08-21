/**
 * What the stock on hand is WORTH. PURE — no imports, no database.
 *
 * **LAYER THREE, AND IT ARRIVES LAST FOR A REASON.** The design splits this pack
 * into quantities (always on), cost accumulation (always on — "cost per finished
 * hog is wanted regardless of tax basis") and financial presentation. `costing.ts`
 * is the middle layer and says outright that the third is not there. This is the
 * third: the fold that turns an accumulated cost into a figure a balance sheet
 * can carry.
 *
 * **NOTHING HERE POSTS.** Valuing and posting are different acts and are kept in
 * different files on purpose — `ledger-ops.ts` writes to the books, this decides
 * what number it would write. Keeping them apart is what lets the valuation be
 * table-tested without a ledger anywhere near it.
 *
 * ## The one rule this file exists to enforce
 *
 * **UNVALUED IS NOT ZERO, AND A TOTAL THAT CONFLATES THEM IS A LIE.** A raised
 * lot with no recorded cost — eggs, a calf you bred, a pen nobody entered feed
 * for — has no basis. Valuing it at nothing says the shelf holds something
 * worthless; valuing it at a guess puts an invented number on a balance sheet.
 * It is neither, and `valuationTotal` therefore reports what it could NOT value
 * beside what it could, so the figure is always accompanied by its own caveat.
 *
 * This is the same mistake `costPerUnit` refuses ("$0.00 per bird reads as free,
 * which is the opposite of not known yet") and the same one that shipped a
 * `$0.00` cost stamp on a pen with no feed in `production` slice 0 — where every
 * test used a pen that HAD feed, so nothing caught it.
 */

/** Money is integer cents throughout, the house convention. */
export interface ValuationInput {
  /** On hand at the as-of date, in the item's stocking unit. Signed. */
  quantity: number;
  /**
   * What is still standing in the lot — `lotCarried().remainingCents`. Null for
   * stock held outside any lot, which has no carried cost of its own.
   */
  carriedCents: number | null;
  /**
   * The item's average cost per stocking unit, unrounded, from
   * `averageCostRate`. Null when nothing came in with a price.
   */
  averageRate: number | null;
}

/** The three cost figures a lot carries, from `lotCarried`. */
export interface CarriedCost {
  purchasedCents: number;
  consumedCents: number;
  releasedCents: number;
  remainingCents: number;
}

/**
 * A lot's carried cost, or null when the lot has never had a cost at all.
 *
 * **`remainingCents` CANNOT TELL THE TWO ZEROS APART, AND THEY ARE NOT THE SAME
 * FACT.** A lot that was bought for $500 and has since issued all $500 out
 * remains at zero and is correctly worth nothing. A lot nobody ever costed —
 * eggs, a bred calf, a pen with no feed entered — also folds to zero, and is
 * worth an unknown amount. Reporting the second as $0.00 is precisely the bug
 * this file's header is about, and this function is where the distinction is
 * actually made rather than merely described.
 *
 * Found by a test, after the header warning it about was already written: the
 * first draft passed `remainingCents` straight into `valueLine`, and a lot of
 * eggs valued at exactly nothing. That is the third time this codebase has made
 * this mistake — `costPerUnit` refuses it, `production` slice 0 shipped it, and
 * this is the one a test caught before it went out.
 *
 * The discriminator is whether any money has EVER touched the lot, in any
 * direction. Purchased, consumed into it, or released out of it — any of the
 * three means somebody costed this batch and zero is a real answer.
 */
export function carriedValue(cost: CarriedCost): number | null {
  const everCosted =
    cost.purchasedCents !== 0 ||
    cost.consumedCents !== 0 ||
    cost.releasedCents !== 0;
  return everCosted ? cost.remainingCents : null;
}

/**
 * How a line got its number. Carried beside the money because **a balance sheet
 * reader is entitled to know which of these three they are looking at** — one is
 * measured, one is an average over a fungible item, and one is an admission.
 */
export type ValuationMethod = "carried" | "average" | "none";

export interface ValuedLine {
  /** Null means it could not be valued. NEVER zero for that case. */
  valueCents: number | null;
  method: ValuationMethod;
}

/**
 * What one line of stock is worth.
 *
 * **A LOT IS VALUED AT ITS CARRIED COST, NEVER AT QUANTITY × AVERAGE**, and that
 * ordering is the whole design. The average is only meaningful for a fungible
 * item; the design is explicit that it is "emphatically NOT fine for specific
 * identity (meat from animal #47, where traceability forbids averaging) and
 * there is no such thing for raised stock with no purchase basis". A lot that
 * has accumulated its own cost — chicks plus their feed — knows what it is
 * worth, and averaging it against every other batch of the same item would
 * throw that away to produce a worse number.
 *
 * So the average is the FALLBACK, for stock held outside any lot. Reversing the
 * two would quietly re-average the one case the lot spine exists to keep apart.
 */
export function valueLine(input: ValuationInput): ValuedLine {
  // Nothing on hand is worth nothing, and that is a real zero rather than an
  // unknown — there is no stock to be uncertain about.
  if (input.quantity === 0) return { valueCents: 0, method: "carried" };

  if (input.carriedCents !== null) {
    return { valueCents: input.carriedCents, method: "carried" };
  }
  if (input.averageRate !== null) {
    return {
      valueCents: Math.round(input.averageRate * input.quantity),
      method: "average",
    };
  }
  // Raised, no purchase basis, and nobody recorded what went into it. Saying so
  // is the only honest answer.
  return { valueCents: null, method: "none" };
}

export interface ValuationTotal {
  /** The sum of every line that COULD be valued. */
  valueCents: number;
  /** How many lines carried a number. */
  valuedLines: number;
  /**
   * How many could not. **Read this before quoting the total anywhere** — a
   * balance sheet with unvalued stock behind it is understated by an unknown
   * amount, not by nothing.
   */
  unvaluedLines: number;
  /** The quantity sitting behind `unvaluedLines`, so the gap has a size. */
  unvaluedQuantity: number;
  /** True when anything at all could not be valued. */
  incomplete: boolean;
}

/**
 * Add the lines up, and say what did not add.
 *
 * **THE `unvalued` FIELDS ARE NOT A NICETY.** A total on its own cannot be
 * checked: `$4,200` reads identically whether it covers everything on the farm
 * or everything except three pens of birds nobody costed. Any screen or posting
 * that shows the total without also showing the gap has recreated the bug this
 * file was written to prevent, and a reviewer should treat that as the defect
 * rather than as a display preference.
 *
 * Negative values are summed as they fall rather than clamped, for the same
 * reason `lotCarried` leaves `remainingCents` negative: a correction landing
 * after stock has left is a real disagreement somebody should see.
 */
export function valuationTotal(
  lines: (ValuedLine & { quantity: number })[],
): ValuationTotal {
  let valueCents = 0;
  let valuedLines = 0;
  let unvaluedLines = 0;
  let unvaluedQuantity = 0;
  for (const line of lines) {
    if (line.valueCents === null) {
      unvaluedLines += 1;
      // Rounded at the same 4 places the quantity ledger keeps, so a sum of
      // fractional pounds does not drift into a figure nobody can match.
      unvaluedQuantity =
        Math.round((unvaluedQuantity + line.quantity) * 10_000) / 10_000;
      continue;
    }
    valueCents += line.valueCents;
    valuedLines += 1;
  }
  return {
    valueCents,
    valuedLines,
    unvaluedLines,
    unvaluedQuantity,
    incomplete: unvaluedLines > 0,
  };
}
