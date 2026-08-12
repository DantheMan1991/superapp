import { addDaysIso } from "../lib/dates";

/**
 * What a payment term means — pure, no database, no `server-only`.
 *
 * The whole of the arithmetic is "issue date plus N days", which is small
 * enough to look like it does not need a module. It gets one because the
 * invoice builder computes the date in the browser as you type and the server
 * recomputes it on save, and two implementations of one rule is how those two
 * come to disagree.
 */

export interface TermLike {
  id: string;
  name: string;
  dueInDays: number;
}

/** Longest term the schema permits; mirrored here for client-side validation. */
export const MAX_DUE_IN_DAYS = 365;

export function dueDateFromTerms(issueDate: string, dueInDays: number): string {
  return addDaysIso(issueDate, dueInDays);
}

/**
 * Which term applies: the customer's own, else the tenant default, else none.
 *
 * `null` on a customer means "whatever the default is" rather than "no terms",
 * so changing the default moves every customer who never had a special
 * arrangement — which is what somebody editing the default expects.
 */
export function resolveTerm(
  terms: readonly TermLike[],
  customerTermId: string | null,
  defaultTermId: string | null,
): TermLike | null {
  if (customerTermId) {
    const own = terms.find((t) => t.id === customerTermId);
    if (own) return own;
  }
  if (defaultTermId) {
    const fallback = terms.find((t) => t.id === defaultTermId);
    if (fallback) return fallback;
  }
  return null;
}

/** "Net 30 — due 2026-09-11", for the line under the date field. */
export function describeTerm(term: TermLike | null, issueDate: string): string {
  if (!term) return "No terms — set a due date yourself";
  const due = dueDateFromTerms(issueDate, term.dueInDays);
  return term.dueInDays === 0
    ? `${term.name} — due ${due}`
    : `${term.name} — due ${due} (${term.dueInDays} days)`;
}
