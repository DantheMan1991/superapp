/**
 * Land vocabulary. NO IMPORTS AND NO DIRECTIVE, deliberately.
 *
 * These values are rendered in the browser by a use picker, and importing them
 * from `src/db/schema/land.ts` would drag drizzle and every table definition
 * into that bundle — the trap documents.md wrote up after `server-only`
 * propagated through a type import and failed a build. `src/packs/assets/
 * vocabulary.ts` and `src/lib/work/vocabulary.ts` exist for the same reason.
 */

/**
 * SUGGESTIONS, NOT A CONSTRAINT.
 *
 * `land_zone_uses.use` is an open taxonomy (P1): the database checks the
 * FORMAT of this column and never its values. This list is what the picker
 * offers first.
 *
 * `productive` is the DEFAULT the form proposes when one of these is chosen —
 * it is stored per row, so a tenant whose woodlot really does sell timber can
 * disagree with us. Ground that is not productive still carries tax, interest
 * and mowing, and leaving it out of the list of what a farm owns is what makes
 * every per-acre figure flatter than reality.
 *
 * Nothing here names an industry (ADR 0004). These are uses of land, which is
 * what the pack is about; a profile contributes its own through `packConfig`
 * once the extension point for it exists (P5).
 */
export const SUGGESTED_ZONE_USES = [
  { use: "pasture", productive: true },
  { use: "hay", productive: true },
  { use: "crop", productive: true },
  { use: "garden", productive: true },
  { use: "orchard", productive: true },
  { use: "woodlot", productive: true },
  { use: "yard", productive: false },
  { use: "lane", productive: false },
  { use: "building_site", productive: false },
  { use: "water", productive: false },
  { use: "wetland", productive: false },
  { use: "idle", productive: false },
] as const;

/** The default this pack proposes for a use it knows. Unknown uses are assumed productive. */
export function defaultProductive(use: string): boolean {
  return SUGGESTED_ZONE_USES.find((u) => u.use === use)?.productive ?? true;
}

/**
 * Tenure is a CLOSED set, unlike a zone use — see the column comment in
 * `src/db/schema/land.ts`. Each value books differently, so a value the pack
 * does not recognise has no defined behaviour rather than merely an unfamiliar
 * name.
 */
export const TENURES = ["owned", "leased", "crop_share"] as const;
export type Tenure = (typeof TENURES)[number];

export const TENURE_LABELS: Record<Tenure, string> = {
  owned: "Owned",
  leased: "Leased",
  crop_share: "Crop share",
};

export const LAND_STATUSES = ["active", "retired"] as const;
export type LandStatus = (typeof LAND_STATUSES)[number];

/** Mirrors the `land_zone_uses_use_format` CHECK. Kept in sync by tests/land.test.ts. */
export const ZONE_USE_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidZoneUse(use: string): boolean {
  return ZONE_USE_FORMAT.test(use);
}

/** "building_site" → "Building site". Uses are slugs; people are not. */
export function zoneUseLabel(use: string): string {
  const spaced = use.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function isTenure(value: string): value is Tenure {
  return (TENURES as readonly string[]).includes(value);
}

/**
 * Which ASSET KINDS can hold animals.
 *
 * A pen is not a kind of land — it is an asset, and `land_occupancy` points at
 * one so a stay can say "in the coop on North Pasture". But `assets.kind` is an
 * open taxonomy covering everything the business owns, so without a filter the
 * picker offers a chest freezer and a tractor as places to put chickens. Found
 * by clicking, 2026-08-16.
 *
 * `building` and `infrastructure` are the industry-neutral answer: a thing you
 * put up and then put something inside. `equipment` is deliberately NOT here
 * even though a chicken tractor is equipment — the tenant's own kind is the
 * escape, which is why this reads config rather than being a constant.
 */
export const DEFAULT_STRUCTURE_KINDS = ["building", "infrastructure"] as const;

/**
 * Structure kinds from `packConfig.land.structureKinds`, tailorable per tenant
 * in `tenant_modules.config`.
 *
 * TOTAL BY CONSTRUCTION, like `areaUnitFrom` and `speciesFrom` — jsonb has no
 * shape constraint and most tenants have no profile, so anything unreadable
 * means the default rather than a crashed page. An explicitly EMPTY list is
 * honoured: a farm that keeps nothing in a structure gets no picker.
 */
export function structureKindsFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).structureKinds;
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === "string" && v !== "");
    }
  }
  return [...DEFAULT_STRUCTURE_KINDS];
}
