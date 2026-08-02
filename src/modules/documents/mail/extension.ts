import "server-only";
import { and, desc, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { put } from "@vercel/blob";
import { schema, withTenant, type Tx } from "@/db";
import { assertBlobConfigured, blobToken, dmsPathPrefix } from "@/lib/blob";
import { sanitizeFileName } from "@/lib/file-headers";
import { logAuditInTx } from "@/lib/audit";
import type {
  FiledMessageInput,
  FiledMessageResult,
  LinkableEntity,
  MailExtension,
  MailExtensionCtx,
  MailImageBlob,
  MailImageCandidate,
} from "@/lib/mail-extensions/types";
import { isAllowedUpload } from "../allowlist";
import { readBlobBytes, sha256Hex } from "../ingest";

/**
 * What Documents contributes to Mail: two linkable types, and the one capability
 * that makes linking mean anything at all — somewhere to PUT a copy.
 *
 * Imports `@/lib/mail-extensions/types` and nothing else from outside this
 * module. It does not import Mail, and Mail does not import it; the registry is
 * the only place both are named, and eslint.config.mjs enforces that.
 */

/** Same shape as the accounting extension's — see the note there about LIKE. */
function contains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const documentEntity = {
  type: "document",
  label: "File",
  pluralLabel: "Files",
  icon: "file",

  async search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<LinkableEntity[]> {
    const like = contains(query);
    // Title OR file name rather than the full-text index: a person attaching a
    // thread is looking for a file they can name, and `searchDocuments`' ranking
    // over extracted body text would bury it under every document that merely
    // mentions the word.
    const rows = await tx
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        fileName: schema.documents.fileName,
        folderId: schema.documents.folderId,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, ctx.tenantId),
          ne(schema.documents.status, "trashed"),
          sql`(${schema.documents.title} ilike ${like} or ${schema.documents.fileName} ilike ${like})`,
        ),
      )
      .orderBy(desc(schema.documents.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      entityType: "document",
      entityId: r.id,
      label: r.title || r.fileName,
      sublabel: r.title && r.fileName !== r.title ? r.fileName : undefined,
      href: r.folderId
        ? `/dashboard/m/documents/browse/${r.folderId}`
        : `/dashboard/m/documents/inbox`,
    }));
  },

  async resolve(
    tx: Tx,
    ctx: MailExtensionCtx,
    ids: readonly string[],
  ): Promise<LinkableEntity[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        fileName: schema.documents.fileName,
        folderId: schema.documents.folderId,
        status: schema.documents.status,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, ctx.tenantId),
          inArray(schema.documents.id, [...ids]),
        ),
      );

    return rows.map((r) => ({
      entityType: "document",
      entityId: r.id,
      label: r.title || r.fileName,
      sublabel: r.status === "trashed" ? "in the trash" : undefined,
      href: r.folderId
        ? `/dashboard/m/documents/browse/${r.folderId}`
        : `/dashboard/m/documents/inbox`,
    }));
  },
};

const folderEntity = {
  type: "folder",
  label: "Folder",
  pluralLabel: "Folders",
  icon: "folder",

  async search(
    tx: Tx,
    ctx: MailExtensionCtx,
    query: string,
    limit: number,
  ): Promise<LinkableEntity[]> {
    const rows = await tx
      .select({
        id: schema.documentFolders.id,
        name: schema.documentFolders.name,
        depth: schema.documentFolders.depth,
      })
      .from(schema.documentFolders)
      .where(
        and(
          eq(schema.documentFolders.tenantId, ctx.tenantId),
          ilike(schema.documentFolders.name, contains(query)),
        ),
      )
      // Shallow first: "Contracts" is more likely meant than "2024/Q3/Contracts".
      .orderBy(schema.documentFolders.depth, schema.documentFolders.nameKey)
      .limit(limit);

    // Owners-only folders are absent from this list without any predicate of
    // ours: RLS removed them for a staff caller before the rows got here. That
    // is the point of taking the caller's tx.
    return rows.map((r) => ({
      entityType: "folder",
      entityId: r.id,
      label: r.name,
      href: `/dashboard/m/documents/browse/${r.id}`,
    }));
  },

  async resolve(
    tx: Tx,
    ctx: MailExtensionCtx,
    ids: readonly string[],
  ): Promise<LinkableEntity[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        id: schema.documentFolders.id,
        name: schema.documentFolders.name,
      })
      .from(schema.documentFolders)
      .where(
        and(
          eq(schema.documentFolders.tenantId, ctx.tenantId),
          inArray(schema.documentFolders.id, [...ids]),
        ),
      );

    return rows.map((r) => ({
      entityType: "folder",
      entityId: r.id,
      label: r.name,
      href: `/dashboard/m/documents/browse/${r.id}`,
    }));
  },
};

