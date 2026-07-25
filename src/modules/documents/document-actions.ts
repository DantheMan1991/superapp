"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { DocsError, friendlyMessage } from "./core/errors";
import { createDmsDocument, inspectUploadedBlob } from "./ingest";
import {
  addDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
  type VersionEntry,
} from "./versions";
import type { DocsCtx } from "./folder-ops";

/**
 * Document-level server actions: register an upload, file it, edit it, trash
 * and restore it. Folder actions live in actions.ts.
 */

const BASE = "/dashboard/m/documents";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<DocsCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");
  if (ctx.role === "expert") {
    throw new DocsError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

/**
 * The same gate without the write refusal, for actions that only read. The
 * accountant role is read-ONLY, not blind: reviewing which revision of a
 * document was current at year end is exactly their job.
 */
async function readGate(): Promise<DocsCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof DocsError) return { error: friendlyMessage(err) };
  if (err instanceof Error && err.message.includes("BLOB_READ_WRITE_TOKEN")) {
    return {
      error: "File storage isn't configured yet — add BLOB_READ_WRITE_TOKEN. See SETUP.md.",
    };
  }
  console.error("documents action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidate(): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/browse`);
  revalidatePath(`${BASE}/inbox`);
}

const registerSchema = z.object({
  pathname: z.string().min(1).max(500),
  folderId: z.string().uuid().nullable().default(null),
  title: z.string().max(200).default(""),
  description: z.string().max(2000).default(""),
});

