import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { Document, DocumentAttachment } from "@/db/schema";
import { DocsError, roleMayWrite, type DocsRole } from "./core/errors";
import { isDisplayableImage } from "./allowlist";
import { createDmsDocument, inspectUploadedBlob } from "./ingest";
import { extractDocumentText } from "./text/extract";
import { folderNameKey } from "./core/tree";
import { logAuditInTx } from "@/lib/audit";

/**
 * **A DOCUMENT ATTACHED TO A RECORD THAT IS NOT AN ACCOUNTING ONE** — a photo
 * of a cow, a photo of a tractor, a manual, a permit. The Layer 0 half of
 * livestock slice 4b, and the surface every future pack attaches through.
 *
 * **THIS FILE NAMES NO PACK, AND THAT IS THE WHOLE POINT.** The target is an
 * `(extensionSlug, entityType, entityId)` triple the CALLER supplies. A core
 * module that knew what a livestock lot was would be the leak ADR 0004 draws
 * the line against — and it would mean a core migration every time a pack
 * wanted a photo. `mail_links` solved the identical problem the identical way.
 *
 * **THE TRADE, SAID PLAINLY: no foreign key to the target.** Postgres cannot
 * police a polymorphic reference, so a deleted record leaves rows behind.
 * `detachAllForEntity` is what a pack's own delete path calls, and a gallery
 * whose target has gone simply renders nothing. See the schema comment.
 *
 * Everything here takes a `Tx` and runs inside the caller's transaction, under
 * RLS, and the attachment policy inherits the DOCUMENT's visibility — so an
 * owners-only photo is not merely unreadable to staff, it is uncounted.
 */

export interface AttachmentTarget {
  /** The pack or module that owns this kind of record: `livestock`, `assets`. */
  extensionSlug: string;
  /** What kind of record it is: `livestock_lot`, `asset`. */
  entityType: string;
  entityId: string;
}

export interface AttachmentCtx {
  tenantId: string;
  userId: string;
  /**
   * **CARRIED SO THE DMS'S OWN RULE CAN BE ASKED HERE.** It was absent until
   * 2026-09-04, which is why `registerAttachedPhoto` refused the accountant and
   * the two functions below did not — a pack that opened its photo panel to an
   * expert got one control that failed and two that worked.
   */
  role: DocsRole;
}

const SLUG = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Every write through this file asks it, so a caller cannot enable one third of
 * the photo panel by accident. See `roleMayWrite` in `core/errors.ts` for why a
 * pack's own `member` level does not settle this.
 */
