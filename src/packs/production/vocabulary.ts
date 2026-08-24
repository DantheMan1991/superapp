/**
 * Production vocabulary. NO IMPORTS AND NO DIRECTIVE — client components read
 * this, and importing from `src/db/schema` would drag drizzle into the bundle.
 * Same arrangement as `inventory/vocabulary.ts` and `livestock/vocabulary.ts`.
 *
 * NOTE WHAT IS NOT HERE: a list of run kinds. A pack that knows what
 * "butchering" is has the boundary wrong (ADR 0004) — kinds come from the
 * installed profile's `packConfig`, which is why `runKindsFrom` reads config
 * rather than declaring anything.
 */

/**
 * A run is open or it is finished. CLOSED, and two is the whole set: the state
 * that matters is whether the cost is still held by the run or has landed on a
 * shelf, and there is no third answer to that.
 */
export const RUN_STATUSES = ["in_progress", "complete"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  in_progress: "Open",
  complete: "Finished",
};

/**
 * How the input cost was split across the outputs. CLOSED — each is a
 * different claim about what the numbers mean.
 */
export const COST_BASES = ["weight", "quantity", "none"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export const COST_BASIS_LABELS: Record<string, string> = {
  weight: "By weight",
  quantity: "By count",
  none: "Not split",
};

export const COST_BASIS_NOTES: Record<string, string> = {
  weight:
    "Every output was weighed, so what went in was split across them pound for pound.",
  quantity:
    "Nothing was weighed, but everything that came out is counted the same way — so the cost was split evenly across the count. A loaf is a loaf.",
  none:
    "The cost could not be split: the outputs are measured in different units and not all of them were weighed. They landed with no cost on them, and nothing has invented one.",
};

/** Mirrors the `_format` CHECKs. Kept in sync by tests/production.test.ts. */
export const SLUG_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_FORMAT.test(value);
}

/** "bake_day" → "Bake day". Slugs are for machines. */
export function slugLabel(slug: string): string {
  const spaced = slug.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Run-kind suggestions from the installed profile's `packConfig`.
 *
 * TOTAL BY CONSTRUCTION, exactly like `speciesFrom` in `livestock`:
 * `tenant_modules.config` is jsonb with no shape constraint and most tenants
 * have no profile, so anything unreadable means an empty list and a free-text
 * field — never a crash.
 */
export function runKindsFrom(config: unknown): string[] {
  return stringListFrom(config, "runKinds");
}

/**
 * What the processors around here will take, from the installed profile.
 *
 * A SEPARATE LIST FROM `livestock`'s `species`, DELIBERATELY, and not an
 * oversight to be tidied away later. This pack must not require `livestock`
 * (`src/packs/index.ts` says why), so it could not read that list even if the
 * duplication were desirable — and it is not: what a plant will TAKE is a
 * different set from what this farm RAISES. Choosing a processor because it
 * handles sheep is a normal thing to do in the season before you own any.
 */
export function processorHandlesFrom(config: unknown): string[] {
  return stringListFrom(config, "processorHandles");
}

/**
 * TOTAL BY CONSTRUCTION, exactly like `speciesFrom` in `livestock`:
 * `tenant_modules.config` is jsonb with no shape constraint and most tenants
 * have no profile, so anything unreadable means an empty list and a free-text
 * field — never a crash.
 */
function stringListFrom(config: unknown, key: string): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === "string" && v !== "");
    }
  }
  return [];
}

/**
 * How a processor is inspected. CLOSED, and mirrors the CHECK on
 * `production_processors.inspection`.
 *
 * **`unknown` IS A REAL ANSWER, NOT A MISSING ONE**, which is why this is not a
 * boolean. A farm that has not asked is not a farm that has been told no, and
 * the difference decides where meat may legally be sold. Collapsing the two
 * would put a confident "uninspected" on a screen that is about to be used to
 * answer a legal question.
 *
 * **`custom_exempt` IS NOT A FLAVOUR OF UNINSPECTED.** It is inspected for the
 * owner and may not be resold — a real legal category with its own consequence,
 * and precisely the distinction a sales channel has to make.
 */
export const INSPECTIONS = [
  "usda",
  "state",
  "custom_exempt",
  "uninspected",
  "unknown",
] as const;
export type Inspection = (typeof INSPECTIONS)[number];

export const INSPECTION_LABELS: Record<string, string> = {
  usda: "USDA inspected",
  state: "State inspected",
  custom_exempt: "Custom exempt",
  uninspected: "Not inspected",
  unknown: "Not established",
};

