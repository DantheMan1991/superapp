/**
 * What an animal weighs, and how far to trust the answer. PURE — no imports,
 * no database.
 *
 * **A WEIGHT IS AN OBSERVATION CARRYING A METHOD.** A steer through a chute onto
 * a certified scale and the same steer measured with a tape around the heart
 * girth produce the same shape of fact and deserve very different confidence.
 * The design's rule, and the reason this file ranks methods rather than treating
 * them as labels: *broiler FCR from bagged feed against sampled weights is
 * measured and can be acted on; cattle gain from a tape against allocated
 * pasture cost is estimated and is a trend to watch. Same report, different
 * confidence.*
 *
 * **THIS IS THE FILE THAT FINALLY MAKES FCR POSSIBLE, AND IT IS ALSO THE FILE
 * THAT REFUSES IT MOST OFTEN.** Feed conversion is feed per pound of GAIN. Gain
 * needs two weighings — one number is a weight, not a gain — and a weight taken
 * days after a haul is 3–5% of shrink pretending to be a loss. Every one of
 * those refusals returns null with a reason the screen can print, because the
 * failure mode this whole slice exists to avoid is a plausible FCR computed from
 * something that was not a gain.
 *
 * Pounds and inches throughout, matching the columns. Day arithmetic through
 * `Date.UTC`, which is exact.
 */

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------- methods ---

/**
 * How a weight was arrived at. **Open taxonomy** — the column is
 * format-constrained and a profile may add a walk-over weigher without a
 * migration — but these four are what the pilot and its 10× target have.
 */
export const WEIGHT_METHODS = ["scale", "sample", "tape", "visual"] as const;
export type WeightMethod = (typeof WEIGHT_METHODS)[number];

export const WEIGHT_METHOD_LABELS: Record<string, string> = {
  scale: "Scale",
  sample: "Sampled",
  tape: "Tape",
  visual: "Eye",
};

export const WEIGHT_METHOD_NOTES: Record<string, string> = {
  scale: "Every animal over a scale. The number is the number.",
  sample:
    "A few caught and weighed, averaged across the pen. How far to trust it depends on how many went on the scale.",
  tape:
    "Heart girth and body length through a formula. Good to within a few percent on a healthy animal of an ordinary shape, and worse on anything else.",
  visual: "Somebody's eye. A trend, not a figure to sell against.",
};

/**
 * Whether a method is good enough for a number somebody acts on.
 *
 * **Scale and sample are measured; tape and eye are estimates**, and anything
 * this file has never heard of is an estimate too — the taxonomy is open, so
 * this code WILL meet methods it does not know, and the safe assumption is the
 * one that makes a downstream number say "watch the trend" rather than "act on
 * this".
 */
export function isMeasuredMethod(method: string): boolean {
  return method === "scale" || method === "sample";
}

// ------------------------------------------------------------------- tape ---

/**
 * Weight from a tape, in pounds: **girth² × length ÷ a divisor**.
 *
 * The divisor is the species' and comes from the installed profile, NOT from
 * this pack. A pack that knows a pig is 400 and a cow is 300 has the same
 * boundary problem as a pack that knows what a broiler is — and the numbers
 * genuinely differ by animal, so guessing one would silently misweigh a whole
 * species. **An unknown species returns null**, which the screen renders as "no
 * estimate from a tape for this species" rather than a confident wrong figure.
 *
 * Both measurements are in inches, taken the standard way: heart girth is the
 * circumference just behind the front legs, length is point of shoulder to pin
 * bone.
 */
export function tapeWeightLb(
  girthIn: number | null,
  lengthIn: number | null,
  divisor: number | null,
): number | null {
  if (girthIn === null || lengthIn === null || divisor === null) return null;
  if (girthIn <= 0 || lengthIn <= 0 || divisor <= 0) return null;
  return round((girthIn * girthIn * lengthIn) / divisor, 1);
}

// ------------------------------------------------------- one observation ---

export interface WeightObservation {
  id: string;
  weighedOn: string;
  method: string;
  /** How many head went on the scale together. Always at least one. */
  sampleSize: number;
  /** What those head weighed IN TOTAL. Null for a tape reading. */
  sampleWeightLb: number | null;
  heartGirthIn: number | null;
  bodyLengthIn: number | null;
}

/**
 * Average weight per head, in pounds — the division this pack never stores.
 *
 * From the scale when there is one, and from the tape otherwise. Null when
 * neither can produce a number, which for a tape means the profile has no
 * divisor for that species.
 */