/* -- Filing -------------------------------------------------------------- */

/**
 * A ceiling on one filed message, raw bytes plus every attachment.
 *
 * `MAX_FILE_BYTES` already caps each individual file; this caps the *set*, so
 * one message with forty attachments cannot walk past the per-file limit forty
 * times in a single action. Well above any real business email.
 */
const MAX_FILED_MESSAGE_BYTES = 60 * 1024 * 1024;

/** Trim a subject down to something usable as a file name. */
function messageFileName(subject: string): string {
  const stem = sanitizeFileName(subject).replace(/\.+$/, "").slice(0, 80).trim();
  return `${stem.length > 0 ? stem : "message"}.eml`;
}

async function storeBytes(
  tenantId: string,
  fileName: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<string> {
  assertBlobConfigured();
  // Mirrors storeInboundAttachment: the store key is not the display name, and
  // the random suffix is what stops two people filing "quote.pdf" colliding.
  const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "attachment";
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

/**
 * File a published copy of a message, and its attachments, into the cabinet.
 *
 * WHY THIS EXISTS AT ALL, since it is easy to mistake for a convenience: a
 * mailbox is private to one person (RLS 0043) and `mail_thread_index` holds no
 * bodies, so a link that merely pointed at a thread would show a colleague
 * "a conversation called X, with these people, last Tuesday" and not one
 * readable word. Copying is what turns a link into the feature. Settled with the
 * founder; written up in docs/modules/email.md.
 *
 * THREE THINGS IT IS CAREFUL ABOUT:
 *
 *  - **The copy is a snapshot**, not a view. A reply tomorrow is a new message,
 *    not an edit of this one. The UI says so; this code just never pretends
 *    otherwise by updating an existing row.
 *  - **Blob writes happen OUTSIDE the transaction.** House rule, same as every
 *    other ingestion path here: network work must never hold one open.
 *  - **The attachment allowlist still applies.** These bytes arrived from
 *    outside the business through a channel with no upload gate, so they get the
 *    same treatment an upload would. Refusals are counted and reported rather
 *    than swallowed — believing a file was kept when it was not is worse than
 *    knowing it was dropped. The `.eml` itself carries every attachment inside
 *    it regardless, so nothing is actually lost, only unindexed.
 */
async function fileMessage(
  ctx: MailExtensionCtx,
  input: FiledMessageInput,
): Promise<FiledMessageResult> {
  const rawSha = sha256Hex(input.raw);

  // Idempotency, by content. Filing the same message twice — a double click, an
  // action retry, linking it to a second invoice — must not litter the cabinet
  // with copies. sha256 rather than the message id because it is the indexed
  // column (documents_tenant_sha256_idx) and because identical bytes ARE the
  // same message however it reached us.
  const prepared = await withTenant(
    ctx.tenantId,
    async (tx) => ({
      existing: await findFiledMessage(tx, ctx.tenantId, rawSha),
      folder: await resolveDestination(tx, ctx, input.target),
    }),
    { role: ctx.role, userId: ctx.userId },
  );
  const destination = prepared.folder;

  if (prepared.existing) {
    // The copy is already here. If it is still UNFILED and this attach named a
    // folder, move it there — the person has now said where it belongs, and
    // leaving it in the inbox would repeat the original mistake. If somebody has
    // already filed it somewhere, leave it alone: that was a deliberate act and
    // a second attach is not permission to undo it.
    const moved =
      destination && prepared.existing.folderId === null
        ? await withTenant(
            ctx.tenantId,
            (tx) => moveToFolder(tx, ctx.tenantId, prepared.existing!.id, destination),
            { role: ctx.role, userId: ctx.userId },
          )
        : false;
    return {
      entityType: "document",
      entityId: prepared.existing.id,
      label: prepared.existing.title || prepared.existing.fileName,
      href: destinationHref(moved ? destination : null, prepared.existing.folderId),
      destinationLabel: moved
        ? `the ${destination!.name} folder`
        : describeExistingHome(prepared.existing.folderId, destination),
      attachmentsFiled: 0,
      attachmentsRejected: 0,
      alreadyFiled: true,
    };
  }

  const accepted = input.attachments.filter((a) =>
    isAllowedUpload(a.mimeType, a.bytes.byteLength),
  );
  const rejected = input.attachments.length - accepted.length;

  const total =
    input.raw.byteLength + accepted.reduce((n, a) => n + a.bytes.byteLength, 0);
  if (total > MAX_FILED_MESSAGE_BYTES) {
    throw new Error("That message is too large to file.");
  }

  const fileName = messageFileName(input.subject);
  const messagePath = await storeBytes(
    ctx.tenantId,
    fileName,
    "message/rfc822",
    input.raw,
  );
  const attachmentBlobs: {
    path: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }[] = [];
  for (const part of accepted) {
    const safe = sanitizeFileName(part.fileName);
    attachmentBlobs.push({
      path: await storeBytes(ctx.tenantId, safe, part.mimeType, part.bytes),
      fileName: safe,
      mimeType: part.mimeType,
      sizeBytes: part.bytes.byteLength,
      sha256: sha256Hex(part.bytes),
    });
  }

  return withTenant(
    ctx.tenantId,
    async (tx) => {
      // Re-checked inside the transaction: the window between the read above and
      // this insert is where a genuine double-submit lives. It is narrow rather
      // than closed — there is no unique key to arbitrate on, because the blob
      // pathname carries a random suffix by design — and the cost of losing the
      // race is one duplicate row in an inbox, not a wrong answer.
      const raced = await findFiledMessage(tx, ctx.tenantId, rawSha);
      if (raced) {
        return {
          entityType: "document",
          entityId: raced.id,
          label: raced.title || raced.fileName,
          href: destinationHref(null, raced.folderId),
          destinationLabel: describeExistingHome(raced.folderId, destination),
          attachmentsFiled: 0,
          attachmentsRejected: rejected,
          alreadyFiled: true,
        };
      }

      const provenance = {
        origin: "dms" as const,
        // The folder the person named, or the Inbox when they named none.
        //
        // The first version always used the Inbox, reasoning that filing into a
        // folder means GUESSING which one and that a guess here is a visibility
        // decision — folders carry effective_visibility, so a wrong guess either
        // hides the correspondence or publishes it wider than intended. That
        // reasoning is right for "attach this to invoice INV-1042", where no
        // folder was named. It is simply wrong for "attach this to the Admin
        // folder", where there is no guess to avoid: the destination was the
        // instruction. Filing it in the inbox instead sent people to a folder
        // that did not contain their email.
        //
        // Visibility follows the folder, exactly as an upload's does, so a copy
        // filed into a restricted folder is restricted. That is the safe
        // direction — RLS already proved the person can see the folder, and
        // inheriting makes the copy narrower rather than wider.
        folderId: destination?.id ?? null,
        filedAt: destination ? new Date() : null,
        effectiveVisibility: destination?.effectiveVisibility ?? ("members" as const),
        source: "email" as const,
        emailFrom: input.fromAddress,
        emailSubject: input.subject,
        emailMessageId: input.rfcMessageId || input.messageId,
        emailReceivedAt: input.receivedAt,
        // The person who published it. Unlike inbound mail — which arrives from
        // outside and has no user — this was somebody's deliberate act.
        uploadedByClerkUserId: ctx.userId,
      };

      const [message] = await tx
        .insert(schema.documents)
        .values({
          ...provenance,
          tenantId: ctx.tenantId,
          blobPathname: messagePath,
          fileName,
          mimeType: "message/rfc822",
          sizeBytes: input.raw.byteLength,
          sha256: rawSha,
          title: input.subject || "(no subject)",
          description: describeMessage(input),
          // The readable half. `extracted_text` feeds search_tsv, so filing a
          // message makes it findable from the Documents search box by what it
          // SAYS — which is most of why a copy is worth having.
          extractedText: input.transcript,
          extractionStatus: "done",
          metadata: mailMetadata(input, { kind: "message" }),
        })
        .returning({
          id: schema.documents.id,
          title: schema.documents.title,
          fileName: schema.documents.fileName,
        });

      for (const blob of attachmentBlobs) {
        await tx
          .insert(schema.documents)
          .values({
            ...provenance,
            tenantId: ctx.tenantId,
            blobPathname: blob.path,
            fileName: blob.fileName,
            mimeType: blob.mimeType,
            sizeBytes: blob.sizeBytes,
            sha256: blob.sha256,
            title: blob.fileName,
            description: `Attachment · ${input.subject || "(no subject)"}`,
            extractionStatus: "skipped",
            metadata: mailMetadata(input, {
              kind: "attachment",
              parentDocumentId: message.id,
            }),
          })
          .onConflictDoNothing();
      }

      // Inside the transaction, not fire-and-forget. This action publishes one
      // person's private correspondence to everyone in the business, and the
      // record of who did that must not be able to go missing while the copy
      // itself commits. Identifiers and counts only — never the subject, never
      // an address (S9).
      await logAuditInTx(tx, {
        action: "mail.message_filed",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "document",
        targetId: message.id,
        meta: {
          threadId: input.threadId,
          messageId: input.messageId,
          attachmentsFiled: attachmentBlobs.length,
          attachmentsRejected: rejected,
        },
      });

      return {
        entityType: "document",
        entityId: message.id,
        label: message.title || message.fileName,
        href: destinationHref(destination, null),
        destinationLabel: destination
          ? `the ${destination.name} folder`
          : "the Documents inbox",
        attachmentsFiled: attachmentBlobs.length,
        attachmentsRejected: rejected,
        alreadyFiled: false,
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );
}

interface Destination {
  id: string;
  name: string;
  effectiveVisibility: "members" | "owners";
}

/**
 * The folder a copy should go in, when the attach target names one.
 *
 * Only `folder` means anything here — attaching to an invoice names a business
 * record, not a place. Read through the caller's `tx`, so a folder RLS hides
 * from this person resolves to nothing and the copy falls back to the Inbox
 * rather than landing somewhere they cannot see.
 */
async function resolveDestination(
  tx: Tx,
  ctx: MailExtensionCtx,
  target: FiledMessageInput["target"],
): Promise<Destination | null> {
  if (target?.entityType !== "folder") return null;
  const rows = await tx
    .select({
      id: schema.documentFolders.id,
      name: schema.documentFolders.name,
      effectiveVisibility: schema.documentFolders.effectiveVisibility,
    })
    .from(schema.documentFolders)
    .where(
      and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        eq(schema.documentFolders.id, target.entityId),
      ),
    )
    .limit(1);
  const folder = rows[0];
  if (!folder) return null;
  return {
    id: folder.id,
    name: folder.name,
    effectiveVisibility:
      folder.effectiveVisibility === "owners" ? "owners" : "members",
  };
}

/**
 * Move an already-filed copy out of the Inbox into a folder somebody named —
 * the message AND its attachments.
 *
 * The attachments move too because they were filed by one act and belong in one
 * place; leaving them behind splits a single email across two locations, which
 * is a worse answer than either one on its own. They are found through
 * `metadata.mail.parentDocumentId`, the P2 bag written at filing time.
 *
 * Both updates are scoped to `folder_id is null`, so nothing is ever dragged out
 * of a folder somebody chose deliberately.
 */
async function moveToFolder(
  tx: Tx,
  tenantId: string,
  documentId: string,
  destination: Destination,
): Promise<boolean> {
  const values = {
    folderId: destination.id,
    filedAt: new Date(),
    effectiveVisibility: destination.effectiveVisibility,
    updatedAt: new Date(),
  };
  const moved = await tx
    .update(schema.documents)
    .set(values)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        eq(schema.documents.id, documentId),
        // Only out of the Inbox, never out of a folder somebody chose.
        isNull(schema.documents.folderId),
      ),
    )
    .returning({ id: schema.documents.id });
  if (moved.length === 0) return false;

  await tx
    .update(schema.documents)
    .set(values)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        isNull(schema.documents.folderId),
        sql`${schema.documents.metadata}->'mail'->>'parentDocumentId' = ${documentId}`,
      ),
    );
  return true;
}

