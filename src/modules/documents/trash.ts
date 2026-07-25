import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/**
 * Trashed DMS documents.
 *
 * Scoped to origin: a trashed receipt belongs to the Receipts trash tab, which
 * has its own surface and its own restore path. Showing it in both places
 * would mean two buttons that fight over the same row.
 *
 * Nothing here deletes a blob — trash is reversible and the retention rule for
 * this module is that stored bytes are never destroyed.
 */
export async function listTrashedDocuments(tx: Tx, tenantId: string, limit = 200) {
  return tx
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      fileName: schema.documents.fileName,
      sizeBytes: schema.documents.sizeBytes,
      folderId: schema.documents.folderId,
      trashedAt: schema.documents.trashedAt,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        eq(schema.documents.origin, "dms"),
        eq(schema.documents.status, "trashed"),
      ),
    )
    .orderBy(desc(schema.documents.trashedAt))
    .limit(limit);
}
