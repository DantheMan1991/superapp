/**
 * What a `Combobox` offers, and how it narrows the list as you type.
 *
 * Pure and in its own file so the matching can be tested without a DOM, the
 * way `command-palette.tsx` could not be: that palette keeps its filter inline,
 * which is why nobody has ever asserted what "6300" finds.
 */
export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra words that should match, beyond the label. Never shown. */
  keywords?: string;
  /** Small text at the right of the row — a code, a company, a balance. */
  hint?: string;
}

/**
 * Every word typed must appear somewhere in the label or keywords, in any
 * order, case-insensitively — so "ins 63" finds `6300 · Insurance` and "63
 * inte" finds `6310 · Interest Expense` but not the insurance line. An empty
 * query returns everything in the caller's order.
 *
 * Options whose label STARTS with the query come first, and the rest keep
 * their order: typing "insurance" should put `Insurance` above `Prepaid
 * Insurance` without reshuffling the chart underneath.
 */
export function matchOptions<T extends ComboboxOption>(
  options: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...options];
  const words = needle.split(/\s+/);
  const hits = options.filter((option) => {
    const haystack = `${option.label} ${option.keywords ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const starts = hits.filter((o) => o.label.toLowerCase().startsWith(needle));
  const rest = hits.filter((o) => !o.label.toLowerCase().startsWith(needle));
  return [...starts, ...rest];
}
