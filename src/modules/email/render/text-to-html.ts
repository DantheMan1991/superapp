/**
 * Plain-text message bodies, rendered as HTML.
 *
 * Goes through the SAME frame and the same CSP as an HTML body — one
 * message-rendering path, not two, so there is one place to be wrong about.
 *
 * The rule that decides the whole file: **tokenize first, escape second.**
 * Linkifying already-escaped text is the classic way to produce hrefs full of
 * `&amp;`, and escaping already-linkified text destroys the anchors. Walking the
 * raw string and emitting each piece in its final form makes both impossible.
 */

const AMP = /&/g;
const LT = /</g;
const GT = />/g;
const QUOT = /"/g;
const APOS = /'/g;

export function escapeHtml(value: string): string {
  return value
    .replace(AMP, "&amp;")
    .replace(LT, "&lt;")
    .replace(GT, "&gt;")
    .replace(QUOT, "&quot;")
    .replace(APOS, "&#39;");
}

/**
 * URLs and bare email addresses, matched in one pass so they cannot overlap.
 * Deliberately conservative: anything ambiguous is left as text, because a
 * missed link is a minor annoyance and a wrong one is a phishing vector.
 */
const TOKEN =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/gi;

/**
 * Trim punctuation that belongs to the sentence rather than the URL.
 *
 * The paren rule is what makes `…/wiki/Foo_(bar)` survive while
 * `(see https://example.com)` does not swallow the closing bracket: a trailing
 * `)` is kept only when the URL opened one.
 */
export function trimUrlTail(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (last === undefined) break;
    if (")]}".includes(last)) {
      const open = last === ")" ? "(" : last === "]" ? "[" : "{";
      const opens = out.split(open).length - 1;
      const closes = out.split(last).length - 1;
      if (closes > opens) {
        out = out.slice(0, -1);
        continue;
      }
      break;
    }
    if (".,;:!?\"'".includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    break;
  }
  return out;
}

/** Only these schemes ever become clickable. Never a denylist. */
function hrefFor(token: string): { href: string; label: string } | null {
  if (token.includes("@") && !/^https?:\/\//i.test(token)) {
    return { href: `mailto:${token}`, label: token };
  }
  if (/^www\./i.test(token)) {
    // The href gets a scheme; the label keeps what the sender wrote.
    return { href: `https://${token}`, label: token };
  }
  if (/^https?:\/\//i.test(token)) return { href: token, label: token };
  return null;
}

function anchor(href: string, label: string): string {
  let host = "";
  try {
    host = new URL(href).host;
  } catch {
    host = "";
  }
  // target/rel forced on every link: the popup is a normal browsing context
  // (allow-popups-to-escape-sandbox), so noopener matters, and noreferrer keeps
  // the message id out of the destination's logs.
  const title = host ? ` title="${escapeHtml(host)}"` : "";
  return (
    `<a href="${escapeHtml(href)}" target="_blank" ` +
    `rel="noopener noreferrer nofollow"${title}>${escapeHtml(label)}</a>`
  );
}

/** One line of text → HTML, with links. Escaping and linking in one pass. */
export function linkifyLine(line: string): string {
  let out = "";
  let cursor = 0;
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(line)) !== null) {
    const raw = match[0];
    const trimmed = trimUrlTail(raw);
    out += escapeHtml(line.slice(cursor, match.index));
    const link = hrefFor(trimmed);
    out += link ? anchor(link.href, link.label) : escapeHtml(trimmed);
    // Punctuation trimmed off the token is still part of the sentence.
    out += escapeHtml(raw.slice(trimmed.length));
    cursor = match.index + raw.length;
  }
  out += escapeHtml(line.slice(cursor));
  return out;
}

function quoteDepth(line: string): number {
  let depth = 0;
  let rest = line;
  for (;;) {
    const m = /^\s*>/.exec(rest);
    if (!m) break;
    depth += 1;
    rest = rest.slice(m[0].length);
  }
  return depth;
}

function stripQuotes(line: string): string {
  let rest = line;
  for (;;) {
    const m = /^\s*>\s?/.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
  }
  return rest;
}

/** A quoted block longer than this is folded behind a disclosure. */
const FOLD_AFTER_LINES = 3;

interface Block {
  depth: number;
  lines: string[];
}

function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const depth = quoteDepth(line);
    const text = depth > 0 ? stripQuotes(line) : line;
    const last = blocks[blocks.length - 1];
    if (last && last.depth === depth) last.lines.push(text);
    else blocks.push({ depth, lines: [text] });
  }
  return blocks;
}

function renderBlock(block: Block): string {
  const body = block.lines.map(linkifyLine).join("\n");
  if (block.depth === 0) return body;

  const inner = `<blockquote>${body}</blockquote>`;
  const nested = block.depth > 1 ? `<blockquote>${inner}</blockquote>` : inner;
  if (block.lines.length <= FOLD_AFTER_LINES) return nested;

  // <details> is the one interactive control that works with scripting off,
  // which is exactly why quote folding is done with it rather than a toggle.
  return `<details><summary>Quoted text (${block.lines.length} lines)</summary>${nested}</details>`;
}

/** RFC 3676 signature separator: a line that is exactly "-- ". */
const SIGNATURE = /^-- ?$/;

/**
 * Render a plain-text body.
 *
 * Returns a fragment, not a document — the caller wraps it in the frame's
 * skeleton along with the reset stylesheet.
 */
export function renderTextBody(text: string): string {
  const normalized = text.replace(/\r\n|\r/g, "\n");
  const lines = normalized.split("\n");

  const sigIndex = lines.findIndex((l) => SIGNATURE.test(l));
  const bodyLines = sigIndex >= 0 ? lines.slice(0, sigIndex) : lines;
  const sigLines = sigIndex >= 0 ? lines.slice(sigIndex + 1) : [];

  const rendered = toBlocks(bodyLines).map(renderBlock).join("\n");

  // A signature is folded rather than dropped: it often carries the phone
  // number somebody actually wants, but it is not the message.
  const signature =
    sigLines.length > 0
      ? `<details class="y-sig"><summary>Signature</summary>${sigLines
          .map(linkifyLine)
          .join("\n")}</details>`
      : "";

  return `<div class="y-text">${rendered}${signature}</div>`;
}

/** Ships inside the frame. `pre-wrap` is what preserves the sender's layout. */
export const TEXT_BODY_CSS = `
.y-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.y-text blockquote { margin: 0.4em 0 0.4em 0.8em; padding-left: 0.8em;
  border-left: 2px solid currentColor; opacity: 0.7; }
.y-text details { margin: 0.4em 0; }
.y-text summary { cursor: pointer; opacity: 0.7; }
`;