export function averageWeightLb(
  observation: WeightObservation,
  tapeDivisor: number | null,
): number | null {
  if (observation.sampleWeightLb !== null && observation.sampleSize > 0) {
    return round(observation.sampleWeightLb / observation.sampleSize, 2);
  }
  return tapeWeightLb(
    observation.heartGirthIn,
    observation.bodyLengthIn,
    tapeDivisor,
  );
}

// ----------------------------------------------------------------- shrink ---

/**
 * How long after a haul a weight is not to be believed.
 *
 * **Cattle drop 3–5% when hauled and take days to recover**, which the land
 * design names as the thing that will lie to weight data. Three days is the
 * conservative end of "take days to recover": long enough to catch the weighing
 * done the morning after a trailer, short enough not to swallow a whole lot's
 * worth of observations.
 */
export const SHRINK_DAYS = 3;

/**
 * Was this weight taken in the shadow of a haul?
 *
 * `lastHauledOn` is the day the lot last moved BETWEEN PARCELS, which is land's
 * own definition of a haul — a walk to the next paddock is daily and free and
 * must not flag anything, or a rotational farm would see this warning every
 * morning and learn to ignore it.
 *
 * Null in, false out: a farm with no ground recorded cannot have hauled.
 */
export function isShrinkAffected(
  weighedOn: string,
  lastHauledOn: string | null,
): boolean {
  if (!lastHauledOn) return false;
  const gap = toEpochDay(weighedOn) - toEpochDay(lastHauledOn);
  return gap >= 0 && gap <= SHRINK_DAYS;
}

export const SHRINK_NOTE =
  "Taken within a few days of a haul. Cattle drop 3–5% on a trailer and take days to put it back, so this reads as a loss that did not happen — it is kept, and left out of the gain.";

// ------------------------------------------------------------------- gain ---

export interface WeighIn {
  id: string;
  weighedOn: string;
  method: string;
  /** Per head, in pounds. Null when the method could not produce one. */
  averageLb: number | null;
  shrinkAffected: boolean;
}

export interface GainResult {
  /** Pounds per head, between the two weighings. */
  gainLb: number;
  /** Average daily gain, per head. The figure husbandry rules of thumb are indexed on. */
  adgLb: number;
  days: number;
  from: WeighIn;
  to: WeighIn;
  /** True only when BOTH ends were measured rather than estimated. */
  measured: boolean;
}

/**
 * Gain between the first and last usable weighing.
 *
 * **Null rather than zero at every refusal**, and there are four of them: no
 * weighings, one weighing, two weighings on the same day, and every weighing
 * shrink-affected. A gain of zero is a claim that the animal did not grow, which
 * is a completely different fact from not knowing whether it did — the same rule
 * `mortalityRate` follows.
 *
 * **Shrink-affected weighings are excluded from the arithmetic and kept in the
 * record.** Deleting them would lose an observation somebody made; using them
 * would let a trailer ride read as three days of starvation.
 */
export function gainBetween(weighIns: WeighIn[]): GainResult | null {
  const usable = weighIns
    .filter((w) => w.averageLb !== null && !w.shrinkAffected)
    .sort((a, b) => (a.weighedOn < b.weighedOn ? -1 : 1));
  if (usable.length < 2) return null;

  const from = usable[0];
  const to = usable[usable.length - 1];
  const days = toEpochDay(to.weighedOn) - toEpochDay(from.weighedOn);
  if (days <= 0) return null;

  const gainLb = round(to.averageLb! - from.averageLb!, 2);
  return {
    gainLb,
    adgLb: round(gainLb / days, 3),
    days,
    from,
    to,
    measured: isMeasuredMethod(from.method) && isMeasuredMethod(to.method),
  };
}

/** The most recent usable weighing, whatever the gain situation. */
export function latestWeighIn(weighIns: WeighIn[]): WeighIn | null {
  const usable = weighIns
    .filter((w) => w.averageLb !== null)
    .sort((a, b) => (a.weighedOn < b.weighedOn ? -1 : 1));
  return usable.length === 0 ? null : usable[usable.length - 1];
}

// -------------------------------------------------------------------- FCR ---

/**
 * How much a feed figure can be leaned on, once a weight is divided into it.
 *
 * **The design's sentence, made computable.** Feed measured against a weight
 * measured is a number to act on. Anything with an estimate at either end — a
 * share of a shared feeder, a tape reading, somebody's eye — is a trend to
 * watch. There is no middle rung, because a scale of confidence nobody
 * calibrates the same way twice is the thing `attention` was kept to two values
 * to avoid.
 */
export type Confidence = "measured" | "estimated";

