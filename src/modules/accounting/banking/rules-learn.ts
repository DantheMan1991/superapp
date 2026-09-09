/**
 * Learning a rule from what somebody already did — pure, no database.
 *
 * When the same kind of bank row is coded to the same account by hand often
 * enough, that mapping has stopped being a judgement call and become a rule.
 * Proposing it is what turns the AI categorizer from a permanent running cost
 * into a thing that only handles what is genuinely new.
 *
 * Split from `rules.ts` for the same reason `ai/bill-validate.ts` is split from
 * `ai/bill-code.ts`: the decision logic is table-testable without a database,
 * and only the reading and writing needs `server-only`.
 */

/** How many hand-codings of the same shape before a rule is proposed. */
export const RULE_PROPOSAL_THRESHOLD = 3;

/**
 * Suggested rules sort after hand-written ones (default priority 100), so an
 * explicit decision always beats an inferred one.
 */
export const SUGGESTED_RULE_PRIORITY = 200;

/**
 * Single tokens too generic to be worth a rule. Bank descriptions are full of
 * them, and "always code anything containing 'payment' to X" is a trap.
 *
 * Only applied to ONE-token results: "Account Maintenance Fee" is a perfectly
 * good pattern even though "fee" alone is not.
 */
const GENERIC_TOKENS = new Set([
  "ach",
  "banking",
  "card",
  "check",
  "credit",
  "debit",
  "deposit",
  "fee",
  "misc",
  "miscellaneous",
  "monthly",
  "online",
  "payment",
  "pos",
  "purchase",
  "recurring",
  "transfer",
  "withdrawal",
]);

function tokenize(description: string): string[] {
  return description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Every contiguous run of tokens, longest first. */
function phrases(tokens: string[]): string[] {
  const out: string[] = [];
  for (let len = tokens.length; len >= 1; len--) {
    for (let start = 0; start + len <= tokens.length; start++) {
      out.push(tokens.slice(start, start + len).join(" "));
    }
  }
  return out;
}

function isUsable(phrase: string): boolean {
  const tokens = phrase.split(" ");
  // Must say something: at least one word that is not just digits.
  if (!tokens.some((t) => /[a-z]/.test(t))) return false;
  if (phrase.replace(/\s/g, "").length < 4) return false;
  if (tokens.length === 1 && GENERIC_TOKENS.has(tokens[0])) return false;
  return true;
}

/**
 * The longest contiguous word sequence shared by every description.
 *
 * `["OH WESTFIELD INS SIGNATURES", "Westfield Ins 07/06"]` → `"westfield ins"`.
 * Null when the descriptions share nothing worth writing a rule about.
 *
 * Contiguous phrases rather than single words because that is what actually
 * identifies a payee: "city of mount vernon" is the pattern, "city" is noise.
 */
export function commonDescriptionPhrase(descriptions: string[]): string | null {
  if (descriptions.length === 0) return null;
  const tokenized = descriptions.map(tokenize);
  if (tokenized.some((t) => t.length === 0)) return null;

  const [first, ...rest] = tokenized;
  const restJoined = rest.map((t) => ` ${t.join(" ")} `);

  // phrases() is longest-first, so the first survivor is the answer.
  for (const phrase of phrases(first)) {
    if (!isUsable(phrase)) continue;
    if (restJoined.every((hay) => hay.includes(` ${phrase} `))) return phrase;
  }
  return null;
}

/**
 * The phrases worth an EXCLUDE rule, from the descriptions of rows set aside
 * as personal on one register (ADR 0034).
 *
 * `commonDescriptionPhrase` asks what EVERY description shares, which is the
 * right question when the rows already share a category. "Personal" is one
 * bucket holding the grocer, the pharmacy and the streaming service, so the
 * rows are grouped first by their leading merchant word — the first token that
 * is a real word, four letters or more, and not one of the generic ones — and
 * each group that has reached the threshold yields one phrase: the longest run
 * the group shares, or the word itself. `["KROGER #412", "KROGER FUEL 9",
 * "KROGER #412", "NETFLIX.COM"]` → `["kroger"]` at a threshold of three.
 *
 * Sorted, so a run over the same rows proposes the same rules in the same
 * order.
 */
export function commonExcludePhrases(
  descriptions: string[],
  threshold: number = RULE_PROPOSAL_THRESHOLD,
): string[] {
  const groups = new Map<string, string[]>();
  for (const description of descriptions) {
    const key = tokenize(description).find(
      (t) => /[a-z]/.test(t) && t.length >= 4 && !GENERIC_TOKENS.has(t),
    );
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), description]);
  }
  const out: string[] = [];
  for (const [key, group] of groups) {
    if (group.length < threshold) continue;
    out.push(commonDescriptionPhrase(group) ?? key);
  }
  return out.sort();
}

