import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import { logAudit } from "@/lib/audit";
import { getStripe, planNameForPriceId } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Stripe → DB sync. Billing state in our tables is written ONLY here (and by
 * ensureCustomer storing the customer id) — the webhook signature is what
 * makes it trustworthy.
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

async function syncSubscription(
  sub: Stripe.Subscription,
  tenantIdHint?: string | null,
) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const firstItem = sub.items?.data?.[0];
  const priceId = firstItem?.price?.id ?? null;
  // current_period_end lives on the item in newer API versions.
  const periodEndUnix =
    firstItem?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;

  await withSystem(async (tx) => {
    let tenantId = tenantIdHint ?? null;
    if (!tenantId) {
      const row = await tx.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.stripeCustomerId, customerId),
      });
      tenantId = row?.tenantId ?? null;
    }
    if (!tenantId) {
      console.error("stripe webhook: no tenant for customer", customerId);
      return;
    }

    await tx
      .update(schema.subscriptions)
      .set({
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        status: sub.status,
        priceId,
        planName: planNameForPriceId(priceId),
        currentPeriodEnd: periodEndUnix
          ? new Date(periodEndUnix * 1000)
          : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptions.tenantId, tenantId));

    // First successful subscription flips the tenant to active.
    if (sub.status === "active" || sub.status === "trialing") {
      await tx
        .update(schema.tenants)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(schema.tenants.id, tenantId));
    }
  });
}
