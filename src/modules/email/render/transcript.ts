/**
 * A message as readable plain text — the half of a filed copy that a search box
 * can reach.
 *
 * A filed message is stored twice, deliberately. The `.eml` is the snapshot:
 * complete, standard, and openable in any mail client, which is what makes it
 * evidence rather than our rendering of evidence. This is the other half — a
 * flat transcript that goes into `documents.extracted_text`, feeds `search_tsv`
 * and answers "find the email where they agreed the price". Neither replaces the
 * other; a lossy rendering filed as the record would be a comfortable lie, and a
 * `.eml` nobody can search for is a file nobody finds.
 *
 * Pure, no `server-only`, no DOM: the same reason `jmap/parse.ts`,
 * `migadu-parse.ts` and `file-headers.ts` are. It is testable against a corpus
 * without a mail server.
 *
 * WHY A HAND-ROLLED HTML STRIPPER IS FINE HERE, when the dossier is emphatic
 * that hand-rolling an HTML *sanitizer* is not: the output of this function is
 * never rendered. It is text going into a tsvector. The failure mode of getting
 * it wrong is a slightly ugly search index, not mutation XSS. Sanitizing for
 * display still goes through `sanitize-html` in `sanitize.ts`, and always will.
 */

/** Blocks whose CONTENT is markup or code, never prose. Dropped whole. */
const NON_PROSE = /<(script|style|head|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Same, unclosed — a truncated body can leave one hanging. */
const NON_PROSE_OPEN = /<(script|style|head|template|noscript)\b[^>]*>[\s\S]*$/i;

/**
 * Tags that end a line when they close (or, for <br>, when they open).
 *
 * `</li>` is deliberately absent: the opening `<li>` already starts a line, and
 * breaking on both put a blank line between every bullet.
 */
const BREAKS =
  /<\s*(?:br\s*\/?|\/\s*(?:p|div|tr|h[1-6]|blockquote|pre|table|ul|ol|section|article))\s*>/gi;
/** A list item opening gets a bullet so the structure survives flattening. */
const LIST_ITEM = /<\s*li\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // The handful that actually show up in business mail. An unknown entity is
  // left as written rather than guessed at — `&foo;` in a search index is
  // harmless, and a wrong expansion is not obviously wrong to anybody reading.
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  eacute: "é",
  pound: "£",
  euro: "€",
  copy: "©",
  reg: "®",
  trade: "™",
};

const ENTITY = /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi;

export function decodeEntities(value: string): string {
  return value.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Surrogates and out-of-range values would produce lone surrogates in a
      // string bound for Postgres, which rejects them outright.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * HTML → plain text. Structure becomes newlines; everything else goes.
 *
 * Order matters: non-prose blocks first (so a stylesheet's contents never reach
 * the index), then structural tags to newlines, then the rest stripped, then
 * entities decoded. Decoding last is what stops a `&lt;script&gt;` in the source
 * turning into something that looks like a tag after the stripper has run.
 */
export function htmlToText(html: string): string {
  const withoutNonProse = html.replace(NON_PROSE, " ").replace(NON_PROSE_OPEN, " ");
  const withBreaks = withoutNonProse
    .replace(LIST_ITEM, "\n• ")
    .replace(BREAKS, "\n");
  const stripped = withBreaks
    // Comments, including Outlook's conditional ones.
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!--[\s\S]*$/, " ")
    // Any remaining tag, closed or left open by truncation.
    .replace(/<[^>]*>/g, " ")
    .replace(/<[^>]*$/, " ");
  return collapse(decodeEntities(stripped));
}

/** Squeeze runs of blanks without destroying paragraph breaks. */
function collapse(value: string): string {
  return value
    .replace(/\r\n|\r/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface TranscriptInput {
  subject: string;
  from: { name: string | null; email: string }[];
  to: { name: string | null; email: string }[];
  cc: { name: string | null; email: string }[];
  receivedAt: Date | null;
  textBody: string | null;
  htmlBody: string | null;
  attachmentNames: string[];
  /** The server cut the body short; the transcript must say so. */
  truncated: boolean;
}

/** Cap on the transcript, so one newsletter cannot bloat a row unboundedly. */
export const TRANSCRIPT_MAX_CHARS = 200_000;

function formatAddress(a: { name: string | null; email: string }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/**
 * Headers, then body, then what was attached.
 *
 * Attachment names are included on purpose: "the email with the revised
 * drawings" is how people search, and the file names are often the only place
 * that phrase appears.
 */
export function buildTranscript(input: TranscriptInput): string {
  const lines: string[] = [];
  lines.push(`Subject: ${input.subject || "(no subject)"}`);
  if (input.from.length > 0) lines.push(`From: ${input.from.map(formatAddress).join(", ")}`);
  if (input.to.length > 0) lines.push(`To: ${input.to.map(formatAddress).join(", ")}`);
  if (input.cc.length > 0) lines.push(`Cc: ${input.cc.map(formatAddress).join(", ")}`);
  if (input.receivedAt) lines.push(`Date: ${input.receivedAt.toISOString()}`);
  if (input.attachmentNames.length > 0) {
    lines.push(`Attachments: ${input.attachmentNames.join(", ")}`);
  }

  // Prefer the text alternative: it is what the sender wrote, rather than what
  // is left of their HTML after a stripper has been through it.
  const body =
    input.textBody && input.textBody.trim().length > 0
      ? collapse(input.textBody)
      : input.htmlBody
        ? htmlToText(input.htmlBody)
        : "";

  lines.push("", body);
  if (input.truncated) {
    // Said plainly rather than left to be inferred from a body that simply
    // stops: a partial transcript presented as whole is the same class of wrong
    // as a message shown as complete when it is not.
    lines.push("", "[This copy was shortened by the mail server.]");
  }

  const out = lines.join("\n").trim();
  return out.length > TRANSCRIPT_MAX_CHARS
    ? `${out.slice(0, TRANSCRIPT_MAX_CHARS)}\n\n[Truncated when filed.]`
    : out;
}