function assertRoleMayWrite(ctx: { role: DocsRole }): void {
  if (!roleMayWrite(ctx.role)) {
    throw new DocsError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
}

function assertTarget(target: AttachmentTarget): void {
  if (!SLUG.test(target.extensionSlug) || !SLUG.test(target.entityType)) {
    throw new DocsError("ATTACHMENT_TARGET_INVALID", "invalid target");
  }
}

const whereTarget = (tenantId: string, target: AttachmentTarget) =>
  and(
    eq(schema.documentAttachments.tenantId, tenantId),
    eq(schema.documentAttachments.entityType, target.entityType),
    eq(schema.documentAttachments.entityId, target.entityId),
  );

/**
 * Attach a document to a record.
 *
 * **`makePrimary` DEFAULTS TO "IF THERE IS NOT ONE ALREADY".** The first photo
 * of an animal is its profile picture without anybody being asked, because a
 * gallery of one whose thumbnail is blank is a bug in every reader's eyes. A
 * later one does not steal the position — that is a choice, and it has a
 * button.
 */
export async function attachDocumentToRecord(
  tx: Tx,
  ctx: AttachmentCtx,
  args: {
    documentId: string;
    target: AttachmentTarget;
    /** `true` forces it, `false` refuses it, omitted means "if none yet". */
    makePrimary?: boolean;
  },
): Promise<DocumentAttachment> {
  assertTarget(args.target);
  const doc = await tx.query.documents.findFirst({
    where: and(
      eq(schema.documents.tenantId, ctx.tenantId),
      eq(schema.documents.id, args.documentId),
    ),
  });
  // Not found and not-visible-to-you are the same answer, because RLS makes
  // them the same query. Saying which would be the leak the policy prevents.
  if (!doc) throw new DocsError("DOCUMENT_NOT_FOUND", args.documentId);
  if (doc.status === "trashed") {
    throw new DocsError("DOCUMENT_TRASHED", doc.id);
  }

  const existing = await tx
    .select({ id: schema.documentAttachments.id })
    .from(schema.documentAttachments)
    .where(
      and(whereTarget(ctx.tenantId, args.target), sql`is_primary`),
    )
    .limit(1);
  const primary =
    args.makePrimary === undefined ? existing.length === 0 : args.makePrimary;
  if (primary && !isDisplayableImage(doc.mimeType)) {
    throw new DocsError("ATTACHMENT_NOT_AN_IMAGE", doc.id);
  }
  // Clearing first, because the partial unique index is NOT deferrable — the
  // same shape `document_versions.is_current` already forces on a promote.
  if (primary && existing.length > 0) {
    await clearPrimary(tx, ctx.tenantId, args.target);
  }

  const rows = await tx
    .insert(schema.documentAttachments)
    .values({
      tenantId: ctx.tenantId,
      documentId: doc.id,
      extensionSlug: args.target.extensionSlug,
      entityType: args.target.entityType,
      entityId: args.target.entityId,
      isPrimary: primary,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    throw new DocsError("ATTACHMENT_EXISTS", doc.id);
  }

  // An attached file is a filed file. The DMS's own inbox exists to show what
  // has NOT found a home, and a photo on an animal has found one.
  if (doc.status !== "filed") {
    await tx
      .update(schema.documents)
      .set({ status: "filed", updatedAt: new Date() })
      .where(
        and(
          eq(schema.documents.tenantId, ctx.tenantId),
          eq(schema.documents.id, doc.id),
        ),
      );
  }
  return rows[0];
}

async function clearPrimary(
  tx: Tx,
  tenantId: string,
  target: AttachmentTarget,
): Promise<void> {
  await tx
    .update(schema.documentAttachments)
    .set({ isPrimary: false })
    .where(and(whereTarget(tenantId, target), sql`is_primary`));
}

/**
 * Make one attachment the record's profile picture.
 *
 * **A PROFILE PICTURE HAS TO BE AN IMAGE**, and that rule lives here rather
 * than in a CHECK because the database holds attachments of every kind on
 * purpose — a tractor's manual is a legitimate one, and it is not its portrait.
 */
export async function setPrimaryAttachment(
  tx: Tx,
  ctx: AttachmentCtx,
  args: { documentId: string; target: AttachmentTarget },
): Promise<void> {
  assertRoleMayWrite(ctx);
  assertTarget(args.target);
  const rows = await tx
    .select({
      id: schema.documentAttachments.id,
      mimeType: schema.documents.mimeType,
    })
    .from(schema.documentAttachments)
    .innerJoin(
      schema.documents,
      and(
        eq(schema.documents.tenantId, schema.documentAttachments.tenantId),
        eq(schema.documents.id, schema.documentAttachments.documentId),
      ),
    )
    .where(
      and(
        whereTarget(ctx.tenantId, args.target),
        eq(schema.documentAttachments.documentId, args.documentId),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new DocsError("ATTACHMENT_NOT_FOUND", args.documentId);
  }
  if (!isDisplayableImage(rows[0].mimeType)) {
    throw new DocsError("ATTACHMENT_NOT_AN_IMAGE", args.documentId);
  }

  await clearPrimary(tx, ctx.tenantId, args.target);
  await tx
    .update(schema.documentAttachments)
    .set({ isPrimary: true })
    .where(
      and(
        eq(schema.documentAttachments.tenantId, ctx.tenantId),
        eq(schema.documentAttachments.id, rows[0].id),
      ),
    );
}

/**
 * Detach a document from a record. The FILE is untouched — it stays in the
 * cabinet, where somebody may still want it. Removing the photo from the animal
 * and deleting the photo are different acts and only one of them is reversible.
 *
 * **The primary flag goes with the row**, which is why it lives on the row.
 * A record whose profile picture is detached has none until somebody says
 * otherwise, rather than silently promoting whatever is next — the app picking
 * a portrait is the thing this whole flag exists to stop.
 */
export async function detachDocumentFromRecord(
  tx: Tx,
  ctx: AttachmentCtx,
  args: { documentId: string; target: AttachmentTarget },
): Promise<void> {
  assertRoleMayWrite(ctx);
  assertTarget(args.target);
  const rows = await tx
    .delete(schema.documentAttachments)
    .where(
      and(
        whereTarget(ctx.tenantId, args.target),
        eq(schema.documentAttachments.documentId, args.documentId),
      ),
    )
    .returning({ id: schema.documentAttachments.id });
  if (rows.length === 0) {
    throw new DocsError("ATTACHMENT_NOT_FOUND", args.documentId);
  }
}

/**
 * **What a pack calls when it deletes a record.** There is no FK to do it, so
 * this is the promise standing in for one — see the schema comment.
 */
export async function detachAllForEntity(
  tx: Tx,
  tenantId: string,
  target: AttachmentTarget,
): Promise<number> {
  assertTarget(target);
  const rows = await tx
    .delete(schema.documentAttachments)
    .where(whereTarget(tenantId, target))
    .returning({ id: schema.documentAttachments.id });
  return rows.length;
}

export type AttachedDocument = {
  attachmentId: string;
  document: Document;
  isPrimary: boolean;
  attachedAt: Date;
};

/** Everything attached to one record, profile picture first, then newest. */
export async function attachmentsForRecord(
  tx: Tx,
  tenantId: string,
  target: AttachmentTarget,
): Promise<AttachedDocument[]> {
  assertTarget(target);
  const rows = await tx
    .select({
      attachmentId: schema.documentAttachments.id,
      isPrimary: schema.documentAttachments.isPrimary,
      attachedAt: schema.documentAttachments.createdAt,
      document: schema.documents,
    })
    .from(schema.documentAttachments)
    .innerJoin(
      schema.documents,
      and(
        eq(schema.documents.tenantId, schema.documentAttachments.tenantId),
        eq(schema.documents.id, schema.documentAttachments.documentId),
      ),
    )
    .where(whereTarget(tenantId, target))
    .orderBy(
      desc(schema.documentAttachments.isPrimary),
      desc(schema.documentAttachments.createdAt),
    );
  return rows.map((row) => ({
    attachmentId: row.attachmentId,
    document: row.document,
    isPrimary: row.isPrimary,
    attachedAt: row.attachedAt,
  }));
}

/**
 * Profile pictures for a LIST of records, keyed by entity id — one query for a
 * page of thumbnails rather than one per row.
 *
 * A record with no primary is absent from the map rather than present as null,
 * because "no photo" and "a photo we could not read" would then look identical
 * to the caller, and only one of them is worth saying anything about.
 */
export async function primaryAttachments(
  tx: Tx,
  tenantId: string,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, Document>> {
  const out = new Map<string, Document>();
  if (entityIds.length === 0 || !SLUG.test(entityType)) return out;
  const rows = await tx
    .select({
      entityId: schema.documentAttachments.entityId,
      document: schema.documents,
    })
    .from(schema.documentAttachments)
    .innerJoin(
      schema.documents,
      and(
        eq(schema.documents.tenantId, schema.documentAttachments.tenantId),
        eq(schema.documents.id, schema.documentAttachments.documentId),
      ),
    )
    .where(
      and(
        eq(schema.documentAttachments.tenantId, tenantId),
        eq(schema.documentAttachments.entityType, entityType),
        inArray(schema.documentAttachments.entityId, entityIds),
        sql`${schema.documentAttachments.isPrimary}`,
      ),
    );
  for (const row of rows) out.set(row.entityId, row.document);
  return out;
}

/**
 * How many records in a set carry any attachment at all.
 *
 * Not the same question as `primaryAttachments` — a record can hold three
 * photos and no portrait — and a list that showed a placeholder for both would
 * be telling somebody there is nothing to look at when there is.
 */
export async function attachmentCounts(
  tx: Tx,
  tenantId: string,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (entityIds.length === 0 || !SLUG.test(entityType)) return out;
  const rows = await tx
    .select({
      entityId: schema.documentAttachments.entityId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.documentAttachments)
    .innerJoin(
      schema.documents,
      and(
        eq(schema.documents.tenantId, schema.documentAttachments.tenantId),
        eq(schema.documents.id, schema.documentAttachments.documentId),
      ),
    )
    .where(
      and(
        eq(schema.documentAttachments.tenantId, tenantId),
        eq(schema.documentAttachments.entityType, entityType),
        inArray(schema.documentAttachments.entityId, entityIds),
      ),
    )
    .groupBy(schema.documentAttachments.entityId);
  for (const row of rows) out.set(row.entityId, row.count);
  return out;
}

/**
 * The root **Photos** folder the module provisions on install, or null.
 *
 * **WITHOUT THIS EVERY ANIMAL PHOTO LANDS IN THE INBOX AND STAYS THERE.** The
 * Inbox is `folder_id is null` by design — "captured but not filed yet" — and a
 * farm with forty animals and five photos each would have two hundred things in
 * it that nobody needs to do anything about, which is how a to-do surface stops
 * being read. Found by driving it.
 *
 * **Degrades to the Inbox rather than creating anything.** A tenant may have
 * renamed or removed the folder, and inventing one on an upload path would be
 * this code deciding how somebody's cabinet is arranged. Naming a folder core
 * ships itself is not core naming a pack.
 */
async function defaultPhotoFolderId(
  tx: Tx,
  tenantId: string,
): Promise<string | null> {
  const folder = await tx.query.documentFolders.findFirst({
    where: and(
      eq(schema.documentFolders.tenantId, tenantId),
      isNull(schema.documentFolders.parentId),
      eq(schema.documentFolders.nameKey, folderNameKey(PHOTO_FOLDER)),
    ),
    columns: { id: true },
  });
  return folder?.id ?? null;
}

/** The name in `templates/defaults.ts`. Resolved by key, so case is no trap. */
const PHOTO_FOLDER = "Photos";

/**
 * **UPLOAD A PHOTO AND HANG IT ON A RECORD, in one act.** The Layer 0 half of a
 * pack's "add a photo" button — the pack supplies the target and nothing else,
 * because this file must not know what a livestock lot is.
 *
 * It is a plain server function rather than an action for one reason: the ACTION
 * is the pack's, so the pack's own module gate runs first. A generic action here
 * would have to take an `extensionSlug` from the browser and decide whether to
 * trust it, which is a permission check written in the wrong place.
 *
 * The document is registered exactly as an ordinary DMS upload is — the blob is
 * re-read and re-hashed server-side, so nothing the client asserted about the
 * file is trusted — and then attached in the SAME transaction. A photo that
 * existed as an unfiled document because the second half failed would be a file
 * nobody knows the purpose of, sitting in the inbox.
 */
export async function registerAttachedPhoto(
  ctx: { tenantId: string; userId: string; role: DocsRole },
  args: {
    pathname: string;
    target: AttachmentTarget;
    /**
     * Where it is filed. **Omitted means the root Photos folder** if the
     * tenant still has one; an explicit `null` keeps it out of the tree.
     */
    folderId?: string | null;
    title?: string;
    makePrimary?: boolean;
  },
): Promise<{ documentId: string; isPrimary: boolean }> {
  assertRoleMayWrite(ctx);
  // Blob inspection is network work and never holds a transaction open — the
  // same ordering `registerDocumentUploadAction` keeps and for the same reason.
  const inspected = await inspectUploadedBlob(ctx.tenantId, args.pathname);
  if (!isDisplayableImage(inspected.mimeType)) {
    throw new DocsError("ATTACHMENT_NOT_AN_IMAGE", args.pathname);
  }

  const extracted = await extractDocumentText(
    inspected.bytes,
    inspected.mimeType,
  );

  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const folderId =
        args.folderId === undefined
          ? await defaultPhotoFolderId(tx, ctx.tenantId)
          : args.folderId;
      const created = await createDmsDocument(tx, ctx, {
        ...inspected,
        blobPathname: args.pathname,
        folderId,
        title: args.title ?? "",
        description: "",
        // Through the SHARED extractor rather than hardcoded: it answers
        // `unsupported` for an image without opening a parser, and a second
        // opinion here is how the search page starts disagreeing with the
        // backfill script about why a file is not searchable.
        extractedText: extracted.text,
        textExtraction: extracted.state,
      });
      const attachment = await attachDocumentToRecord(tx, ctx, {
        documentId: created.document.id,
        target: args.target,
        makePrimary: args.makePrimary,
      });
      await logAuditInTx(tx, {
        action: "documents.attached",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "document",
        targetId: created.document.id,
        // Identifiers and measurements only, never the file.
        meta: {
          entityType: args.target.entityType,
          entityId: args.target.entityId,
          extensionSlug: args.target.extensionSlug,
          sizeBytes: inspected.sizeBytes,
          mimeType: inspected.mimeType,
          isPrimary: attachment.isPrimary,
        },
      });
      return {
        documentId: created.document.id,
        isPrimary: attachment.isPrimary,
      };
    },
    { role: ctx.role },
  );
}