export async function registerDocumentUploadAction(
  input: z.infer<typeof registerSchema>,
): Promise<ActionResult<{ documentId: string; duplicateOfId: string | null }>> {
  try {
    const ctx = await gate();
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    // Blob inspection (head + full read to hash) happens BEFORE the
    // transaction — network work must never hold one open.
    const inspected = await inspectUploadedBlob(ctx.tenantId, parsed.data.pathname);

    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createDmsDocument(tx, ctx, {
          ...inspected,
          blobPathname: parsed.data.pathname,
          folderId: parsed.data.folderId,
          title: parsed.data.title,
          description: parsed.data.description,
        });
        await logAuditInTx(tx, {
          action: "documents.uploaded",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document",
          targetId: created.document.id,
          // Identifiers and measurements only — never the file's contents.
          meta: {
            origin: "dms",
            sizeBytes: inspected.sizeBytes,
            mimeType: inspected.mimeType,
            folderId: parsed.data.folderId,
            duplicateOfId: created.duplicateOfId,
          },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidate();
    return {
      ok: true,
      data: {
        documentId: result.document.id,
        duplicateOfId: result.duplicateOfId,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

const addVersionSchema = z.object({
  documentId: z.string().uuid(),
  pathname: z.string().min(1).max(500),
  note: z.string().max(500).default(""),
});

/**
 * Replace a document's file, keeping the old bytes as history.
 *
 * Same two-phase shape as the initial upload — client-direct to blob storage,
 * then this action re-reads the blob's real metadata and hashes the actual
 * bytes. A new revision goes through exactly the same allowlist and namespace
 * checks as a new file, because it IS a new file; only the row it attaches to
 * differs.
 */
export async function addDocumentVersionAction(
  input: z.infer<typeof addVersionSchema>,
): Promise<ActionResult<{ versionNo: number; sameAsCurrent: boolean }>> {
  try {
    const ctx = await gate();
    const parsed = addVersionSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const inspected = await inspectUploadedBlob(ctx.tenantId, parsed.data.pathname);

    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const added = await addDocumentVersion(tx, ctx, parsed.data.documentId, {
          ...inspected,
          blobPathname: parsed.data.pathname,
          note: parsed.data.note,
        });
        await logAuditInTx(tx, {
          action: "documents.version_added",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document",
          targetId: parsed.data.documentId,
          // Identifiers and measurements only — never the note, which is
          // free text a user wrote and may describe the contents.
          meta: {
            versionNo: added.version.versionNo,
            sizeBytes: inspected.sizeBytes,
            mimeType: inspected.mimeType,
            sameAsCurrent: added.sameAsCurrent,
          },
        });
        return added;
      },
      { role: ctx.role },
    );
    revalidate();
    return {
      ok: true,
      data: {
        versionNo: result.version.versionNo,
        sameAsCurrent: result.sameAsCurrent,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

const restoreVersionSchema = z.object({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
});

export async function restoreDocumentVersionAction(
  input: z.infer<typeof restoreVersionSchema>,
): Promise<ActionResult<{ versionNo: number; sourceNo: number }>> {
  try {
    const ctx = await gate();
    const parsed = restoreVersionSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const result = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const restored = await restoreDocumentVersion(
          tx,
          ctx,
          parsed.data.documentId,
          parsed.data.versionId,
        );
        await logAuditInTx(tx, {
          action: "documents.version_restored",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document",
          targetId: parsed.data.documentId,
          meta: {
            versionNo: restored.version.versionNo,
            restoredFrom: restored.sourceNo,
          },
        });
        return restored;
      },
      { role: ctx.role },
    );
    revalidate();
    return {
      ok: true,
      data: {
        versionNo: result.version.versionNo,
        sourceNo: result.sourceNo,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

const listVersionsSchema = z.object({ documentId: z.string().uuid() });

/**
 * The history panel's data, fetched when the dialog opens rather than joined
 * into the browse query — a folder page would otherwise pay for history nobody
 * asked to see.
 */
export async function listDocumentVersionsAction(
  input: z.infer<typeof listVersionsSchema>,
): Promise<ActionResult<{ versions: VersionEntry[] }>> {
  try {
    const ctx = await readGate();
    const parsed = listVersionsSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const versions = await withTenant(
      ctx.tenantId,
      (tx) => listDocumentVersions(tx, ctx.tenantId, parsed.data.documentId),
      { role: ctx.role },
    );
    return { ok: true, data: { versions } };
  } catch (err) {
    return fail(err);
  }
}

const moveSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(100),
  folderId: z.string().uuid().nullable(),
});

export async function moveDocumentsAction(
  input: z.infer<typeof moveSchema>,
): Promise<ActionResult<{ moved: number }>> {
  try {
    const ctx = await gate();
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const moved = await withTenant(
      ctx.tenantId,
      async (tx) => {
        // Filing into a folder adopts that folder's visibility. If the target
        // is owners-only and the caller is staff, RLS refuses the write
        // outright (WITH CHECK) rather than quietly filing it somewhere the
        // caller then cannot see.
        let effectiveVisibility: "members" | "owners" = "members";
        if (parsed.data.folderId !== null) {
          const folder = await tx.query.documentFolders.findFirst({
            where: and(
              eq(schema.documentFolders.tenantId, ctx.tenantId),
              eq(schema.documentFolders.id, parsed.data.folderId),
            ),
          });
          if (!folder) {
            throw new DocsError("FOLDER_NOT_FOUND", "folder not visible");
          }
          effectiveVisibility = folder.effectiveVisibility as
            | "members"
            | "owners";
        }

        const rows = await tx
          .update(schema.documents)
          .set({
            folderId: parsed.data.folderId,
            filedAt: parsed.data.folderId === null ? null : new Date(),
            effectiveVisibility,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.documents.tenantId, ctx.tenantId),
              inArray(schema.documents.id, parsed.data.documentIds),
            ),
          )
          .returning({ id: schema.documents.id });

        await logAuditInTx(tx, {
          action: "documents.filed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document",
          targetId: parsed.data.documentIds[0],
          meta: { count: rows.length, folderId: parsed.data.folderId },
        });
        return rows.length;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { moved } };
  } catch (err) {
    return fail(err);
  }
}

const updateSchema = z.object({
  documentId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  docKind: z.string().max(64).optional(),
});

export async function updateDocumentAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const rows = await tx
          .update(schema.documents)
          .set({
            ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
            ...(parsed.data.description !== undefined
              ? { description: parsed.data.description }
              : {}),
            ...(parsed.data.docKind !== undefined
              ? { docKind: parsed.data.docKind }
              : {}),
            version: parsed.data.expectedVersion + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.documents.tenantId, ctx.tenantId),
              eq(schema.documents.id, parsed.data.documentId),
              eq(schema.documents.version, parsed.data.expectedVersion),
            ),
          )
          .returning({ id: schema.documents.id });
        if (rows.length === 0) {
          throw new DocsError("STALE_VERSION", "document changed");
        }
        await logAuditInTx(tx, {
          action: "documents.updated",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document",
          targetId: parsed.data.documentId,
          meta: {},
        });
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const trashSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(100),
});

export async function trashDocumentsAction(
  input: z.infer<typeof trashSchema>,
): Promise<ActionResult<{ trashed: number }>> {
  try {
    const ctx = await gate();
    const parsed = trashSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const trashed = await withTenant(
      ctx.tenantId,
      async (tx) => {
        // A document attached to a bill or journal entry must be detached
        // there first — the accounting module owns that relationship and the
        // DMS must not silently break its audit trail.
        const linked = await tx
          .select({ documentId: schema.documentLinks.documentId })
          .from(schema.documentLinks)
          .where(
            and(
              eq(schema.documentLinks.tenantId, ctx.tenantId),
              inArray(schema.documentLinks.documentId, parsed.data.documentIds),
            ),
          );
        if (linked.length > 0) {
          throw new DocsError("DOCUMENT_HAS_LINKS", "document is attached");
        }

        const rows = await tx
          .update(schema.documents)
          .set({
            status: "trashed",
            trashedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.documents.tenantId, ctx.tenantId),
              inArray(schema.documents.id, parsed.data.documentIds),
            ),
          )
          .returning({ id: schema.documents.id });

        await logAuditInTx(tx, {
          action: "documents.trashed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document",
          targetId: parsed.data.documentIds[0],
          meta: { count: rows.length },
        });
        return rows.length;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { trashed } };
  } catch (err) {
    return fail(err);
  }
}

export async function restoreDocumentsAction(
  input: z.infer<typeof trashSchema>,
): Promise<ActionResult<{ restored: number }>> {
  try {
    const ctx = await gate();
    const parsed = trashSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const restored = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const rows = await tx
          .update(schema.documents)
          .set({
            // Back to the shared inbox state; the DMS reads folder_id, not
            // status, so a restored file returns to whatever folder it had.
            status: "inbox",
            trashedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.documents.tenantId, ctx.tenantId),
              inArray(schema.documents.id, parsed.data.documentIds),
            ),
          )
          .returning({ id: schema.documents.id });

        await logAuditInTx(tx, {
          action: "documents.restored",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "document",
          targetId: parsed.data.documentIds[0],
          meta: { count: rows.length },
        });
        return rows.length;
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true, data: { restored } };
  } catch (err) {
    return fail(err);
  }
}
