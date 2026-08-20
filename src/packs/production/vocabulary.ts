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
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).runKinds;
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === "string" && v !== "");
    }
  }
  return [];
}
