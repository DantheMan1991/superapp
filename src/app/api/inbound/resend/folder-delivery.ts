import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { isModuleEnabled } from "@/lib/modules";
import { getResend } from "@/lib/resend";
import { selectEmailAttachments } from "@/lib/inbound-attachments";
import { isAllowedUpload } from "@/modules/documents/allowlist";
import {
  acceptsInboundMail,
  createInboundDocument,
  folderIngestCount,
  FOLDER_INGEST_HOURLY_CAP,
  resolveFolderByToken,
  storeInboundAttachment,
} from "@/modules/documents/inbound";

/**
 * Delivering an inbound email into a Documents folder.
 *
 * Lives beside the route rather than inside the Documents module because it
 * needs the mail provider and the shared attachment rules, and the module's
 * boundary rule is that nothing under src/modules/documents/ imports another
 * module. The module owns the decisions; this owns the plumbing.
 *
 * Trust model is the route's: the svix signature made the payload
 * trustworthy, withSystem does the token → folder hop and nothing else, and
 * every write runs inside withTenant.
 */

const SYSTEM_ACTOR = "system:email";

export interface FolderDeliveryEmail {
  emailId: string;
  from: string;
  subject: string;
  messageId: string;
  receivedAt: Date;
}

export async function deliverToFolder(
  token: string,
  email: FolderDeliveryEmail,
): Promise<{ handled: boolean; created: number; reason?: string }> {
  // The one god-view lookup: token → folder. Nothing else uses it.
  const folder = await withSystem((tx) => resolveFolderByToken(tx, token));
  if (!folder) return { handled: false, created: 0, reason: "unknown_token" };

  if (!(await isModuleEnabled(folder.tenantId, "documents"))) {
    return { handled: true, created: 0, reason: "module_off" };
  }

  // The folder may have been closed to staff since the address was handed
  // out. Accepting mail into it now would let an outsider keep writing into
  // somewhere the business has deliberately shut.
  if (!acceptsInboundMail(folder)) {
    await audit(folder.tenantId, "documents.email_refused", {
      folderId: folder.id,
      reason: "folder_restricted",
      emailId: email.emailId,
    });
    return { handled: true, created: 0, reason: "folder_restricted" };
  }

  const recent = await withTenant(
    folder.tenantId,
    (tx) => folderIngestCount(tx, folder.tenantId, folder.id),
    { role: "owner" },
  );
  if (recent >= FOLDER_INGEST_HOURLY_CAP) {
    await audit(folder.tenantId, "documents.email_rate_limited", {
      folderId: folder.id,
      emailId: email.emailId,
    });
    return { handled: true, created: 0, reason: "rate_limited" };
  }

  // The webhook payload is metadata only; the bytes are fetched separately so
  // attachment size never has to fit in a request body.
  const listed = await getResend().emails.receiving.attachments.list({
    emailId: email.emailId,
  });
  if (listed.error) {
    throw new Error(`attachments.list failed: ${listed.error.message}`);
  }
  const attachments = selectEmailAttachments(
    listed.data?.data ?? [],
    isAllowedUpload,
  );

  let created = 0;
  for (const attachment of attachments) {
    const fileName = attachment.filename || "attachment";

    // Attachment-level idempotency: svix retries must not duplicate a file.
    const exists = await withTenant(
      folder.tenantId,
      (tx) =>
        tx.query.documents.findFirst({
          where: and(
            eq(schema.documents.tenantId, folder.tenantId),
            eq(schema.documents.emailMessageId, email.messageId),
            eq(schema.documents.fileName, fileName),
          ),
        }),
      { role: "owner" },
    );
    if (exists) continue;

    const res = await fetch(attachment.download_url);
    if (!res.ok) throw new Error(`attachment download failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());

    // Re-checked against the REAL bytes, not the provider's claimed size.
    if (!isAllowedUpload(attachment.content_type, bytes.byteLength)) continue;

    // Blob write happens outside any transaction.
    const pathname = await storeInboundAttachment(
      folder.tenantId,
      fileName,
      attachment.content_type,
      bytes,
    );

    const result = await withTenant(
      folder.tenantId,
      async (tx) => {
        const doc = await createInboundDocument(tx, folder.tenantId, folder, {
          blobPathname: pathname,
          fileName,
          mimeType: attachment.content_type,
          sizeBytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          emailFrom: email.from.slice(0, 300),
          emailSubject: email.subject.slice(0, 300),
          emailMessageId: email.messageId.slice(0, 300),
          emailReceivedAt: email.receivedAt,
        });
        if (doc) {
          await logAuditInTx(tx, {
            action: "documents.email_filed",
            tenantId: folder.tenantId,
            actorLabel: SYSTEM_ACTOR,
            targetType: "document",
            targetId: doc.documentId,
            // Sender domain, not the address: the sender is a third party and
            // the audit log is identifiers-only. The full address is on the
            // document row, which is the tenant's own record.
            meta: {
              folderId: folder.id,
              mimeType: attachment.content_type,
              sizeBytes: bytes.byteLength,
              fromDomain: email.from.split("@").pop()?.slice(0, 100) ?? "",
            },
          });
        }
        return doc;
      },
      // The folder is members-visible (checked above), but the write sets
      // effective_visibility and RLS's WITH CHECK is stricter for staff.
      { role: "owner" },
    );
    if (result) created += 1;
  }

  return { handled: true, created };
}

async function audit(
  tenantId: string,
  action: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await withTenant(
    tenantId,
    (tx) => logAuditInTx(tx, { action, tenantId, actorLabel: SYSTEM_ACTOR, meta }),
    { role: "owner" },
  );
}
