import { formatQuantity } from "./billing-math";
import type { MeasureKind } from "./vocabulary";

/**
 * THE ARITHMETIC OF MEASURING THE BUILDING (X7).
 *
 * Pure, so `tests/jobs-measure.test.ts` can hold the rules without a
 * database and without the model. The ops half is `measure-ops.ts`.
 *
 * ── THE MODEL IS NOT IN THIS PATH EITHER ────────────────────────────────────
 *
 * The same rule X6 set for prices, for the same reason. A measurement is
 * asked for from a row, read by the parser below, and written to the row
 * whose id was on the screen. Nothing infers which measurement an answer
 * belonged to, because a wrong number here is worse than a wrong price: it
 * multiplies through every line that reads it.
 *
 * ── BUT AN ESTIMATOR DOES NOT TYPE A DECIMAL ────────────────────────────────
 *
 * They type what is on the tape and what is on the drawing. `38'-6"`, `24 x
 * 40`, `40 + 24 + 40 + 24`. Refusing those would be correct and useless —
 * the founder's bar is *"seamless and snappy and just part of the flow"* —
 * so the parser reads them, and reads nothing it has to guess at. Two
 * figures with no operator between them is still not an answer.
 */

/** A measurement the outline wants, as the pure half sees it. */
export interface DeclaredMeasure {
  id: string;
  name: string;
  unit: string;
  kind: MeasureKind;
  guidance: string;
  required: boolean;
}

/** One taken, as the pure half sees it. */
export interface TakenMeasure {
  slug: string;
  name: string;
  unit: string;
  valueThousandths: number | null;
  passed: boolean;
  note: string;
}

export interface MeasureAsk {
  measureId: string;
  slug: string;
  name: string;
  unit: string;
  kind: MeasureKind;
  prompt: string;
}

export type MeasureReply =
  | { kind: "value"; valueThousandths: number }
  | { kind: "pass" }
  | { kind: "unclear" };

/**
 * THE IDENTITY OF A MEASUREMENT IS ITS NAME, REDUCED.
 *
 * *Wall perimeter*, *wall perimeter* and *Wall  Perimeter* are one number
 * about one building. Reducing here rather than comparing loosely at every
 * call site is what lets the database hold the rule as a unique index.
 */
export function measureSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** What the question sounds like. The unit is in it, because the answer is a bare number. */
export function measureQuestionFor(m: DeclaredMeasure): MeasureAsk {
  const unit = m.unit.trim();
  const head = unit === "" ? `${m.name} — what is it?` : `${m.name} — how many ${unit}?`;
  return {
    measureId: m.id,
    slug: measureSlug(m.name),
    name: m.name,
    unit,
    kind: m.kind,
    prompt: m.guidance.trim() === "" ? head : `${head} (${m.guidance.trim()})`,
  };
}

/**
 * The first thing on the list nobody has answered. A measurement that is
 * there with a value OR a pass is answered; the pass is what stops the walk
 * asking the same thing at every turn.
 */
export function nextToMeasure(
  declared: readonly DeclaredMeasure[],
  taken: readonly TakenMeasure[],
): DeclaredMeasure | null {
  const done = new Set(taken.map((t) => t.slug));
  return declared.find((d) => !done.has(measureSlug(d.name))) ?? null;
}

/** What is still owed before the questions start — required ones only. */
export function outstandingMeasures(
  declared: readonly DeclaredMeasure[],
  taken: readonly TakenMeasure[],
): DeclaredMeasure[] {
  const done = new Set(taken.map((t) => t.slug));
  return declared.filter((d) => d.required && !done.has(measureSlug(d.name)));
}

/** "248 lf", "2,400 sf", "not on this job". */
export function formatMeasurement(m: TakenMeasure): string {
  if (m.valueThousandths === null) return "not measured";
  const n = formatQuantity(m.valueThousandths);
  return m.unit.trim() === "" ? n : `${n} ${m.unit.trim()}`;
}

/**
 * The measurements as the walk's prompt carries them — a handful of lines
 * that go in EVERY turn, which is the point of the whole slice. An answer
 * falls out of the context after thirty; this does not.
 */
export function measureLines(taken: readonly TakenMeasure[]): string[] {
  return taken
    .filter((m) => m.valueThousandths !== null)
    .map((m) => `- ${m.name}: ${formatMeasurement(m)}${m.note.trim() ? ` (${m.note.trim()})` : ""}`);
}

/* -------------------------------------------------------------------- reading */

const PASS_WORDS = [
  "skip",
  "pass",
  "leave it",
  "later",
  "not sure",
  "don't know",
  "dont know",
  "no idea",
  "n/a",
  "na",
  "none",
  "not on this",
  "tbd",
];

