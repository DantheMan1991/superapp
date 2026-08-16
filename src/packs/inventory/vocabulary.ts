/**
 * Inventory vocabulary. NO IMPORTS AND NO DIRECTIVE, deliberately — client
 * components read this, and importing from `src/db/schema` would drag drizzle
 * into that bundle. Same reason `assets/vocabulary.ts` and
 * `land/vocabulary.ts` exist.
 */

/**
 * SUGGESTIONS, NOT A CONSTRAINT. `inventory_items.item_kind` is an open
 * taxonomy: the database checks the format and never the values.
 *
 * Ordered by how often a farm reaches for them, NOT alphabetically — `land`
 * paid for that lesson when sorting put `building_site` at the top of the use
 * picker and made it the default answer for a paddock.
 */
export const SUGGESTED_ITEM_KINDS = [
  "feed",
  "produce",
  "meat",
  "egg",
  "supply",
  "livestock",
  "seed",
  "medicine",
] as const;

/**
 * What a place has to be for the thing to keep. Open, because the walk-in that
 * holds eggs, aging beef and fresh product is not a cold freezer and somebody
 * will need a word for whatever they actually have.
 */
export const STORAGE_REQUIREMENTS = [
  "frozen",
  "refrigerated",
  "dry",
  "ambient",
] as const;

/** Where a lot came from. CLOSED — each behaves differently once cost arrives. */
export const LOT_SOURCES = ["purchased", "raised", "produced"] as const;
export type LotSource = (typeof LOT_SOURCES)[number];

export const LOT_SOURCE_LABELS: Record<LotSource, string> = {
  purchased: "Bought",
  raised: "Raised here",
  produced: "Made here",
};

export function isLotSource(value: string): value is LotSource {
  return (LOT_SOURCES as readonly string[]).includes(value);
}

/**
 * Movement kinds this pack writes itself. The column is an open taxonomy, so
 * `livestock` adds `death` and `placement` without a migration — these are only
 * the ones inventory's own screens produce.
 */
export const MOVEMENT_KINDS = [
  "receipt",
  "issue",
  "transfer_in",
  "transfer_out",
  "split_out",
  "split_in",
  "merge_out",
  "merge_in",
  "adjustment",
] as const;

export const MOVEMENT_KIND_LABELS: Record<string, string> = {
  receipt: "Received",
  issue: "Used",
  transfer_in: "Moved in",
  transfer_out: "Moved out",
  split_out: "Split out",
  split_in: "Split in",
  merge_out: "Merged out",
  merge_in: "Merged in",
  adjustment: "Adjusted",
  placement: "Placed",
  death: "Died",
};

export function movementKindLabel(kind: string): string {
  return MOVEMENT_KIND_LABELS[kind] ?? slugLabel(kind);
}

/** Mirrors the `_format` CHECKs. Kept in sync by tests/inventory.test.ts. */
export const SLUG_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_FORMAT.test(value);
}

/** "building_site" → "Building site". Slugs are for machines. */
export function slugLabel(slug: string): string {
  const spaced = slug.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const ITEM_STATUSES = ["active", "archived"] as const;
export const LOT_STATUSES = ["open", "closed"] as const;
