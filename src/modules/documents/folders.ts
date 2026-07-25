import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DocumentFolder } from "@/db/schema";

/**
 * Folder reads. Every one of these runs inside a withTenant transaction, so
 * RLS has already removed folders the caller may not see — owners-only folders
 * simply do not come back for staff, and no query here carries a visibility
 * predicate of its own.
 *
 * The whole tree is loaded in one query on purpose: trees are tens to hundreds
 * of rows, and having them all in memory is what lets the pure functions in
 * core/tree.ts do the work instead of recursive SQL.
 */

export async function listFolders(
  tx: Tx,
  tenantId: string,
): Promise<DocumentFolder[]> {
  return tx
    .select()
    .from(schema.documentFolders)
    .where(eq(schema.documentFolders.tenantId, tenantId))
    .orderBy(
      asc(schema.documentFolders.depth),
      asc(schema.documentFolders.sortOrder),
      asc(schema.documentFolders.nameKey),
    );
}

export interface FolderCounts {
  /** Live documents per folder id. */
  byFolder: Map<string, number>;
  /** Live documents not filed into any folder — the Inbox. */
  inbox: number;
}

/**
 * Counts every live document, whatever its origin: an emailed receipt sitting
 * unfiled is exactly what the Inbox is for, and a receipt filed into
 * /Suppliers/Acme belongs in that folder's count. This is the one place the
 * "one cabinet, two surfaces" decision is visible in a query.
 */
export async function countDocumentsByFolder(
  tx: Tx,
  tenantId: string,
): Promise<FolderCounts> {
  const rows = await tx
    .select({
      folderId: schema.documents.folderId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        ne(schema.documents.status, "trashed"),
      ),
    )
    .groupBy(schema.documents.folderId);

  const byFolder = new Map<string, number>();
  let inbox = 0;
  for (const row of rows) {
    if (row.folderId === null) inbox = row.n;
    else byFolder.set(row.folderId, row.n);
  }
  return { byFolder, inbox };
}

/**
 * The tenant's module settings. Member-readable but never member-writable —
 * the share TTL ceiling and the AI budget are platform-governed knobs.
 */
export async function loadDocumentSettings(tx: Tx, tenantId: string) {
  return tx.query.documentSettings.findFirst({
    where: eq(schema.documentSettings.tenantId, tenantId),
  });
}

/** Root folders only — the top level of the cabinet. */
export async function listRootFolders(
  tx: Tx,
  tenantId: string,
): Promise<DocumentFolder[]> {
  return tx
    .select()
    .from(schema.documentFolders)
    .where(
      and(
        eq(schema.documentFolders.tenantId, tenantId),
        isNull(schema.documentFolders.parentId),
      ),
    )
    .orderBy(
      asc(schema.documentFolders.sortOrder),
      asc(schema.documentFolders.nameKey),
    );
}
