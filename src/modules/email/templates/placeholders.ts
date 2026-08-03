import { htmlToPlainText } from "../compose/to-text";

/**
 * The things a template can leave blank for the composer to fill in.
 *
 * Pure and free of `server-only`: the fill happens in the browser, at the
 * moment a template is inserted, so this module has to be importable from a
 * client component.
 *
 * **A FIXED ENUMERATION, NEVER FREE INPUT** — the same call
 * `compose/formatting.ts` made for colours and fonts, and for the same reason.
 * If any `{{word}}` were substitutable, a typo would be indistinguishable from
 * a feature: `{{cusotmer}}` would save happily and go out to a client verbatim,
 * and nobody would find out until they read the sent copy. Because the set is
 * closed, `validateTemplateBody` can refuse the typo at the moment somebody
 * saves — which is the only moment they are looking at it.
 *
 * It also means the send path can state a guarantee rather than a hope: a body
 * still carrying an EXACT member of this set is a template nobody finished, and
 * `unfilledPlaceholders` is what lets `sendMessageAction` say so.
 */

export interface PlaceholderDef {
  /** The token as written, without braces. */
  key: string;
  /** "Recipient's first name" — shown in the editor's list. */
  label: string;
  /** What it resolves to, and when it cannot. */
  hint: string;
}

/**
 * WHAT IS HERE AND WHAT IS NOT.
 *
 * Everything below resolves from what the COMPOSER already knows: who is being
 * written to, who is writing, which business, and the date. None of it needs a
 * choice from the person inserting the template, which is what makes insertion
 * a single click.
 *
 * Business-object fields — an invoice number, a job reference — are deliberately
 * absent and are the next slice rather than an oversight. They cannot resolve
 * from the composer's own state: "which invoice?" is a question only a person
 * can answer, so they need an entity picker in the insert flow AND a new
 * capability on `MailExtension` to read fields off the chosen record.
 * `LinkableEntity` carries `label` and `sublabel` for display and nothing
 * structured, and parsing a formatted sublabel to recover a number is exactly
 * the kind of thing this module refuses to do.
 */
export const PLACEHOLDERS: readonly PlaceholderDef[] = [
  {
    key: "recipient.name",
    label: "Recipient's name",
    hint: "The name on the first To address, or the address itself when there is no name.",
  },
  {
    key: "recipient.first_name",
    label: "Recipient's first name",
    hint: "The first word of the recipient's name.",
  },
  { key: "recipient.email", label: "Recipient's email", hint: "The first To address." },
  { key: "me.name", label: "Your name", hint: "The name on the address you are sending from." },
  { key: "me.email", label: "Your email", hint: "The address you are sending from." },
  { key: "business.name", label: "Business name", hint: "Your business's name in Yosher." },
  { key: "date.today", label: "Today's date", hint: "The date the template is inserted." },
] as const;

/**
 * The vocabulary a caller is judging against.
 *
 * Composed rather than constant, because business-object fields are
 * CONTRIBUTED: Mail does not know what an invoice is, so `{{invoice.number}}`
 * exists only because Accounting declared it. The statics above plus whatever
 * the registry offers is the whole set, and it is still CLOSED — which is the
 * property everything else rests on.
 */
export type Vocabulary = ReadonlySet<string>;

/**
 * An entity type's contribution, flattened for the client.
 *
 * A plain object rather than the `MailEntityType` itself, because that carries
 * `search`/`resolve` functions that cannot cross into a client component — and
 * because the browser needs only the names.
 */
export interface ContributedNamespace {
  /** `invoice` — the part before the dot, and the entity type's own name. */
  type: string;
  /** "Invoice", singular, for the "which invoice?" prompt. */
  label: string;
  fields: readonly { key: string; label: string }[];
}

const STATIC_KEYS: ReadonlySet<string> = new Set(PLACEHOLDERS.map((p) => p.key));

/** The statics alone. Callers that have no registry to hand. */
export const STATIC_VOCABULARY: Vocabulary = STATIC_KEYS;

/**
 * Build a vocabulary from the statics plus a set of contributing entity types.
 *
 * **RECOGNIZE GLOBALLY, OFFER PER TENANT — and the asymmetry is a bug fix
 * rather than a nicety.** The template editor should list only what this
 * business can actually fill, so it passes the ENABLED extensions. The send
 * guard must recognize every namespace that exists anywhere, from the static
 * registry, and the reason is a hole the first version had: a template written
 * while Accounting was on, then Accounting switched off, leaves
 * `{{invoice.number}}` in a body. Judged against the tenant's own vocabulary it
 * is no longer a known placeholder, so the guard would wave it through and it
 * would reach a customer as literal braces — precisely the case the guard
 * exists for.
 */
