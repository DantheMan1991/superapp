import { promises as fs } from "fs";
import path from "path";

// Module dossiers: docs/modules/*.md is the source of truth (checked into
// git, updated by every PR that touches a module — rule in AGENTS.md). The
// admin "Build docs" pages render these files read-only; nothing here is
// stored in the database, so the docs can never drift from the repo.

const DOCS_DIR = path.join(process.cwd(), "docs", "modules");

// Filenames are the slug; underscore-prefixed files (_TEMPLATE.md) are
// internal. The strict slug shape also makes path traversal impossible.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface ModuleDocMeta {
  slug: string;
  title: string;
  summary: string;
  statusLine: string | null;
  /** Date of the newest build-log entry (`### YYYY-MM-DD — ...`). */
  lastLogged: string | null;
}

export interface ModuleDoc extends ModuleDocMeta {
  content: string;
}

function parseMeta(slug: string, raw: string): ModuleDocMeta {
  const title = /^# (.+)$/m.exec(raw)?.[1]?.trim() ?? slug;

  // The leading blockquote is the dossier's purpose paragraph; a line
  // starting with "Status:" inside it is shown separately as a badge line.
  const quoteLines: string[] = [];
  let statusLine: string | null = null;
  let inQuote = false;
  for (const line of raw.split("\n")) {
    if (line.startsWith(">")) {
      inQuote = true;
      const text = line.replace(/^>\s?/, "").trim();
      if (/^status:/i.test(text)) statusLine = text;
      else if (text) quoteLines.push(text);
    } else if (inQuote) {
      break;
    }
  }

  return {
    slug,
    title,
    summary: quoteLines.join(" "),
    statusLine,
    lastLogged: /^### (\d{4}-\d{2}-\d{2})/m.exec(raw)?.[1] ?? null,
  };
}

export async function listModuleDocs(): Promise<ModuleDocMeta[]> {
  let files: string[];
  try {
    files = await fs.readdir(DOCS_DIR);
  } catch {
    return [];
  }
  const slugs = files
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -".md".length))
    .filter((s) => SLUG_RE.test(s))
    .sort();

  return Promise.all(
    slugs.map(async (slug) => {
      const raw = await fs.readFile(path.join(DOCS_DIR, `${slug}.md`), "utf8");
      return parseMeta(slug, raw);
    }),
  );
}

export async function getModuleDoc(slug: string): Promise<ModuleDoc | null> {
  if (!SLUG_RE.test(slug)) return null;
  let raw: string;
  try {
    raw = await fs.readFile(path.join(DOCS_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
  return { ...parseMeta(slug, raw), content: raw };
}
