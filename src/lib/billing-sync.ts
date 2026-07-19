import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import { getStripe, planNameForPriceId } from "@/lib/stripe";

/**
 * Billing state is written only from trusted Stripe data: either a
 * signature-verified webhook event, or a direct server→Stripe API read
 * (reconcile). Never from anything the browser sends.
 */
export async function syncSubscription(
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
      console.error("stripe sync: no tenant for customer", customerId);
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

/**
 * Pull the tenant's latest subscription state straight from the Stripe API.
 * Covers environments where webhooks can't reach us (local dev) and heals
 * any missed webhook. No-op when Stripe isn't configured or the tenant has
 * no Stripe customer yet.
 */
export async function reconcileSubscriptionFromStripe(tenantId: string) {
  if (!process.env.STRIPE_SECRET_KEY) return;

  const row = await withSystem((tx) =>
    tx.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.tenantId, tenantId),
    }),
  );
  if (!row?.stripeCustomerId) return;

  try {
    const subs = await getStripe().subscriptions.list({
      customer: row.stripeCustomerId,
      status: "all",
      limit: 1,
    });
    const latest = subs.data[0];
    if (latest) await syncSubscription(latest, tenantId);
  } catch (err) {
    // Reconcile is best-effort; the page still renders from local state.
    console.error("stripe reconcile failed", err);
  }
}
