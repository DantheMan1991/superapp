/**
 * Merging and ranking recipient suggestions.
 *
 * Three sources answer independently — the mail server's address book, whatever
 * the extension registry contributes (Accounting today, a CRM later), and the
 * people this person has actually corresponded with — and they overlap heavily.
 * A customer you invoice monthly is in all three. So this file decides two
 * things: which duplicate wins, and what order the survivors appear in.
 *
 * THE RANKING RULE THAT MATTERS: **somebody you have actually written to beats a
 * directory entry.** It is by far the strongest signal an autocomplete has, and
 * getting it wrong is what makes a recipient box feel stupid — typing three
 * letters and being offered a supplier from 2019 ahead of the person you emailed
 * this morning. Everything else here is tie-breaking.
 *
 * Pure, free of `server-only`, so the ordering is testable without a mail server
 * or a database. That matters more than it sounds: ranking is exactly the kind
 * of logic that gets quietly wrong and is never noticed, because a slightly bad
 * suggestion list still looks like a suggestion list.
 */

export type ContactOrigin = "recent" | "directory" | "records";

export interface ContactSuggestion {
  email: string;
  name: string;
  /** "Customer", "Address book", "You emailed them in June". */
  sublabel: string;
  origin: ContactOrigin;
}

/** How much each source is worth before any text matching is considered. */
const ORIGIN_WEIGHT: Record<ContactOrigin, number> = {
  // Correspondence beats everything. See the header.
  recent: 300,
  // A record somebody deliberately created — a customer, a vendor, a CRM
  // contact — beats a directory entry that may have been bulk-imported.
  records: 200,
  directory: 100,
};

/**
 * Where the query matched, worth more than which source it came from once the
 * match is strong: an exact address is what somebody typing an address means.
 */
function matchScore(suggestion: ContactSuggestion, query: string): number {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;
  const email = suggestion.email.toLowerCase();
  const name = suggestion.name.toLowerCase();

  if (email === q) return 1000;
  // The local part is what people type — "dan" for dan@yosher.com — so a match
  // at the start of the address is nearly as good as an exact one.
  if (email.startsWith(q)) return 500;
  // Any word of the name, not just the first: people search by surname at least
  // as often as by forename, and "Braonáin" must find "Aoife Ó Braonáin".
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 400;
  if (name.startsWith(q)) return 400;
  // The domain, so "@acme" finds everyone there.
  if (email.includes(`@${q}`) || email.includes(q)) return 150;
  if (name.includes(q)) return 100;
  return 0;
}

/**
 * Which of two entries for the same address survives.
 *
 * Not simply "the first one": sources answer in whatever order they finish, and
 * a list whose labels depend on which query returned fastest is one that changes
 * between keystrokes. The rule is that the higher-ranked ORIGIN wins the slot,
 * but a NAME is taken from whichever entry has one — a recent correspondent is
 * often just a bare address, while the customer record for the same address
 * carries the business's actual name, and showing "acme@example.com" when we
 * know it is Acme Ltd is a worse answer than either source alone.
 */
function merge(a: ContactSuggestion, b: ContactSuggestion): ContactSuggestion {
  const [better, worse] =
    ORIGIN_WEIGHT[a.origin] >= ORIGIN_WEIGHT[b.origin] ? [a, b] : [b, a];
  const name = better.name.trim() || worse.name.trim();
  // The sublabel follows the NAME, so "Acme Ltd · Customer" cannot become
  // "Acme Ltd · you emailed them in June" pointing at a name from elsewhere.
  const sublabel =
    better.name.trim().length > 0 ? better.sublabel : worse.sublabel || better.sublabel;
  return { ...better, name, sublabel };
}

/**
 * Everything, deduplicated by address and ordered best-first.
 *
 * Addresses compare case-insensitively because mail does: `Dan@Example.com` and
 * `dan@example.com` are the same person, and offering both is the kind of
 * duplicate that makes people distrust the list.
 */
export function rankContacts(
  suggestions: readonly ContactSuggestion[],
  query: string,
  limit: number,
): ContactSuggestion[] {
  const byAddress = new Map<string, ContactSuggestion>();
  for (const suggestion of suggestions) {
    const email = suggestion.email.trim();
    if (email.length === 0) continue;
    const key = email.toLowerCase();
    const existing = byAddress.get(key);
    byAddress.set(key, existing ? merge(existing, suggestion) : { ...suggestion, email });
  }

  return [...byAddress.values()]
    .map((suggestion) => ({
      suggestion,
      score: matchScore(suggestion, query) + ORIGIN_WEIGHT[suggestion.origin],
    }))
    // A suggestion that does not match the query at all is dropped rather than
    // ranked last. Sources are asked with the same query, so anything scoring
    // zero came back on a looser rule than ours and would read as noise.
    .filter((row) => query.trim().length === 0 || matchScore(row.suggestion, query) > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Stable and predictable once scores tie, so the list does not reshuffle
        // between identical queries.
        a.suggestion.email.localeCompare(b.suggestion.email),
    )
    .slice(0, limit)
    .map((row) => row.suggestion);
}

/**
 * Addresses already in the recipient fields, so they are not offered again.
 *
 * Lowercased for the same reason `rankContacts` dedupes that way.
 */
export function excludeChosen(
  suggestions: readonly ContactSuggestion[],
  chosen: readonly string[],
): ContactSuggestion[] {
  const taken = new Set(chosen.map((a) => a.trim().toLowerCase()).filter(Boolean));
  return suggestions.filter((s) => !taken.has(s.email.toLowerCase()));
}