export function combinedConfidence(
  feedProvenance: string,
  weightMeasured: boolean,
): Confidence {
  return feedProvenance === "measured" && weightMeasured
    ? "measured"
    : "estimated";
}

export const CONFIDENCE_NOTES: Record<Confidence, string> = {
  measured:
    "Feed issued to this lot by name, against weights off a scale. A number to act on.",
  estimated:
    "Some part of this is an estimate — a share of a shared feeder, or a weight from a tape or an eye. A trend to watch rather than a figure to price against.",
};

export interface FeedConversion {
  /** Pounds of feed per pound of gain. The number the enterprise is judged on. */
  ratio: number;
  feedLb: number;
  /** Total pounds of gain across the lot, over the period the gain was measured. */
  gainLb: number;
  confidence: Confidence;
}

/**
 * Feed conversion ratio: **pounds of feed per pound of GAIN**.
 *
 * `gainLb` is the lot's TOTAL gain, not per head — feed is fed to the pen, so
 * both sides of the division have to be about the pen. The caller multiplies
 * per-head gain by the head that were standing, which is a fold over the same
 * ledger everything else in this pack folds.
 *
 * Refuses on a non-positive gain rather than returning a huge or negative
 * ratio. An animal that lost weight has a real problem and an FCR is not how to
 * say so.
 */
export function feedConversion(
  feedLb: number,
  gainLb: number,
  confidence: Confidence,
): FeedConversion | null {
  if (feedLb <= 0 || gainLb <= 0) return null;
  return {
    ratio: round(feedLb / gainLb, 2),
    feedLb: round(feedLb, 1),
    gainLb: round(gainLb, 1),
    confidence,
  };
}

/**
 * Feed per pound of LIVEWEIGHT standing — and it is emphatically not FCR.
 *
 * **It exists because the first lot of anything can never have an FCR.** Gain
 * needs two weighings, and a lot already half-grown before anybody owned a
 * scale has at best one — which is exactly the pilot's position, and exactly the
 * cold start the design says outranks the schema. This gives that lot a real
 * number from a single weighing, and the label is the whole of the honesty: it
 * counts the weight the animal arrived with as though the feed had made it,
 * which for a day-old chick is nearly true and for a bought-in feeder steer is
 * not true at all.
 *
 * Never call it conversion. The screens say "per pound of liveweight".
 */
export function feedPerLiveweightLb(
  feedLb: number,
  liveweightLb: number,
): number | null {
  if (feedLb <= 0 || liveweightLb <= 0) return null;
  return round(feedLb / liveweightLb, 2);
}

// ------------------------------------------------------------- formatting ---

/** "4.2 lb", "—". Two places is what a scale reads; three is a claim it does not make. */
export function formatLb(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} lb`;
}

/** "2.31 : 1", the way a feed conversion is spoken. */
/**
 * **A CONVERSION BELOW 1 : 1 IS NOT A CONVERSION.** Slice 8d.
 *
 * A pound of gain cannot come from less than a pound of feed, so a ratio under
 * one does not mean a miraculous pen — it means **the animals are eating
 * something this app has no record of.** On a homestead that is almost always
 * PASTURE, which `land` allocates as a zone cost and deliberately never prices
 * as feed: the design's "forage never has to be priced" is exactly why the
 * numerator here can be short.
 *
 * **SO THE WARNING SAYS WHAT IT MEANS RATHER THAN "IMPOSSIBLE".** The figure is
 * a FLOOR — the conversion cannot be better than this — and read that way it is
 * still worth showing. Hiding it would throw away a real signal, and printing
 * it bare invites somebody to quote 0.94 : 1 to a neighbour.
 *
 * Returns null when there is nothing to say, so a caller can render it or not
 * without a second condition.
 */
export function conversionWarning(ratio: number | null): string | null {
  if (ratio === null || ratio >= 1) return null;
  return "Below 1 : 1, so some of what they ate is not recorded here — pasture, most likely. Read it as a floor rather than a conversion.";
}

export function formatRatio(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(2)} : 1`;
}

/**
 * "10 birds on the scale", "1 animal" — what the sample size means for trust.
 *
 * The design asks for sample size to be recorded *so the system knows how far to
 * trust the number*, which only pays off if the person reading the screen is
 * told it too.
 */
export function describeSample(
  method: string,
  sampleSize: number,
  head: number,
): string {
  if (method === "tape" || method === "visual") return WEIGHT_METHOD_LABELS[method] ?? method;
  if (sampleSize <= 1) return "1 on the scale";
  if (head > 0 && sampleSize >= head) return `all ${head} on the scale`;
  return `${sampleSize} of ${head > 0 ? head : "the pen"} on the scale`;
}
