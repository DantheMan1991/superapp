import { promises as fs } from "fs";
import path from "path";
import { parseHeader, stripComments, stripInline } from "./markdown-meta";
import { walkMarkdown, type MarkdownEntry } from "./markdown-tree";

// Build docs: everything under `docs/` is the source of truth (checked into
// git, updated by the PR that changes the thing it describes — rule in
// AGENTS.md). The admin "Build docs" pages render these files read-only;
// nothing here is stored in the database, so the docs can never drift from
// the repo.
//
// This walks the whole tree rather than one folder. Module dossiers
// (`docs/modules/`), the platform docs (`docs/*.md`), the ADRs
// (`docs/decisions/`), the briefs (`docs/briefs/`) and the runbooks
// (`docs/runbooks/`) are all build
// docs and all belong on the page — the previous reader only knew about
// `docs/modules/`, so four platform docs and every ADR were invisible in
// the app no matter how carefully they were written. Anything added under
// `docs/` now shows up without a code change; that is the point.
//
// The one exception is `docs/help/`: the tenant guides, written for the
// client and rendered inside the product by `guides.ts`. They are not the
// build record, and on this page they would show their `{{vocabulary}}`
// unresolved, so the walker skips that folder.

const DOCS_DIR = path.join(process.cwd(), "docs");
const NOT_BUILD_DOCS = ["help"];

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
    key: "briefs",
    label: "Briefs",
    blurb:
      "Written to be SENT, not read here: a question put to somebody outside the building whose answer the software cannot invent. Plain prose on purpose — the dossier voice is for us.",
  },
  {
    key: "runbooks",
    label: "Runbooks",
    blurb: "Operational procedures: what to actually do, step by step.",
  },
];

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

// The header parser lives in markdown-meta.ts, shared with the tenant guides;
// this only adds what a build doc has and a guide does not.
function parseMeta(slug: string, raw: string): Parsed {
  const header = parseHeader(raw);
  return {
    title: header.title ?? slug,
    summary: header.summary,
    statusLine: header.statusLine,
    readBefore: header.fields.has("read before")
      ? stripInline(header.fields.get("read before") ?? "")
      : null,
    lastLogged: newestLogDate(raw),
  };
}

/** Every build doc under `docs/`, keyed by slug. */
function index(): Promise<Map<string, MarkdownEntry>> {
  return walkMarkdown(DOCS_DIR, { skipTopLevel: NOT_BUILD_DOCS });
}

async function readMeta(
  slug: string,
  entry: MarkdownEntry,
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
  /**
   * **HTML COMMENTS ARE INSTRUCTIONS TO THE AUTHOR, NEVER CONTENT FOR THE
   * READER**, and they were being rendered as text on 21 of the 29 docs that
   * have a `Status:` line — `<!-- keep Status on ONE line ... -->` sitting in
   * the middle of the header of nearly every dossier on the page.
   *
   * `react-markdown` runs without `rehype-raw`, so it does not render HTML; it
   * passes an unrecognised comment through as the literal characters instead,
   * which is worse than either rendering or dropping it. `stripInline` has
   * always removed them from the summary cards, which is why the index looked
   * clean and only the doc pages were wrong.
   *
   * Found while adding the first `docs/briefs/` page — a document written to be
   * handed to somebody outside the company, where a stray authoring note is not
   * a wart but a credibility problem.
   */
  return { ...meta, content: stripComments(raw) };
}

/** Section label for a key, for breadcrumbs. */
export function sectionLabel(key: string) {
  return (
    SECTIONS.find((s) => s.key === key)?.label ??
    key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, " ")
  );
}
