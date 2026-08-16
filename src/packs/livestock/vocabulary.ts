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
export const REMOVAL_REASONS = ["death", "cull", "sold_live"] as const;
export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export const REMOVAL_REASON_LABELS: Record<RemovalReason, string> = {
  death: "Died",
  cull: "Culled",
  sold_live: "Sold live",
};

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
