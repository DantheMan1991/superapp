import { z } from "zod";

/**
 * Inbound email parsing — pure, fully unit-testable. The webhook route
 * verifies the svix signature and hands the JSON here; nothing in this
 * file touches the network or the database.
 */

export const MAX_EMAIL_ATTACHMENTS = 10;

/** Per-tenant hourly cap on email-ingested documents (abuse valve). */
export const EMAIL_INGEST_HOURLY_CAP = 100;

const TOKEN_LOCAL_PART = /^receipts-([A-Za-z0-9_-]{10,})$/i;

/**
 * Find our forwarding token among the email's recipients. The mailbox
 * prefix and domain match case-insensitively, but the TOKEN keeps its
 * case — base64url tokens are case-sensitive DB keys. Scans to/cc plus
 * `received_for` (the envelope recipient — catches BCC and forwards).
 * Returns the first token found, or null.
 */
export function parseInboundToken(
  addresses: readonly string[],
  domain: string,
): string | null {
  const wantDomain = domain.trim().toLowerCase();
  if (!wantDomain) return null;
  for (const raw of addresses) {
    // Tolerate "Display Name <addr@host>" forms.
    const angled = /<([^<>]+)>/.exec(raw);
    const addr = (angled ? angled[1] : raw).trim();
    const at = addr.lastIndexOf("@");
    if (at < 0) continue;
    if (addr.slice(at + 1).toLowerCase() !== wantDomain) continue;
    const m = TOKEN_LOCAL_PART.exec(addr.slice(0, at));
    if (m) return m[1];
  }
  return null;
}

/** The subset of Resend's email.received payload the webhook consumes. */
export const inboundEmailSchema = z.object({
  type: z.literal("email.received"),
  data: z.object({
    email_id: z.string().min(1),
    from: z.string().default(""),
    to: z.array(z.string()).default([]),
    cc: z.array(z.string()).nullish(),
    received_for: z.array(z.string()).nullish(),
    message_id: z.string().default(""),
    subject: z.string().default(""),
    created_at: z.string().default(""),
    attachments: z
      .array(
        z.object({
          id: z.string().optional(),
          filename: z.string().nullish(),
          content_type: z.string().default(""),
          size: z.number().default(0),
        }),
      )
      .default([]),
  }),
});

export type InboundEmail = z.infer<typeof inboundEmailSchema>;

/** Every address worth scanning for the routing token. */
export function inboundRecipients(email: InboundEmail): string[] {
  return [
    ...email.data.to,
    ...(email.data.cc ?? []),
    ...(email.data.received_for ?? []),
  ];
}

/** Floor for regular attachments (tracking pixels, stray icons). */
export const MIN_ATTACHMENT_BYTES = 8 * 1024;
/**
 * Floor for INLINE images considered as documents. Signature logos are
 * typically well under this; a pasted receipt photo is well over it.
 */
export const MIN_INLINE_IMAGE_BYTES = 100 * 1024;

export interface EmailAttachmentMeta {
  content_type: string;
  size: number;
  content_disposition?: string | null;
}

/**
 * Decide which of an email's files are documents worth ingesting.
 * Signature logos and tracking pixels arrive as INLINE images alongside
 * the real bill; the rules that separate them:
 *  - PDFs are always documents, inline or not.
 *  - Regular (disposition "attachment") files are documents.
 *  - Inline images count ONLY when the email has no regular document at
 *    all (a receipt photo pasted into the body) AND they are large
 *    enough to plausibly be a photo, not a logo.
 * Caller applies the allowlist/size caps via isAllowedUpload; this
 * function layers the disposition heuristics on top and caps the count.
 */
export function selectEmailAttachments<T extends EmailAttachmentMeta>(
  attachments: readonly T[],
  isAllowed: (mimeType: string, sizeBytes: number) => boolean,
): T[] {
  const allowed = attachments.filter((a) => isAllowed(a.content_type, a.size));
  const isInlineImage = (a: EmailAttachmentMeta) =>
    a.content_disposition === "inline" && a.content_type !== "application/pdf";
  const regular = allowed.filter(
    (a) => !isInlineImage(a) && a.size >= MIN_ATTACHMENT_BYTES,
  );
  if (regular.length > 0) return regular.slice(0, MAX_EMAIL_ATTACHMENTS);
  return allowed
    .filter((a) => isInlineImage(a) && a.size >= MIN_INLINE_IMAGE_BYTES)
    .slice(0, MAX_EMAIL_ATTACHMENTS);
}
