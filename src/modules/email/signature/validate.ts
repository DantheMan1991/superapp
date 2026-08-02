import { sanitizeOutboundHtml, htmlHasContent } from "../compose/html";
import { htmlToPlainText } from "../compose/to-text";

/**
 * Preparing a signature for the mail server.
 *
 * A SIGNATURE IS THE MOST-SENT MARKUP IN THE PRODUCT. Everything else the
 * composer emits goes out once; this goes out on every message the person ever
 * writes, from Yosher and from every other client pointed at the same mailbox.
 * So it goes through exactly the same outbound sanitizer a message body does —
 * `compose/html.ts`, whose header explains why the write path has no sandbox
 * behind it — and not a laxer one on the grounds that it is "our own" content.
 * It is the user's content, and the user can paste.
 *
 * **The text version is DERIVED, never typed alongside.** Same rule as the
 * message body and for the same reason: two fields would disagree the moment
 * somebody edited one, and the recipient whose client prefers text would read a
 * different signature from everyone else — silently, for months.
 *
 * Pure, free of `server-only`, so the rules are testable without a mail server.
 */

/** Long enough for a legal footer, short enough not to be a newsletter. */
export const MAX_SIGNATURE_HTML = 20_000;

export interface PreparedSignature {
  htmlSignature: string;
  textSignature: string;
}

/**
 * RFC 3676's separator, prepended when the signature does not already open with
 * one.
 *
 * Mail clients fold everything after a line of exactly `-- ` out of quoted
 * replies. Without it a signature is quoted back into every message in a thread,
 * so a four-exchange conversation ends with four copies of somebody's phone
 * number in it — which is the single most common way signatures make mail worse.
 *
 * Added rather than required, because nobody types `-- ` on purpose and a form
 * that refused to save without it would be a puzzle.
 */
const SEPARATOR_TEXT = "-- ";
const SEPARATOR_HTML = "<div>-- </div>";

/**
 * Does this signature already open with the separator?
 *
 * Trailing whitespace is trimmed before comparing because the space in `-- ` is
 * exactly what a stray `trimEnd` elsewhere eats — so a signature that lost it
 * should be recognized and repaired rather than given a second separator.
 */
export function hasSeparator(text: string): boolean {
  const firstLine = (text.replace(/\r\n|\r/g, "\n").split("\n")[0] ?? "").trimEnd();
  return firstLine === "--";
}

/**
 * Sanitize, derive, and make sure the separator is there.
 *
 * Returns empty strings for an empty signature rather than refusing: clearing a
 * signature is a thing people do, and it has to be expressible.
 */
export function prepareSignature(html: string): PreparedSignature {
  const trimmed = html.length > MAX_SIGNATURE_HTML
    ? html.slice(0, MAX_SIGNATURE_HTML)
    : html;

  // No `allowedCids`: a signature cannot carry an inline image. A `cid:` is
  // minted per message and lives in that message's MIME, so a stored one would
  // reference a part that does not exist in any of the messages it is later
  // pasted into — a broken image on every mail somebody sends. The picture would
  // have to be re-attached to each message, which is a different feature.
  const clean = sanitizeOutboundHtml(trimmed);
  if (!htmlHasContent(clean)) return { htmlSignature: "", textSignature: "" };

  const withSeparator = startsWithSeparator(clean)
    ? clean
    : `${SEPARATOR_HTML}\n${clean}`;

  const text = htmlToPlainText(withSeparator);
  return {
    htmlSignature: withSeparator,
    // Belt: `htmlToPlainText` preserves a `-- ` line, but a signature whose HTML
    // separator was somehow lost must not ship a text version without one.
    textSignature: hasSeparator(text) ? text : `${SEPARATOR_TEXT}\n${text}`,
  };
}

/**
 * Is the first visible line already the separator?
 *
 * Checked on the TEXT rendering rather than by matching markup, because the
 * separator can arrive as `<div>-- </div>`, `<p>--&nbsp;</p>` or a bare `-- `
 * depending on which client last edited it, and all three mean the same thing.
 */
function startsWithSeparator(html: string): boolean {
  return hasSeparator(htmlToPlainText(html));
}
