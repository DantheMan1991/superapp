import "server-only";
import { and, asc, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DocumentFolder } from "@/db/schema";
import { clampPageSize, parseCursor, takePage } from "./core/paging";

/**
 * The browse read model: what one folder contains.
 *
 * Subfolders are fetched whole (a folder with hundreds of direct children is
 * not a real case) while documents are paged with a keyset cursor, because a
 * folder genuinely can hold thousands of files and receives new ones while
 * someone is scrolling.
 */

export interface BrowseDocument {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  origin: string;
  tags: string[];
  fileVersionNo: number;
  fileVersionCount: number;
  /** Optimistic-concurrency counter, for the edit dialogs. */
  version: number;
  createdAt: Date;
}

export interface FolderContents {
  subfolders: DocumentFolder[];
  documents: BrowseDocument[];
  nextCursor: string | null;
}

export async function listFolderContents(
  tx: Tx,
  tenantId: string,
  input: { folderId: string | null; cursor?: string; limit?: number },
): Promise<FolderContents> {
  const limit = clampPageSize(input.limit);
  const cursor = parseCursor(input.cursor);

  const subfolders = await tx
    .select()
    .from(schema.documentFolders)
    .where(
      and(
        eq(schema.documentFolders.tenantId, tenantId),
        input.folderId === null
          ? isNull(schema.documentFolders.parentId)
          : eq(schema.documentFolders.parentId, input.folderId),
      ),
    )
    .orderBy(
      asc(schema.documentFolders.sortOrder),
      asc(schema.documentFolders.nameKey),
    );

  // Keyset on (created_at DESC, id DESC) — the tie-break on id is what makes
  // the cursor total, so two documents created in the same millisecond cannot
  // hide each other across a page boundary.
  const rows = await tx
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      fileName: schema.documents.fileName,
      mimeType: schema.documents.mimeType,
      sizeBytes: schema.documents.sizeBytes,
      origin: schema.documents.origin,
      tags: schema.documents.tags,
      fileVersionNo: schema.documents.fileVersionNo,
      fileVersionCount: schema.documents.fileVersionCount,
      version: schema.documents.version,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        input.folderId === null
          ? isNull(schema.documents.folderId)
          : eq(schema.documents.folderId, input.folderId),
        ne(schema.documents.status, "trashed"),
        cursor
          ? or(
              lt(schema.documents.createdAt, cursor.createdAt),
              and(
                eq(schema.documents.createdAt, cursor.createdAt),
                lt(schema.documents.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.documents.createdAt), desc(schema.documents.id))
    .limit(limit + 1);

  const page = takePage(rows, limit);
  return {
    subfolders,
    documents: page.items,
    nextCursor: page.nextCursor,
  };
}

/**
 * Ancestors of a folder, root first, for the breadcrumb.
 *
 * One query using the materialized path: every ancestor's path is a prefix of
 * this folder's. That is the whole reason the path exists — the alternative is
 * a recursive CTE or one query per level.
 */
export async function loadAncestors(
  tx: Tx,
  tenantId: string,
  folder: DocumentFolder,
): Promise<DocumentFolder[]> {
  const rows = await tx
    .select()
    .from(schema.documentFolders)
    .where(
      and(
        eq(schema.documentFolders.tenantId, tenantId),
        sql`${folder.path} like ${schema.documentFolders.path} || '%'`,
        ne(schema.documentFolders.id, folder.id),
      ),
    )
    .orderBy(asc(schema.documentFolders.depth));
  return rows;
}

export async function loadFolderById(
  tx: Tx,
  tenantId: string,
  folderId: string,
): Promise<DocumentFolder | null> {
  const folder = await tx.query.documentFolders.findFirst({
    where: and(
      eq(schema.documentFolders.tenantId, tenantId),
      eq(schema.documentFolders.id, folderId),
    ),
  });
  return folder ?? null;
}
