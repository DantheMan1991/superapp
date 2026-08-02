import { decodeEntities } from "../render/transcript";

/**
 * The plain-text alternative that rides alongside every HTML message we send.
 *
 * WHY THIS IS NOT `htmlToText` FROM `render/transcript.ts`, which flattens HTML
 * for a search index: that function's own header says its output "is never
 * rendered". This output IS read, by a person, in a mail client that showed them
 * the text part — a phone on a bad connection, a screen reader, a ticketing
 * system, `mutt`. It loses hrefs, list numbering and quote depth because a
 * tsvector does not need them. A reader does.
 *
 * The quote depth is the one that actually matters. A recipient replying to the
 * text alternative gets our `>` prefixes back in THEIR quote, which is how a
 * plain-text reply chain stays readable across four exchanges. Drop it and every
 * message in the thread flattens into one block of undifferentiated prose the
 * moment somebody on a text-only client answers.
 *
 * WHY HAND-ROLLING A PARSER IS FINE HERE, when the dossier is emphatic that
 * hand-rolling an HTML *sanitizer* is not. Two reasons, and both have to hold:
 *
 *   • The output is plain text. There is no such thing as mutation XSS in a
 *     string with no markup in it, so the failure mode is an ugly text part
 *     rather than a compromise.
 *   • The input is ALREADY SANITIZED. This runs on the output of
 *     `sanitizeOutboundHtml`, never on raw markup, so the tag set is a dozen
 *     names long and known-good. The callers enforce that ordering and there is
 *     a test asserting the order in `compose-actions.ts`.
 *
 * Pure, no `server-only`, no DOM.
 */

/** Tags that end the current line when they open. */
const OPENS_LINE = new Set(["p", "div", "blockquote", "ul", "ol", "li", "pre"]);
/** Tags that end the current line when they close. */
const CLOSES_LINE = new Set(["p", "div", "blockquote", "ul", "ol", "li", "pre"]);
/** Tags after which a blank line separates the block from what follows. */
const BLOCK_GAP = new Set(["p", "div", "blockquote", "pre"]);

/** One `<ul>`/`<ol>` we are currently inside. */
interface ListLevel {
  ordered: boolean;
  index: number;
}

/** An `<a>` we have opened but not yet closed. */
interface OpenLink {
  href: string;
  /** Where the label started in the current line, so we can read it back. */
  start: number;
}

const TOKEN = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * Normalize an href and a label for comparison.
 *
 * `mailto:` is the case this exists for: a link whose text is the address and
 * whose href is `mailto:` + the address is the SAME thing said twice, and
 * emitting `dan@example.com <mailto:dan@example.com>` in a text part is noise
 * every mail client's own converter avoids.
 */
