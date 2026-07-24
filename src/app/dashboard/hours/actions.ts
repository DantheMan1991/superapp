"use server";

import { z } from "zod";
import { requireTenantOwner } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  getStripe,
  HOUR_BLOCKS,
  priceIdForHourBlock,
  type HourBlockKey,
} from "@/lib/stripe";
import { appUrl, ensureCustomer } from "@/lib/stripe-customer";

const buySchema = z.object({
  block: z.enum(["five_hours", "ten_hours"]),
});

/**
 * One-time Stripe Checkout for an extra-hour block (owner only). The
 * webhook (or the reconcile on return) credits the purchase — this action
 * never writes hours itself.
 */
export async function createHourBlockCheckout(input: {
  block: HourBlockKey;
}): Promise<{ url?: string; error?: string }> {
  const ctx = await requireTenantOwner();
  const parsed = buySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid block" };

  const block = HOUR_BLOCKS[parsed.data.block];
  const priceId = priceIdForHourBlock(parsed.data.block);
  if (!priceId) {
    return {
      error: `Billing isn't fully configured yet (missing ${block.priceEnv}).`,
    };
  }

  const stripe = getStripe();
  const customerId = await ensureCustomer(ctx.tenant.id, ctx.tenant.name);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      tenantId: ctx.tenant.id,
      kind: "hour_block",
      blockKey: block.key,
    },
    success_url: appUrl(
      "/dashboard/hours?status=success&session_id={CHECKOUT_SESSION_ID}",
    ),
    cancel_url: appUrl("/dashboard/hours?status=canceled"),
  });

  await logAudit({
    action: "billing.hour_block_checkout_started",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    meta: { block: block.key },
  });

  return { url: session.url ?? undefined };
}
