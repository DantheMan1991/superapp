/**
 * Tag slugs. `documents.tags` stores slugs from the `document_tags` registry,
 * never display names — which is what makes renaming a tag a one-row update
 * instead of a rewrite of every document that carries it.
 *
 * Postgres cannot foreign-key an array element, so the registry is enforced by
 * a single door (setDocumentTags resolves slugs inside the transaction) rather
 * than by the database. These pure helpers are that door's vocabulary.
 */

export const TAG_SLUG_MAX = 49;
export const TAG_NAME_MAX = 50;
/** Mirrors the documents_tags_cap CHECK. */
export const TAGS_PER_DOCUMENT_MAX = 30;
export const TAGS_PER_TENANT_MAX = 200;

/** Must agree with the document_tags_slug_format CHECK constraint. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}$/;

/**
 * Display name to slug. Returns null when nothing usable survives — callers
 * map that to TAG_NAME_TAKEN's sibling, not to a silent empty tag.
 */
export function slugifyTag(raw: string): string | null {
  const slug = raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, TAG_SLUG_MAX);
  // The slice can strip back to a trailing hyphen, which the CHECK rejects.
  const trimmed = slug.replace(/-+$/, "");
  if (trimmed.length === 0) return null;
  return SLUG_PATTERN.test(trimmed) ? trimmed : null;
}

export function isValidTagSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/**
 * Dedupe, drop invalid, sort, and cap.
 *
 * The sort is not cosmetic: a stable array order means two documents with the
 * same tags produce the same stored value, which keeps `tags && ARRAY[...]`
 * plans and test assertions stable.
 */
export function normalizeTags(slugs: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const slug of slugs) {
    const candidate = slug.trim().toLowerCase();
    if (isValidTagSlug(candidate)) seen.add(candidate);
  }
  return [...seen].sort().slice(0, TAGS_PER_DOCUMENT_MAX);
}

/** What changed, for the audit meta. Slugs only — never document contents. */
export function diffTags(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((t) => !beforeSet.has(t)),
    removed: before.filter((t) => !afterSet.has(t)),
  };
}
