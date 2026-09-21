import { formatQuantity } from "./billing-math";
import { moneyInText } from "./walk-lines-math";

/**
 * THE MONEY, ASKED FOR RATHER THAN GUESSED (X6).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The founder walked a real bid and said: *"I'm still not seeing how the
 * estimate is built with pricing etc. Seems like I am just answering
 * questions."* He was right, and the reason was three-deep. The walk's own
 * prompt forbids it to touch money — **rule 2, `GATHER, NEVER PRICE`** —
 * which was written to stop it INVENTING a number and also stopped it
 * ASKING for one. The pricing step behind it reads an assembly, what the
 * business charged last time, or a figure somebody said; his tenant had
 * **no assemblies and one priced line in the whole system**, so every line
 * came back `needs a price` at nothing. And the whole thing sat behind a
 * button he had to press twice a phase, thirty-three times.
 *
 * **ASKING IS NOT INVENTING.** It is the opposite, and it is the only way a
 * number this business has never recorded can reach a bid safely. So the
 * walk asks, and the answer lands with a basis of `said` — the one this
 * pack has trusted since X2b.
 *
 * ── ONE NUMBER, ONE MEANING ─────────────────────────────────────────────────
 *
 * The dangerous version of this asks *"what's the footing?"* and takes
 * whatever number comes back. `$3,400` against 240 lf is either three and a
 * half thousand pounds of concrete or **eight hundred and sixteen thousand**,
 * depending on a reading nobody stated. So the question always names what it
 * wants — *per lf* when there is a real quantity, the amount outright when
 * the line is a lump — and the panel shows the extension straight back, so a
 * misread is a number on the screen rather than a number in a proposal.
 *
 * ── THE FIRST BID IS WHERE THE PRICE BOOK COMES FROM ────────────────────────
 *
 * Every figure said here is read back by `price-memory` on the next job, so
 * the asking thins out fast. That is where the forty-five minutes lives: not
 * in typing quicker, in not being asked twice.
 */

/** What the walk wants for a line, and how it says it. */
export interface PriceAsk {
  /** The proposed line being priced. */
  lineId: string;
  /** The words on the screen. */
  prompt: string;
  /** True when the answer is a rate; false when it is the whole amount. */
  perUnit: boolean;
  unit: string;
  quantityThousandths: number;
}

export interface PriceableLine {
  id: string;
  description: string;
  unit: string;
  quantityThousandths: number;
  unitCostCents: number;
  basis: string;
}

/**
 * **A LINE NEEDS A PRICE WHEN THE WALK COULD NOT FIND ONE.** Basis `none` is
 * X2b's own word for exactly that, and a deliberate zero somebody typed is
 * not this — those never reach a proposal, they are typed on the estimate.
 */
export function needsPricing(line: PriceableLine): boolean {
  return line.basis === "none" || line.unitCostCents <= 0;
}

/** The next line on this step with no price, in the order they were proposed. */
export function nextToPrice(lines: readonly PriceableLine[]): PriceableLine | null {
  return lines.find(needsPricing) ?? null;
}

/**
 * The question, in words that say which number is wanted.
 *
 * A quantity of exactly one with no unit is a lump — asking *"per each"*
 * there reads like a machine. Anything else names its unit, every time.
 */
export function priceQuestionFor(line: PriceableLine): PriceAsk {
  const lump = line.unit.trim() === "" || line.quantityThousandths === 1_000;
  const quantity = `${formatQuantity(line.quantityThousandths)} ${line.unit}`.trim();
  return {
    lineId: line.id,
    perUnit: !lump,
    unit: line.unit,
    quantityThousandths: line.quantityThousandths,
    prompt: lump
      ? `${line.description} — what are you getting for that?`
      : `${line.description}, ${quantity} — what are you getting per ${line.unit}?`,
  };
}

/** What somebody meant by their answer to a price question. */
export type PriceReply =
  | { kind: "price"; unitCostCents: number }
  | { kind: "pass" }
  | { kind: "unclear" };

const PASSING = [
  "skip",
  "pass",
  "later",
  "leave it",
  "not yet",
  "dont know",
  "don't know",
  "no idea",
  "tbd",
  "come back",
];