/**
 * What each one means for selling it. Sentences, because this is the copy
 * somebody reads when the question is whether a sale is legal — and the app
 * states the SHAPE of the restriction without asserting any state's specifics,
 * which vary and are nobody here's to declare.
 */
export const INSPECTION_NOTES: Record<string, string> = {
  usda:
    "Federally inspected. Product may be sold across state lines and through any channel, wholesale included.",
  state:
    "Inspected under a state programme. Usually equal to federal within the state and not across state lines — check the programme before selling out of state.",
  custom_exempt:
    "Cut for the owner of the animal and stamped not for sale. It may be eaten by whoever owned it live, which is why halves are sold before the kill and never after.",
  uninspected:
    "No inspection. What may be done with this is narrow and varies by state — typically direct to the person eating it, in state, with no resale.",
  // `{word}` is the tenant's own name for the place — see `inspectionNote`.
  unknown:
    "Nobody has recorded how this {word} is inspected, so nothing here can say where its meat may be sold. It is the first thing to ask them.",
};

/**
 * An inspection note in the tenant's own vocabulary.
 *
 * **FOUND BY DRIVING IT, AND IT IS THE EXACT MISTAKE THIS SLICE ARGUES
 * AGAINST.** Every other string on the directory resolves through
 * `labelFor(pack.labels, "processor", …)`, so a farm reads "butcher"
 * throughout — except this one note, which had "processor" baked into it and
 * said so on the screen directly under a heading that said Butcher. A pack that
 * declares a renameable word and then hardcodes it in the one paragraph a person
 * actually reads has not really made it renameable.
 *
 * Only `unknown` interpolates today; the other four describe a legal status
 * rather than a place and name nothing. The substitution is unconditional
 * anyway, so the next note that needs the word gets it by writing `{word}`
 * rather than by remembering to change this function.
 */
export function inspectionNote(status: string, word: string): string {
  const note = INSPECTION_NOTES[status] ?? "";
  return note.replace(/\{word\}/g, word.toLowerCase());
}

/**
 * WHICH PATH THE MEAT TOOK. Derived from whether a run names a processor —
 * never a column of its own, because two answers to one question disagree.
 *
 * The design puts the path on the RUN and says why in one line: *"The same
 * batch of birds may be processed on-farm uninspected or sent out to a butcher,
 * decided at booking. Modelling the path on the animal or the species is
 * wrong."*
 */
export type ProcessingPath = "on_farm" | "sent_out";

export const PATH_LABELS: Record<ProcessingPath, string> = {
  on_farm: "Done here",
  sent_out: "Sent out",
};

export function pathOf(processorId: string | null): ProcessingPath {
  return processorId ? "sent_out" : "on_farm";
}

/**
 * One exemption a profile has declared: a kind, and how many of it may be
 * processed on-farm in a year.
 *
 * **THE PACK DECLARES THE SHAPE AND NOT ONE VALUE.** A pack carrying "poultry:
 * 1000" would know both what a bird is and whose law it is under. The pilot's
 * figure is in `homestead-farm.ts`; a farm in another state edits
 * `tenant_modules.config` and nothing is deployed.
 */
export interface ExemptionRule {
  kind: string;
  annualHead: number;
}

export function exemptionsFrom(config: unknown): ExemptionRule[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const value = (config as Record<string, unknown>).exemptions;
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const kind = (raw as Record<string, unknown>).kind;
    const annualHead = (raw as Record<string, unknown>).annualHead;
    if (typeof kind !== "string" || kind === "") return [];
    if (typeof annualHead !== "number" || !Number.isFinite(annualHead)) return [];
    if (annualHead <= 0) return [];
    return [{ kind, annualHead }];
  });
}

/** Where a year-to-date count sits against its cap. */
export type ExemptionStanding = "clear" | "close" | "at" | "over";

/**
 * **AT 80% IT STARTS SAYING SOMETHING.** The design's own framing is that the
 * pilot is *"already managed to a line"* — a farm at 1,000 birds knows the
 * number matters, and being told at 999 is being told too late to send the next
 * batch out to inspection instead. A processor books six to twelve months
 * ahead, so the warning has to arrive while there is still time to make a phone
 * call, not while the birds are on the trailer.
 */
export const EXEMPTION_WARN_AT = 0.8;

