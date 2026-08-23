/**
 * Reading `audit_log.meta`. PURE — no imports, no database.
 *
 * **EVERY AUDITED ACTION IN THIS APP WRITES WHAT CHANGED, AND NOTHING RENDERED
 * IT.** 234 call sites put identifiers and coarse metadata into a jsonb column,
 * and `/admin/audit` showed when, what, who and which target — so a correction
 * to a withdrawal clock, a module switched on, a retainer adjusted and a
 * mailbox connected all read as "something happened". Twice in one week a
 * screen had to stop telling somebody their old value was "kept in the audit
 * log", because it was kept somewhere nobody could open.
 *
 * **THE BEFORE/AFTER SHAPE IS THE WHOLE POINT.** Corrections write
 * `{ was: {...}, now: {...} }`, and rendering those as two blobs would be worse
 * than nothing — the reader has to diff them by eye. `describeMeta` diffs them
 * and emits only what MOVED, as `21 → 28`. One line, and the question the page
 * exists to answer.
 *
 * Everything here is defensive to the point of paranoia, and deliberately so:
 * `meta` is `jsonb` with no shape constraint, written by webhooks, background
 * jobs and every pack, so this WILL meet values it has never seen. Nothing in
 * this file may throw — a malformed blob must degrade to a readable line, never
 * take down the one page a superadmin uses to find out what happened.
 */

export interface AuditDetail {
  /** The key, in words. */
  label: string;
  /** The value, or "before → after" when it moved. */
  value: string;
  /** True when this is a before/after pair rather than a plain fact. */
  changed: boolean;
}

/**
 * How many pairs travel before the rest are summarised.
 *
 * High, because this is a diagnostic page and the reader is a superadmin
 * looking for something specific — but not unbounded, because one row with
 * forty keys would push every other event off the screen.
 */
export const MAX_DETAILS = 12;

/** How long a single value may be before it is cut. */
const MAX_VALUE = 80;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== null
  );
}

/**
 * `meatWithdrawalDays` → "meat withdrawal days", `clerkOrgId` → "clerk org id".
 *
 * Lower case throughout rather than Title Case: these sit as a muted second
 * line under an action slug, and capitalising them would make them compete with
 * it for the eye.
 */
export function humanise(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced || key;
}

/**
 * One value, as a string a person can read.
 *
 * Booleans become yes/no because "true" beside a label like *delegated* reads
 * as jargon. Null becomes an em dash because **an absent value is usually the
 * fact** — "invited: —" says no invitation went out, and dropping the row would
 * hide that.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "string") return truncate(value.trim() || "—");
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    return truncate(value.map((v) => formatValue(v)).join(", "));
  }
  if (isPlainObject(value)) {
    const inner = Object.entries(value)
      .map(([k, v]) => `${humanise(k)} ${formatValue(v)}`)
      .join(", ");
    return truncate(inner || "—");
  }
  // A Date, a bigint, something a driver handed back unparsed. Never throw.
  try {
    return truncate(String(value));
  } catch {
    return "—";
  }
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_VALUE ? `${flat.slice(0, MAX_VALUE - 1)}…` : flat;
}

/**
 * What an audit row actually recorded.
 *
 * Two shapes, and the first is why this function exists:
 *
 *   1. **A correction** — `{ was: {…}, now: {…} }`. Diffed, and only the keys
 *      that MOVED come back, as `before → after`. A correction that changed one
 *      field produces one line instead of two objects to compare by eye.
 *   2. **Anything else** — the top-level keys, flattened.
 *
 * `was: null` is a real case (the row was read back and had already gone), and
 * it degrades to showing the new values rather than diffing against nothing.
 */
export function describeMeta(meta: unknown): AuditDetail[] {
  if (!isPlainObject(meta)) return [];

  if ("now" in meta && isPlainObject(meta.now)) {
    const now = meta.now;
    const was = isPlainObject(meta.was) ? meta.was : null;
    if (!was) {
      return capped(
        Object.entries(now).map(([key, value]) => ({
          label: humanise(key),
          value: formatValue(value),
          changed: false,
        })),
      );
    }
    // Every key on either side: a field cleared by the correction is exactly
    // the kind of change somebody is looking for, and it exists only in `was`.
    const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])];
    const moved = keys
      .filter((key) => formatValue(was[key]) !== formatValue(now[key]))
      .map((key) => ({
        label: humanise(key),
        value: `${formatValue(was[key])} → ${formatValue(now[key])}`,
        changed: true,
      }));
    // A correction that changed nothing is a real outcome — somebody opened the
    // dialog and saved it unchanged — and saying so beats an empty cell that
    // looks like a rendering failure.
    return moved.length > 0
      ? capped(moved)
      : [{ label: "no change", value: "saved as it was", changed: false }];
  }

  return capped(
    Object.entries(meta).map(([key, value]) => ({
      label: humanise(key),
      value: formatValue(value),
      changed: false,
    })),
  );
}

function capped(details: AuditDetail[]): AuditDetail[] {
  if (details.length <= MAX_DETAILS) return details;
  const shown = details.slice(0, MAX_DETAILS);
  const hidden = details.length - MAX_DETAILS;
  // Said out loud rather than truncated silently — the house rule the advisor's
  // digest and the feed report both follow.
  return [
    ...shown,
    { label: "…and", value: `${hidden} more not shown`, changed: false },
  ];
}
