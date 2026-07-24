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

/**
 * Fixed extra-hour blocks sold as one-time payments on top of the retainer.
 * Minutes are ALWAYS taken from this map server-side — never from Stripe
 * metadata — so a tampered checkout session can't inflate a credit.
 */
export const HOUR_BLOCKS = {
  five_hours: {
    key: "five_hours",
    name: "5-hour block",
    minutes: 300,
    priceEnv: "STRIPE_PRICE_HOURS_5",
    description: "Five extra hours of hands-on work. Never expires.",
  },
  ten_hours: {
    key: "ten_hours",
    name: "10-hour block",
    minutes: 600,
    priceEnv: "STRIPE_PRICE_HOURS_10",
    description: "Ten extra hours at a better rate. Never expires.",
  },
} as const;

export type HourBlockKey = keyof typeof HOUR_BLOCKS;

export function priceIdForHourBlock(block: HourBlockKey): string | undefined {
  return process.env[HOUR_BLOCKS[block].priceEnv];
}

/** Safe lookup for untrusted strings (webhook metadata). */
export function hourBlockForKey(key: string | undefined | null) {
  if (!key || !(key in HOUR_BLOCKS)) return null;
  return HOUR_BLOCKS[key as HourBlockKey];
}
