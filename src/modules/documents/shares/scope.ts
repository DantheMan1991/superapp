import type { DocumentVisibility } from "@/db/schema";

/**
 * What a share is allowed to expose.
 *
 * The governing rule, and the reason this is a pure function with its own
 * tests rather than a WHERE clause:
 *
 *   A share NEVER exposes a subtree more restrictive than its own root.
 *
 * A share is a deliberate override of internal visibility for an outside
 * party — otherwise an owners-only folder could never be shared at all. But it
 * must not WIDEN. So a link rooted at an ordinary folder prunes any
 * owners-only subtree beneath it, while a link an owner rooted directly at an
 * owners-only folder carries everything below it.
 *
 * Evaluated at read time, not frozen at creation, so files added to a shared
 * folder afterwards appear (the point of sharing a folder) and a subfolder
 * later marked private silently drops out.
 */

export interface ScopeRoot {
  kind: "document" | "folder";
  /** For folder scope: the root's materialized path. */
  path: string | null;
  visibility: DocumentVisibility;
}

export interface ScopeCandidate {
  documentId: string;
  folderId: string | null;
  /** The document's own effective visibility (denormalized from its folder). */
  visibility: DocumentVisibility;
  /** The containing folder's path; null for unfiled documents. */
  folderPath: string | null;
}

/**
 * Is this document inside the share, given the root's visibility?
 *
 * The prefix test is on the materialized path, so "/jobs/12/" does not match
 * "/jobs/123/" — every path ends in a separator, which is what makes prefix
 * matching safe here.
 */
export function isWithinScope(
  root: ScopeRoot,
  sharedDocumentId: string | null,
  candidate: ScopeCandidate,
): boolean {
  if (root.kind === "document") {
    return candidate.documentId === sharedDocumentId;
  }
  if (root.path === null || candidate.folderPath === null) return false;
  if (!candidate.folderPath.startsWith(root.path)) return false;

  // The pruning rule. An ordinary-root share cannot reach into a restricted
  // subtree; an owners-root share already covers everything beneath it.
  if (root.visibility === "members" && candidate.visibility === "owners") {
    return false;
  }
  return true;
}

export interface ScopeFolder {
  id: string;
  path: string;
  name: string;
  visibility: DocumentVisibility;
}

/**
 * Subfolders a recipient may see listed. Pruned subtrees must not leak their
 * NAMES either, so this filters the listing rather than only the file streams.
 */
export function visibleSubfolders(
  root: ScopeRoot,
  folders: readonly ScopeFolder[],
): ScopeFolder[] {
  const rootPath = root.path;
  if (root.kind !== "folder" || rootPath === null) return [];
  return folders.filter((folder) => {
    if (folder.path === rootPath) return false;
    if (!folder.path.startsWith(rootPath)) return false;
    if (root.visibility === "members" && folder.visibility === "owners") {
      return false;
    }
    return true;
  });
}
