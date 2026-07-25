import type { DocumentVisibility } from "@/db/schema";

/**
 * The folder tree, as pure functions. No database, no React — everything here
 * is unit-tested without a connection, which is the point: the visibility
 * rules below decide who can read a file, and they must be provable in
 * isolation.
 *
 * The tree is an adjacency list (`parentId` is the source of truth) plus a
 * materialized `path`. The path is what turns cycle detection and subtree
 * queries into string comparisons instead of recursive CTEs.
 */

export const FOLDER_MAX_DEPTH = 10;
export const FOLDER_NAME_MAX = 120;

const CHAR_SLASH = 47;
const CHAR_BACKSLASH = 92;
const CHAR_DEL = 127;
const CHAR_FIRST_PRINTABLE = 32;

export interface FolderNode {
  id: string;
  parentId: string | null;
  visibility: DocumentVisibility;
}

/** A uuid with the dashes stripped — one path segment. */
export function folderSegment(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

/** '/<seg>/' for a root, parentPath + '<seg>/' for a child. Includes self. */
export function buildFolderPath(
  parentPath: string | null,
  id: string,
): string {
  return `${parentPath ?? "/"}${folderSegment(id)}/`;
}

/** Segment count. Cheaper and more honest than re-deriving from the parent. */
export function depthFromPath(path: string): number {
  let n = 0;
  for (const part of path.split("/")) if (part.length > 0) n += 1;
  return n;
}

/** Strict descendant — a folder is not its own descendant. */
export function isDescendantPath(path: string, ancestorPath: string): boolean {
  return path !== ancestorPath && path.startsWith(ancestorPath);
}

/**
 * Would moving the folder at `movingPath` under `newParentPath` create a loop?
 *
 * Because every path contains its own id as the last segment, "the new parent
 * is inside the subtree I am moving" and "the new parent IS me" are the same
 * check — a prefix match. That single comparison replaces a recursive walk,
 * and unlike a walk it cannot be fooled by a partially-visited tree.
 */
export function wouldCreateCycle(
  movingPath: string,
  newParentPath: string | null,
): boolean {
  if (newParentPath === null) return false;
  return newParentPath.startsWith(movingPath);
}

/** Re-root a descendant path when its ancestor moves. */
export function rewritePath(
  path: string,
  oldPrefix: string,
  newPrefix: string,
): string {
  if (!path.startsWith(oldPrefix)) return path;
  return newPrefix + path.slice(oldPrefix.length);
}

/**
 * Roll `visibility` down the ancestor chain.
 *
 * The rule: a folder is effectively owners-only if it declares itself so OR
 * any ancestor does. Restriction only ever tightens going down.
 *
 * The consequence worth stating, because a naive subtree UPDATE gets it
 * backwards: turning a mid-node back to 'members' must NOT re-open a
 * descendant that declares itself 'owners'. That descendant keeps its own
 * restriction. This function is why the recompute happens here and not in SQL.
 */
export function computeEffectiveVisibility(
  folders: readonly FolderNode[],
): Map<string, DocumentVisibility> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const resolved = new Map<string, DocumentVisibility>();

  function resolve(id: string, seen: Set<string>): DocumentVisibility {
    const cached = resolved.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    // An unknown parent is treated as a root: a folder can never become MORE
    // visible because a row is missing.
    if (!node) return "members";
    // Defensive only — the CHECK constraint and the move guard make cycles
    // unrepresentable. A corrupt row must not hang a request.
    if (seen.has(id)) return node.visibility;
    seen.add(id);

    const parentVisibility =
      node.parentId !== null && byId.has(node.parentId)
        ? resolve(node.parentId, seen)
        : "members";
    const effective: DocumentVisibility =
      node.visibility === "owners" || parentVisibility === "owners"
        ? "owners"
        : "members";
    resolved.set(id, effective);
    return effective;
  }

  for (const folder of folders) resolve(folder.id, new Set());
  return resolved;
}

/**
 * Trim, collapse runs of whitespace, and reject what a path segment can't
 * carry. Returns null when the name is unusable — callers map that to a typed
 * error, so the rule lives in one place and is testable without a database.
 *
 * Order matters. The whitespace collapse runs FIRST, so tab/CR/LF — the
 * characters that would be header injection once a name reaches
 * Content-Disposition on export — are turned into an ordinary space rather
 * than rejected. Pasting a name out of a spreadsheet should work. Every other
 * control character has no legitimate use in a folder name and is refused.
 *
 * Character codes rather than a regex, because the rejected set is mostly
 * unprintable and a regex literal for it is unreadable and easy to get wrong.
 */
export function normalizeFolderName(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length > FOLDER_NAME_MAX) return null;
  if (collapsed === "." || collapsed === "..") return null;
  for (let i = 0; i < collapsed.length; i += 1) {
    const code = collapsed.charCodeAt(i);
    if (code < CHAR_FIRST_PRINTABLE || code === CHAR_DEL) return null;
    if (code === CHAR_SLASH || code === CHAR_BACKSLASH) return null;
  }
  return collapsed;
}

/** Case-insensitive uniqueness key. Stored, so the DB index can enforce it. */
export function folderNameKey(name: string): string {
  return name.toLowerCase();
}
