import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { and, eq, gt } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { isModuleEnabled } from "@/lib/modules";
import { getResend } from "@/lib/resend";
import { tryExtractDocument } from "@/modules/accounting/ai/extract";
import { isAllowedUpload } from "@/modules/accounting/documents/allowlist";
import {
  EMAIL_INGEST_HOURLY_CAP,
  inboundEmailSchema,
  inboundRecipients,
  parseInboundToken,
  selectEmailAttachments,
} from "@/modules/accounting/documents/email";
import {
  createDocumentRecord,
  sha256Hex,
  storeEmailAttachment,
} from "@/modules/accounting/documents/ingest";

export const runtime = "nodejs";

/** Actor label for audit rows — email ingestion has no Clerk user. */
const SYSTEM_ACTOR = "system:email";

/**
 * Resend inbound email → receipt inbox. Trust model mirrors the Stripe
 * and Clerk webhooks exactly: the svix signature makes the payload
 * trustworthy; the forwarding-address token resolves the tenant via a
 * read-only withSystem lookup; every write runs inside withTenant.
 * Unknown or disabled tokens answer 200 (no retries, no validity oracle).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  if (!secret || !domain) {
    return NextResponse.json(
      { error: "inbound email not configured" },
      { status: 500 },
    );
  }

  const payload = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };
  let verified: unknown;
  try {
    verified = new Webhook(secret).verify(payload, headers);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const parsed = inboundEmailSchema.safeParse(verified);
  if (!parsed.success) {
    // Signed but not an email.received we understand — ack, don't retry.
    return NextResponse.json({ ignored: true });
  }
  const email = parsed.data;

  const token = parseInboundToken(inboundRecipients(email), domain);
  if (!token) return NextResponse.json({ ignored: true });

  // Read-only god-view lookup: token → tenant. Writes never use this.
  const settings = await withSystem((tx) =>
    tx.query.accountingSettings.findFirst({
      where: eq(schema.accountingSettings.inboundEmailToken, token),
    }),
  );
  if (!settings) return NextResponse.json({ ignored: true });
  const tenantId = settings.tenantId;
  if (!(await isModuleEnabled(tenantId, "accounting"))) {
    return NextResponse.json({ ignored: true });
  }

  try {
    // Abuse valve: per-tenant hourly cap on email-ingested documents.
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const recent = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.tenantId, tenantId),
            eq(schema.documents.source, "email"),
            gt(schema.documents.createdAt, hourAgo),
          ),
        ),
    );
    if (recent.length >= EMAIL_INGEST_HOURLY_CAP) {
      await withTenant(tenantId, (tx) =>
        logAuditInTx(tx, {
          action: "documents.email_rate_limited",
          tenantId,
          actorLabel: SYSTEM_ACTOR,
          meta: { emailId: email.data.email_id },
        }),
      );
      return NextResponse.json({ ignored: true, reason: "rate_limited" });
    }

    const emailMeta = {
      emailFrom: email.data.from.slice(0, 300),
      emailSubject: email.data.subject.slice(0, 300),
      emailMessageId: email.data.message_id.slice(0, 300),
      emailReceivedAt: email.data.created_at
        ? new Date(email.data.created_at)
        : new Date(),
    };

    // Fetch signed attachment URLs (the webhook payload is metadata-only;
    // this is why Resend — attachment size never hits our request body).
    const listed = await getResend().emails.receiving.attachments.list({
      emailId: email.data.email_id,
    });
    if (listed.error) {
      throw new Error(`attachments.list failed: ${listed.error.message}`);
    }
    // Disposition-aware selection: real attachments in, signature logos
    // and tracking pixels out (see selectEmailAttachments for the rules).
    const attachments = selectEmailAttachments(
      listed.data?.data ?? [],
      isAllowedUpload,
    );

    const createdIds: string[] = [];
    for (const attachment of attachments) {
      const fileName = attachment.filename || "attachment";
      // Attachment-level idempotency: svix retries must not duplicate.
      const exists = await withTenant(tenantId, (tx) =>
        tx.query.documents.findFirst({
          where: and(
            eq(schema.documents.tenantId, tenantId),
            eq(schema.documents.emailMessageId, emailMeta.emailMessageId),
            eq(schema.documents.fileName, fileName),
          ),
        }),
      );
      if (exists) continue;

      const res = await fetch(attachment.download_url);
      if (!res.ok) {
        throw new Error(`attachment download failed: ${res.status}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!isAllowedUpload(attachment.content_type, bytes.byteLength)) continue;

      const pathname = await storeEmailAttachment(
        tenantId,
        fileName,
        attachment.content_type,
        bytes,
      );
      const created = await withTenant(tenantId, async (tx) => {
        const r = await createDocumentRecord(tx, tenantId, {
          blobPathname: pathname,
          fileName,
          mimeType: attachment.content_type,
          sizeBytes: bytes.byteLength,
          sha256: sha256Hex(bytes),
          source: "email",
          ...emailMeta,
        });
        await logAuditInTx(tx, {
          action: "documents.email_received",
          tenantId,
          actorLabel: SYSTEM_ACTOR,
          targetType: "document",
          targetId: r.document.id,
          meta: {
            emailId: email.data.email_id,
            sizeBytes: bytes.byteLength,
            mimeType: attachment.content_type,
            duplicateOfId: r.duplicateOfId,
          },
        });
        return r.document;
      });
      createdIds.push(created.id);
    }

    // Provenance is never dropped: an email with no usable attachment
    // still leaves a row in the inbox.
    if (attachments.length === 0) {
      await withTenant(tenantId, async (tx) => {
        const existing = await tx.query.documents.findFirst({
          where: and(
            eq(schema.documents.tenantId, tenantId),
            eq(schema.documents.emailMessageId, emailMeta.emailMessageId),
            eq(schema.documents.fileName, "(no attachment)"),
          ),
        });
        if (existing) return;
        const r = await createDocumentRecord(tx, tenantId, {
          blobPathname: null,
          fileName: "(no attachment)",
          mimeType: "",
          sizeBytes: 0,
          sha256: "",
          source: "email",
          extractionStatus: "skipped",
          ...emailMeta,
        });
        await logAuditInTx(tx, {
          action: "documents.email_received",
          tenantId,
          actorLabel: SYSTEM_ACTOR,
          targetType: "document",
          targetId: r.document.id,
          meta: { emailId: email.data.email_id, noAttachment: true },
        });
      });
    }

    // Auto-extraction after the ingest transactions committed. The
    // per-tenant cooldown means later attachments in a batch may stay
    // pending — the manual Extract button covers them.
    for (const id of createdIds) {
      await tryExtractDocument(
        { tenantId, userId: SYSTEM_ACTOR, role: "owner" },
        id,
      );
    }

    return NextResponse.json({ processed: createdIds.length });
  } catch (err) {
    // 500 → svix retries; attachment-level idempotency makes that safe.
    console.error("inbound email processing failed", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
