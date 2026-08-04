/**
 * Party name normalization. PURE — no database, no `server-only`, no React, so
 * every rule below is testable without a session.
 *
 * The one thing worth stating up front: `displayName` is AUTHORITATIVE. Nothing
 * here derives it on an update, ever. `personDisplayName` exists to supply a
 * sensible value at CREATE time when the caller gave structured names and no
 * display name, and after that the two drift independently on purpose —
 * somebody who wants "Bob Smith Plumbing" over "Robert Smith" must be able to
 * have it without the system arguing.
 */

/** Collapse whitespace and trim. `"  Acme   Ltd "` → `"Acme Ltd"`. */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Normalize an optional field to `string | null`.
 *
 * Empty and whitespace-only both become null rather than `""`. The accounting
 * role tables use `NOT NULL DEFAULT ''` for their optional text and that was
 * the right call there — `metadata->>'x'` style access is always safe. Here the
 * columns are genuinely nullable, and storing `""` would mean two different
 * spellings of "not known" that every reader has to handle.
 */
export function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = normalizeName(value);
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A display name for a person, from whatever parts are known.
 *
 * Returns null when nothing usable was supplied, so the caller can fall back to
 * refusing the write rather than storing a blank. Deliberately does NOT invent
 * an ordering convention beyond given-then-family: a platform that guesses at
 * name order gets it wrong for a large part of the world, and the display name
 * is user-editable precisely so it can be corrected by the person who knows.
 */
export function personDisplayName(
  givenName: string | null | undefined,
  familyName: string | null | undefined,
): string | null {
  const parts = [normalizeOptional(givenName), normalizeOptional(familyName)]
    .filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(" ");
}
