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
