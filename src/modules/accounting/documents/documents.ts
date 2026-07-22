import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { LedgerError, type LedgerCtx } from "../core";

const LIST_LIMIT = 200;

export type DocumentTab = "inbox" | "filed" | "trash";

export async function loadDocument(
  tx: Tx,
  tenantId: string,
  documentId: string,
) {
  const doc = await tx.query.documents.findFirst({
    where: and(
      eq(schema.documents.tenantId, tenantId),
      eq(schema.documents.id, documentId),
    ),
  });
  if (!doc) throw new LedgerError("DOCUMENT_NOT_FOUND", documentId);
  return doc;
}

export async function listDocuments(
  tx: Tx,
  tenantId: string,
  tab: DocumentTab,
) {
  return tx.query.documents.findMany({
    where: and(
      eq(schema.documents.tenantId, tenantId),
      eq(
        schema.documents.status,
        tab === "trash" ? "trashed" : tab,
      ),
    ),
    orderBy: [desc(schema.documents.createdAt)],
    limit: LIST_LIMIT,
  });
}

export async function countDocumentLinks(
  tx: Tx,
  tenantId: string,
  documentId: string,
): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.documentLinks)
    .where(
      and(
        eq(schema.documentLinks.tenantId, tenantId),
        eq(schema.documentLinks.documentId, documentId),
      ),
    );
  return rows[0]?.n ?? 0;
}

/**
 * Soft-delete only — no blob is ever deleted in this module. A document
 * still attached to a record cannot be trashed (detach first); the paper
 * trail on posted records survives by construction.
 */
export async function trashDocument(
  tx: Tx,
  ctx: LedgerCtx,
  args: { documentId: string; expectedVersion: number },
) {
  const doc = await loadDocument(tx, ctx.tenantId, args.documentId);
  if (doc.status === "trashed") {
    throw new LedgerError("DOCUMENT_TRASHED", doc.id);
  }
  const links = await countDocumentLinks(tx, ctx.tenantId, doc.id);
  if (links > 0) {
    throw new LedgerError("DOCUMENT_HAS_LINKS", doc.id, { links });
  }
  const updated = await tx
    .update(schema.documents)
    .set({
      status: "trashed",
      trashedAt: new Date(),
      version: sql`${schema.documents.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        eq(schema.documents.id, doc.id),
        eq(schema.documents.version, args.expectedVersion),
      ),
    )
    .returning();
  if (updated.length === 0) {
    throw new LedgerError("STALE_VERSION", doc.id);
  }
  return updated[0];
}

/** Trash is recoverable; a restored document returns to the inbox. */
export async function restoreDocument(
  tx: Tx,
  ctx: LedgerCtx,
  args: { documentId: string; expectedVersion: number },
) {
  const doc = await loadDocument(tx, ctx.tenantId, args.documentId);
  if (doc.status !== "trashed") return doc;
  const updated = await tx
    .update(schema.documents)
    .set({
      status: "inbox",
      trashedAt: null,
      version: sql`${schema.documents.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        eq(schema.documents.id, doc.id),
        eq(schema.documents.version, args.expectedVersion),
      ),
    )
    .returning();
  if (updated.length === 0) {
    throw new LedgerError("STALE_VERSION", doc.id);
  }
  return updated[0];
}