function sameThing(label: string, href: string): boolean {
  const l = label.trim().toLowerCase().replace(/\/+$/, "");
  const h = href
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return l === h || l.replace(/^https?:\/\//, "") === h;
}

export function htmlToPlainText(html: string): string {
  const lines: string[] = [];
  let line = "";
  let quoteDepth = 0;
  const lists: ListLevel[] = [];
  let link: OpenLink | null = null;
  /** Set when a `<li>` opened, consumed by the next flush that has content. */
  let pendingMarker = "";

  /**
   * Emit the current line, with its quote prefix, and start a fresh one.
   *
   * `hard` marks a line ending the author actually asked for — a `<br>` — as
   * opposed to one implied by a block boundary. The distinction is the whole
   * reason this takes an argument: `<li>alpha</li><li>beta</li>` closes and
   * opens a line between the two bullets and must NOT put a blank one there,
   * while `<br><br>` inside a quote is somebody's paragraph break and must
   * survive as a `>` of its own.
   */
  function flush(hard = false): void {
    // The non-breaking spaces are a contenteditable's, not the author's: every
    // browser inserts them to keep a run of spaces from collapsing, and they
    // arrive in the recipient's text part as bytes that look like spaces and do
    // not wrap like them.
    const raw = `${pendingMarker}${line}`.replace(/ /g, " ").trimEnd();
    // RFC 3676's signature separator is "-- " WITH the trailing space, and that
    // space is what mail clients key their signature folding off. A blanket
    // trimEnd eats it and turns a signature into ordinary body text that gets
    // quoted back in every reply for the rest of the thread.
    const body = raw === "--" ? "-- " : raw;
    pendingMarker = "";
    line = "";

    // The prefix is applied at flush time rather than when the quote opens,
    // because a `<br>` inside a quote has to carry it too — that is the whole
    // difference between a quote that survives a reply and one that unravels
    // on the second line.
    const prefix = "> ".repeat(quoteDepth);

    if (body.length === 0) {
      // Nothing to emit. A soft flush is a block boundary doing its bookkeeping
      // and produces no line at all — blank lines come from `gap()` and nowhere
      // else, which is what stops a contenteditable's many empty wrappers each
      // adding one.
      if (!hard) return;
      // A hard flush with nothing on the line is a deliberate blank line. Inside
      // a quote it has to keep the quote going, or the paragraph break reads as
      // the end of the quotation to the next person who replies. Trimmed to ">"
      // rather than "> " for the same reason `quoteText` does it: a trailing
      // space would grow by one on every round trip.
      if (quoteDepth > 0) lines.push(prefix.trimEnd());
      else gap();
      return;
    }
    lines.push(`${prefix}${body}`);
  }

  /** A blank separator, without stacking up runs of them. */
  function gap(): void {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
  }

  function appendText(raw: string): void {
    // Whitespace in HTML is insignificant, so runs collapse to one space.
    // Entities are decoded AFTER that — decoding first would let `&#10;` become
    // a newline that the collapse then eats, and `&nbsp;` is meant to survive
    // collapsing, which is exactly why it is a non-breaking space.
    let collapsed = raw.replace(/[\t\n\r ]+/g, " ");
    // A space at the start of a line is the markup's indentation, not the
    // author's. Trimmed BEFORE entities are decoded, so a deliberate `&nbsp;` —
    // which is a non-breaking space precisely because somebody meant it to
    // survive — is not caught by it.
    if (line.length === 0) collapsed = collapsed.replace(/^ +/, "");
    if (collapsed.length === 0) return;
    line += decodeEntities(collapsed);
  }

  let cursor = 0;
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN.exec(html)) !== null) {
    appendText(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const raw = match[0];
    const name = match[1].toLowerCase();
    const closing = raw.startsWith("</");

    if (name === "br") {
      flush(true);
      continue;
    }

    if (name === "a") {
      if (!closing) {
        const href = HREF.exec(match[2]);
        const value = href ? (href[1] ?? href[2] ?? href[3] ?? "") : "";
        link = value ? { href: decodeEntities(value), start: line.length } : null;
      } else if (link) {
        const label = line.slice(link.start);
        // The href is appended in angle brackets — the convention every mail
        // client's own text alternative uses, and the one that stops a link
        // becoming invisible in the part that has no anchors.
        if (label.trim().length === 0) line += link.href;
        else if (!sameThing(label, link.href)) line += ` <${link.href}>`;
        link = null;
      }
      continue;
    }

    if (name === "blockquote") {
      flush();
      if (closing) {
        quoteDepth = Math.max(0, quoteDepth - 1);
        gap();
      } else {
        gap();
        quoteDepth += 1;
      }
      continue;
    }

    if (name === "ul" || name === "ol") {
      flush();
      if (closing) {
        lists.pop();
        gap();
      } else {
        lists.push({ ordered: name === "ol", index: 0 });
      }
      continue;
    }

    if (name === "li") {
      flush();
      if (!closing) {
        const level = lists[lists.length - 1];
        if (level) {
          level.index += 1;
          // Nesting is shown by indentation, since a text part has no other way
          // to say it. Two spaces per level below the first.
          const indent = "  ".repeat(Math.max(0, lists.length - 1));
          pendingMarker = level.ordered
            ? `${indent}${level.index}. `
            : `${indent}- `;
        } else {
          // A stray `<li>` outside any list. Sanitized markup should not carry
          // one, but emitting a bullet is a better answer than losing the text.
          pendingMarker = "- ";
        }
      }
      continue;
    }

    if (closing ? CLOSES_LINE.has(name) : OPENS_LINE.has(name)) {
      flush();
      if (closing && BLOCK_GAP.has(name)) gap();
      continue;
    }
    // Everything else — b, i, u, strong, em, code … — contributes no text and
    // no structure. Plain text has no way to say "bold", and inventing `*bold*`
    // would put asterisks into messages nobody typed.
  }

  appendText(html.slice(cursor));
  flush();

  // Leading and trailing blank lines are the editor's, not the author's.
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}
