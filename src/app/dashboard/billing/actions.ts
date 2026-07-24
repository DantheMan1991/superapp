"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem, schema } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getStripe, PLANS, priceIdForPlan, type PlanKey } from "@/lib/stripe";
import { appUrl, ensureCustomer } from "@/lib/stripe-customer";

const checkoutSchema = z.object({
  plan: z.enum(["operations", "business_office"]),
  includeOnboardingFee: z.boolean().default(false),
});

/**
 * Start a Stripe Checkout for the tenant's subscription (owner only).
 * Card details never touch this server — Stripe hosts the payment page.
 */
export async function createCheckoutSession(input: {
  plan: PlanKey;
  includeOnboardingFee: boolean;
}): Promise<{ url?: string; error?: string }> {
  const ctx = await requireTenantOwner();
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid plan" };

  const priceId = priceIdForPlan(parsed.data.plan);
  if (!priceId) {
    return {
      error: `Billing isn't fully configured yet (missing ${PLANS[parsed.data.plan].priceEnv}).`,
    };
  }

  const stripe = getStripe();
  const customerId = await ensureCustomer(ctx.tenant.id, ctx.tenant.name);

  const lineItems: { price: string; quantity: number }[] = [
    { price: priceId, quantity: 1 },
  ];
  const onboardingPrice = process.env.STRIPE_PRICE_ONBOARDING;
  if (parsed.data.includeOnboardingFee && onboardingPrice) {
    lineItems.push({ price: onboardingPrice, quantity: 1 });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    subscription_data: { metadata: { tenantId: ctx.tenant.id } },
    metadata: { tenantId: ctx.tenant.id },
    success_url: appUrl("/dashboard/billing?status=success"),
    cancel_url: appUrl("/dashboard/billing?status=canceled"),
    allow_promotion_codes: true,
  });

  await logAudit({
    action: "billing.checkout_started",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    meta: { plan: parsed.data.plan },
  });

  return { url: session.url ?? undefined };
}

/** Stripe-hosted portal for payment method, invoices, cancellation. */
export async function createPortalSession(): Promise<{
  url?: string;
  error?: string;
}> {
  const ctx = await requireTenantOwner();

  const sub = await withSystem((tx) =>
    tx.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.tenantId, ctx.tenant.id),
    }),
  );
  if (!sub?.stripeCustomerId) {
    return { error: "No billing account yet — subscribe first." };
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: appUrl("/dashboard/billing"),
  });

  return { url: session.url };
}
