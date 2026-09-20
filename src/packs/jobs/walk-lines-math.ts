import { recall, type PriceBook } from "./price-memory";

/**
 * ANSWERS BECOME LINES (X2b, ADR 0098) — the pure half, and the one rule the
 * whole slice exists to keep.
 *
 * ── THE MODEL NEVER EMITS MONEY ─────────────────────────────────────────────
 *
 * Not a style preference. The pack's own assembly tests say why: **a
 * plausible wrong number in an estimate is worse than a refusal, because it
 * goes out in a proposal.** A model asked what tile costs will answer, and
 * the answer will look exactly like a real one.
 *
 * So a proposal is a SHAPE — words, a unit, a cost code, and a pointer at
 * where a number could come from — and the price is put on it here, from one
 * of four places the business can point at:
 *
 *   `assembly`  a saved item of theirs, exploded at the size asked for
 *   `memory`    what they charged for this line last time (E4a)
 *   `said`      a figure the estimator gave in the conversation
 *   `none`      nothing yet, and the line says so
 *
 * ── AND A FIGURE IT CLAIMS WAS SAID HAS TO HAVE BEEN SAID ───────────────────
 *
 * `said` is the hole in the rule: a model can put an invented number in a
 * field labelled "what they told you". So it is CHECKED — the figure must
 * appear in something actually recorded on this step, or it is dropped and
 * the line comes out unpriced. A number nobody can find in the transcript is
 * exactly the number this feature must never produce.
 */

/** Quantities are thousandths (ADR 0064); money is cents. */
const ONE = 1_000;

export const LINE_BASES = ["assembly", "memory", "said", "none"] as const;
export type LineBasis = (typeof LINE_BASES)[number];

/** What a walk may propose. Note what is absent: any free-form price. */
export interface ProposedShape {
  /** The estimator's own shorthand, as the walk heard it. */
  description: string;
  /** What the client reads instead, when it is worth differing. */
  clientDescription?: string;
  /** Whether the client sees the line at all (ADR 0080). */
  clientVisible?: boolean;
  unit?: string;
  /** In thousandths. Either quoted from the transcript or explained below. */
  quantityThousandths?: number;
  /**
   * THE ARITHMETIC, when the figure is not one somebody said outright:
   * *"2 baths at 3 fixtures each"*, *"176 lf less the 12 ft opening"*.
   *
   * The founder asked for this after the first strict version refused to do
   * any arithmetic at all — say *"two baths, three fixtures each"* and it
   * would not put 6 on the line. **A derived number is fine; an unexplained
   * one is not**, so the working is required and it is shown on the line.
   */
  derivedFrom?: string;
  /** By its digits, resolved against the job's own list (ADR 0086). */
  costCode?: string;
  /** A saved item of theirs to build this from, by name. */
  assembly?: string;
  /** A unit cost the ESTIMATOR gave, in cents. Verified against the answers. */
  saidUnitCostCents?: number;
}

export type QuantityBasis = "said" | "derived" | "none";

export interface PricedLine {
  description: string;
  clientDescription: string;
  clientVisible: boolean;
  unit: string;
  quantityThousandths: number;
  unitCostCents: number;
  costCode: string;
  basis: LineBasis;
  /** The sentence under the chip: "your last 6 bids", "you said so". */
  basisDetail: string;
  /** Where the QUANTITY came from, which is a separate question from the price. */
  quantityBasis: QuantityBasis;
  /** The working, when it was derived. Blank when it was quoted. */
  quantityNote: string;
}

/**
 * Every money-shaped figure in a piece of text, in cents.
 *
 * Deliberately generous about the way people write money and deliberately
 * strict about what counts as a match: `4.20`, `$4.20`, `4,200`, `12000` all
 * become cents, and anything that is not a number is not one. It is used to
 * ANSWER a question — "did they actually say this figure?" — so a false
 * positive costs a wrong price and a false negative costs an unpriced line.
 * The cheap direction is obvious.
 */
export function moneyInText(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const cleaned = raw[0].replace(/,/g, "");
    const value = Number(cleaned);
    if (!Number.isFinite(value)) continue;
    /** `4.20` is four dollars twenty; `12000` is twelve thousand dollars. */
    out.push(Math.round(value * 100));
  }
  return out;
}

/** Every plain figure in a piece of text, as thousandths. */
export function quantitiesInText(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(raw[0].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push(Math.round(value * ONE));
  }
  return out;
}

/**
 * Was this figure actually said?
 *
 * The guard on the one basis a model could forge. Matched against every
 * answer on the step rather than the one question, because an estimator
 * answers three things in a sentence and the walk records them separately.
 */
