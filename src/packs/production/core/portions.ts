/**
 * The whole-bird remainder. PURE — one type import from `../vocabulary`, no
 * database.
 *
 * **TEN OF THE HUNDRED GO BACK WHOLE AND NOTHING RECONCILED THAT.** The
 * founder's words on the cut sheet: *"10 of the 100 birds might need to be whole
 * birds and then some will get cut up."* Ask for 90 quartered out of 100 and no
 * screen mentioned the other 10; ask for 130 out of 100 and nothing objected.
 * Both are this file.
 *
 * **THE REMAINDER IS DERIVED AND NEVER STORED**, which is the rule
 * `core/carcass.ts` follows for a condemnation rate and `core/yield.ts` for a
 * yield. A stored remainder is a third number that can disagree with the two it
 * came from, and it would go stale the moment a line changed.
 *
 * **A BLANK QUANTITY ON A CUTTING LINE MEANS ALL OF THEM**, and that is a
 * deliberate agreement with `core/fee.ts` rather than an assumption made here.
 * `lineQuantity` already measures the whole run for a line charged per head with
 * no quantity typed, and that figure is what the plant was quoted at and what
 * reached the meat on 2026-08-23. A reconciliation reading the same blank as
 * *nobody has said* would put two answers to one question on one screen — the
 * shape this codebase keeps finding disagrees with itself within a season. So
 * the blank is read the same way in both places, and its consequence is visible
 * rather than hidden: two blank cutting lines each claim every bird, which
 * over-accounts, which is flagged.
 *
 * **ONLY `cutting` COUNTS, AND ONLY WHEN IT IS PRICED PER HEAD.** Slaughter is
 * per head too and every animal gets it, so counting it would make a hundred
 * slaughtered plus ninety quartered read as a sheet for a hundred and ninety
 * birds. Packaging is per head on some sheets and applies to whatever came back
 * in a bag. The sheet's own grouping is the only thing that says which lines
 * divide the animals up, and guessing that from the label is how this pack would
 * start knowing what a chicken is.
 */
import type { PriceUnit } from "../vocabulary";

/** One line of a cut sheet, as the reconciliation needs to see it. */
export interface PortionLine {
  key: string;
  label: string;
  /** The sheet's own grouping. Only `cutting` divides the animals up. */
  category: string;
  /** Null on an instruction line, which asks for no animals at all. */
  unit: PriceUnit | null;
  /** What somebody typed. Null means the whole sheet — see the header. */
  quantity: number | null;
}

/**
 * What stops a remainder being stated. Three, and none of them is
 * under-accounting: **head that no cutting line claims are the whole birds**,
 * which is the answer rather than a failure to reach one.
 */
export type PortionRefusal =
  | "NO_HEAD_COUNT"
  | "CUT_NOT_BY_HEAD"
  | "SHEET_OVER_PORTIONED";

/**
 * What the screen says instead of a count. Sentences, for the reason
 * `STAGE_REFUSALS` are: this is the copy somebody reads when they expected a
 * number, and the reason is the useful half.
 */
export const PORTION_REFUSALS: Record<PortionRefusal, string> = {
  NO_HEAD_COUNT:
    "This sheet does not say how many head it covers, so there is nothing for the cutting to be a share of. Put the count on the sheet and the whole ones work themselves out.",
  CUT_NOT_BY_HEAD:
    "Cutting on this sheet is charged by weight rather than per animal, so nothing on it says how many of them get cut. A remainder would be a count nobody gave.",
  SHEET_OVER_PORTIONED:
    "The cutting lines account for more head than the sheet covers. One of the two is wrong, and guessing which would send the plant a sheet asking for animals that are not coming.",
};

/** One cutting line's claim on the animals. */
export interface PortionShare {
  key: string;
  label: string;
  head: number;
  /**
   * `typed` — somebody said how many. `all` — the line said nothing, so it
   * claims every head on the sheet, which is what the fee already charges for.
   */
  source: "typed" | "all";
}

