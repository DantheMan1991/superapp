/**
 * What a list page reads from its URL — a search term and a page number —
 * and the arithmetic behind "Showing 51–100 of 312". Pure, no imports, so
 * every list can share it and a test can pin it without a database.
 *
 * The lists used to stop at 200 or 300 rows with no search at all, which a
 * card feed reaches in a few months. A search box and pages are the two
 * cheapest things that make a long list usable, and they only make sense
 * as URL state: a filter you cannot bookmark or send is a filter you redo.
 */

/** Longer than any number, name or memo somebody is actually looking for. */
export const MAX_SEARCH_CHARS = 100;

/** What somebody typed, trimmed, its whitespace collapsed, and capped. */
export function searchTerm(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_CHARS);
}

/**
 * A `%term%` pattern for ILIKE, with the wildcard characters escaped so a
 * search for `100%` finds "100%" and not every row. Postgres's default escape
 * character is the backslash, which is why each of `\`, `%` and `_` gets one.
 */
export function ilikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Case-insensitive "contains" across several fields, for a list short enough
 * to filter in memory (customers, vendors — a few hundred names at most).
 *
 * When the term is mostly digits it is also compared digits-to-digits, so
 * `555 0100` finds the phone stored as `(555) 010-0000`: the punctuation
 * somebody typed, or did not type, stops mattering. A term like `acme 12`
 * is not mostly digits and gets only the text comparison, so its `12` cannot
 * pull in every phone number with a 12 in it.
 */
export function matchesAny(term: string, fields: Array<string | null | undefined>): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  const digits = numericTerm(term);
  return fields.some((f) => {
    if (!f) return false;
    if (f.toLowerCase().includes(needle)) return true;
    return digits !== null && f.replace(/\D/g, "").includes(digits);
  });
}

/**
 * The digits of a term that is MOSTLY digits, else null.
 *
 * `555 0100` is a phone number typed by hand and `840 1234` is an ear tag;
 * `acme 12` is neither, and its `12` must not pull in every number with a 12
 * in it. One rule, shared by `matchesAny` and by any SQL search that wants
 * the same answer — livestock's tag search compares digits to digits in
 * Postgres with exactly this test deciding whether to.
 */
export function numericTerm(term: string): string | null {
  const digits = term.replace(/\D/g, "");
  return digits.length >= 3 && digits.length * 2 >= term.length ? digits : null;
}

/** The page number a URL asked for: a positive whole number, or 1. */
export function pageFrom(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export interface PageWindow {
  /** The page actually shown — clamped, so a stale link past the end shows the last page. */
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  offset: number;
  /** 1-based, inclusive, for "Showing 51–100". Both 0 when the list is empty. */
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function pageWindow(page: number, pageSize: number, total: number): PageWindow {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const offset = (current - 1) * pageSize;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + pageSize);
  return {
    page: current,
    pageSize,
    total,
    pages,
    offset,
    from,
    to,
    hasPrev: current > 1,
    hasNext: current < pages,
  };
}