export function exemptionStanding(
  used: number,
  cap: number,
): ExemptionStanding {
  if (cap <= 0) return "clear";
  if (used > cap) return "over";
  if (used === cap) return "at";
  return used / cap >= EXEMPTION_WARN_AT ? "close" : "clear";
}

/**
 * What to say about it. Sentences, because the number alone does not tell
 * somebody what to do about it — and the app states the SHAPE of the limit
 * without asserting anybody's law, which varies and is not ours to declare.
 */
export function exemptionNote(
  standing: ExemptionStanding,
  used: number,
  cap: number,
  word: string,
): string {
  const left = cap - used;
  switch (standing) {
    case "over":
      return `That is ${used - cap} more than the ${cap} this year. Anything already processed cannot be undone; what it changes is where that meat may legally be sold, and every batch from here has to go to a ${word.toLowerCase()}.`;
    case "at":
      return `That is the whole ${cap} for this year. Every batch from here has to go to a ${word.toLowerCase()}, and dates get booked months ahead.`;
    case "close":
      return `${left} left of ${cap} this year. Worth booking a ${word.toLowerCase()} now rather than when it runs out — good ones are booked six to twelve months ahead.`;
    case "clear":
      return `${left} left of ${cap} this year.`;
  }
}

/**
 * Where a booked date stands. CLOSED, and three is the whole set.
 *
 * **THERE IS NO "IT HAPPENED".** Whether a date turned into a processing day is
 * answered by the booking's `run_id`, not by a status somebody has to remember
 * to advance — and a status nobody advances is precisely how a farm ends up
 * with a list that says everything is still pending. See the schema header.
 */
