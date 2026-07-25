import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { put } from "@vercel/blob";
import { schema, type Tx } from "@/db";
import type { DocumentFolder } from "@/db/schema";
import { assertBlobConfigured, blobToken, dmsPathPrefix } from "@/lib/blob";
import { buildInboundAddress } from "@/lib/inbound-address";
import { DocsError } from "./core/errors";
import { isAllowedUpload } from "./allowlist";

/**
 * Emailing files straight into a folder.
 *
 * A subcontractor sends revised drawings to the address on the job folder and
 * they file themselves — no login, no app, no attachment landing in somebody's
 * personal inbox. It is the highest-value half of the whole email idea and it
 * needs no paid sending plan, because receiving is already configured.
 *
 * It is also an ANONYMOUS WRITE surface: anyone who learns the address can put
 * files in that folder. The controls are the unguessable token, the per-folder
 * hourly cap, the upload allowlist, and the fact that the owner can rotate or
 * switch the address off at any moment.
 */

/** Per folder, per hour. Matches the receipts inbox's valve. */
export const FOLDER_INGEST_HOURLY_CAP = 100;

/**
 * 96 bits as 24 lowercase hex characters. Lowercase because email local-parts
 * are not case-preserved in transit — see lib/inbound-address.
 */
export function mintFolderToken(): string {
  return randomBytes(12).toString("hex");
}

export function folderInboundAddress(
  token: string,
  domain: string,
): string {
  return buildInboundAddress("docs", token, domain);
}

/**
 * Turn a token from an inbound address into the folder it belongs to.
 * Runs under withSystem in the webhook — it is the token→tenant hop, and like
 * the share-link resolver it does that and nothing else.
 */
export async function resolveFolderByToken(
  tx: Tx,
  token: string,
): Promise<DocumentFolder | null> {
  const folder = await tx.query.documentFolders.findFirst({
    where: eq(schema.documentFolders.inboundToken, token.toLowerCase()),
  });
  return folder ?? null;
}

/**
 * Refuse to deliver into a folder that has since become owners-only.
 *
 * The address was handed to an outsider when the folder was open to everyone.
 * If an owner later restricts it, continuing to accept mail there would let a
 * third party keep writing into a place the business has deliberately closed.
 * Same instinct as a share link suspending itself.
 */
export function acceptsInboundMail(folder: DocumentFolder): boolean {
  return (
    folder.inboundToken !== null && folder.effectiveVisibility === "members"
  );
}

export async function folderIngestCount(
  tx: Tx,
  tenantId: string,
  folderId: string,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        eq(schema.documents.folderId, folderId),
        eq(schema.documents.source, "email"),
        gte(schema.documents.createdAt, since),
      ),
    );
  return n;
}

/**
 * Store attachment bytes in the tenant's own blob namespace. Runs OUTSIDE any
 * transaction — network work never holds one open.
 */
export async function storeInboundAttachment(
  tenantId: string,
  fileName: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<string> {
  assertBlobConfigured();
  const safeName =
    fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "attachment";
  const result = await put(
    `${dmsPathPrefix(tenantId, "files")}${safeName}`,
    Buffer.from(bytes),
    {
      access: "private",
      addRandomSuffix: true,
      contentType,
      token: blobToken(),
    },
  );
  return result.pathname;
}

export interface InboundFileInput {
  blobPathname: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  emailFrom: string;
  emailSubject: string;
  emailMessageId: string;
  emailReceivedAt: Date | null;
}

/**
 * File an emailed attachment into a folder. Called inside the caller's
 * withTenant transaction.
 *
 * The document is created already filed — that is the entire point. A drawing
 * emailed to the job folder should be IN the job folder, not waiting in an
 * inbox for somebody to sort it.
 */
export async function createInboundDocument(
  tx: Tx,
  tenantId: string,
  folder: DocumentFolder,
  input: InboundFileInput,
): Promise<{ documentId: string } | null> {
  if (!isAllowedUpload(input.mimeType, input.sizeBytes)) return null;

  const rows = await tx
    .insert(schema.documents)
    .values({
      tenantId,
      origin: "dms",
      folderId: folder.id,
      filedAt: new Date(),
      effectiveVisibility: folder.effectiveVisibility,
      blobPathname: input.blobPathname,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      source: "email",
      emailFrom: input.emailFrom,
      emailSubject: input.emailSubject,
      emailMessageId: input.emailMessageId,
      emailReceivedAt: input.emailReceivedAt,
      // No Clerk user — this arrived from outside the business.
      uploadedByClerkUserId: null,
      extractionStatus: "skipped",
    })
    .onConflictDoNothing()
    .returning({ id: schema.documents.id });

  return rows.length > 0 ? { documentId: rows[0].id } : null;
}

/* ---- owner-side management ------------------------------------------- */

export async function enableFolderInbound(
  tx: Tx,
  tenantId: string,
  folderId: string,
): Promise<string> {
  const folder = await tx.query.documentFolders.findFirst({
    where: and(
      eq(schema.documentFolders.tenantId, tenantId),
      eq(schema.documentFolders.id, folderId),
    ),
  });
  if (!folder) throw new DocsError("FOLDER_NOT_FOUND", "folder not visible");
  // Same rule as share links: never hand an outside party a way into a place
  // the business has closed to its own staff.
  if (folder.effectiveVisibility === "owners") {
    throw new DocsError(
      "SHARE_ROOT_RESTRICTED",
      "owners-only folders cannot take email",
    );
  }

  const token = mintFolderToken();
  await tx
    .update(schema.documentFolders)
    .set({
      inboundToken: token,
      version: folder.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documentFolders.tenantId, tenantId),
        eq(schema.documentFolders.id, folderId),
      ),
    );
  return token;
}

export async function disableFolderInbound(
  tx: Tx,
  tenantId: string,
  folderId: string,
): Promise<void> {
  await tx
    .update(schema.documentFolders)
    .set({ inboundToken: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.documentFolders.tenantId, tenantId),
        eq(schema.documentFolders.id, folderId),
      ),
    );
}
