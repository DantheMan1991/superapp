import { promises as fs } from "fs";
import path from "path";

// Build docs: everything under `docs/` is the source of truth (checked into
// git, updated by the PR that changes the thing it describes — rule in
// AGENTS.md). The admin "Build docs" pages render these files read-only;
// nothing here is stored in the database, so the docs can never drift from
// the repo.
//
// This walks the whole tree rather than one folder. Module dossiers
// (`docs/modules/`), the platform docs (`docs/*.md`), the ADRs
// (`docs/decisions/`) and the runbooks (`docs/runbooks/`) are all build
// docs and all belong on the page — the previous reader only knew about
// `docs/modules/`, so four platform docs and every ADR were invisible in
// the app no matter how carefully they were written. Anything added under
// `docs/` now shows up without a code change; that is the point.

const DOCS_DIR = path.join(process.cwd(), "docs");

/** Section = the top-level folder under `docs/` (`""` is `docs/*.md`). */
export interface DocSection {
  key: string;
  label: string;
  blurb: string;
  docs: BuildDocMeta[];
}

export interface BuildDocMeta {
  /** URL path under `/admin/docs` — the file's path minus `.md`. */
  slug: string;
  /** Basename slug (`email`), for matching a dossier to a module id. */
  name: string;
  /** Repo-relative path, shown in the UI so the file is findable. */
  file: string;
  section: string;
  title: string;
  summary: string;
  /** `> Status: ...` line from a dossier's purpose blockquote. */
  statusLine: string | null;
  /** `> **Read before:** ...` line from a platform doc's header. */
  readBefore: string | null;
  /** Date of the newest build-log entry (`### YYYY-MM-DD — ...`). */
  lastLogged: string | null;
}

export interface BuildDoc extends BuildDocMeta {
  content: string;
}

// Known sections, in the order they should be read. An unknown folder still
// renders — it just sorts last under a title-cased version of its name.
const SECTIONS: Omit<DocSection, "docs">[] = [
  {
    key: "",
    label: "Platform",
    blurb:
      "The invariants every module inherits. Read these before a first substantial change.",
  },
  {
    key: "modules",
    label: "Modules",
    blurb:
      "One dossier per module (and per platform-level machinery): what it is, how it got that way, and the decisions behind it.",
  },
  {
    key: "decisions",
    label: "Decisions",
    blurb:
      "Architecture decision records — why a foundational choice is the way it is, and what it ruled out. Immutable once accepted.",
  },
  {
    key: "runbooks",
    label: "Runbooks",
    blurb: "Operational procedures: what to actually do, step by step.",
  },
];

function isHidden(name: string) {
  // `_TEMPLATE.md` and friends are scaffolding, not build docs.
  return name.startsWith("_") || name.startsWith(".");
}

/** `[text](url)` → `text`, and drop bold/code marks. For card summaries. */
function stripInline(text: string) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Newest build-log date in the file. Max, not first: a long dossier is not
 * reliably ordered newest-first end to end (email.md carries a dated
 * section above its log), and "updated" showing an older date than the last
 * entry is worse than showing none.
 */
function newestLogDate(raw: string): string | null {
  const dates = [...raw.matchAll(/^### (\d{4}-\d{2}-\d{2})/gm)].map(
    (m) => m[1],
  );
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

interface Parsed {
  title: string;
  summary: string;
  statusLine: string | null;
  readBefore: string | null;
  lastLogged: string | null;
}

function parseMeta(slug: string, raw: string): Parsed {
  const lines = raw.split("\n");
  const title = /^# (.+)$/m.exec(raw)?.[1]?.trim() ?? slug;

  // The leading blockquote is the doc's header. Two shapes exist in the
  // tree: a dossier's purpose paragraph (plus a `Status:` line), and a
  // platform doc's `**Read before:** / **Update when:**` fields. Parse both
  // — a `**Field:**` marker opens a field and continues over wrapped lines.
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
    readBefore: fields.has("read before")
      ? stripInline(fields.get("read before")!.join(" "))
      : null,
    lastLogged: newestLogDate(raw),
  };
}

/**
 * First real paragraph of body prose — the fallback summary for docs whose
 * header is all `**Read before:**` fields and no purpose line.
 */
function firstProse(lines: string[]) {
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

/** Every `.md` under `docs/`, keyed by slug. */
async function index(): Promise<Map<string, { file: string; rel: string }>> {
  const found = new Map<string, { file: string; rel: string }>();

  async function walk(dir: string, rel: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (isHidden(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      // isDirectory() is false for symlinks, so a link loop can't recurse.
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const slug = relPath.slice(0, -".md".length).toLowerCase();
        if (!found.has(slug)) {
          found.set(slug, { file: path.join(dir, entry.name), rel: relPath });
        }
      }
    }
  }

  await walk(DOCS_DIR, "");
  return found;
}

async function readMeta(
  slug: string,
  entry: { file: string; rel: string },
): Promise<{ meta: BuildDocMeta; raw: string }> {
  const raw = await fs.readFile(entry.file, "utf8");
  const cut = slug.lastIndexOf("/");
  return {
    raw,
    meta: {
      ...parseMeta(slug, raw),
      slug,
      name: cut === -1 ? slug : slug.slice(cut + 1),
      file: `docs/${entry.rel}`,
      section: cut === -1 ? "" : slug.slice(0, cut),
    },
  };
}

function sortDocs(docs: BuildDocMeta[]) {
  // A section README introduces its section, so it leads.
  return docs.sort((a, b) => {
    if (a.name === "readme") return -1;
    if (b.name === "readme") return 1;
    return a.slug.localeCompare(b.slug);
  });
}

/** All build docs, grouped into sections. Empty sections are dropped. */
export async function listBuildDocs(): Promise<DocSection[]> {
  const entries = [...(await index()).entries()];
  const metas = await Promise.all(
    entries.map(([slug, entry]) => readMeta(slug, entry).then((r) => r.meta)),
  );

  const known = new Set(SECTIONS.map((s) => s.key));
  const extras = [...new Set(metas.map((m) => m.section))]
    .filter((key) => !known.has(key))
    .sort()
    .map((key) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, " "),
      blurb: "",
    }));

  return [...SECTIONS, ...extras]
    .map((section) => ({
      ...section,
      docs: sortDocs(metas.filter((m) => m.section === section.key)),
    }))
    .filter((section) => section.docs.length > 0);
}

/** Module dossiers only — used by `/admin/modules` to link the registry. */
export async function listModuleDocs(): Promise<BuildDocMeta[]> {
  const sections = await listBuildDocs();
  return sections.find((s) => s.key === "modules")?.docs ?? [];
}

/**
 * Look the slug up in an index built from real directory contents — the
 * path is never constructed from caller input, so traversal is impossible
 * by construction rather than by validation.
 */
export async function getBuildDoc(slug: string): Promise<BuildDoc | null> {
  const entry = (await index()).get(slug.toLowerCase());
  if (!entry) return null;
  const { meta, raw } = await readMeta(slug.toLowerCase(), entry);
  return { ...meta, content: raw };
}

/** Section label for a key, for breadcrumbs. */
export function sectionLabel(key: string) {
  return (
    SECTIONS.find((s) => s.key === key)?.label ??
    key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, " ")
  );
}
