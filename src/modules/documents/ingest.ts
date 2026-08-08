import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { get, head } from "@vercel/blob";
import { schema, type Tx } from "@/db";
import type { Document, DocumentVisibility } from "@/db/schema";
import {
  assertBlobConfigured,
  blobToken,
  dmsPathPrefix,
  isTenantBlobPath,
} from "@/lib/blob";
import { DocsError } from "./core/errors";
import { isAllowedUpload } from "./allowlist";
import type { TextExtractionState } from "./text/state";
import type { DocsCtx } from "./folder-ops";

/**
 * Document ingestion for the DMS. The module owns its own copy rather than
 * importing the accounting one, so a tenant without accounting still has a
 * working filing cabinet — the boundary rule for this module is that nothing
 * under src/modules/documents/ may import from src/modules/accounting/.
 *
 * The shape is the house one: blob work OUTSIDE any transaction (network calls
 * must never hold one open), then the row inside the caller's withTenant.
 */

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Exported for the spreadsheet preview, which parses the bytes server-side. */
export async function readBlobBytes(pathname: string): Promise<Uint8Array> {
  const result = await get(pathname, { access: "private", token: blobToken() });
  if (!result || result.statusCode !== 200) {
    throw new DocsError("DOCUMENT_NOT_FOUND", `blob missing: ${pathname}`);
  }
  const buf = await new Response(result.stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Undo `addRandomSuffix` for display.
 *
 * The presigned upload asks the store for a random suffix so two people
 * uploading `invoice.pdf` cannot collide — that suffix belongs in the STORAGE
 * key and nowhere else. Reading the stored name straight off the pathname put
 * it in front of the user: a file uploaded as `Invoice 3000 (1).pdf` listed as
 * `Invoice 3000 (1)-A76EZtxEuYMtCeXMNHHj.pdf`.
 *
 * Vercel Blob's suffix is a hyphen plus a fixed-length alphanumeric run
 * immediately before the extension, so it is removable without guessing. A
 * name that does not match that shape is returned untouched — a real file
 * called `report-2026Q1.pdf` must survive.
 */
export function displayNameFromBlobPath(base: string): string {
  const dot = base.lastIndexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? "" : base.slice(dot);
  // The store uses a 20+ character suffix; requiring that length keeps a
  // hyphenated word like "as-built" or a date like "2026-01" safe.
  const stripped = stem.replace(/-[A-Za-z0-9]{20,}$/, "");
  return stripped.length > 0 ? `${stripped}${ext}` : base;
}

export interface InspectedUpload {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * The inspection plus the bytes it already had in hand.
 *
 * Separate from `InspectedUpload` so the bytes travel only where they are
 * wanted: `AddVersionInput` extends the smaller shape and is stored in a row,
 * and a megabyte of file riding along in a struct nobody reads is the kind of
 * thing that quietly ends up logged.
 */
export interface InspectedUploadWithBytes extends InspectedUpload {
  bytes: Uint8Array;
}

/**
 * Upload part 2 (part 1 is the client-direct blob upload): prove the blob is
 * really in this tenant's namespace, re-apply the allowlist to the blob's REAL
 * metadata rather than whatever the client claimed, and hash the actual bytes.
 *
 * The client-side check before upload is a courtesy that saves a round trip.
 * This is the check that counts.
 *
 * RETURNS THE BYTES it downloaded to hash, which it used to discard. Text
 * extraction needs exactly those bytes, so handing them back is what makes
 * indexing a file's contents cost a parse rather than a second download of
 * something up to 100MB. Callers that only want the metadata destructure past
 * them; nothing persists this field.
 */
export async function inspectUploadedBlob(
  tenantId: string,
  pathname: string,
): Promise<InspectedUploadWithBytes> {
  assertBlobConfigured();
  // Re-checked here as well as at token issuance: registration is a separate
  // request and must not trust that the earlier gate ran.
  if (
    !pathname.startsWith(dmsPathPrefix(tenantId, "files")) ||
    !isTenantBlobPath(tenantId, pathname)
  ) {
    throw new DocsError(
      "DOCUMENT_UPLOAD_INVALID",
      "pathname outside tenant namespace",
    );
  }
  let meta;
  try {
    meta = await head(pathname, { token: blobToken() });
  } catch {
    throw new DocsError("DOCUMENT_NOT_FOUND", `blob missing: ${pathname}`);
  }
  if (!isAllowedUpload(meta.contentType ?? "", meta.size)) {
    throw new DocsError(
      "DOCUMENT_UPLOAD_INVALID",
      `type=${meta.contentType} size=${meta.size}`,
    );
  }
  const bytes = await readBlobBytes(pathname);
  const base = pathname.slice(pathname.lastIndexOf("/") + 1);
  return {
    fileName: displayNameFromBlobPath(base),
    mimeType: meta.contentType ?? "",
    sizeBytes: meta.size,
    sha256: sha256Hex(bytes),
    bytes,
  };
}

export interface RegisterInput extends InspectedUpload {
  /** The blob's real location — the global partial unique key. */
  blobPathname: string;
  folderId: string | null;
  title: string;
  description: string;
  /** Already read from the bytes by the caller — see `text/extract.ts`. */
  extractedText: string;
  textExtraction: TextExtractionState;
}

export interface RegisterResult {
  document: Document;
  /** Most recent live DMS file with identical content — warn, never block. */
  duplicateOfId: string | null;
}

export async function createDmsDocument(
  tx: Tx,
  ctx: DocsCtx,
  input: RegisterInput,
): Promise<RegisterResult> {
  // A document inherits its folder's visibility at the moment it is filed;
  // afterwards recomputeVisibility owns the column. Unfiled documents sit in
  // the Inbox and are visible to members.
  let effectiveVisibility: DocumentVisibility = "members";
  if (input.folderId !== null) {
    const folder = await tx.query.documentFolders.findFirst({
      where: and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        eq(schema.documentFolders.id, input.folderId),
      ),
    });
    if (!folder) throw new DocsError("FOLDER_NOT_FOUND", "folder not visible");
    effectiveVisibility = folder.effectiveVisibility as DocumentVisibility;
  }

  // Scoped to origin: a DMS upload must never be reported as a duplicate of a
  // receipt, and vice versa. The two surfaces share a table, not a namespace.
  const duplicate =
    input.sha256 !== ""
      ? await tx.query.documents.findFirst({
          where: and(
            eq(schema.documents.tenantId, ctx.tenantId),
            eq(schema.documents.origin, "dms"),
            eq(schema.documents.sha256, input.sha256),
            ne(schema.documents.status, "trashed"),
          ),
          orderBy: [desc(schema.documents.createdAt)],
        })
      : undefined;

  const inserted = await tx
    .insert(schema.documents)
    .values({
      tenantId: ctx.tenantId,
      origin: "dms",
      folderId: input.folderId,
      filedAt: input.folderId === null ? null : new Date(),
      effectiveVisibility,
      blobPathname: input.blobPathname,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      source: "upload",
      title: input.title,
      description: input.description,
      uploadedByClerkUserId: ctx.userId,
      // The ACCOUNTING AI status, which stays 'skipped' — a filing-cabinet
      // upload is not a receipt and no model looks at it. Not to be confused
      // with `textExtraction` below, which is the search-index one; they are
      // different questions about the same file and were conflated in review
      // once already.
      extractionStatus: "skipped",
      extractedText: input.extractedText,
      textExtraction: input.textExtraction,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return { document: inserted[0], duplicateOfId: duplicate?.id ?? null };
  }

  // The global partial unique on blob_pathname arbitrates a double
  // registration (double-click, retry): the row already exists, return it.
  const existing = await tx.query.documents.findFirst({
    where: and(
      eq(schema.documents.tenantId, ctx.tenantId),
      eq(schema.documents.blobPathname, input.blobPathname),
    ),
  });
  if (!existing) {
    throw new DocsError(
      "DOCUMENT_NOT_FOUND",
      "conflicting registration vanished",
    );
  }
  return { document: existing, duplicateOfId: duplicate?.id ?? null };
}