export function wasSaid(
  cents: number,
  answers: readonly string[],
  read: (text: string) => number[] = moneyInText,
): boolean {
  if (cents <= 0) return false;
  return answers.some((a) => read(a).includes(cents));
}

/**
 * A shape, priced.
 *
 * The order is the order of trust: what the estimator SAID beats what they
 * charged last time, and both beat nothing. An assembly is not here — it
 * makes several lines rather than one, so `explodeAssembly` handles it and
 * this is what the rest fall back to.
 */
export function priceProposed(
  shape: ProposedShape,
  answers: readonly string[],
  book: PriceBook,
  today: string,
): PricedLine {
  const description = shape.description.trim();
  const quantity = resolveQuantity(shape, answers);
  const base = {
    description,
    clientDescription: (shape.clientDescription ?? "").trim(),
    clientVisible: shape.clientVisible !== false,
    unit: (shape.unit ?? "").trim(),
    costCode: (shape.costCode ?? "").trim(),
    quantityThousandths: quantity.quantityThousandths,
    quantityBasis: quantity.quantityBasis,
    quantityNote: quantity.quantityNote,
  };

  /* 1. A figure the estimator gave — if they really gave it. */
  if (shape.saidUnitCostCents !== undefined && shape.saidUnitCostCents > 0) {
    if (wasSaid(shape.saidUnitCostCents, answers)) {
      return {
        ...base,
        unitCostCents: shape.saidUnitCostCents,
        basis: "said",
        basisDetail: "you said so",
      };
    }
    /**
     * IT CLAIMED A FIGURE NOBODY SAID. The line still comes out — the WORDS
     * are useful and dropping them loses the scope — but with no price and a
     * chip that says so. This is the refusal the whole file is built around.
     */
    return {
      ...base,
      unitCostCents: 0,
      basis: "none",
      basisDetail: "needs a price",
    };
  }

  /* 2. What this business charged for the same line last time (E4a). */
  const remembered = recall(book, description);
  if (remembered && remembered.unitCostCents > 0) {
    return {
      ...base,
      unit: base.unit === "" ? remembered.unit : base.unit,
      unitCostCents: remembered.unitCostCents,
      basis: "memory",
      basisDetail: `last charged on ${remembered.projectNumber}`,
    };
  }

  /* 3. Nothing to go on, and the line says so rather than guessing. */
  return { ...base, unitCostCents: 0, basis: "none", basisDetail: "needs a price" };
}

/** How long a piece of working may be before it stops being readable. */
export const QUANTITY_NOTE_MAX = 120;

/**
 * **A QUANTITY IS EITHER QUOTED OR EXPLAINED.**
 *
 * The first version refused any figure that was not verbatim in the
 * transcript, which also refused arithmetic anybody would want: say *"two
 * baths, three fixtures each"* and it would not put 6 on the line. The
 * founder asked for the arithmetic, shown — which is the better rule,
 * because what makes a derived number safe is not that a model did not do it
 * but that **you can see the working and judge it in a second.**
 *
 * So: quoted from what was said, or accompanied by its working. A figure
 * with neither is still refused and the line becomes a lump of one, because
 * a number with no account of itself is exactly what this must not produce.
 */
export function resolveQuantity(
  shape: ProposedShape,
  answers: readonly string[],
): { quantityThousandths: number; quantityBasis: QuantityBasis; quantityNote: string } {
  const wanted = shape.quantityThousandths;
  const none = { quantityThousandths: ONE, quantityBasis: "none" as const, quantityNote: "" };
  if (wanted === undefined || wanted <= 0) return none;

  if (wasSaid(wanted, answers, quantitiesInText)) {
    return { quantityThousandths: wanted, quantityBasis: "said", quantityNote: "" };
  }

  const working = (shape.derivedFrom ?? "").trim();
  if (working !== "") {
    return {
      quantityThousandths: wanted,
      quantityBasis: "derived",
      quantityNote: working.slice(0, QUANTITY_NOTE_MAX),
    };
  }
  return none;
}

/** What the chip reads beside a quantity. Blank when nobody needs telling. */
export function quantityLabel(
  basis: QuantityBasis,
  note: string,
): string {
  if (basis === "derived") return note;
  return "";
}

/** What the chip reads on a line the walk produced. */
export function basisLabel(basis: LineBasis): string {
  switch (basis) {
    case "assembly":
      return "assembly";
    case "memory":
      return "your last price";
    case "said":
      return "you said it";
    case "none":
      return "needs a price";
  }
}
