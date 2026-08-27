/**
 * Livestock vocabulary. NO IMPORTS AND NO DIRECTIVE — client components read
 * this, and importing from `src/db/schema` would drag drizzle into the bundle.
 *
 * NOTE WHAT IS NOT HERE: a list of species. A pack that knows what a broiler is
 * has the boundary wrong (ADR 0004) — species come from the installed profile's
 * `packConfig`, which is why `speciesFrom` reads config rather than declaring
 * anything. The homestead-farm profile supplies cattle, swine and poultry.
 */

/** Reasons head leaves other than by moving to another lot. CLOSED — each means something different. */
export const REMOVAL_REASONS = ["death", "cull", "sold_live", "processed"] as const;
export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export const REMOVAL_REASON_LABELS: Record<RemovalReason, string> = {
  death: "Died",
  cull: "Culled",
  sold_live: "Sold live",
  processed: "Processed",
};

/**
 * Reasons a PERSON picks on the lot page. `processed` is deliberately not one
 * of them: head leaves for a run through `production`, which is the only place
 * that also lands the meat, carries the cost across and consults the withdrawal
 * clock. Offering it here would give somebody a way to empty a pen that does
 * none of those three things.
 */
export const HAND_REMOVAL_REASONS = ["death", "cull", "sold_live"] as const;

export const SEXES = ["male", "female", "mixed"] as const;
export const SEX_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  // The honest answer for a straight-run batch of chicks, not a missing value.
  mixed: "Mixed",
};

/**
 * Tag kinds. Open taxonomy — the format is constrained, the values are not.
 *
 * They are NOT interchangeable: a visual tag is what you read across a field, an
 * official tag is what reaches processor paperwork, and an EID is what a reader
 * picks up. Tags are lost and replaced while the official ID must persist.
 */
export const IDENTIFIER_KINDS = ["name", "visual", "official", "eid", "tattoo"] as const;

export const IDENTIFIER_KIND_LABELS: Record<string, string> = {
  name: "Name",
  visual: "Visual tag",
  official: "Official tag",
  eid: "EID / RFID",
  tattoo: "Tattoo",
};

export function identifierKindLabel(kind: string): string {
  return IDENTIFIER_KIND_LABELS[kind] ?? kind;
}

/**
 * How a treatment went in. Open taxonomy — the format is constrained, the
 * values are not.
 *
 * **The route is not decoration: it changes the withdrawal period.** The same
 * product given in the water and given by injection clears at different times,
 * which is why it sits beside the dose rather than in the notes.
 */
export const TREATMENT_ROUTES = [
  "water",
  "feed",
  "oral",
  "injection",
  "topical",
  "intramammary",
] as const;

export const TREATMENT_ROUTE_LABELS: Record<string, string> = {
  water: "In the water",
  feed: "In the feed",
  oral: "By mouth",
  injection: "Injection",
  topical: "On the skin",
  intramammary: "Intramammary",
};

export function treatmentRouteLabel(route: string): string {
  return TREATMENT_ROUTE_LABELS[route] ?? slugToWords(route);
}

function slugToWords(slug: string): string {
  const words = slug.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Species suggestions from the installed profile's `packConfig`.
 *
 * TOTAL BY CONSTRUCTION: `tenant_modules.config` is jsonb with no shape
 * constraint and most tenants have no profile, so anything unreadable means an
 * empty list and a free-text field — never a crash.
 */
export function speciesFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).species;
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === "string" && v !== "");
    }
  }
  return [];
}

/**
 * An example breed for the species chosen, for the placeholder only.
 *
 * A HINT, NEVER A CONSTRAINT, and since slice 4a it is also the FALLBACK: when
 * the profile lists breeds for a species, `breedsFrom` supplies real
 * suggestions and this is what a species nobody described still gets.
 *
 * It exists because the field carried a fixed "e.g. Cornish Cross", which sat
 * under Species: Cattle and read as an instruction rather than an example.
 * A species this does not know gets NO placeholder, which is the honest answer
 * — better an empty box than a confident irrelevance.
 */
const BREED_HINTS: Record<string, string> = {
  cattle: "e.g. Angus",
  poultry: "e.g. Cornish Cross",
  swine: "e.g. Berkshire",
  sheep: "e.g. Katahdin",
  goat: "e.g. Boer",
};

export function breedHint(species: string): string | undefined {
  return BREED_HINTS[species.trim().toLowerCase().replace(/\s+/g, "_")];
}

/**
 * The breeds a profile suggests for one species, as slugs.
 *
 * **THE PACK NAMES NO BREEDS**, for the same reason it names no species: one
 * that knew what a Hereford was would know what industry it was in, which is
 * the boundary ADR 0004 draws. A profile lists what is common where its tenants
 * farm, and a tenant crossing something nobody listed types it — the slug format
 * check is the only thing with an opinion.
 *
 * Total by construction, like `speciesFrom` and `tapeDivisorFrom`:
 * `tenant_modules.config` is jsonb with no shape constraint, so anything
 * unreadable is an empty list and a free-text field, never a crash.
 */
export function breedsFrom(config: unknown, species: string): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const breeds = (config as Record<string, unknown>).breeds;
  if (!breeds || typeof breeds !== "object" || Array.isArray(breeds)) return [];
  const key = species.trim().toLowerCase().replace(/\s+/g, "_");
  const value = (breeds as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

/**
 * The divisor in the tape formula — **girth² × length ÷ this** — for one
 * species, from the installed profile's `packConfig`.
 *
 * IT LIVES IN CONFIG FOR THE SAME REASON SPECIES DO. The number genuinely
 * differs by animal (a pig is not a cow), and a pack that hardcoded 400 for
 * swine and 300 for cattle would know what a pig is — the boundary ADR 0004
 * draws. It is also the sort of figure a vet or an extension office will argue
 * about, and config is where an argument can be settled per tenant.
 *
 * **Returns null for a species the profile says nothing about, and null means no
 * estimate rather than a default.** A tape reading on an animal whose formula
 * nobody supplied produces no weight at all, which is the honest answer — the
 * alternative is quietly weighing sheep as though they were pigs.
 *
 * Total by construction, like `speciesFrom`: `tenant_modules.config` is jsonb
 * with no shape constraint, so anything unreadable is "no divisor".
 */
export function tapeDivisorFrom(
  config: unknown,
  species: string,
): number | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const divisors = (config as Record<string, unknown>).tapeDivisors;
  if (!divisors || typeof divisors !== "object" || Array.isArray(divisors)) {
    return null;
  }
  const key = species.trim().toLowerCase().replace(/\s+/g, "_");
  const value = (divisors as Record<string, unknown>)[key];
  return typeof value === "number" && value > 0 ? value : null;
}
