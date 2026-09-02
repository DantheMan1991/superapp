/**
 * The pure half of reading a markdown tree — what a file's header says — with
 * no filesystem in sight.
 *
 * Two readers share it: `build-docs.ts` (the superadmin build record under
 * `docs/`) and `guides-core.ts` (the tenant guides under `docs/help/`). Both
 * parse the same header shape — `# Title`, a leading blockquote, and
 * `**Field:** value` lines inside it — so that shape is defined once, here,
 * and the two cannot drift apart.
 *
 * No `node:` imports on purpose: `resolveDocLink` also runs inside the shared
 * markdown renderer, which ships to the browser with the help panel.
 */

export function isHidden(name: string): boolean {
  // `_TEMPLATE.md` and friends are scaffolding, not content.
  return name.startsWith("_") || name.startsWith(".");
}

/** `[text](url)` → `text`, and drop bold/code marks. For card summaries. */
export function stripInline(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * HTML comments are instructions to the author, never content for the reader.
 * `react-markdown` runs without `rehype-raw`, so an unstripped comment renders
 * as its literal characters — which is how `<!-- keep Status on ONE line -->`
 * once appeared in the header of 21 dossiers.
 */
export function stripComments(raw: string): string {
  return raw.replace(/<!--[\s\S]*?-->/g, "");
}

export interface MarkdownHeader {
  /** The first `# ` heading, or null when the file has none. */
  title: string | null;
  /** The leading blockquote's plain lines, or failing that the first body paragraph. */
  summary: string;
  /** A `> Status: …` line, with inline marks stripped. */
  statusLine: string | null;
  /**
   * `> **Field:** value` lines, keyed by the lowercased field name. A field
   * continues over wrapped quote lines; the pieces are joined with a space.
   */
  fields: Map<string, string>;
}

/**
 * The leading blockquote is the doc's header. Three shapes exist in the tree:
 * a dossier's purpose paragraph (plus a `Status:` line), a platform doc's
 * `**Read before:** / **Update when:**` fields, and a guide's `**Route:**` /
 * `**Order:**` fields. One parser reads all of them — a `**Field:**` marker
 * opens a field and continues over wrapped lines.
 */
export function parseHeader(raw: string): MarkdownHeader {
  const lines = raw.split("\n");
  const title = /^# (.+)$/m.exec(raw)?.[1]?.trim() ?? null;

  const summaryLines: string[] = [];
  const fields = new Map<string, string[]>();
  let statusLine: string | null = null;
  let current: string[] | null = null;
  let inQuote = false;
  let quoteEnd = 0;

  for (const [i, line] of lines.entries()) {
    if (line.startsWith(">")) {
      inQuote = true;
      quoteEnd = i + 1;
      const text = line.replace(/^>\s?/, "").trim();
      if (!text) continue;

      const field = /^\*\*(.+?):\*\*\s*(.*)$/.exec(text);
      if (field) {
        current = [field[2]];
        fields.set(field[1].toLowerCase(), current);
      } else if (/^status:/i.test(text)) {
        statusLine = stripInline(text);
        current = null;
      } else if (current) {
        current.push(text);
      } else {
        summaryLines.push(text);
      }
    } else if (inQuote) {
      break;
    }
  }

  return {
    title,
    summary: summaryLines.length
      ? stripInline(summaryLines.join(" "))
      : firstProse(lines.slice(quoteEnd)),
    statusLine,
    fields: new Map(
      [...fields.entries()].map(([key, parts]) => [key, parts.join(" ").trim()]),
    ),
  };
}

/**
 * First real paragraph of body prose — the fallback summary for docs whose
 * header is all `**Read before:**` fields and no purpose line.
 */
function firstProse(lines: string[]): string {
  const para: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (!para.length) {
      // Skip headings, rules, quotes, tables, lists and blanks.
      if (!text || /^([#>|]|---|\*|-\s|\d+\.\s)/.test(text)) continue;
      para.push(text);
    } else {
      if (!text) break;
      para.push(text);
    }
  }
  return stripInline(para.join(" "));
}

/**
 * A relative markdown link inside one doc → the slug of the doc it points at,
 * so a page can render it as an app link instead of a request for a `.md`
 * file the server does not serve. `land/overview` + `../workspace/x.md` →
 * `workspace/x`. Null for anything that is not a relative `.md` link — an
 * absolute app path, an external URL or a bare anchor pass through untouched.
 */
export function resolveDocLink(fromSlug: string, href: string): string | null {
  if (!href || href.startsWith("/") || href.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const [target] = href.split("#");
  if (!/\.md$/i.test(target)) return null;

  const parts = fromSlug.split("/").filter(Boolean);
  parts.pop(); // the doc's own name — a link is relative to its folder
  for (const piece of target.slice(0, -".md".length).split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(piece);
  }
  return parts.length ? parts.join("/").toLowerCase() : null;
}
