import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withSystem } from "@/db";

export const runtime = "nodejs";

/**
 * Delivery events from the email provider: delivered, bounced, complained.
 *
 * Same trust model as the inbound webhook and the Clerk/Stripe ones — the svix
 * signature is what makes the payload trustworthy, and nothing here reads a
 * tenant id from the request. The provider's message id resolves the row, and
 * the row carries the tenant.
 *
 * Why this matters more than it looks: an unnoticed bounce is the single most
 * common way an email workflow dies silently. The sender believes the invoice
 * went out, the customer never got it, and nobody finds out until someone
 * chases payment. Recording the bounce is what makes the send log honest.
 */

const eventSchema = z.object({
  type: z.string(),
  data: z.object({
    email_id: z.string().optional(),
    id: z.string().optional(),
  }),
});

/** Provider event -> our status. Anything else is acknowledged and ignored. */
const STATUS_BY_TYPE: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.delivery_delayed": "sent",
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.RESEND_EVENTS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "email events not configured" },
      { status: 500 },
    );
  }

  const payload = await req.text();
  let verified: unknown;
  try {
    verified = new Webhook(secret).verify(payload, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    });
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(verified);
  if (!parsed.success) {
    // Signed, but not a shape we handle. Ack so it is not retried forever.
    return NextResponse.json({ ignored: true });
  }

  const status = STATUS_BY_TYPE[parsed.data.type];
  const messageId = parsed.data.data.email_id ?? parsed.data.data.id;
  if (!status || !messageId) {
    return NextResponse.json({ ignored: true });
  }

  // Delivery status is the provider's word about what happened, so it is
  // written by trusted code only — outbound_emails is member_read-only.
  await withSystem((tx) =>
    tx
      .update(schema.outboundEmails)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.outboundEmails.providerMessageId, messageId)),
  );

  return NextResponse.json({ ok: true });
}
