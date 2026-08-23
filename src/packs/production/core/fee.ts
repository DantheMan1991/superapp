/**
 * What the plant charged. PURE — no imports, no database.
 *
 * **THE HALF OF A RUN'S COST THAT WAS MISSING.** `roll.ts` splits the pot
 * across the outputs; until this file the pot was the animals' accumulated cost
 * alone, so a box of ground beef carried eight weeks of feed and nothing at all
 * for the killing, cutting and wrapping that turned an animal into a box. On a
 * farm sending stock out, the processing bill is frequently the largest single
 * cost of the whole conversion.
 *
 * **FLAT PER ANIMAL PLUS PER POUND IS THE ARRANGEMENT, AND IT IS WHY THE UNIT
 * HAD TO BE MODELLED.** Most plants quote both — $95 a head to kill and $0.90 a
 * pound of hanging weight to cut — and the consequence is arithmetic nobody
 * should have to do in their head: **a smaller animal costs more per pound at
 * the same plant**, because the flat half spreads over less meat. A 900 lb
 * carcass and a 600 lb carcass at those rates come out at $1.01 and $1.06 a
 * pound. That difference is real, it decides which animals are worth finishing,
 * and a fee model with one number in it cannot show it.
 *
 * ── WHAT THIS FILE WILL NOT DO ──────────────────────────────────────────────
 *
 * **IT NEVER INVENTS A QUANTITY.** A line charged per package needs somebody to
 * count the packages; a line charged per pound of hanging weight can be
 * measured off the kill sheet. The first is REPORTED as un-totalled and the
 * second is worked out, and the difference between those two is the whole
 * reason `PRICE_UNITS` is a closed set. Assuming "one" of anything is how a fee
 * becomes quietly wrong in the direction of too small.
 *
 * **A PARTIAL TOTAL IS ALWAYS LABELLED AS ONE.** `FeeTotal` carries what could
 * not be worked out beside what could, because a screen showing $612.40 with no
 * mention of the four lines it could not price is worse than one showing
 * nothing: it looks finished.
 */

import type { PriceUnit } from "../vocabulary";

/** One line of an order, as the fee sees it. */
export interface FeeLine {
  key: string;
  label: string;
  /** Cents per unit, as quoted when the line was written. Null is not zero. */
  unitPriceCents: number | null;
  /** Null on an instruction line, which is not a charge at all. */
  unit: PriceUnit | null;
  /** The floor, in cents. */
  minimumCents: number | null;
  /** What was typed. Null means fall back to the run — or to nothing. */
  quantity: number | null;
}

/**
 * The four numbers a finished run can measure about itself.
 *
 * Every field is nullable because every one of them can genuinely be unknown: a
 * run with no kill sheet has no hanging weight, a bakery run has no head, and
 * `livestock`'s rule that *an unknown is not a zero* applies to all four.
 */
export interface RunMeasures {
  head: number | null;
  liveLb: number | null;
  hangingLb: number | null;
  finishedLb: number | null;
}

export type FeeSource = "typed" | "measured" | "unknown";

export interface FeeLineTotal {
  key: string;
  label: string;
  quantity: number | null;
  /** Where the quantity came from — the screen prints this beside it. */
  source: FeeSource;
  /** Cents for this line, or null when it could not be worked out. */
  cents: number | null;
  /** True when the minimum, not the arithmetic, decided the figure. */
  atMinimum: boolean;
}

export interface FeeTotal {
  lines: FeeLineTotal[];
  /** The sum of every line that could be worked out. */
  cents: number;
  /** Lines that could not be, and are therefore NOT in `cents`. */
  unpriced: FeeLineTotal[];
}

/**
 * Which measure a unit is charged against, or null when only a person knows.
 *
 * The map is exhaustive over `PRICE_UNITS` by construction rather than by
 * convention — adding a ninth unit without deciding this is a type error, which
 * is deliberate, because a unit silently falling through to "cannot be worked
 * out" is a fee that quietly shrinks.
 */
const MEASURED_BY: Record<PriceUnit, keyof RunMeasures | null> = {
  head: "head",
  live_lb: "liveLb",
  hanging_lb: "hangingLb",
  finished_lb: "finishedLb",
  package: null,
  box: null,
  flat: null,
  hour: null,
};

