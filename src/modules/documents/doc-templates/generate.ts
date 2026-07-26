import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { schema, type Tx } from "@/db";
import type { Document, DocumentGeneration } from "@/db/schema";
import { assertBlobConfigured, blobToken, dmsPathPrefix } from "@/lib/blob";
import { DocsError } from "../core/errors";
import type { DocsCtx } from "../folder-ops";
import { sha256Hex } from "../ingest";
import { missingFields } from "./merge";
import { parseFields } from "./fields";
import { loadCurrentPublished } from "./template-ops";

/**
 * Turn a published template into a filed PDF.
 *
 * Shape follows the house rule the rest of the module uses: the expensive,
 * network-touching work (rendering, uploading) happens OUTSIDE the transaction,
 * and only the rows are written inside it. A PDF render holding a Postgres
 * transaction open would be a long-lived lock for no reason.
 */

export interface GenerateInput {
  templateId: string;
  values: Record<string, string>;
  /** Where to file it. Null lands in the Inbox. */
  folderId: string | null;
  /** Overrides the default "<template> <number>". */
  title?: string;
}

export interface PreparedGeneration {
  templateId: string;
  templateName: string;
  templateVersionId: string;
  templateVersionNo: number;
  body: string;
  values: Record<string, string>;
}

/**
 * Load the published version and check the values against it.
 *
 * Generation always uses the newest PUBLISHED version, never the draft. A
 * half-written template must not be able to leave the building, and that is
 * the practical payoff of publish immutability.
 */
export async function prepareGeneration(
  tx: Tx,
  ctx: DocsCtx,
  input: GenerateInput,
): Promise<PreparedGeneration> {
  const template = await tx.query.documentTemplates.findFirst({
    where: and(
      eq(schema.documentTemplates.tenantId, ctx.tenantId),
      eq(schema.documentTemplates.id, input.templateId),
    ),
  });
  if (!template) throw new DocsError("TEMPLATE_NOT_FOUND", "not visible");
  if (template.archivedAt) {
    throw new DocsError("TEMPLATE_ARCHIVED", "template is archived");
  }

  const version = await loadCurrentPublished(tx, ctx.tenantId, input.templateId);
  if (!version) {
    throw new DocsError("TEMPLATE_NOT_PUBLISHED", "nothing published");
  }

  // Only fields the template DECLARES required are enforced. An optional field
  // left blank renders as its [placeholder], which is visible and fixable;
  // refusing the whole generation over it would be worse.
  const required = new Set(
    parseFields(version.fields)
      .filter((f) => f.required)
      .map((f) => f.name),
  );
  const blank = missingFields(version.body, input.values).filter((name) =>
    required.has(name),
  );
  if (blank.length > 0) {
    throw new DocsError("GENERATION_MISSING_FIELDS", blank.join(","));
  }

  return {
    templateId: template.id,
    templateName: template.name,
    templateVersionId: version.id,
    templateVersionNo: version.versionNo,
    body: version.body,
    values: input.values,
  };
}

/**
 * The next per-tenant generation number.
 *
 * Read inside the writing transaction and protected by the
 * `(tenant_id, number)` unique: two people generating at the same instant have
 * one of them fail the insert and retry rather than both quoting "#14".
 */
export async function nextGenerationNumber(
  tx: Tx,
  tenantId: string,
): Promise<number> {
  const [row] = await tx
    .select({ number: schema.documentGenerations.number })
    .from(schema.documentGenerations)
    .where(eq(schema.documentGenerations.tenantId, tenantId))
    .orderBy(desc(schema.documentGenerations.number))
    .limit(1);
  return (row?.number ?? 0) + 1;
}

/** Filename-safe, so the stored name never needs sanitizing downstream. */
function slugForFile(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return slug || "document";
}

export interface UploadedPdf {
  blobPathname: string;
  sizeBytes: number;
  sha256: string;
  fileName: string;
}

