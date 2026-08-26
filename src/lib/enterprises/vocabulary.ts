/**
 * The words this subsystem uses. **NO IMPORTS AND NO DIRECTIVE** — client
 * components read this, and importing from `src/db/schema` would drag drizzle
 * into the bundle. Same arrangement as every pack's `vocabulary.ts`.
 *
 * ── WHAT IS NOT HERE, AND WHY IT WAS REMOVED ────────────────────────────────
 *
 * **A LIST OF KINDS.** The first version of this shipped with
 * `["livestock", "crop", "other"]` hard-coded, and a form reading *"Livestock —
 * animals you raise"*. That is a Layer 0 table telling a law firm what its lines
 * of business are made of.
 *
 * The rule it broke is the one `production` states best, about its own missing
 * list: *"the pack has no list of its own on purpose — one that knew what
 * 'butchering' was would know what industry it was in, which is the boundary
 * ADR 0004 draws."* `speciesFrom`, `runKindsFrom` and `channelKindsFrom` are all
 * the same shape, and this is now a fourth. **A core tool speaks no industry.**
 *
 * The industry profile supplies the kinds; a tenant with a kind nobody listed
 * types it, and the column takes any slug.
 */

/** Mirrors `enterprises_kind_format`. Kept in sync by tests/enterprises.test.ts. */
export const KIND_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * **THE NEUTRAL WORD, and it is deliberately not "Enterprise".**
 *
 * "Enterprise" is farm-management vocabulary — a farm enterprise is one
 * production activity, and the beef enterprise and the dairy enterprise are the
 * two halves of a herd. To anybody outside agriculture it reads as "a company",
 * which is the wrong idea entirely.
 *
 * A line of business is what the thing actually is in plain English, in any
 * trade, and needs no glossary. The farm profile renames it — see
 * `src/industries/homestead-farm.ts`, where `zone` becomes "Paddock" and
 * `productionRun` becomes "Batch" for the same reason.
 */
export const ENTERPRISE_LABEL_KEY = "enterprise";
export const ENTERPRISE_FALLBACK = "Line of business";
export const ENTERPRISE_FALLBACK_PLURAL = "Lines of business";

/** "laying_hens" → "Laying hens". Slugs are for machines. */
export function slugLabel(slug: string): string {
  const spaced = slug.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Kind suggestions from the installed profile's config.
 *
 * **TOTAL BY CONSTRUCTION, like `speciesFrom` and `runKindsFrom`**: the config
 * is jsonb with no shape constraint and most tenants have no profile, so
 * anything unreadable means an empty list and a free-text field — never a
 * crash, and never a default that asserts an industry.
 */
export function enterpriseKindsFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).kinds;
    if (Array.isArray(value)) {
      return value.filter(
        (v): v is string => typeof v === "string" && KIND_FORMAT.test(v),
      );
    }
  }
  return [];
}
