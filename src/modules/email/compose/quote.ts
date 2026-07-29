import type { JmapEmail, JmapEmailAddress } from "@/lib/email/jmap/types";
import { escapeHtml } from "../render/text-to-html";
import { htmlToText } from "../render/transcript";

/**
 * Quoting the message you are answering.
 *
 * Pure, and free of `server-only`, like everything else in this directory.
 *
 * THE THING THIS FILE IS CAREFUL ABOUT. A quoted body is attacker-controlled
 * markup that we are about to put inside a message OUR user sends under their
 * own name — so it leaves our origin and arrives somewhere else wearing their
 * From header. That is a different threat from rendering it: the danger is not
 * script running here, it is our user unknowingly forwarding something hostile
 * over their own signature.
 *
 * So the HTML path does not pass the original through. It converts it to text
 * and re-emits escaped markup we built ourselves. Structure is lost; a reply
 * quote is a reference, not a reproduction, and the recipient already has the
 * original. The `.eml` filed by Slice 5 is where a faithful copy lives.
 */

/** Longest quote we will carry into a reply. */
export const MAX_QUOTE_CHARS = 50_000;

function formatAddress(a: JmapEmailAddress): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

/**
 * "On Tuesday 28 July 2026 at 21:12, Supplier Test <billing@…> wrote:"
 *
 * The date is formatted by the CALLER'S locale-free ISO-ish form rather than
 * `toLocaleString`, because this string is composed on the server and read by
 * the recipient — whose locale we do not know and must not guess from ours.
 */
export function attributionLine(
  message: Pick<JmapEmail, "from" | "receivedAt" | "sentAt">,
): string {
  const author = message.from[0];
  const who = author ? formatAddress(author) : "someone";
  // receivedAt, not sentAt: sentAt is the sender's claim and is spoofable, and
  // the same rule the thread index sorts by.
  const when = message.receivedAt ?? message.sentAt;
  const stamp = when ? when.toISOString().replace("T", " ").slice(0, 16) : null;
  return stamp ? `On ${stamp} UTC, ${who} wrote:` : `${who} wrote:`;
}

function clamp(body: string): string {
  return body.length > MAX_QUOTE_CHARS
    ? `${body.slice(0, MAX_QUOTE_CHARS)}\n[…]`
    : body;
}

/** The best plain-text rendering of a message body we can manage. */
function bodyAsText(message: Pick<JmapEmail, "textBody" | "htmlBody">): string {
  if (message.textBody && message.textBody.trim().length > 0) {
    return message.textBody.replace(/\r\n|\r/g, "\n");
  }
  return message.htmlBody ? htmlToText(message.htmlBody) : "";
}

/**
 * A quoted reply body, plain text. `>` prefixing, the convention every mail
 * client understands and the one `renderTextBody` already folds on the way back
 * in.
 */
export function quoteText(
  message: Pick<JmapEmail, "from" | "receivedAt" | "sentAt" | "textBody" | "htmlBody">,
): string {
  const body = clamp(bodyAsText(message));
  const quoted = body
    .split("\n")
    // A blank line becomes ">" rather than "> ", which is what stops a quoted
    // paragraph break growing a trailing space on every round trip.
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `\n\n${attributionLine(message)}\n${quoted}\n`;
}

/**
 * A quoted reply body, HTML.
 *
 * Built from the TEXT rendering and escaped, never from the original markup —
 * see the file header. `<blockquote>` is what mail clients indent, and the
 * `type="cite"` attribute is what several of them use to collapse it.
 */
export function quoteHtml(
  message: Pick<JmapEmail, "from" | "receivedAt" | "sentAt" | "textBody" | "htmlBody">,
): string {
  const body = clamp(bodyAsText(message));
  const lines = body
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br>\n");
  return (
    `<p>${escapeHtml(attributionLine(message))}</p>\n` +
    `<blockquote type="cite" style="margin:0 0 0 0.8em;padding-left:0.8em;border-left:2px solid #ccc;">\n` +
    `${lines}\n</blockquote>\n`
  );
}

/**
 * The header block a forward carries.
 *
 * Forwarding is different from replying: the recipient has NOT seen the
 * original, so the envelope details are the point rather than context. Kept as
 * text and escaped by the HTML caller.
 */
export function forwardHeaderLines(
  message: Pick<JmapEmail, "from" | "to" | "cc" | "subject" | "receivedAt" | "sentAt">,
): string[] {
  const when = message.receivedAt ?? message.sentAt;
  const lines = [
    "---------- Forwarded message ----------",
    `From: ${message.from.map(formatAddress).join(", ") || "(unknown)"}`,
  ];
  if (when) lines.push(`Date: ${when.toISOString().replace("T", " ").slice(0, 16)} UTC`);
  lines.push(`Subject: ${message.subject || "(no subject)"}`);
  if (message.to.length > 0) lines.push(`To: ${message.to.map(formatAddress).join(", ")}`);
  if (message.cc.length > 0) lines.push(`Cc: ${message.cc.map(formatAddress).join(", ")}`);
  return lines;
}

export function forwardText(
  message: Pick<
    JmapEmail,
    "from" | "to" | "cc" | "subject" | "receivedAt" | "sentAt" | "textBody" | "htmlBody"
  >,
): string {
  const header = forwardHeaderLines(message).join("\n");
  return `\n\n${header}\n\n${clamp(bodyAsText(message))}\n`;
}

export function forwardHtml(
  message: Pick<
    JmapEmail,
    "from" | "to" | "cc" | "subject" | "receivedAt" | "sentAt" | "textBody" | "htmlBody"
  >,
): string {
  const header = forwardHeaderLines(message)
    .map((line) => escapeHtml(line))
    .join("<br>\n");
  const body = clamp(bodyAsText(message))
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br>\n");
  return `<p>${header}</p>\n<div>${body}</div>\n`;
}

/**
 * The full starting body for a reply or forward: the person's own signature
 * space above, the quote below.
 *
 * The blank lines at the top are not decoration — a composer that opens with
 * the cursor jammed against a quote is one people have to fight before typing.
 */
export function openingBody(
  signature: string,
  quoted: string,
): string {
  const sig = signature.trim().length > 0 ? `\n\n${signature.trim()}` : "";
  return `${sig}${quoted}`;
}
