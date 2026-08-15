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