/**
 * Put the rendered bytes in the tenant's namespace.
 *
 * Server-side `put`, not the presigned client flow: the browser never sees
 * these bytes and there is nothing to presign — the server made them.
 * `docs/{tenant}/generated/` keeps them separate from uploads, which is the
 * `dmsPathPrefix` kind the plan reserved.
 */
export async function uploadGeneratedPdf(
  tenantId: string,
  prepared: PreparedGeneration,
  bytes: Uint8Array,
  number: number,
): Promise<UploadedPdf> {
  assertBlobConfigured();
  const fileName = `${slugForFile(prepared.templateName)}-${number}.pdf`;
  const result = await put(
    `${dmsPathPrefix(tenantId, "generated")}${fileName}`,
    Buffer.from(bytes),
    {
      // PRIVATE, like every other blob in this module. A generated lien waiver
      // is business paperwork; it reaches a browser only through the
      // authenticated stream route, or through a share link the owner
      // deliberately created. A public blob URL would be an unauthenticated
      // leak that no later permission check could undo.
      access: "private",
      addRandomSuffix: true,
      contentType: "application/pdf",
      token: blobToken(),
    },
  );
  return {
    blobPathname: result.pathname,
    sizeBytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    fileName,
  };
}

/**
 * Write the document row and the generation record together.
 *
 * One transaction on purpose: a filed PDF with no provenance, or a provenance
 * record pointing at nothing, are both worse than the whole thing failing.
 */
export async function recordGeneration(
  tx: Tx,
  ctx: DocsCtx,
  prepared: PreparedGeneration,
  uploaded: UploadedPdf,
  input: {
    folderId: string | null;
    title?: string;
    /**
     * Claimed by the caller with `nextGenerationNumber` before uploading,
     * because the filename embeds it. Passed in rather than re-read here so
     * the number in the file and the number in the record cannot diverge.
     */
    number: number;
  },
): Promise<{ document: Document; generation: DocumentGeneration }> {
  let effectiveVisibility: "members" | "owners" = "members";
  if (input.folderId !== null) {
    const folder = await tx.query.documentFolders.findFirst({
      where: and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        eq(schema.documentFolders.id, input.folderId),
      ),
    });
    if (!folder) throw new DocsError("FOLDER_NOT_FOUND", "folder not visible");
    effectiveVisibility = folder.effectiveVisibility as "members" | "owners";
  }

  const number = input.number;

  const [document] = await tx
    .insert(schema.documents)
    .values({
      tenantId: ctx.tenantId,
      origin: "dms",
      folderId: input.folderId,
      filedAt: input.folderId === null ? null : new Date(),
      effectiveVisibility,
      blobPathname: uploaded.blobPathname,
      fileName: uploaded.fileName,
      mimeType: "application/pdf",
      sizeBytes: uploaded.sizeBytes,
      sha256: uploaded.sha256,
      // The enum value 0036 added — which is why it had to land in its own
      // migration before this code could ship.
      source: "generated",
      title: input.title?.trim() || `${prepared.templateName} ${number}`,
      uploadedByClerkUserId: ctx.userId,
      extractionStatus: "skipped",
    })
    .returning();

  const [generation] = await tx
    .insert(schema.documentGenerations)
    .values({
      tenantId: ctx.tenantId,
      templateId: prepared.templateId,
      templateVersionId: prepared.templateVersionId,
      // Stored as a NUMBER as well as an id: if the version row is ever lost,
      // "generated from v3" still means something.
      templateVersionNo: prepared.templateVersionNo,
      documentId: document.id,
      number,
      values: prepared.values,
      generatedByClerkUserId: ctx.userId,
    })
    .returning();

  return { document, generation };
}

export async function listGenerations(
  tx: Tx,
  tenantId: string,
  templateId: string,
  limit = 50,
): Promise<DocumentGeneration[]> {
  return tx
    .select()
    .from(schema.documentGenerations)
    .where(
      and(
        eq(schema.documentGenerations.tenantId, tenantId),
        eq(schema.documentGenerations.templateId, templateId),
      ),
    )
    .orderBy(desc(schema.documentGenerations.createdAt))
    .limit(limit);
}