export function buildVocabulary(
  contributors: readonly {
    type: string;
    templateFields?: readonly { key: string }[];
  }[],
): Vocabulary {
  const keys = new Set(STATIC_KEYS);
  for (const entity of contributors) {
    for (const field of entity.templateFields ?? []) {
      keys.add(`${entity.type}.${field.key}`);
    }
  }
  return keys;
}

/** The same, from the flattened shape the browser gets. */
export function vocabularyFromNamespaces(
  namespaces: readonly ContributedNamespace[],
): Vocabulary {
  return buildVocabulary(
    namespaces.map((n) => ({ type: n.type, templateFields: n.fields })),
  );
}

/**
 * The entity types an inserted template needs a record for.
 *
 * `{{invoice.number}}` means "ask which invoice". Returned in first-seen order
 * so the composer asks in the order they appear in the message, which is the
 * order somebody wrote them and therefore the order they expect.
 */
export function requiredNamespaces(
  source: string,
  vocabulary: Vocabulary,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of extractPlaceholders(htmlToPlainText(source))) {
    if (!vocabulary.has(key)) continue;
    // A static like `recipient.name` needs no record; only contributed keys do,
    // and those are exactly the ones whose namespace is not a static's.
    if (STATIC_KEYS.has(key)) continue;
    const namespace = key.slice(0, key.indexOf("."));
    if (namespace.length === 0 || seen.has(namespace)) continue;
    seen.add(namespace);
    out.push(namespace);
  }
  return out;
}

/**
 * Deliberately takes the vocabulary rather than defaulting to the statics.
 *
 * A default would be the statics, which is wrong for both callers — the editor
 * needs the tenant's contributed fields and the send guard needs every
 * registered one — and a wrong default is worse than an extra argument,
 * because it is invisible at the call site.
 */
export function isKnownPlaceholder(key: string, vocabulary: Vocabulary): boolean {
  return vocabulary.has(key);
}

/** What a caller must supply to fill a template. Missing keys stay unfilled. */
export type PlaceholderValues = Partial<Record<string, string>>;

/**
 * `{{ key }}` — braces, optional inner spaces, and nothing else.
 *
 * Deliberately narrow. A pattern that allowed arbitrary characters between the
 * braces would match half the CSS and JSON anybody ever pasted into a template,
 * and every one of those would become an "unknown placeholder" error on save.
 */
const TOKEN = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;

/** Every token in a string, in order, deduplicated. Braces stripped. */
export function extractPlaceholders(source: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(TOKEN)) {
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(key);
  }
  return found;
}

export interface TemplateBodyProblem {
  kind: "unknown" | "split";
  keys: string[];
}

/**
 * Is this template body one the composer can actually fill?
 *
 * TWO FAILURES, AND THE SECOND IS THE ONE NOBODY WOULD GUESS.
 *
 * **Unknown** is the typo: `{{cusotmer}}`. Caught here because the vocabulary
 * is closed.
 *
 * **Split** is the editor's doing. The template body is rich text, so somebody
 * who bolds part of a token — or whose browser splits a text node mid-word —
 * stores `{{recipient.<b>name}}</b>`. That reads perfectly to a human and is
 * invisible to any regex over the HTML, so the token would survive
 * substitution and go out to a customer as literal braces.
 *
 * It is detected by comparing the two renderings: a token present in the TEXT
 * (where markup has been flattened away) but absent from the HTML can only have
 * been broken up by tags. That reuses `htmlToPlainText` rather than parsing the
 * DOM, which this module has no business doing on the server.
 */
export function validateTemplateBody(
  html: string,
  vocabulary: Vocabulary,
): TemplateBodyProblem | null {
  const inHtml = extractPlaceholders(html);
  const inText = extractPlaceholders(htmlToPlainText(html));

  // Compared against the TEXT rendering, so a token broken by markup is judged
  // on what a person actually sees rather than on what survived the tags.
  const unknown = inText.filter((k) => !isKnownPlaceholder(k, vocabulary));
  if (unknown.length > 0) return { kind: "unknown", keys: unknown };

  const htmlKeys = new Set(inHtml);
  const split = inText.filter((k) => !htmlKeys.has(k));
  if (split.length > 0) return { kind: "split", keys: split };

  return null;
}

