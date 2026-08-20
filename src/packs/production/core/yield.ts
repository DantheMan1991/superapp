/**
 * The yield. PURE — no imports, no database.
 *
 * **THIS IS THE REPORT ONLY THIS PACK CAN PRODUCE, and the reason the pack
 * exists at all.** A steer goes in at 1,150 lb live and hangs at 690. That
 * ratio varies by animal, by breed, by finish — and *by processor*, which is
 * where the money is: the pilot already uses more than one butcher, same kind of
 * animal, different pounds in the freezer, and essentially nobody measures it.
 *
 * **IT IS MEASURED PER RUN AND IS NEVER A STORED FACTOR.** `inventory`'s units
 * file spells out why: a live-to-hanging conversion baked into a unit is an
 * unauditable fudge in the books and makes every carcass quietly wrong. So the
 * arithmetic lives here, over what was actually weighed, and it is folded at
 * read time like every other number in these packs.
 *
 * **EVERY REFUSAL IN THIS FILE IS DELIBERATE.** A yield computed over a partial
 * set of weights is not approximately right, it is confidently low — three of
 * five boxes weighed against the whole animal reads as a catastrophic kill. The
 * pack's rule, inherited from `livestock`'s FCR: *the reason a screen gives is
 * more useful than a number it had to invent.*
 */

/** One side of the scale. Pounds, or null when nobody weighed it. */
export interface WeighedRow {
  key: string;
  lb: number | null;
}

export type YieldRefusal =
  | "NO_INPUTS"
  | "NO_OUTPUTS"
  | "NO_INPUT_WEIGHTS"
  | "NO_OUTPUT_WEIGHTS"
  | "PARTIAL_INPUT_WEIGHTS"
  | "PARTIAL_OUTPUT_WEIGHTS";

/**
 * What the screen says instead of a percentage. Written as sentences, because
 * this is the copy somebody reads when they expected a number and did not get
 * one.
 */
export const YIELD_REFUSALS: Record<YieldRefusal, string> = {
  NO_INPUTS: "Nothing has gone in yet, so there is nothing to measure against.",
  NO_OUTPUTS: "Nothing has come out yet.",
  NO_INPUT_WEIGHTS:
    "Nothing that went in was weighed. A yield is a ratio of weights, and head is not a weight — put the animals on a scale and it becomes answerable.",
  NO_OUTPUT_WEIGHTS:
    "Nothing that came out was weighed. Anything counted rather than weighed needs its pounds entered, or there is no ratio to state.",
  PARTIAL_INPUT_WEIGHTS:
    "Some of what went in was not weighed. A ratio over part of the animals would read as a far better yield than the run actually had, so none is given.",
  PARTIAL_OUTPUT_WEIGHTS:
    "Some of what came out was not weighed. A ratio over part of the boxes would read as a disastrous kill, so none is given.",
};

export interface RunYield {
  /** Total pounds in. */
  inLb: number;
  /** Total pounds out. */
  outLb: number;
  /** Out over in. 0.6 for a steer that hangs at 60%. */
  ratio: number;
}

export type YieldResult =
  | { yield: RunYield; refusedBecause?: undefined }
  | { yield?: undefined; refusedBecause: YieldRefusal };

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Overall yield: everything that came out over everything that went in.
 *
 * **"OVERALL", AND THE WORD IS LOAD-BEARING.** Dressing percentage (live →
 * hanging) and cutting yield (hanging → packaged) are the two ratios a butcher
 * actually argues about, and telling them apart needs the carcass recorded as a
 * stage of its own — which is the kill sheet, and which is slice 1. Until then
 * this is one honest number rather than two guessed ones.
 */
export function runYield(
  inputs: WeighedRow[],
  outputs: WeighedRow[],
): YieldResult {
  if (inputs.length === 0) return { refusedBecause: "NO_INPUTS" };
  if (outputs.length === 0) return { refusedBecause: "NO_OUTPUTS" };

  const inWeighed = inputs.filter((r) => r.lb !== null);
  if (inWeighed.length === 0) return { refusedBecause: "NO_INPUT_WEIGHTS" };
  if (inWeighed.length < inputs.length) {
    return { refusedBecause: "PARTIAL_INPUT_WEIGHTS" };
  }

  const outWeighed = outputs.filter((r) => r.lb !== null);
  if (outWeighed.length === 0) return { refusedBecause: "NO_OUTPUT_WEIGHTS" };
  if (outWeighed.length < outputs.length) {
    return { refusedBecause: "PARTIAL_OUTPUT_WEIGHTS" };
  }

  const inLb = round(inWeighed.reduce((sum, r) => sum + (r.lb ?? 0), 0));
  const outLb = round(outWeighed.reduce((sum, r) => sum + (r.lb ?? 0), 0));
  // Zero pounds in is unrepresentable through the write path (the column is
  // CHECKed positive), but a fold that can divide by zero is a fold that will.
  if (inLb <= 0) return { refusedBecause: "NO_INPUT_WEIGHTS" };

  return { yield: { inLb, outLb, ratio: outLb / inLb } };
}

/** "60.0%", or an em dash. Never a rounded-to-zero percentage for a real ratio. */
export function formatRatio(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

/** "1,150.0 lb". Pounds throughout — the column names say so for a reason. */
export function formatLb(lb: number | null): string {
  if (lb === null) return "—";
  return `${lb.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} lb`;
}
