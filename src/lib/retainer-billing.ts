import "server-only";
import { z } from "zod";
import { withSystem, schema } from "@/db";
import { logAudit } from "@/lib/audit";
import { getStripe, hourBlockForKey } from "@/lib/stripe";

/**
 * Hour-block credits — written only from trusted Stripe data (the
 * signature-verified webhook, or a server→Stripe re-retrieve on checkout
 * return). The retainer_purchases stripe_session_id unique constraint is
 * the idempotency arbiter: calling this N times with one session credits
 * once. Minutes come from HOUR_BLOCKS server-side, never from metadata.
 */

const metadataSchema = z.object({
  tenantId: z.string().uuid(),
  kind: z.literal("hour_block"),
  blockKey: z.string(),
});

interface CheckoutSessionLike {
  id: string;
  payment_status: string | null;
  amount_total: number | null;
  metadata: Record<string, string> | null | undefined;
}

export async function creditHourBlockFromSession(
  session: CheckoutSessionLike,
): Promise<{ credited: boolean }> {
  const parsed = metadataSchema.safeParse(session.metadata ?? {});
  if (!parsed.success) {
    console.error(`hour-block credit: bad metadata on session ${session.id}`);
    return { credited: false };
  }
  const block = hourBlockForKey(parsed.data.blockKey);
  if (!block) {
    console.error(
      `hour-block credit: unknown blockKey "${parsed.data.blockKey}" on session ${session.id}`,
    );
    return { credited: false };
  }
  if (session.payment_status !== "paid") return { credited: false };

  const { tenantId } = parsed.data;
  const rows = await withSystem((tx) =>
    tx
      .insert(schema.retainerPurchases)
      .values({
        tenantId,
        minutes: block.minutes,
        amountCents: session.amount_total ?? 0,
        stripeSessionId: session.id,
        blockKey: block.key,
      })
      .onConflictDoNothing({
        target: schema.retainerPurchases.stripeSessionId,
      })
      .returning({ id: schema.retainerPurchases.id }),
  );

  if (rows.length > 0) {
    await logAudit({
      action: "billing.hours_purchased",
      tenantId,
      actorLabel: "stripe-webhook",
      targetType: "retainer_purchase",
      targetId: rows[0].id,
      meta: {
        blockKey: block.key,
        minutes: block.minutes,
        amountCents: session.amount_total ?? 0,
      },
    });
  }
  return { credited: rows.length > 0 };
}

/**
 * Heal a missed webhook on checkout return (local dev has none). The URL
 * only supplies a session ID — the session re-retrieved from the Stripe API
 * is the trust anchor, and it must belong to the calling tenant.
 */
export async function reconcileHourBlockPurchase(
  tenantId: string,
  sessionId: string,
): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) return;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.tenantId !== tenantId) return;
    await creditHourBlockFromSession(session);
  } catch (err) {
    console.error("hour-block reconcile failed", err);
  }
}
