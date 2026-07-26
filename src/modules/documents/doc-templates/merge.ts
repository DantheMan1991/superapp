/**
 * Merge fields for document templates.
 *
 * NOTE ON THE DIRECTORY NAME: `src/modules/documents/templates/` is already
 * taken by FOLDER templates (the default folder tree a tenant is provisioned
 * with). These are DOCUMENT templates — a lien waiver, a change order — and
 * they are unrelated. Hence `doc-templates/`.
 *
 * ── The rule this file exists to enforce ──────────────────────────────────
 *
 * A merge value is NEVER substituted into the template's Markdown source.
 * Values are injected as TEXT NODES into the already-parsed syntax tree.
 *
 * This is the exact analogue of SQL parameterization, and it matters for the
 * same reason. A customer literally named `# ACME` must appear as the text
 * "# ACME", not become a heading. A subcontractor called
 * `[click here](http://evil.example)` must not become a link in a document the
 * business is about to put its name on. String substitution into the source
 * makes every merge value a potential document-structure injection; injecting
 * into the tree after parsing makes it impossible by construction.
 *
 * Pure and dependency-free on purpose: the same functions run in the browser
 * preview (as a remark plugin, where the tree arrives already parsed) and on
 * the server for PDF generation. Nothing here imports a Markdown parser.
 */

/** `{{ field_name }}` — whitespace tolerated, name deliberately strict. */
const FIELD_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export const FIELD_NAME_MAX = 40;
export const FIELDS_PER_TEMPLATE_MAX = 60;

/**
 * Field names are identifier-shaped, not free text.
 *
 * Deliberately narrower than what the pattern above would tolerate: a name is
 * shown to whoever fills the template in, becomes a form label, and is matched
 * against supplied data. Allowing punctuation or spaces would make
 * `{{ client name }}` and `{{client_name}}` two different fields that look the
 * same in a list.
 */
export function isValidFieldName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) && name.length <= FIELD_NAME_MAX;
}

/**
 * Every distinct field referenced by a template body, in first-appearance
 * order — which is the order a form should ask for them.
 */
export function extractMergeFields(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // A fresh regex per call: the global flag makes lastIndex stateful, and a
  // shared instance would silently skip matches on every second call.
  const pattern = new RegExp(FIELD_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1];
    if (!isValidFieldName(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= FIELDS_PER_TEMPLATE_MAX) break;
  }
  return out;
}

/** Fields a template needs that the supplied values do not cover. */
export function missingFields(
  source: string,
  values: Readonly<Record<string, string>>,
): string[] {
  return extractMergeFields(source).filter(
    (name) => (values[name] ?? "").trim().length === 0,
  );
}

/**
 * What an unfilled placeholder becomes.
 *
 * Left visible on purpose. A blank would produce a document with a silent hole
 * in it — "Received from  the sum of" — which is worse than one that obviously
 * still needs filling in, especially on something heading for a signature.
 */
export function placeholderFor(name: string): string {
  return `[${name}]`;
}

/* ── The tree walk ─────────────────────────────────────────────────────── */

/** The subset of mdast this walker needs. Structural, not exhaustive. */
export interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  [key: string]: unknown;
}

/**
 * Split one text node's value on placeholders, returning the replacement
 * nodes. Values become their own text nodes and are never re-parsed.
 */
function splitTextNode(
  value: string,
  values: Readonly<Record<string, string>>,
): { nodes: MdNode[]; count: number } {
  const pattern = new RegExp(FIELD_PATTERN.source, "g");
  const nodes: MdNode[] = [];
  let cursor = 0;
  let count = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const name = match[1];
    if (match.index > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    const supplied = values[name];
    nodes.push({
      type: "text",
      // An empty or whitespace-only value is treated as unsupplied, so a form
      // submitted with a blank box does not silently produce a gap.
      value:
        supplied !== undefined && supplied.trim().length > 0
          ? supplied
          : placeholderFor(name),
    });
    count += 1;
    cursor = match.index + match[0].length;
  }

  if (count === 0) return { nodes: [], count: 0 };
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return { nodes, count };
}

/**
 * Replace every placeholder in a parsed tree with its value, in place.
 *
 * Only `text` nodes are touched. That is the whole safety property: a value
 * lands as the `value` of a text node, so whatever it contains is content, not
 * syntax. Code blocks (`code`, `inlineCode`) are left ALONE — a template that
 * shows `{{amount}}` inside a code sample is documenting the placeholder, not
 * using it.
 *
 * Returns the number of substitutions, which the caller can use to tell
 * "nothing to merge" from "merged nothing".
 */
export function injectValues(
  node: MdNode,
  values: Readonly<Record<string, string>>,
): number {
  if (!Array.isArray(node.children)) return 0;

  let count = 0;
  const next: MdNode[] = [];

  for (const child of node.children) {
    if (child.type === "code" || child.type === "inlineCode") {
      next.push(child);
      continue;
    }
    if (child.type === "text" && typeof child.value === "string") {
      const split = splitTextNode(child.value, values);
      if (split.count === 0) {
        next.push(child);
        continue;
      }
      // Counted per placeholder, not per emitted node — the literal slices
      // around a placeholder are not substitutions.
      count += split.count;
      next.push(...split.nodes);
      continue;
    }
    count += injectValues(child, values);
    next.push(child);
  }

  node.children = next;
  return count;
}
