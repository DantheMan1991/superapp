import "server-only";
import Stripe from "stripe";

let client: Stripe | undefined;

/** Lazy so the app builds and boots without Stripe configured. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set. See SETUP.md.");
  }
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

export const PLANS = {
  operations: {
    key: "operations",
    name: "Operations",
    priceEnv: "STRIPE_PRICE_OPERATIONS",
    description: "Platform access, your active modules, maintenance, on-call.",
  },
  business_office: {
    key: "business_office",
    name: "Business Office",
    priceEnv: "STRIPE_PRICE_BUSINESS_OFFICE",
    description:
      "Everything in Operations plus the expert layer — books reviewed, contracts checked, marketing running.",
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function priceIdForPlan(plan: PlanKey): string | undefined {
  return process.env[PLANS[plan].priceEnv];
}

export function planNameForPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  for (const plan of Object.values(PLANS)) {
    if (process.env[plan.priceEnv] === priceId) return plan.name;
  }
  return null;
}
