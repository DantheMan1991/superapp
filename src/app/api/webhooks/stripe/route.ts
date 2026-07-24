import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { logAudit } from "@/lib/audit";
import { syncSubscription } from "@/lib/billing-sync";
import { creditHourBlockFromSession } from "@/lib/retainer-billing";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Stripe → DB sync. The webhook signature is what makes it trustworthy;
 * unverified payloads are rejected before any side effects.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      // One-time hour-block purchase (no subscription attached). The
      // credit is self-idempotent (unique stripe_session_id), so a
      // redelivered event is harmless.
      if (session.mode === "payment" && session.metadata?.kind === "hour_block") {
        await creditHourBlockFromSession(session);
        break;
      }
      const tenantId = session.metadata?.tenantId;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (tenantId && subscriptionId) {
        const sub = await getStripe().subscriptions.retrieve(subscriptionId);
        await syncSubscription(sub, tenantId);
        await logAudit({
          action: "billing.subscription_started",
          tenantId,
          actorLabel: "stripe-webhook",
        });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await syncSubscription(sub, sub.metadata?.tenantId);
      if (event.type === "customer.subscription.deleted") {
        await logAudit({
          action: "billing.subscription_canceled",
          tenantId: sub.metadata?.tenantId ?? null,
          actorLabel: "stripe-webhook",
        });
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