export interface PortionTally {
  /** What the sheet says it covers. Null when nobody has said. */
  headCount: number | null;
  /** The cutting lines, in the order they were given. */
  shares: PortionShare[];
  /** Head the cutting lines account for. */
  headPortioned: number;
  /**
   * Head no cutting line claims — the ones that go back whole. Null when there
   * is nothing to reconcile against, and never negative: an over-accounted
   * sheet reports `headOver` instead, because "minus thirty whole birds" is not
   * a thing to print on a document somebody hands across a counter.
   */
  headWhole: number | null;
  /** How far past the sheet's own count the cutting lines go, or null. */
  headOver: number | null;
  /** True when the sheet prices cutting, but by weight rather than per head. */
  cutByWeight: boolean;
}

/**
 * Count the cutting up.
 *
 * **A SHEET WITH NO CUTTING ON IT AT ALL IS NOT A REFUSAL — IT IS "ALL WHOLE".**
 * A hundred birds and a slaughter line is a hundred whole birds, which is a real
 * arrangement and exactly what a plant that will not cut fewer than fifty of
 * them offers. That is why `cutByWeight` is a separate flag from an empty
 * `shares`: no cutting is an answer, cutting nobody can count is not.
 */
export function tallyPortions(
  lines: PortionLine[],
  headCount: number | null,
): PortionTally {
  const cutting = lines.filter(
    (l) => l.category === "cutting" && l.unit !== null,
  );
  const byHead = cutting.filter((l) => l.unit === "head");
  const cutByWeight = cutting.length > 0 && byHead.length === 0;

  const shares: PortionShare[] = byHead.map((line) => {
    const typed = line.quantity !== null && line.quantity > 0;
    return {
      key: line.key,
      label: line.label,
      head: typed ? (line.quantity as number) : (headCount ?? 0),
      source: typed ? "typed" : "all",
    };
  });

  const headPortioned = round(
    shares.reduce((total, s) => total + s.head, 0),
  );
  const unclaimed = headCount === null ? null : round(headCount - headPortioned);

  return {
    headCount,
    shares,
    headPortioned,
    headWhole: unclaimed === null || unclaimed < 0 ? null : unclaimed,
    headOver: unclaimed === null || unclaimed >= 0 ? null : -unclaimed,
    cutByWeight,
  };
}

/**
 * Everything that stops the remainder being stated, in the order a person would
 * hit it. Separate from the tally for the reason `sheetRefusal` is separate from
 * `tallyCarcasses`: the counts are still worth showing beside the reason.
 */
export function portionRefusal(tally: PortionTally): PortionRefusal | null {
  if (tally.headCount === null) return "NO_HEAD_COUNT";
  if (tally.cutByWeight) return "CUT_NOT_BY_HEAD";
  if (tally.headOver !== null) return "SHEET_OVER_PORTIONED";
  return null;
}

/**
 * "90 Quartered, 10 back whole" — the line the PLANT reads.
 *
 * **THIS PRINTS**, unlike the money beside it. What is going to be done to a
 * bird is the plant's business and is the whole purpose of handing a sheet over;
 * what it costs is the farm's side of the arrangement. Empty when there is
 * nothing to say, so a caller drops the row rather than printing a sentence
 * about nought.
 */
export function portionSentence(tally: PortionTally): string {
  if (portionRefusal(tally) !== null) return "";
  const parts = tally.shares
    .filter((s) => s.head > 0)
    .map((s) => `${formatHead(s.head)} ${s.label}`);
  if (tally.headWhole !== null && tally.headWhole > 0) {
    parts.push(`${formatHead(tally.headWhole)} back whole`);
  }
  /**
   * **COMMAS, NOT `·`, AND THAT WAS A DEFECT.** The order line's own label is
   * `·`-joined — `Quartered · 50 head and over` — so a middot here put two
   * separators of one kind at two levels, and a live sheet printed *"90
   * Quartered · 50 head and over · 10 back whole"*, in which the band reads as a
   * third portion. The caller passes a shortened label; this keeps the levels
   * apart.
   */
  return parts.join(", ");
}

/** Birds are counted, so a trailing `.00` reads as false precision. */
function formatHead(value: number): string {
  return String(Number(value.toFixed(2)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
