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
  /**
   * **PRESENT ONLY WHEN THE READER ASKED ABOUT ONE PLACE**, and it is what
   * turns a whole-batch figure into that place's part of it.
   *
   * `here` is what is at the place, `whole` is what the batch holds
   * everywhere. A batch's carried cost is a fact about the BATCH — nothing
   * anywhere records what each shelf of it cost — so answering "what is in the
   * freezer worth" means apportioning, and apportioning is a decision rather
   * than a lookup. See `shareOfCarried` for the rule and for when it refuses.
   *
   * Absent is the ordinary whole-business case and is untouched by any of this.
   */
  share?: { here: number; whole: number };
}

/** The cost figures a lot carries, from `lotCarried`. */
export interface CarriedCost {
  purchasedCents: number;
  consumedCents: number;
  releasedCents: number;
  /** Appended corrections landing on stock still on hand — ADR 0012 §A.4. */
  adjustedOnHandCents: number;
  /** Appended corrections landing on stock already issued. */
  adjustedIssuedCents: number;
  remainingCents: number;
}

/**
 * **HAS ANYBODY EVER SAID WHAT THIS BATCH COST?**
 *
 * The discriminator between a real zero and an unknown, and **the single place
 * that question is answered** — which is the point of it being a function of
 * its own rather than an expression repeated wherever it is needed.
 *
 * It was repeated. `production/ops.ts` asked it independently before stamping a
 * run's output, and the two tests were not even the same shape. When
 * `inventory_cost_adjustments` arrived, a batch costed ONLY by a correction
 * would have passed neither: the valuation screen would have reported "No cost
 * recorded" about a batch carrying real money, and a kill day would have
 * stamped NULL on the meat it produced. That is the eggs-at-$0.00 bug arriving
 * through a new door, twice, in two files, from one omission.
 *
 * Money in ANY direction counts. Purchased, consumed into it, released out of
 * it, or corrected — any of the five means somebody costed this batch and zero
 * is then a real answer.
 */
export function hasRecordedCost(cost: CarriedCost): boolean {
  return (
    cost.purchasedCents !== 0 ||
    cost.consumedCents !== 0 ||
    cost.releasedCents !== 0 ||
    cost.adjustedOnHandCents !== 0 ||
    cost.adjustedIssuedCents !== 0
  );
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
 * direction — `hasRecordedCost`, which is shared with `production` rather than
 * restated there, because when it WAS restated the two copies disagreed.
 */
export function carriedValue(cost: CarriedCost): number | null {
  return hasRecordedCost(cost) ? cost.remainingCents : null;
}

/**
 * How a line got its number. Carried beside the money because **a balance sheet
 * reader is entitled to know which of these they are looking at** — one is
 * measured, one is an average over a fungible item, one is an apportionment,
 * and two are admissions.
 *
 * `none` and `unsplit` are BOTH unvalued and are NOT the same fact. `none` says
 * nobody ever costed this batch; `unsplit` says somebody did and the figure
 * cannot honestly be divided between places. Folding them together would tell a
 * reader looking at one freezer that their raised stock had never been costed.
 */
export type ValuationMethod =
  | "carried"
  | "average"
  | "share"
  | "unsplit"
  | "none";

/**
 * **ONE PLACE'S PART OF WHAT A BATCH IS CARRIED AT.**
 *
 * Nothing anywhere records what each shelf of a batch cost. A batch has ONE
 * carried figure, and a person standing in front of one freezer still wants a
 * number — so the quantity there is used as the share of the quantity
 * everywhere. It is the same pro-rate `lotCarried` already names as the thing a
 * production run must do against what is still standing, and the same one
 * `splitCostAdjustment` does when a batch is cut in two.
 *
 * **IT REFUSES RATHER THAN GUESSES, in two cases**, and both are real:
 *
 * - `whole` is zero. A batch holding nine in the freezer and minus nine in the
 *   truck nets to nothing, and there is no share of nothing to take. Dividing
 *   would be a division by zero; picking a side would be an invention.
 * - the share falls outside 0 to 1 — a place holding more than the batch does,
 *   or holding a positive against a batch that is negative overall. The signs
 *   disagree, and multiplying by a ratio above one or below zero produces a
 *   figure that is confidently wrong.
 *
 * A refusal comes back as `null` and the caller reports it as `unsplit`, which
 * lands in the same "what this figure leaves out" count the page is built
 * around. That is the point: the caveat machinery already exists, so the honest
 * answer costs nothing to say.
 */
export function shareOfCarried(
  carriedCents: number,
  here: number,
  whole: number,
): number | null {
  if (whole === 0) return null;
  const ratio = here / whole;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return null;
  return Math.round(carriedCents * ratio);
}

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
    // **A SHARE IS ASKED FOR ONLY WHEN ONE PLACE IS.** Without it this is the
    // whole-business answer it has always been, byte for byte.
    if (input.share) {
      const part = shareOfCarried(
        input.carriedCents,
        input.share.here,
        input.share.whole,
      );
      return part === null
        ? { valueCents: null, method: "unsplit" }
        : { valueCents: part, method: "share" };
    }
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

/**
 * One line of a valuation: an item, and one of its batches or the stock it
 * holds outside any.
 *
 * **DECLARED HERE RATHER THAN IN `ops.ts` (2026-09-09)** so a pure file can
 * describe the report a pure file builds — `core/valuation-csv.ts` turns one of
 * these into a file and must not import a module that opens a database. `ops`
 * re-exports both, so every existing caller is unchanged.
 */
export interface ValuationRow {
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  lotCode: string | null;
  /** The lot's provenance — `purchased`, `raised` or `produced`. */
  lotSource: string | null;
  /** Which place this line is at, when the reader asked about one. */
  locationAssetId?: string | null;
  quantity: number;
  valueCents: number | null;
  method: ValuationMethod;
}

export interface StockValuation {
  rows: ValuationRow[];
  total: ValuationTotal;
  /** The date everything here is as of. */
  asOf: string;
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