function destinationHref(
  destination: Destination | null,
  existingFolderId: string | null,
): string {
  const folderId = destination?.id ?? existingFolderId;
  return folderId
    ? `/dashboard/m/documents/browse/${folderId}`
    : "/dashboard/m/documents/inbox";
}

/** Where an already-filed copy actually lives, said plainly. */
function describeExistingHome(
  existingFolderId: string | null,
  destination: Destination | null,
): string {
  if (existingFolderId === null) return "the Documents inbox";
  // It is already in SOME folder and we did not move it. Naming the folder the
  // person just picked would be a lie, so say what is true instead.
  return destination
    ? "the folder it was already filed in"
    : "Documents";
}

async function findFiledMessage(
  tx: Tx,
  tenantId: string,
  sha256: string,
): Promise<{
  id: string;
  title: string;
  fileName: string;
  folderId: string | null;
} | null> {
  const rows = await tx
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      fileName: schema.documents.fileName,
      folderId: schema.documents.folderId,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        eq(schema.documents.origin, "dms"),
        eq(schema.documents.sha256, sha256),
        ne(schema.documents.status, "trashed"),
      ),
    )
    .orderBy(desc(schema.documents.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** One line under the title in the browser, so a filed email reads as one. */
function describeMessage(input: FiledMessageInput): string {
  const who = input.fromName ? `${input.fromName} <${input.fromAddress}>` : input.fromAddress;
  const when = input.receivedAt ? input.receivedAt.toISOString().slice(0, 10) : "";
  return [`Email from ${who}`, when].filter(Boolean).join(" · ").slice(0, 500);
}

/**
 * Provenance in the P2 extension bag rather than in new columns.
 *
 * `documents.metadata` is `NOT NULL DEFAULT '{}'`, so `metadata->'mail'` is
 * always safe to ask for, and namespacing under one key keeps this out of the
 * way of whatever an industry pack stores beside it.
 */
function mailMetadata(
  input: FiledMessageInput,
  extra: { kind: "message" | "attachment"; parentDocumentId?: string },
): Record<string, unknown> {
  return {
    mail: {
      ...extra,
      threadId: input.threadId,
      messageId: input.messageId,
      rfcMessageId: input.rfcMessageId,
      // Recorded so the UI never has to imply the copy is live. It is a
      // point-in-time snapshot and this is the point in time.
      filedAt: new Date().toISOString(),
    },
  };
}

export const documentsMailExtension: MailExtension = {
  slug: "documents",
  moduleSlug: "documents",
  name: "Documents",
  entityTypes: [documentEntity, folderEntity],
  filing: {
    destinationLabel: "the Documents inbox",
    fileMessage,
  },
  images: {
    label: "Documents",
    search: searchImages,
    open: openImage,
  },
};

/* -- Pictures the composer can insert ------------------------------------ */

/**
 * The image types a composed message may carry inline.
 *
 * Narrower than the DMS allowlist on purpose. SVG is absent for the same reason
 * it is refused as a mail attachment and absent from the read path's sniff
 * table: it is a document that can carry script, not a picture, and this one is
 * going OUT under the user's own name where nothing of ours sanitizes it again.
 */
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Cap per inline image. Well under the mail server's own attachment limit. */
const MAX_INLINE_BYTES = 10 * 1024 * 1024;

/**
 * Documents as a source of pictures for the composer.
 *
 * Both hooks take the CALLER'S transaction, which is the whole security model:
 * `documents` carries RLS keyed on tenant and, through its folder, on
 * `effective_visibility`, so an owners-only folder's photograph is invisible to
 * a staff user without one predicate of ours. Nothing here filters on
 * visibility, and that is not an omission — it is the point.
 */
async function searchImages(
  tx: Tx,
  ctx: MailExtensionCtx,
  query: string,
  limit: number,
): Promise<MailImageCandidate[]> {
  const term = query.trim();
  const rows = await tx
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      fileName: schema.documents.fileName,
      mimeType: schema.documents.mimeType,
      sizeBytes: schema.documents.sizeBytes,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        ne(schema.documents.status, "trashed"),
        // A row with no blob is a placeholder, not a picture.
        sql`${schema.documents.blobPathname} is not null`,
        inArray(schema.documents.mimeType, [...INLINE_IMAGE_TYPES]),
        sql`${schema.documents.sizeBytes} <= ${MAX_INLINE_BYTES}`,
        // An empty query lists the most recent rather than nothing: this is a
        // picker somebody BROWSES, unlike the entity search, where an empty
        // query means the question has not been asked yet.
        ...(term.length > 0
          ? [
              sql`(${schema.documents.title} ilike ${contains(term)} or ${schema.documents.fileName} ilike ${contains(term)})`,
            ]
          : []),
      ),
    )
    .orderBy(desc(schema.documents.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    label: row.title || row.fileName || "Untitled",
    sublabel: describeSize(row.sizeBytes),
    size: row.sizeBytes,
    type: row.mimeType,
  }));
}

