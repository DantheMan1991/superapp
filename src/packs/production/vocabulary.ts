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
