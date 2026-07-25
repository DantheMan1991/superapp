import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import type { DocumentShare, DocumentVisibility } from "@/db/schema";
import { visibleSubfolders, type ScopeFolder, type ScopeRoot } from "./scope";

/**
 * What a recipient of a link actually gets to see.
 *
 * Read at role "staff" (the default), so RLS has already removed anything
 * owners-only before the scope rules run — the pruning below is the second
 * layer, not the only one.
 */

export interface SharedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderPath: string | null;
}

export interface SharedContents {
  rootName: string;
  files: SharedFile[];
  folders: Array<{ id: string; name: string; path: string }>;
}

export async function loadSharedContents(
  share: DocumentShare,
): Promise<SharedContents | null> {
  return withTenant(share.tenantId, async (tx) => {
    if (share.documentId) {
      const doc = await tx.query.documents.findFirst({
        where: and(
          eq(schema.documents.tenantId, share.tenantId),
          eq(schema.documents.id, share.documentId),
        ),
      });
      if (!doc || doc.status === "trashed") return null;
      return {
        rootName: doc.title || doc.fileName,
        files: [
          {
            id: doc.id,
            name: doc.title || doc.fileName,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            folderPath: null,
          },
        ],
        folders: [],
      };
    }

    const root = await tx.query.documentFolders.findFirst({
      where: and(
        eq(schema.documentFolders.tenantId, share.tenantId),
        eq(schema.documentFolders.id, share.folderId ?? ""),
      ),
    });
    if (!root) return null;

    const descendants = await tx
      .select({
        id: schema.documentFolders.id,
        name: schema.documentFolders.name,
        path: schema.documentFolders.path,
        visibility: schema.documentFolders.effectiveVisibility,
      })
      .from(schema.documentFolders)
      .where(
        and(
          eq(schema.documentFolders.tenantId, share.tenantId),
          sql`${schema.documentFolders.path} like ${`${root.path}%`}`,
        ),
      )
      .orderBy(asc(schema.documentFolders.path));

    const scopeRoot: ScopeRoot = {
      kind: "folder",
      path: root.path,
      visibility: root.effectiveVisibility as DocumentVisibility,
    };
    const folders = visibleSubfolders(
      scopeRoot,
      descendants as ScopeFolder[],
    ).map((f) => ({ id: f.id, name: f.name, path: f.path }));

    // Files anywhere in the surviving subtree, including the root itself.
    const allowedFolderIds = [root.id, ...folders.map((f) => f.id)];
    const files = await tx
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        fileName: schema.documents.fileName,
        mimeType: schema.documents.mimeType,
        sizeBytes: schema.documents.sizeBytes,
        folderId: schema.documents.folderId,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, share.tenantId),
          ne(schema.documents.status, "trashed"),
          // inArray, not a raw `= any($1)`: the sql template would pass the
          // JS array as a single parameter and Postgres would try to parse it
          // as an array literal.
          inArray(schema.documents.folderId, allowedFolderIds),
        ),
      )
      .orderBy(desc(schema.documents.createdAt))
      .limit(500);

    const pathById = new Map(folders.map((f) => [f.id, f.path]));
    pathById.set(root.id, root.path);

    return {
      rootName: root.name,
      files: files.map((f) => ({
        id: f.id,
        name: f.title || f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        folderPath: f.folderId ? (pathById.get(f.folderId) ?? null) : null,
      })),
      folders,
    };
  });
}

/**
 * Is this document inside this share? Re-checked on EVERY file request rather
 * than trusted from the listing — the listing is a render, this is the gate.
 */
export async function resolveSharedFile(
  share: DocumentShare,
  documentId: string,
): Promise<{
  blobPathname: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
} | null> {
  return withTenant(share.tenantId, async (tx) => {
    const doc = await tx.query.documents.findFirst({
      where: and(
        eq(schema.documents.tenantId, share.tenantId),
        eq(schema.documents.id, documentId),
      ),
    });
    if (!doc || doc.status === "trashed" || !doc.blobPathname) return null;

    if (share.documentId) {
      if (doc.id !== share.documentId) return null;
    } else {
      if (!doc.folderId) return null;
      const root = await tx.query.documentFolders.findFirst({
        where: and(
          eq(schema.documentFolders.tenantId, share.tenantId),
          eq(schema.documentFolders.id, share.folderId ?? ""),
        ),
      });
      const holder = await tx.query.documentFolders.findFirst({
        where: and(
          eq(schema.documentFolders.tenantId, share.tenantId),
          eq(schema.documentFolders.id, doc.folderId),
        ),
      });
      if (!root || !holder) return null;
      // Prefix match on the materialized path: every path ends in a
      // separator, so "/jobs/12/" cannot match "/jobs/123/".
      if (!holder.path.startsWith(root.path)) return null;
      if (
        root.effectiveVisibility === "members" &&
        holder.effectiveVisibility === "owners"
      ) {
        return null;
      }
    }

    return {
      blobPathname: doc.blobPathname,
      mimeType: doc.mimeType,
      fileName: doc.fileName,
      sizeBytes: doc.sizeBytes,
    };
  });
}
