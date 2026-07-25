import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Document, DocumentVersion } from "@/db/schema";
import { DocsError } from "./core/errors";
import type { DocsCtx } from "./folder-ops";
import type { InspectedUpload } from "./ingest";

/**
 * File revision history.
 *
 * The model: `documents` always describes the CURRENT bytes (blob_pathname,
 * file_name, mime_type, size, sha256) and `document_versions` is the log of
 * every set of bytes the document has ever had, including the current one.
 * Nothing here ever deletes a row or a blob — a version is superseded, never
 * replaced.
 *
 * Two invariants are the database's job, not this file's: exactly one
 * `is_current` row per document (partial unique) and version numbers unique
 * per document. This code is written so that a race loses a transaction rather
 * than corrupting the history.
 */

/** What the caller may attach to a new revision. */
export interface AddVersionInput extends InspectedUpload {
  blobPathname: string;
  note: string;
}

export interface AddVersionResult {
  document: Document;
  version: DocumentVersion;
  /** The new bytes are identical to the version they replaced — warn, never block. */
  sameAsCurrent: boolean;
}

/**
 * Load a document for a version write, taking a row lock.
 *
 * FOR UPDATE serializes two people replacing the same file at the same moment.
 * Without it both would read the same `max(version_no)` and the loser would hit
 * the unique index with a confusing error; with it they queue and become v2 and
 * v3, which is what "append a revision" should mean. One row, so unlike the
 * folder tree's coarse lock there is nothing to order against a deadlock.
 */
async function lockDocument(
  tx: Tx,
  ctx: DocsCtx,
  documentId: string,
): Promise<Document> {
  // RLS applies to SELECT ... FOR UPDATE, so a staff caller locking an
  // owners-only document simply finds nothing.
  const locked = await tx.execute(
    sql`select id from documents
         where tenant_id = ${ctx.tenantId} and id = ${documentId}
         for update`,
  );
  if ((locked.rows ?? []).length === 0) {
    throw new DocsError("DOCUMENT_NOT_FOUND", "document not visible");
  }
  const doc = await tx.query.documents.findFirst({
    where: and(
      eq(schema.documents.tenantId, ctx.tenantId),
      eq(schema.documents.id, documentId),
    ),
  });
  if (!doc) throw new DocsError("DOCUMENT_NOT_FOUND", "document not visible");

  if (doc.status === "trashed") {
    throw new DocsError("DOCUMENT_TRASHED", "document is in the trash");
  }
  // Versioning is a filing-cabinet operation. A receipt's bytes are evidence
  // attached to a journal entry or a bill, and quietly swapping them would
  // rewrite what that transaction points at without the accounting module ever
  // knowing. The Receipts tool detaches and re-attaches instead.
  if (doc.origin !== "dms") {
    throw new DocsError("DOCUMENT_NOT_VERSIONABLE", `origin=${doc.origin}`);
  }
  if (!doc.blobPathname) {
    throw new DocsError("DOCUMENT_NOT_FOUND", "document has no file");
  }
  return doc;
}

/**
 * Ensure the document's CURRENT bytes have a history row, creating one from the
 * document's own columns if they do not.
 *
 * This is the load-bearing function in the file. Every document that predates
 * versioning — and every document created since, because `createDmsDocument`
 * deliberately does not write a history row for a file with no history — has
 * zero rows in `document_versions`. Appending v2 overwrites
 * `documents.blob_pathname`, so without this call the ORIGINAL blob would stop
 * being referenced by anything: still paid for, no longer reachable, and gone
 * from a history that would claim to be complete.
 *
 * Doing it lazily rather than backfilling in a migration means there is exactly
 * one code path that produces a v1 row, and it is the one every test exercises.
 * Idempotent: a document that already has history is left alone.
 */
