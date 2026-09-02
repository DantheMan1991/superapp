import { promises as fs } from "fs";
import path from "path";
import { isHidden } from "./markdown-meta";

export interface MarkdownEntry {
  /** Absolute path, for reading. */
  file: string;
  /** Path relative to the root, `/`-joined on every platform, for display. */
  rel: string;
}

/**
 * Every `.md` under `root`, keyed by slug: the relative path minus `.md`,
 * lowercased. Slugs are only ever LOOKED UP in this map — a path is never
 * built from caller input, so traversal is impossible by construction rather
 * than by validation. First writer wins on a collision.
 *
 * `skipTopLevel` names folders directly under `root` that belong to a
 * different reader: `docs/help/` is the tenant guides, not the build record.
 *
 * Entries are sorted so two walks of the same tree agree — `readdir` order is
 * whatever the filesystem feels like, and it differs between this laptop and
 * the Linux box that runs CI.
 */
export async function walkMarkdown(
  root: string,
  options: { skipTopLevel?: readonly string[] } = {},
): Promise<Map<string, MarkdownEntry>> {
  const skip = new Set(options.skipTopLevel ?? []);
  const found = new Map<string, MarkdownEntry>();

  async function walk(dir: string, rel: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (isHidden(entry.name)) continue;
      if (!rel && skip.has(entry.name)) continue;
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

  await walk(root, "");
  return found;
}