export const BOOKING_STATUSES = ["held", "confirmed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  held: "Pencilled in",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

export const BOOKING_STATUS_NOTES: Record<string, string> = {
  held: "A date they are holding for you. Nothing has been committed on either side, and it can go to somebody else.",
  confirmed:
    "Both sides are standing behind this date. Usually because money has moved.",
  cancelled: "Given up. It is kept so the season's history stays honest.",
};

/**
 * What a booking needs from a person RIGHT NOW, worked out from the date and
 * what the booking became. Never stored.
 *
 * `missed` is the state this whole slice exists to surface: **a date that went
 * by with no processing day recorded against it and no cancellation.** Either
 * the animals went and nobody wrote it down, or the date was lost. Both are
 * worth a person's attention and neither can be discovered by looking at a
 * status, because nothing sets one.
 *
 * `cancelled` and `done` are deliberately NOT urgencies. They are finished, and
 * a list that keeps nagging about them is one somebody stops reading.
 */
export type BookingStanding =
  | "cancelled"
  | "done"
  | "missed"
  | "today"
  | "soon"
  | "upcoming";

/**
 * HOW LONG BEFORE A DATE IT STARTS ASKING FOR ATTENTION.
 *
 * Twenty-one days, and it is a livestock number rather than a software one. A
 * kill date needs animals at weight, a trailer, and — where `livestock` holds a
 * withdrawal clock — a treatment that has cleared, which is the one that cannot
 * be fixed in the last week. Work's own horizon is seven days because a task is
 * something you sit down and do; this is something you have to have been
 * preparing for.
 */
export const BOOKING_SOON_WITHIN_DAYS = 21;

export function bookingStanding(
  booking: { status: string; bookedFor: string; runId: string | null },
  today: string,
): BookingStanding {
  if (booking.status === "cancelled") return "cancelled";
  if (booking.runId) return "done";
  if (booking.bookedFor < today) return "missed";
  if (booking.bookedFor === today) return "today";
  return daysBetween(today, booking.bookedFor) <= BOOKING_SOON_WITHIN_DAYS
    ? "soon"
    : "upcoming";
}

/**
 * Whole days between two `yyyy-mm-dd` dates.
 *
 * PARSED AS UTC MIDNIGHT ON BOTH SIDES, so the arithmetic is a subtraction of
 * two fixed instants and no daylight-saving transition can make a day 23 hours
 * long. The tenant's timezone has already been applied upstream — `today`
 * arrives as a date string computed with it — and applying it twice is how an
 * off-by-one appears for exactly the half of the year one zone is shifted.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** "in 12 days", "today", "3 days ago". Never a bare date. */
export function describeBookingDate(bookedFor: string, today: string): string {
  const days = daysBetween(today, bookedFor);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** Will they put YOUR label on the package. Mirrors the CHECK. */
export const LABELLING_OPTIONS = ["unknown", "no", "yes"] as const;
export type Labelling = (typeof LABELLING_OPTIONS)[number];

export const LABELLING_LABELS: Record<string, string> = {
  unknown: "Not established",
  no: "Their label only",
  yes: "Your label",
};

/**
 * A person's rating, in words. The scale is 1–5 and the words are here so the
 * screen never shows a bare number: "4" means nothing on its own, and a farm
 * comparing two plants a year apart needs the same anchor both times.
 */
export const RATING_LABELS: Record<number, string> = {
  1: "Would not use again",
  2: "Usable, with problems",
  3: "Fine",
  4: "Good",
  5: "First choice",
};

/**
 * Money in, money out — cents to a display string.
 *
 * Here rather than in a component because two screens format the same quoted
 * fee and a second copy would drift. Null is NOT zero and never renders as
 * `$0.00`: an unquoted fee is a question nobody has asked, and a zero would say
 * the plant works for nothing.
 */
export function centsToDisplay(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

// ------------------------------------------------------- what a plant charges ---

/**
 * WHAT ONE PRICE ON A RATE SHEET IS PER. **CLOSED, and it is the column the
 * whole itemised price list exists for.**
 *
 * $1.05 is five different amounts of money depending on which of these it is,
 * and slice 1e proved it the expensive way: `cut_wrap_cents_per_lb` held a
 * per-pound rate, every poultry plant quotes cutting per bird, and `1.05` in
 * the per-pound column was indistinguishable from a real rate. A second column
 * fixed that one case. Enumerating the unit fixes the general one.
 *
 * **THE FIRST FOUR CAN BE COMPUTED FROM A RUN; THE LAST FOUR CANNOT**, and that
 * split is what the next slice rests on:
 *
 *   - `head` — head count, off the carcass lines
 *   - `live_lb` — the plant's live weight, or the trailer ticket
 *   - `hanging_lb` — the kill sheet's hanging weight, which is what red-meat
 *     plants quote cut-and-wrap on
 *   - `finished_lb` — what came back packaged, off the run's outputs
 *   - `package`, `box`, `flat`, `hour` — a number only a person knows
 *
 * **`head` AND `hanging_lb` TOGETHER ARE THE ARRANGEMENT MOST PLANTS QUOTE**:
 * a flat fee per animal plus a rate per pound. It is also why a small animal
 * costs more per pound than a large one at the same plant — the flat half
 * spreads over less meat — which is a real fact about the business and not an
 * artefact of this model.
 *
 * `flat` is once per drop-off, whatever went. Deliberately not called `batch`:
 * the homestead profile renames a production run to *Batch*, and a unit sharing
 * that word would read as "per run" to the one tenant using it.
 */
export const PRICE_UNITS = [
  "head",
  "live_lb",
  "hanging_lb",
  "finished_lb",
  "package",
  "box",
  "flat",
  "hour",
] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export function isPriceUnit(value: string): value is PriceUnit {
  return (PRICE_UNITS as readonly string[]).includes(value);
}

/** How a unit reads beside a price. Short, because it sits after a figure. */
export const PRICE_UNIT_LABELS: Record<string, string> = {
  head: "per head",
  live_lb: "per lb live",
  hanging_lb: "per lb hanging",
  finished_lb: "per lb packaged",
  package: "per package",
  box: "per box",
  flat: "flat",
  hour: "per hour",
};

/**
 * What each unit is measured against, for the screen that has to explain why a
 * line could not be totalled. The four computable ones name where the number
 * comes from; the rest say plainly that somebody has to count them.
 */
export const PRICE_UNIT_NOTES: Record<string, string> = {
  head: "Counted off the kill sheet.",
  live_lb: "The weight before slaughter — the plant's scale where it recorded one, otherwise the trailer ticket.",
  hanging_lb: "The carcass weight off the kill sheet. What red-meat plants quote cutting against.",
  finished_lb: "The weight of what came back packaged.",
  package: "However many packages came back — somebody has to count them.",
  box: "However many boxes came back — somebody has to count them.",
  flat: "Charged once for the drop-off, whatever went.",
  hour: "Hours the plant billed for.",
};

/**
 * Units the app can work out for itself from a finished run. The rest need a
 * quantity typed onto the order line, and an order that cannot total a line
 * says so rather than assuming one of anything.
 */
export const COMPUTABLE_PRICE_UNITS: readonly PriceUnit[] = [
  "head",
  "live_lb",
  "hanging_lb",
  "finished_lb",
];

export function isComputablePriceUnit(unit: string): boolean {
  return (COMPUTABLE_PRICE_UNITS as readonly string[]).includes(unit);
}

/**
 * How a rate sheet groups itself. **A SUGGESTION, NOT A CLOSED SET** — the
 * CHECK asks only that it be a slug. Every plant's sheet is laid out
 * differently and the first one that charges for something nobody anticipated
 * must not be a migration; this is the same call
 * `production_processor_cuts.name` made about cut names, and the same one
 * `inventory` made about an adjustment's reason.
 */
export const PRICE_CATEGORIES = [
  "slaughter",
  "cutting",
  "packaging",
  "giblets",
  "extra",
] as const;

export const PRICE_CATEGORY_LABELS: Record<string, string> = {
  slaughter: "Slaughter",
  cutting: "Cutting",
  packaging: "Packaging",
  giblets: "Giblets and offal",
  extra: "Extras",
};

/** Sheet order: the way the paper reads, with anything unanticipated last. */
export function priceCategoryRank(category: string): number {
  const at = (PRICE_CATEGORIES as readonly string[]).indexOf(category);
  return at === -1 ? PRICE_CATEGORIES.length : at;
}

/**
 * Compare two labels the way a person reads them, with numbers as numbers.
 *
 * **`localeCompare` PUT A RATE SHEET IN THIS ORDER: `1001 to 1500`, `101 to
 * 250`, `251 to 500`, `50 to 100`.** Alphabetically that is correct and to
 * anybody holding the sheet it is nonsense — the bands are a ladder and they
 * came out shuffled. Any label carrying a figure has the same problem, which is
 * why this is a general comparison rather than a band-shaped one: `2 lb bag`
 * before `10 lb bag`, `Box of 6` before `Box of 12`.
 *
 * Digit runs compare as numbers and everything else compares as text, so
 * `Slaughter, Cornish x, 50 to 100` still sorts under `Slaughter` and only then
 * by its figures. Leading zeroes and decimal points are not special-cased:
 * `007` is seven, and `1.5` is a one followed by a five, which orders correctly
 * against `1.25` for the only reason that matters here — nobody bands a rate
 * sheet in fractions of an animal.
 */
export function compareLabels(a: string, b: string): number {
  const left = chunks(a);
  const right = chunks(b);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const x = left[i];
    const y = right[i];
    const bothNumbers = typeof x === "number" && typeof y === "number";
    if (bothNumbers) {
      if (x !== y) return (x as number) - (y as number);
      continue;
    }
    const compared = String(x).localeCompare(String(y));
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}

/** `Slaughter, 50 to 100` → `["slaughter, ", 50, " to ", 100]`. */
function chunks(value: string): Array<string | number> {
  const parts = value.trim().toLowerCase().match(/\d+|\D+/g) ?? [];
  return parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/**
 * Does printing the category beside this label only say the label again?
 *
 * **THE SUPPRESSION USED TO FIRE ONLY ON AN EXACT MATCH**, which was enough
 * while a label was one word and stopped being enough the moment a real sheet's
 * labels carried their qualifiers: `Slaughter, Cornish x, 50 to 100 ·
 * Slaughter` was on a screen. A label that BEGINS with its own category is
 * repeating it, and the category adds nothing.
 *
 * **THE BOUNDARY IS LOAD-BEARING.** `Slaughterhouse levy` begins with the
 * letters of `slaughter` and is not repeating it, so the character after the
 * match has to be punctuation or a space — anything but another letter or
 * digit.
 */
export function categoryRepeatsLabel(
  categoryLabel: string,
  label: string,
): boolean {
  const category = categoryLabel.trim().toLowerCase();
  const text = label.trim().toLowerCase();
  if (category === "" || !text.startsWith(category)) return false;
  const next = text.charAt(category.length);
  return next === "" || !/[a-z0-9]/.test(next);
}

/**
 * A price with its unit, for a line of a screen — `$1.05 per lb hanging`.
 *
 * Null in means null out, the same refusal `centsToDisplay` makes and for the
 * same reason: an unquoted price is a question, and `$0.00 per head` would say
 * the plant does it for nothing.
 */
export function priceWithUnit(
  cents: number | null | undefined,
  unit: string,
): string | null {
  const money = centsToDisplay(cents);
  if (money === null) return null;
  const suffix = PRICE_UNIT_LABELS[unit] ?? unit;
  return `${money} ${suffix}`;
}
