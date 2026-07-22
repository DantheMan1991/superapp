import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { get, head, put } from "@vercel/blob";
import { schema, type Tx } from "@/db";
import { assertBlobConfigured, receiptPathPrefix } from "@/lib/blob";
import { LedgerError, type LedgerCtx } from "../core";
import { isAllowedUpload } from "./allowlist";

/**
 * Channel-agnostic document ingestion. Both capture paths — client-direct
 * upload and inbound email — land here: blob first (outside any tx), then
 * `createDocumentRecord` inside the caller's withTenant transaction.
 */

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readBlobBytes(pathname: string): Promise<Uint8Array> {
  assertBlobConfigured();
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) {
    throw new LedgerError("DOCUMENT_NOT_FOUND", `blob missing: ${pathname}`);
  }
  const buf = await new Response(result.stream).arrayBuffer();
  return new Uint8Array(buf);
}

export interface NewDocumentInput {
  blobPathname: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  source: "upload" | "email";
  uploadedByClerkUserId?: string | null;
  emailFrom?: string;
  emailSubject?: string;
  emailMessageId?: string;
  emailReceivedAt?: Date | null;
  /** No-attachment provenance rows skip extraction outright. */
  extractionStatus?: "pending" | "skipped";
}

export interface IngestResult {
  document: typeof schema.documents.$inferSelect;
  /** Most recent other doc with the same content hash — warn, never block. */
  duplicateOfId: string | null;
}

/**
 * Insert the document row + content-hash duplicate lookup, in the
 * caller's transaction. The global partial unique on blob_pathname
 * arbitrates double-registration races (onConflictDoNothing + reselect —
 * never catch-and-reselect inside a tx).
 */
export async function createDocumentRecord(
  tx: Tx,
  tenantId: string,
  input: NewDocumentInput,
): Promise<IngestResult> {
  const duplicate =
    input.sha256 !== ""
      ? await tx.query.documents.findFirst({
          where: and(
            eq(schema.documents.tenantId, tenantId),
            eq(schema.documents.sha256, input.sha256),
            ne(schema.documents.status, "trashed"),
          ),
          orderBy: [desc(schema.documents.createdAt)],
        })
      : undefined;

  const inserted = await tx
    .insert(schema.documents)
    .values({
      tenantId,
      blobPathname: input.blobPathname,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      source: input.source,
      uploadedByClerkUserId: input.uploadedByClerkUserId ?? null,
      emailFrom: input.emailFrom ?? "",
      emailSubject: input.emailSubject ?? "",
      emailMessageId: input.emailMessageId ?? "",
      emailReceivedAt: input.emailReceivedAt ?? null,
      extractionStatus: input.extractionStatus ?? "pending",
    })
    // Bare form (house precedent): the only possible conflict here is the
    // global blob_pathname partial unique — the pk is random.
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return { document: inserted[0], duplicateOfId: duplicate?.id ?? null };
  }
  // Same pathname already registered (double-click/retry) — return it.
  const existing = await tx.query.documents.findFirst({
    where: and(
      eq(schema.documents.tenantId, tenantId),
      eq(schema.documents.blobPathname, input.blobPathname ?? ""),
    ),
  });
  if (!existing) {
    throw new LedgerError(
      "DOCUMENT_NOT_FOUND",
      "conflicting registration vanished",
    );
  }
  return { document: existing, duplicateOfId: duplicate?.id ?? null };
}

/**
 * Upload path, part 2 (part 1 is the client-direct blob upload): verify
 * the blob really lives in the caller's tenant namespace and passes the
 * allowlist, hash the ACTUAL bytes server-side (never a client claim),
 * then insert. The blob read happens before the caller opens its tx.
 */
export async function inspectUploadedBlob(
  ctx: LedgerCtx,
  pathname: string,
): Promise<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}> {
  assertBlobConfigured();
  if (!pathname.startsWith(receiptPathPrefix(ctx.tenantId))) {
    throw new LedgerError(
      "DOCUMENT_UPLOAD_INVALID",
      "pathname outside tenant namespace",
    );
  }
  let meta;
  try {
    meta = await head(pathname);
  } catch {
    throw new LedgerError("DOCUMENT_NOT_FOUND", `blob missing: ${pathname}`);
  }
  if (!isAllowedUpload(meta.contentType ?? "", meta.size)) {
    throw new LedgerError(
      "DOCUMENT_UPLOAD_INVALID",
      `type=${meta.contentType} size=${meta.size}`,
    );
  }
  const bytes = await readBlobBytes(pathname);
  const base = pathname.slice(pathname.lastIndexOf("/") + 1);
  return {
    fileName: base,
    mimeType: meta.contentType ?? "",
    sizeBytes: meta.size,
    sha256: sha256Hex(bytes),
  };
}

/**
 * Email path, blob step: store fetched attachment bytes privately under
 * the tenant's namespace. Runs OUTSIDE any tx (network call).
 */
export async function storeEmailAttachment(
  tenantId: string,
  fileName: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<string> {
  assertBlobConfigured();
  const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "attachment";
  const result = await put(
    `${receiptPathPrefix(tenantId)}${safeName}`,
    Buffer.from(bytes),
    {
      access: "private",
      addRandomSuffix: true,
      contentType,
    },
  );
  return result.pathname;
}
