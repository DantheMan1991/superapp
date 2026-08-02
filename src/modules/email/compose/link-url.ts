/**
 * The URL a person typed into the composer's link box.
 *
 * Pure and in its own file rather than inside `rich-text-editor.tsx`, for the
 * usual reason in this directory: it is the security-relevant half of a client
 * component and it should be testable without a DOM.
 *
 * WHY THE EDITOR NEEDS THIS AT ALL, given `compose/html.ts` refuses unsafe
 * schemes on the way out anyway: `execCommand("createLink")` will build
 * `href="javascript:…"` out of whatever string it is handed. The sanitizer would
 * drop it at send time, but only after it had spent the whole composing session
 * looking like a working link — and a control that appears to accept something
 * and silently discards it later is worse than one that refuses up front.
 */

/** Schemes a composed link may use. `compose/html.ts` enforces the same list. */
const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;

/**
 * Returns a usable href, or null when the input cannot become one.
 *
 * A bare host gets `https://`, a bare address gets `mailto:`, and a scheme we do
 * not allow is REFUSED rather than repaired — prefixing `https://` onto
 * `javascript:alert(1)` would quietly produce a link to a host called
 * "javascript", which is a stranger outcome than doing nothing.
 */
export function normalizeLinkInput(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) return null;
  if (SAFE_SCHEME.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}
