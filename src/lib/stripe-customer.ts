import "server-only";
import { eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import { getStripe } from "@/lib/stripe";

export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/** Find or create the tenant's Stripe customer, persisting the id. */
export async function ensureCustomer(tenantId: string, tenantName: string) {
  const stripe = getStripe();
  const sub = await withSystem((tx) =>
    tx.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.tenantId, tenantId),
    }),
  );
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;

  const customer = await stripe.customers.create({
    name: tenantName,
    metadata: { tenantId },
  });

  await withSystem((tx) =>
    tx
      .update(schema.subscriptions)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(schema.subscriptions.tenantId, tenantId)),
  );

  return customer.id;
}
