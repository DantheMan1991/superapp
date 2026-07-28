import "server-only";
import { and, desc, eq, ilike, inArray, ne, sql } from "drizzle-orm";
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
} from "@/lib/mail-extensions/types";
import { isAllowedUpload } from "../allowlist";
import { sha256Hex } from "../ingest";

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
  const existing = await withTenant(
    ctx.tenantId,
    (tx) => findFiledMessage(tx, ctx.tenantId, rawSha),
    { role: ctx.role, userId: ctx.userId },
  );
  if (existing) {
    return {
      entityType: "document",
      entityId: existing.id,
      label: existing.title || existing.fileName,
      href: "/dashboard/m/documents/inbox",
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
          href: "/dashboard/m/documents/inbox",
          attachmentsFiled: 0,
          attachmentsRejected: rejected,
          alreadyFiled: true,
        };
      }

      const provenance = {
        origin: "dms" as const,
        // The system Inbox, deliberately. Filing straight into a folder would
        // mean guessing which one, and a guess here is a visibility decision:
        // folders carry effective_visibility, so the wrong guess either hides
        // the correspondence from the people who need it or publishes it wider
        // than the person intended. The Inbox is where this cabinet already puts
        // things nobody has sorted yet.
        folderId: null,
        filedAt: null,
        effectiveVisibility: "members" as const,
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
        href: "/dashboard/m/documents/inbox",
        attachmentsFiled: attachmentBlobs.length,
        attachmentsRejected: rejected,
        alreadyFiled: false,
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );
}

async function findFiledMessage(
  tx: Tx,
  tenantId: string,
  sha256: string,
): Promise<{ id: string; title: string; fileName: string } | null> {
  const rows = await tx
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      fileName: schema.documents.fileName,
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
};