/**
 * How many of this line there were.
 *
 * **A TYPED QUANTITY ALWAYS WINS**, including over a measurement, and that is
 * not laziness about precedence: the plant's invoice is the authority on what
 * it charged for, and somebody typing 640 after reading the bill is correcting
 * the app rather than being corrected by it.
 *
 * `flat` is the one unit that resolves to a quantity without measuring
 * anything: charged once for the drop-off, whatever went. It is still reported
 * as `measured` rather than `typed`, because nobody typed it.
 */
export function lineQuantity(
  line: FeeLine,
  measures: RunMeasures,
): { quantity: number | null; source: FeeSource } {
  if (line.quantity !== null && line.quantity > 0) {
    return { quantity: line.quantity, source: "typed" };
  }
  if (line.unit === null) return { quantity: null, source: "unknown" };
  if (line.unit === "flat") return { quantity: 1, source: "measured" };
  const field = MEASURED_BY[line.unit];
  if (field === null) return { quantity: null, source: "unknown" };
  const measured = measures[field];
  if (measured === null || measured <= 0) {
    return { quantity: null, source: "unknown" };
  }
  return { quantity: measured, source: "measured" };
}

/**
 * One line, in cents.
 *
 * **THE MINIMUM IS A FLOOR AND IS APPLIED LAST**, which is what a rate sheet
 * means by it: $0.65 a pound with a $10 minimum charges $10 for a 12 lb bird
 * and $13 for a 20 lb one. Adding it to the price instead — the mistake the
 * extractor's prompt is explicitly told not to make — would charge $17.80 for
 * the first.
 *
 * **A LINE WITH A MINIMUM AND NO PRICE STILL COSTS THE MINIMUM.** "Cutting,
 * price on application, $75 minimum" is a real line and the floor is the one
 * figure on it that is certain. Reporting nothing would understate the bill by
 * the only amount anybody knows.
 */
export function lineCents(
  line: FeeLine,
  quantity: number | null,
): { cents: number | null; atMinimum: boolean } {
  const priced =
    line.unitPriceCents !== null && quantity !== null
      ? Math.round(line.unitPriceCents * quantity)
      : null;
  if (priced === null) {
    return line.minimumCents !== null
      ? { cents: line.minimumCents, atMinimum: true }
      : { cents: null, atMinimum: false };
  }
  if (line.minimumCents !== null && line.minimumCents > priced) {
    return { cents: line.minimumCents, atMinimum: true };
  }
  return { cents: priced, atMinimum: false };
}

/**
 * The whole order, in cents, and what it could not answer.
 *
 * **AN INSTRUCTION LINE IS NOT UNPRICED — IT IS NOT A CHARGE.** "Grind the
 * chuck" has no price, no unit and no minimum, and listing it among the things
 * that could not be worked out would make every cut sheet look broken. A line
 * only counts as unpriced when it LOOKS like a charge and cannot be turned into
 * one: it has a price, and nothing said how many.
 */
export function feeTotal(lines: FeeLine[], measures: RunMeasures): FeeTotal {
  const out: FeeLineTotal[] = [];
  let cents = 0;
  const unpriced: FeeLineTotal[] = [];

  for (const line of lines) {
    const { quantity, source } = lineQuantity(line, measures);
    const { cents: lineTotal, atMinimum } = lineCents(line, quantity);
    const row: FeeLineTotal = {
      key: line.key,
      label: line.label,
      quantity,
      source,
      cents: lineTotal,
      atMinimum,
    };
    out.push(row);
    if (lineTotal !== null) {
      cents += lineTotal;
    } else if (line.unitPriceCents !== null) {
      unpriced.push(row);
    }
  }

  return { lines: out, cents, unpriced };
}

/**
 * What a fee works out to per pound of what came back — the comparison the
 * whole exercise is for.
 *
 * Null rather than zero when there is nothing to divide by, the same refusal
 * `lotShareCents` makes: a rate over no pounds is a question with no
 * denominator, not a free service.
 */
export function feePerLb(
  feeCents: number,
  finishedLb: number | null,
): number | null {
  if (finishedLb === null || finishedLb <= 0) return null;
  return feeCents / finishedLb;
}