async function materializeCurrentVersion(
  tx: Tx,
  ctx: DocsCtx,
  doc: Document,
): Promise<void> {
  const existing = await tx
    .select({ id: schema.documentVersions.id })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.tenantId, ctx.tenantId),
        eq(schema.documentVersions.documentId, doc.id),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  await tx.insert(schema.documentVersions).values({
    tenantId: ctx.tenantId,
    documentId: doc.id,
    // Not doc.fileVersionNo: a document with no history is at v1 by
    // definition, and trusting a counter that nothing has ever incremented
    // would let drift become a unique-index violation.
    versionNo: 1,
    blobPathname: doc.blobPathname ?? "",
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    sha256: doc.sha256,
    isCurrent: true,
    note: "",
    // The original uploader, not whoever happens to be adding v2.
    uploadedByClerkUserId: doc.uploadedByClerkUserId,
    createdAt: doc.createdAt,
  });
}

/** Highest version number on record. Zero when there is no history yet. */
async function maxVersionNo(
  tx: Tx,
  tenantId: string,
  documentId: string,
): Promise<number> {
  const [row] = await tx
    .select({ versionNo: schema.documentVersions.versionNo })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.tenantId, tenantId),
        eq(schema.documentVersions.documentId, documentId),
      ),
    )
    .orderBy(desc(schema.documentVersions.versionNo))
    .limit(1);
  return row?.versionNo ?? 0;
}

/**
 * Append a revision and make it current.
 *
 * Order matters: the old `is_current` flag is cleared BEFORE the new row is
 * inserted, because the partial unique index enforcing "exactly one current"
 * is not deferrable. Insert-then-clear would fail on the insert.
 */
export async function addDocumentVersion(
  tx: Tx,
  ctx: DocsCtx,
  documentId: string,
  input: AddVersionInput,
): Promise<AddVersionResult> {
  const doc = await lockDocument(tx, ctx, documentId);
  await materializeCurrentVersion(tx, ctx, doc);

  const nextNo = (await maxVersionNo(tx, ctx.tenantId, documentId)) + 1;
  const sameAsCurrent = input.sha256 !== "" && input.sha256 === doc.sha256;

  await tx
    .update(schema.documentVersions)
    .set({ isCurrent: false })
    .where(
      and(
        eq(schema.documentVersions.tenantId, ctx.tenantId),
        eq(schema.documentVersions.documentId, documentId),
        eq(schema.documentVersions.isCurrent, true),
      ),
    );

  const [version] = await tx
    .insert(schema.documentVersions)
    .values({
      tenantId: ctx.tenantId,
      documentId,
      versionNo: nextNo,
      blobPathname: input.blobPathname,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      isCurrent: true,
      note: input.note,
      uploadedByClerkUserId: ctx.userId,
    })
    .returning();

  const document = await promoteVersion(tx, ctx, doc, version);
  return { document, version, sameAsCurrent };
}

/**
 * Restore an earlier revision by appending it again as the newest one.
 *
 * The old row is never re-flagged and no bytes are copied: the new version
 * points at the SAME blob pathname, which is why `document_versions_blob_idx`
 * is deliberately not unique. History stays append-only, so "someone rolled
 * back to v2 on Tuesday" remains visible instead of being erased by the act of
 * rolling back.
 */
export async function restoreDocumentVersion(
  tx: Tx,
  ctx: DocsCtx,
  documentId: string,
  versionId: string,
): Promise<{ document: Document; version: DocumentVersion; sourceNo: number }> {
  const doc = await lockDocument(tx, ctx, documentId);
  await materializeCurrentVersion(tx, ctx, doc);

  const source = await tx.query.documentVersions.findFirst({
    where: and(
      eq(schema.documentVersions.tenantId, ctx.tenantId),
      eq(schema.documentVersions.documentId, documentId),
      eq(schema.documentVersions.id, versionId),
    ),
  });
  if (!source) throw new DocsError("VERSION_NOT_FOUND", "version not visible");
  if (source.isCurrent) {
    throw new DocsError("VERSION_ALREADY_CURRENT", `v${source.versionNo}`);
  }

  const nextNo = (await maxVersionNo(tx, ctx.tenantId, documentId)) + 1;

  await tx
    .update(schema.documentVersions)
    .set({ isCurrent: false })
    .where(
      and(
        eq(schema.documentVersions.tenantId, ctx.tenantId),
        eq(schema.documentVersions.documentId, documentId),
        eq(schema.documentVersions.isCurrent, true),
      ),
    );

  const [version] = await tx
    .insert(schema.documentVersions)
    .values({
      tenantId: ctx.tenantId,
      documentId,
      versionNo: nextNo,
      // Same bytes, same blob — no re-upload, no re-hash.
      blobPathname: source.blobPathname,
      fileName: source.fileName,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
      isCurrent: true,
      note: "",
      restoredFromVersionId: source.id,
      uploadedByClerkUserId: ctx.userId,
    })
    .returning();

  const document = await promoteVersion(tx, ctx, doc, version);
  return { document, version, sourceNo: source.versionNo };
}

