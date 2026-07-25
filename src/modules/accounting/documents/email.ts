import { z } from "zod";
import { parseTokenForPrefix } from "@/lib/inbound-address";

/**
 * Inbound email parsing — pure, fully unit-testable. The webhook route
 * verifies the svix signature and hands the JSON here; nothing in this
 * file touches the network or the database.
 */


/** Per-tenant hourly cap on email-ingested documents (abuse valve). */
export const EMAIL_INGEST_HOURLY_CAP = 100;

/**
 * Find this module's forwarding token among an email's recipients.
 *
 * The matching itself now lives in src/lib/inbound-address.ts, shared with the
 * Documents module's folder addresses on the same domain. The details that
 * matter — case-insensitive matching with a lowercased result (Outlook
 * lowercases forwarded addresses, learned in production) and scanning the
 * envelope recipient so BCCs and forwards are caught — are documented there.
 */
export function parseInboundToken(
  addresses: readonly string[],
  domain: string,
): string | null {
  return parseTokenForPrefix(addresses, domain, "receipts");
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

/**
 * Attachment-selection rules now live in src/lib/inbound-attachments.ts,
 * shared with the Documents module's folder addresses. Re-exported here so
 * this module's callers and tests keep a single import site.
 */
export {
  MAX_EMAIL_ATTACHMENTS,
  MIN_ATTACHMENT_BYTES,
  MIN_INLINE_IMAGE_BYTES,
  selectEmailAttachments,
  type EmailAttachmentMeta,
} from "@/lib/inbound-attachments";