/**
 * Words an estimator says around a number that carry no arithmetic. Stripped
 * before the expression is read, so *"call it about 2,400 sf"* is 2,400.
 */
const FILLER =
  /\b(about|roughly|around|approx|approximately|call it|say|its|it's|is|total|say about|maybe)\b/g;

/**
 * Units that may trail a figure. Stripped so the expression is arithmetic
 * only — and `ft`/`in` go last, because the feet-and-inches reading below
 * has already had its turn at them.
 */
const UNIT_WORDS =
  /\b(square feet|square foot|sq\.? ?ft|sq\.? ?m|sqft|lineal feet|linear feet|lin\.? ?ft|lf|sf|sy|cy|cubic yards?|yards?|each|ea|ft|feet|foot|in|inch|inches|m2|m²|metres?|meters?|m)\b/g;

/**
 * A phrase present as WORDS, never as letters inside one. Both sides are
 * reduced to space-separated words first, which is why `n/a` in the list
 * finds `n/a`, `n.a.` and `N / A` and why `na` does not find *internal*.
 */
function words(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function hasWord(text: string, phrase: string): boolean {
  return words(text).includes(words(phrase));
}

/** A figure written as feet and inches becomes decimal feet, in place. */
function readFeetAndInches(text: string): string {
  return text
    /** 38'-6", 38' 6", 38'6" */
    .replace(
      /(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"/g,
      (_, ft: string, inch: string) => String(Number(ft) + Number(inch) / 12),
    )
    /** 38 ft 6 in */
    .replace(
      /(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\s*-?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches)\b/g,
      (_, ft: string, inch: string) => String(Number(ft) + Number(inch) / 12),
    )
    /** 38' on its own */
    .replace(/(\d+(?:\.\d+)?)\s*'/g, (_, ft: string) => ft)
    /** 6" on its own */
    .replace(/(\d+(?:\.\d+)?)\s*"/g, (_, inch: string) => String(Number(inch) / 12));
}

/**
 * **A SUM OF PRODUCTS, AND NOTHING CLEVERER.**
 *
 * `40 + 24 + 40 + 24` is a perimeter walked round a plan and `24 x 40` is a
 * footprint; both are what an estimator actually writes, and both are
 * unambiguous. Subtraction is deliberately NOT read, because `38-6` is feet
 * and inches to the person typing it and would silently become 32.
 */
function readExpression(text: string): number | null {
  const parts = text.split("+");
  let total = 0;
  for (const part of parts) {
    const factors = part.split(/[x*]/);
    let product = 1;
    let any = false;
    for (const f of factors) {
      const t = f.trim();
      if (t === "") return null;
      if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
      product *= Number(t);
      any = true;
    }
    if (!any) return null;
    total += product;
  }
  return Number.isFinite(total) ? total : null;
}

/**
 * WHAT SOMEBODY TYPED, AS A MEASUREMENT OR AS NOTHING.
 *
 * Unclear is a real outcome and a cheap one — it costs a sentence and asks
 * again. Guessing costs a bid.
 */
export function readMeasureReply(said: string): MeasureReply {
  const raw = said.trim().toLowerCase();
  if (raw === "") return { kind: "unclear" };
  /**
   * A passing word wins over a figure in the same breath: "skip, maybe 40"
   * is a pass. **On a word boundary, not a substring** — `na` inside
   * *internal* would otherwise pass a measurement somebody was giving.
   */
  if (PASS_WORDS.some((w) => hasWord(raw, w))) return { kind: "pass" };

  let text = readFeetAndInches(raw);
  /** A thousands comma only: "2,400" is one figure, "12, 14" is two. */
  text = text.replace(/,(?=\d{3}(?:\D|$))/g, "");
  text = text.replace(/\bby\b/g, "x");
  text = text.replace(FILLER, " ");
  text = text.replace(UNIT_WORDS, " ");
  text = text.replace(/[()]/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (text === "") return { kind: "unclear" };

  /**
   * The expression first, then ONE FIGURE AMONG WORDS.
   *
   * The fallback is what keeps this usable: *"2,400 sf gross"* and
   * *"internal 40"* carry a word the list above does not know, and refusing
   * them would be safe and infuriating. One number in the whole answer
   * cannot be the wrong one. **Two still can**, so *"240 to 260"* stays
   * unclear and gets asked again — the rule X6 set for prices, unchanged.
   */
  const figures = text.match(/\d+(?:\.\d+)?/g) ?? [];
  const value = readExpression(text) ?? (figures.length === 1 ? Number(figures[0]) : null);
  /** Nothing, nought and a negative are not measurements. */
  if (value === null || !(value > 0)) return { kind: "unclear" };
  return { kind: "value", valueThousandths: Math.round(value * 1000) };
}
