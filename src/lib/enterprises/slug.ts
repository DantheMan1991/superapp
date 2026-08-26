/**
 * Turning a name into a handle. PURE — no imports, no database.
 *
 * Kept apart from `index.ts` so it can be tested without a database, and
 * because it is the one piece of this subsystem with edge cases worth pinning.
 */

/** Mirrors `enterprises_slug_format`. Kept in sync by tests/enterprises.test.ts. */
export const SLUG_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * "Broilers" → `broilers`. "Laying hens & eggs" → `laying_hens_eggs`.
 *
 * **DERIVED ONCE, ON CREATION, AND NEVER AGAIN.** The slug is what a profile's
 * seed, an import and any future URL hold onto while somebody renames
 * "Broilers" to "Meat birds"; re-deriving it on rename would break every one of
 * them to keep a handle nobody reads pretty.
 *
 * **RETURNS NULL RATHER THAN A FALLBACK when nothing survives.** A name of
 * "🐔" or "---" has no handle in it, and inventing `enterprise_1` would put a
 * row in the database under a name the person never typed. The caller asks for
 * a different name instead.
 */
export function slugify(name: string): string | null {
  const base = name
    .normalize("NFKD")
    // Strip accents rather than transliterating: "Café" → "cafe", not "cafx".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 63);
  if (!base) return null;
  // The CHECK demands a LETTER first, so a name beginning with a digit — "2026
  // broilers" — would produce a slug the database refuses. Prefixing keeps the
  // digits rather than dropping them.
  const withLetter = /^[a-z]/.test(base) ? base : `e_${base}`.slice(0, 63);
  // A trailing underscore can survive the 63-char slice above; the format
  // allows it, but it reads as a truncation accident, which it is.
  const trimmed = withLetter.replace(/_+$/g, "");
  return SLUG_FORMAT.test(trimmed) ? trimmed : null;
}

/**
 * The first free slug in `base`, `base_2`, `base_3`, …
 *
 * **A COLLISION IS ORDINARY, NOT AN ERROR.** "Beef" and "Beef " differ to a
 * person typing and not to `slugify`, and a farm that runs two things it calls
 * the same word is the farm's business. Only the NAME is refused for being
 * taken — see `createEnterprise` — and that refusal is about the person's own
 * list being readable, not about this handle.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  // A thousand enterprises called the same thing is not a farm, and silently
  // reusing a slug would break the unique index it exists to satisfy.
  throw new Error(`no free slug for ${base}`);
}