/**
 * Point the document at a version's bytes.
 *
 * `title` is untouched on purpose: it is the human's label for the thing, not
 * for the file, so "Kitchen elevation" survives a revision that arrives named
 * `scan_0042.pdf`. `file_name` DOES follow the current version, so downloads
 * and the search index describe the bytes actually being served.
 */
async function promoteVersion(
  tx: Tx,
  ctx: DocsCtx,
  doc: Document,
  version: DocumentVersion,
): Promise<Document> {
  const [updated] = await tx
    .update(schema.documents)
    .set({
      blobPathname: version.blobPathname,
      fileName: version.fileName,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
      sha256: version.sha256,
      fileVersionNo: version.versionNo,
      fileVersionCount: version.versionNo,
      // The optimistic-concurrency counter, which is NOT the revision number —
      // bumped so an edit dialog opened before this replacement is refused.
      version: doc.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        eq(schema.documents.id, doc.id),
      ),
    )
    .returning();
  if (!updated) throw new DocsError("DOCUMENT_NOT_FOUND", "document vanished");
  return updated;
}

/** One row of the history panel. */
export interface VersionEntry {
  /**
   * Null for a document whose current bytes have never been superseded: there
   * is no history row yet, and `/api/documents/<id>/file` already serves it.
   */
  id: string | null;
  versionNo: number;
  fileName: string;
  sizeBytes: number;
  isCurrent: boolean;
  note: string;
  /** Resolved to a number so the panel can say "restored from v2". */
  restoredFromVersionNo: number | null;
  uploadedByClerkUserId: string | null;
  createdAt: Date;
}

/**
 * The history of one document, newest first.
 *
 * Synthesizes the single entry for a document with no history rows so callers
 * never have to special-case "never revised". RLS does the access control:
 * `document_versions`' policy inherits the parent document's visibility through
 * an EXISTS subquery, so a staff caller asking about an owners-only document
 * gets an empty list from the join and NOT_FOUND from the document lookup.
 */
export async function listDocumentVersions(
  tx: Tx,
  tenantId: string,
  documentId: string,
): Promise<VersionEntry[]> {
  const doc = await tx.query.documents.findFirst({
    where: and(
      eq(schema.documents.tenantId, tenantId),
      eq(schema.documents.id, documentId),
    ),
  });
  if (!doc) throw new DocsError("DOCUMENT_NOT_FOUND", "document not visible");

  const rows = await tx
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.tenantId, tenantId),
        eq(schema.documentVersions.documentId, documentId),
      ),
    )
    .orderBy(asc(schema.documentVersions.versionNo));

  if (rows.length === 0) {
    return [
      {
        id: null,
        versionNo: 1,
        fileName: doc.fileName,
        sizeBytes: doc.sizeBytes,
        isCurrent: true,
        note: "",
        restoredFromVersionNo: null,
        uploadedByClerkUserId: doc.uploadedByClerkUserId,
        createdAt: doc.createdAt,
      },
    ];
  }

  const noById = new Map(rows.map((r) => [r.id, r.versionNo]));
  return rows
    .map((r) => ({
      id: r.id,
      versionNo: r.versionNo,
      fileName: r.fileName,
      sizeBytes: r.sizeBytes,
      isCurrent: r.isCurrent,
      note: r.note,
      restoredFromVersionNo: r.restoredFromVersionId
        ? (noById.get(r.restoredFromVersionId) ?? null)
        : null,
      uploadedByClerkUserId: r.uploadedByClerkUserId,
      createdAt: r.createdAt,
    }))
    .reverse();
}
