/**
 * The words this pack uses. **NO IMPORTS AND NO DIRECTIVE** — client components
 * read this, and importing from `src/db/schema` would drag drizzle into the
 * bundle. Same arrangement as every other pack's.
 *
 * ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
 *
 * **A LIST OF DELIVERY METHODS.** No `["production_residential", "commercial",
 * …]`, not even as a suggestion. A pack that knew what "commercial" meant would
 * know what industry it was in, which is the boundary ADR 0004 draws and the
 * one `production` states best about its own missing list of run kinds. The
 * industry profile supplies the suggestions through `packConfig`; a business
 * with a kind nobody listed types it, and the format check is the only thing
 * with an opinion.
 *
 * **A LIST OF COST CODES.** For the same reason twice over: CSI MasterFormat is
 * commercial vocabulary, NAHB's chart is residential, and the pilot invented its
 * own. A starter set is a profile's seed, and the rows are the tenant's from the
 * moment they exist.
 */

/**
 * The pack's slug, as `modules.id` and as the route segment.
 *
 * HERE RATHER THAN IN `actions.ts`, and the reason is a rule neither `tsc` nor
 * eslint enforces: **a `"use server"` file may export nothing but async
 * functions.** `export const PACK` in one is a build error that only shows when
 * the page is actually rendered — found by running it, 2026-09-14.
 */
export const PACK = "jobs";

/** Mirrors `job_projects_delivery_method_format`. Kept in sync by tests/jobs.test.ts. */
export const DELIVERY_METHOD_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

/** Mirrors `job_projects_status_valid`. */
export const PROJECT_STATUSES = [
  "planned",
  "active",
  "on_hold",
  "complete",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

/** What a status is called on screen. */
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Active",
  on_hold: "On hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

/**
 * The dimension type a project syncs into `dimension_members`.
 *
 * **THE REASON THIS PACK IS WORTH ANYTHING ON DAY ONE.** Once a project is a
 * cost object, a bill line and a timecard can be tagged to it and every existing
 * accounting report groups by it — with no change to accounting, which must
 * never learn that this pack exists.
 */
export const PROJECT_DIMENSION = "project";

/** "laying_hens" → "Laying hens". Slugs are for machines. */
export function slugLabel(slug: string): string {
  const spaced = slug.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Delivery-method suggestions from the installed profile's config.
 *
 * **TOTAL BY CONSTRUCTION**, like `speciesFrom` and `runKindsFrom`: the config
 * is jsonb with no shape constraint and most tenants have no profile, so
 * anything unreadable means an empty list and a free-text field — never a crash,
 * and never a default that asserts an industry.
 */
export function deliveryMethodsFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).deliveryMethods;
    if (Array.isArray(value)) {
      return value.filter(
        (v): v is string => typeof v === "string" && DELIVERY_METHOD_FORMAT.test(v),
      );
    }
  }
  return [];
}
