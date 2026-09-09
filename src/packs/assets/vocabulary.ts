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

/**
 * Why something owned before the books began cannot be put on them yet, in
 * the person's words (ADR 0038).
 *
 * HERE RATHER THAN IN `actions.ts` because both sides say it: the asset's
 * page explains it before the button is pressed, and the action says it again
 * if the state changed underneath. A `"use server"` module may export nothing
 * but async functions, so a shared string helper could not live there anyway —
 * and one copy is what stops the two from drifting apart.
 */
export function openingBlockedMessage(blocked: string): string {
  switch (blocked) {
    case "no_books_start":
      return "Say when your books begin first, on the Opening position page. That is the day this lands on.";
    case "no_cost":
      return "Record what it cost first. An opening balance is that figure going onto the books.";
    case "no_asset_account":
      return "Choose the account its cost sits in first, under Edit.";
    case "not_before_start":
      return "Give it an acquired date before the day your books begin. Anything bought since then reaches the books through its bill.";
    case "already_recorded":
      return "This is already on the books. A correction is a journal entry.";
    default:
      return "This cannot be put on the books yet.";
  }
}
