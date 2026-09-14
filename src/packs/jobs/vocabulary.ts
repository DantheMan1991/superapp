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

// ------------------------------------------------------------------ contracts

/** Mirrors `job_contracts_role_valid`. Kept in sync by tests/jobs.test.ts. */
export const CONTRACT_ROLES = ["prime", "subcontract"] as const;
export type ContractRole = (typeof CONTRACT_ROLES)[number];

export const ROLE_LABELS: Record<ContractRole, string> = {
  prime: "We hold the contract",
  subcontract: "We are a subcontractor",
};

/** Mirrors `job_contracts_status_valid`. */
export const CONTRACT_STATUSES = [
  "proposed",
  "signed",
  "complete",
  "declined",
  "cancelled",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  proposed: "Proposed",
  signed: "Signed",
  complete: "Complete",
  /** The client who looked at the number and walked. A real and common end. */
  declined: "Declined",
  cancelled: "Cancelled",
};

/**
 * Statuses whose value counts toward what a project is worth.
 *
 * **PROPOSED IS NOT IN IT, AND THAT IS THE WHOLE POINT.** A concept the client
 * has not signed is not money, and a project list that added it up would report
 * a business as bigger than it is — which is the number an owner would take to a
 * bank. `declined` and `cancelled` are out for the obvious reason.
 */
export const VALUED_CONTRACT_STATUSES: readonly ContractStatus[] = [
  "signed",
  "complete",
];

/**
 * Mirrors `job_contracts_billing_method_valid`.
 *
 * A CLOSED list, unlike `kind` and unlike a delivery method — each of these is a
 * different sum, so the pack has to implement one before it can offer it, and
 * adding a method is a code change and therefore a migration. **Slice 1 only
 * records which one applies; nothing bills yet.**
 */
export const BILLING_METHODS = [
  "fixed_price",
  "progress_draw",
  "schedule_of_values",
  "draw_schedule",
  "cost_plus_fee",
  "unit_price",
  "time_and_materials",
] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];

/**
 * What each method is called, in the words a person doing the billing uses.
 *
 * The pilot's three are `progress_draw` (fixed price billed monthly),
 * `schedule_of_values` (an AIA pay application) and `draw_schedule` (a home's
 * milestone draws). Cost-plus, unit price and T&M are in the list because the
 * market needs them, not because the pilot does.
 */
export const BILLING_METHOD_LABELS: Record<BillingMethod, string> = {
  fixed_price: "Fixed price, billed at the end",
  progress_draw: "Fixed price, billed monthly on progress",
  schedule_of_values: "Schedule of values (AIA pay application)",
  draw_schedule: "Draw schedule (milestones)",
  cost_plus_fee: "Cost plus a fee",
  unit_price: "Unit price",
  time_and_materials: "Time and materials",
};

export function isContractRole(v: string): v is ContractRole {
  return (CONTRACT_ROLES as readonly string[]).includes(v);
}
export function isContractStatus(v: string): v is ContractStatus {
  return (CONTRACT_STATUSES as readonly string[]).includes(v);
}
export function isBillingMethod(v: string): v is BillingMethod {
  return (BILLING_METHODS as readonly string[]).includes(v);
}

/**
 * Contract-kind suggestions from the installed profile's config.
 *
 * Same shape and same reason as `deliveryMethodsFrom`: the pilot's five kinds —
 * Concept Design, Construction Drawings, New Home, Misc Proposal, AIA — are that
 * business's own ladder, and a list here would make the pack know its industry.
 * Total by construction: anything unreadable means an empty list and a free-text
 * field, never a crash.
 */
export function contractKindsFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).contractKinds;
    if (Array.isArray(value)) {
      return value.filter(
        (v): v is string => typeof v === "string" && DELIVERY_METHOD_FORMAT.test(v),
      );
    }
  }
  return [];
}