/**
 * The payees a register's rows name, one row per payee, for a business that
 * has just imported its statements and has a vendor for none of them
 * (onboarding slice 2b).
 *
 * MONEY OUT ONLY. A payee you pay is a vendor; money coming in is a customer,
 * and a deposit's description is usually the bank's own words for a transfer
 * rather than anybody's name.
 *
 * Grouped the way `commonExcludePhrases` groups — by the leading real word —
 * but with NO THRESHOLD, because a vendor billed once a year is still a
 * vendor. Each group yields the longest run its descriptions share, which is
 * what identifies the payee: `["TRACTOR SUPPLY 8821", "TRACTOR SUPPLY 0412"]`
 * → `tractor supply`, not `tractor supply 8821`.
 *
 * Sorted by how much of the statement each accounts for, so the first row of
 * the dialog is the one worth naming.
 */
export interface PayeeCandidate {
  /** Lower case, the phrase the rows share. */
  phrase: string;
  /** Title-cased — what the vendor would be called. */
  label: string;
  /** How many rows it covers. */
  count: number;
  /** One of the descriptions, so a person can see where it came from. */
  sample: string;
  /** Total paid out, in positive cents. */
  totalCents: number;
}

/**
 * Drop the store and reference numbers off the ends of a phrase.
 *
 * `commonDescriptionPhrase` over a group of ONE returns that description
 * whole, so a payee seen once would be called `Kroger 0412`. A number at
 * either end of a bank description is the till, the store or the cheque —
 * never part of the name. One kept in the middle, as in `7 eleven store`, is
 * left alone because there it is the name.
 */
function trimReferenceNumbers(phrase: string): string {
  const tokens = phrase.split(" ");
  while (tokens.length > 1 && /^\d+$/.test(tokens[0])) tokens.shift();
  while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

export function payeeCandidates(
  rows: ReadonlyArray<{ description: string; amountCents: number }>,
): PayeeCandidate[] {
  const groups = new Map<string, Array<{ description: string; amountCents: number }>>();
  for (const row of rows) {
    if (row.amountCents >= 0) continue;
    const key = tokenize(row.description).find(
      (t) => /[a-z]/.test(t) && t.length >= 4 && !GENERIC_TOKENS.has(t),
    );
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const out: PayeeCandidate[] = [];
  for (const [key, group] of groups) {
    const phrase = trimReferenceNumbers(
      commonDescriptionPhrase(group.map((r) => r.description)) ?? key,
    );
    out.push({
      phrase,
      label: titleCasePhrase(phrase),
      count: group.length,
      sample: group[0].description,
      totalCents: group.reduce((s, r) => s - r.amountCents, 0),
    });
  }
  return out.sort(
    (a, b) => b.totalCents - a.totalCents || b.count - a.count || a.label.localeCompare(b.label),
  );
}

/**
 * Does this description name that payee? The same containment test the
 * proposal used, so the rows a pick labels are exactly the rows it was
 * counted from.
 */
export function descriptionNamesPayee(description: string, phrase: string): boolean {
  return ` ${tokenize(description).join(" ")} `.includes(` ${phrase} `);
}

/** Title case for display: "westfield ins" → "Westfield Ins". */
export function titleCasePhrase(phrase: string): string {
  return phrase
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * `(Suggested) Westfield Ins as Insurance` — the name states the mapping, so
 * the rules list reads as a list of decisions rather than a list of objects.
 */
export function suggestedRuleName(phrase: string, accountName: string): string {
  return `(Suggested) ${titleCasePhrase(phrase)} as ${accountName}`;
}