/**
 * Substitute what we can, leave the rest.
 *
 * An unresolvable placeholder is LEFT AS ITS TOKEN rather than replaced with an
 * empty string, and that is the whole of the error handling. "Hi ," with a hole
 * where a name should be looks like a message somebody wrote carelessly and
 * reads as ordinary text, so it sails past the writer and out to the customer.
 * `{{recipient.name}}` sitting in the middle of a sentence is unmistakable —
 * and because the fill happens at INSERT time, it is on screen while there is
 * still someone there to fix it.
 *
 * Values are inserted as TEXT, escaped: a recipient whose display name contains
 * `<` would otherwise inject markup into the body, and that markup would then
 * be sent under our user's own name. The outbound sanitizer would strip
 * anything dangerous at send, but relying on it here would mean the editor
 * showed one thing and the recipient received another.
 */
export function fillPlaceholders(
  html: string,
  values: PlaceholderValues,
): string {
  return html.replace(TOKEN, (token, key: string) => {
    const value = values[key];
    if (value === undefined || value.length === 0) return token;
    return escapeHtmlText(value);
  });
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Known placeholders still sitting in a body about to be sent.
 *
 * The safety net, and narrow by construction: only EXACT members of the
 * vocabulary count, so somebody writing to a developer about `{{mustache}}`
 * syntax is unaffected, and so is anyone who pasted JSON.
 */
export function unfilledPlaceholders(
  html: string,
  vocabulary: Vocabulary,
): string[] {
  return extractPlaceholders(htmlToPlainText(html)).filter((k) =>
    isKnownPlaceholder(k, vocabulary),
  );
}

/**
 * Everything above the quote, which is the only part the writer wrote.
 *
 * THE FALSE POSITIVE THIS EXISTS FOR IS REAL AND WOULD BE INFURIATING. A
 * customer asks "how do I use `{{recipient.name}}` in a template?", somebody
 * hits Reply, and the quoted original carries the token into the new message.
 * Guarding the whole body would refuse to send that reply, repeatedly, with a
 * message about filling in a placeholder the person never wrote — and the only
 * way out would be deleting the quote.
 *
 * A quote is a `<blockquote>` in the rich body (`quoteHtml` emits one, and the
 * sanitizer keeps it) and a run of `>`-prefixed lines in the plain-text one.
 * Both are stripped before the check, so what remains is what somebody typed.
 *
 * Over-stripping is the safe direction: a placeholder INSIDE a quote is text
 * the writer is deliberately reproducing, and sending it is correct.
 */
export function stripQuotedRegions(html: string, text: string): string {
  const withoutBlockquotes = html.replace(
    /<blockquote\b[\s\S]*?<\/blockquote>/gi,
    " ",
  );
  const withoutQuotedLines = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  return `${withoutBlockquotes}\n${withoutQuotedLines}`;
}

/**
 * The values the composer can resolve, from what it has on screen.
 *
 * Pure so the whole mapping is testable without a browser: the caller passes
 * the recipient line and the identity, and gets back exactly what
 * `fillPlaceholders` consumes.
 *
 * A recipient with no display name yields the LOCAL PART rather than nothing —
 * "dan" from `dan@acme.example` is a serviceable greeting and an empty one is
 * not, and the alternative (leaving the token) would be wrong here because the
 * information genuinely is available.
 */
export function composerPlaceholderValues(input: {
  recipientName: string | null;
  recipientEmail: string | null;
  senderName: string;
  senderEmail: string;
  businessName: string;
  today: Date;
}): PlaceholderValues {
  const name =
    input.recipientName?.trim() ||
    (input.recipientEmail ? input.recipientEmail.split("@")[0] : "");

  const values: PlaceholderValues = {
    "me.name": input.senderName,
    "me.email": input.senderEmail,
    "business.name": input.businessName,
    // The BROWSER's locale and timezone, the same call `triage/snooze-times.ts`
    // and the schedule picker make: "today" is a statement about the writer's
    // calendar, and a server rendering it in UTC gets the date wrong for a good
    // share of the day.
    "date.today": input.today.toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };

  if (name) {
    values["recipient.name"] = name;
    values["recipient.first_name"] = name.split(/\s+/)[0] ?? name;
  }
  if (input.recipientEmail) values["recipient.email"] = input.recipientEmail;

  return values;
}