/**
 * **THE FIRST FIGURE, AND NOTHING CLEVER.** A price question asks for one
 * number and this takes one number. It does not add, average, pick the
 * largest or read *"about twelve, maybe fourteen"* as thirteen — an
 * estimator who said two things gets asked again, which costs a sentence,
 * where a guess costs a wrong price in a bid.
 *
 * Passing is a real answer: the line stays unpriced and the reckoning shows
 * it, which is the whole point of the reckoning.
 */
export function readPriceReply(said: string, ask: PriceAsk): PriceReply {
  const text = said.trim().toLowerCase();
  if (text === "") return { kind: "unclear" };
  if (PASSING.some((w) => text.includes(w))) return { kind: "pass" };

  const figures = moneyInText(said);
  if (figures.length !== 1) return { kind: "unclear" };

  const cents = figures[0];
  if (cents <= 0) return { kind: "unclear" };
  return { kind: "price", unitCostCents: ask.perUnit ? cents : perUnitFromTotal(cents, ask) };
}

/**
 * A lump's answer IS its extended amount, and a proposed line stores a unit
 * cost. With a quantity of one they are the same number; the arithmetic is
 * here so that stays true if a lump ever carries another quantity.
 */
export function perUnitFromTotal(totalCents: number, ask: PriceAsk): number {
  const qty = ask.quantityThousandths;
  if (qty <= 0 || qty === 1_000) return totalCents;
  return Math.round((totalCents * 1_000) / qty);
}

/** What the line comes to once priced: quantity at the rate, rounded once. */
export function extendedCents(quantityThousandths: number, unitCostCents: number): number {
  return Math.round((quantityThousandths * unitCostCents) / 1_000);
}

/**
 * **A PRICE QUESTION BELONGS TO A PHASE, AND IT IS NOT THE ONE THE WALK
 * DERIVED.** The proposed line remembers which: `step_id`, and `step_title`
 * and `step_section` AS THEY WERE when it was proposed.
 */
export interface PendingPrice {
  /** The proposed line being asked about. */
  lineId: string;
  stepId: string | null;
  stepTitle: string;
  stepSection: string;
}

/** Enough of an outline step to name it. */
interface PhaseLike {
  id: string;
  title: string;
  section: string;
  guidance: string;
}

/** A phase as the screen names it. */
export interface PhaseOnScreen {
  stepId: string | null;
  title: string;
  section: string;
  guidance: string;
  /** Its place in the outline as it stands; 0 when the outline has lost it. */
  number: number;
}

/**
 * **WHICH PHASE THE SCREEN IS ABOUT**, which is not always the one
 * `currentStep` derived.
 *
 * X6's own note says why: coverage is how a phase is known to be finished,
 * so **`currentStep` has already left the phase whose questions just
 * settled** — and the money for that phase is asked afterwards. Everything
 * hung off the derived step therefore named the NEXT phase while the prices
 * were being asked, which on a real bid read
 * *"04. STRUCTURAL / Rough carpentry · step 1 of 10"* over *"Wall board,
 * 1/2", hang & finish, 1,216 sf — what are you getting per sf?"*.
 *
 * Nothing here is derived. A pending price names its phase, and the walk
 * has not moved on — `moveToStep` runs after the last price is in — so this
 * is the honest answer, not a nicer-looking one.
 *
 * **THE OUTLINE'S WORDS WIN WHERE IT STILL HAS THE STEP**, and the line's
 * remembered ones are the fallback: the outline is read live (ADR 0098), so
 * a phase renamed mid-walk should read by its new name on the screen, while
 * a phase DELETED mid-walk can still say what it was called.
 */
export function phaseOnScreen(
  steps: readonly PhaseLike[],
  standing: PhaseLike | null,
  pricing: PendingPrice | null,
): PhaseOnScreen {
  const at = (stepId: string | null) =>
    stepId === null ? -1 : steps.findIndex((s) => s.id === stepId);

  if (pricing) {
    const i = at(pricing.stepId);
    const step = i === -1 ? null : steps[i];
    return {
      stepId: pricing.stepId,
      title: step?.title ?? pricing.stepTitle,
      section: step?.section ?? pricing.stepSection,
      guidance: step?.guidance ?? "",
      number: i + 1,
    };
  }

  return {
    stepId: standing?.id ?? null,
    title: standing?.title ?? "",
    section: standing?.section ?? "",
    guidance: standing?.guidance ?? "",
    /** Nowhere to stand means the walk is past the end of the outline. */
    number: standing ? at(standing.id) + 1 : steps.length,
  };
}
