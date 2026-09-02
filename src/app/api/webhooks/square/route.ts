import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { markSquareRevoked } from "@/lib/payments/square/accounts";
import { squareWebhookUrl } from "@/lib/payments/square/config";
import { verifySquareSignature } from "@/lib/payments/square/signature";

export const runtime = "nodejs";

/**
 * **SQUARE EVENTS — THE TENANT'S OWN SQUARE ACCOUNT.**
 *
 * The third webhook in this codebase and the third signing scheme: Stripe's
 * two routes verify with the Stripe SDK; this one verifies Square's
 * `x-square-hmacsha256-signature` — HMAC-SHA256 over the notification URL plus
 * the raw body — in `src/lib/payments/square/signature.ts`, which is pure and
 * has a test with a known vector. Unverified payloads never reach a side effect.
 *
 * **ONE EVENT MATTERS TODAY.** `oauth.authorization.revoked` means the seller
 * withdrew Yosher's access from their Square dashboard; the rows for that
 * merchant close and their tokens are blanked. Everything else — payments,
 * payouts, Terminal checkouts — is acknowledged and ignored until the slice
 * that reads it exists. A 200 for an event we do not handle is correct:
 * retrying would not make us handle it.
 *
 * **THE TENANT IS RESOLVED FROM OUR OWN ROW BY MERCHANT ID**, never from
 * anything else in the payload. A forged event that somehow passed the
 * signature could at worst close a connection, never open one.
 *
 * **MISSING THIS ENDPOINT FAILS QUIETLY**, as the Connect one does: the page
 * reconciles on load, and a revoked token surfaces there as "needs
 * reconnecting". Acceptable while nothing acts on the connection without a
 * person present; the moment the till reads it, this endpoint stops being
 * optional.
 */
const EventSchema = z.object({
  merchant_id: z.string().min(1),
  type: z.string().min(1),
  event_id: z.string().optional(),
  created_at: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "SQUARE_WEBHOOK_SIGNATURE_KEY not configured" },
      { status: 500 },
    );
  }

  const payload = await req.text();
  const verified = verifySquareSignature({
    body: payload,
    signatureHeader: req.headers.get("x-square-hmacsha256-signature"),
    signatureKey: key,
    notificationUrl: squareWebhookUrl(),
  });
  if (!verified) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = EventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "unexpected shape" }, { status: 400 });
  }
  const event = parsed.data;

  if (event.type === "oauth.authorization.revoked") {
    try {
      const closed = await markSquareRevoked(event.merchant_id);
      for (const row of closed) {
        await logAudit({
          action: "payments.square_revoked",
          tenantId: row.tenantId,
          actorLabel: "square-webhook",
          targetType: "payment_account",
          targetId: row.paymentAccountId,
          meta: { merchantId: event.merchant_id },
        });
      }
    } catch (err) {
      // 500 so Square retries. A silent 200 on a failed write is the shape that
      // leaves a revoked account looking connected for good.
      console.error("square webhook revocation failed", event.merchant_id, err);
      return NextResponse.json({ error: "revocation failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
