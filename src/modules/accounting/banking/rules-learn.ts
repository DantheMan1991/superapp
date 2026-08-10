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
