/**
 * Asset vocabulary. NO IMPORTS AND NO DIRECTIVE, deliberately.
 *
 * These values are rendered in the browser by a kind picker, and importing
 * them from `src/db/schema/assets.ts` would drag drizzle and every table
 * definition into that bundle — the trap documents.md wrote up after
 * `server-only` propagated through a type import and failed a build.
 * `src/lib/work/vocabulary.ts` exists for the same reason.
 */

/**
 * SUGGESTIONS, NOT A CONSTRAINT.
 *
 * `assets.kind` is an open taxonomy (P1): the database checks the FORMAT of
 * this column and never its values, so a tenant or a future profile can use a
 * kind nobody here anticipated without a migration. This list is what the
 * picker offers first, and the reason it is short — a longer guess would read
 * as the allowed set.
 *
 * These are the industry-neutral ones. A profile contributes its own through
 * `packConfig`, once the extension point for it exists (P5).
 */
export const SUGGESTED_ASSET_KINDS = [
  "building",
  "equipment",
  "vehicle",
  "infrastructure",
  "fixture",
] as const;

export const ASSET_STATUSES = ["active", "disposed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Mirrors the `assets_kind_format` CHECK. Kept in sync by tests/assets.test.ts. */
export const ASSET_KIND_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidAssetKind(kind: string): boolean {
  return ASSET_KIND_FORMAT.test(kind);
}

/** "chest_freezer" → "Chest freezer". Kinds are slugs; people are not. */
export function assetKindLabel(kind: string): string {
  const spaced = kind.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