function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function openImage(
  tx: Tx,
  ctx: MailExtensionCtx,
  id: string,
): Promise<MailImageBlob | null> {
  const [row] = await tx
    .select({
      blobPathname: schema.documents.blobPathname,
      fileName: schema.documents.fileName,
      title: schema.documents.title,
      mimeType: schema.documents.mimeType,
      sizeBytes: schema.documents.sizeBytes,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, id),
        eq(schema.documents.tenantId, ctx.tenantId),
        ne(schema.documents.status, "trashed"),
      ),
    )
    .limit(1);

  // Null covers "not yours to see" and "not there" identically, deliberately:
  // a different answer for each would let somebody probe for the existence of
  // files in folders they cannot open.
  if (!row || !row.blobPathname) return null;
  if (!INLINE_IMAGE_TYPES.has(row.mimeType)) return null;
  if (row.sizeBytes > MAX_INLINE_BYTES) return null;

  const pathname = row.blobPathname;
  return {
    name: sanitizeFileName(row.fileName || row.title || "image"),
    type: row.mimeType,
    size: row.sizeBytes,
    // The fetch happens OUTSIDE this transaction — the house rule about network
    // work, and the reason this returns a thunk rather than bytes. By the time
    // it runs the row has already proved the caller may have the file.
    fetch: async () => {
      try {
        const bytes = await readBlobBytes(pathname);
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      } catch {
        // A blob that has gone since the row was read is a missing picture, not
        // an error worth failing a composer over.
        return null;
      }
    },
  };
}
