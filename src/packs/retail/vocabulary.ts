/**
 * Retail vocabulary. NO IMPORTS AND NO DIRECTIVE — client components read this,
 * and importing from `src/db/schema` would drag drizzle into the bundle. Same
 * arrangement as every other pack's.
 *
 * NOTE WHAT IS NOT HERE: a list of channels. A pack that knows what a farmers
 * market is has the boundary wrong (ADR 0004) — kinds come from the installed
 * profile's `packConfig`, which is why `channelKindsFrom` reads config rather
 * than declaring anything.
 */

/** A channel is open for business or it is not. CLOSED — there is no third state. */
export const CHANNEL_STATUSES = ["active", "closed"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  active: "Selling",
  closed: "Closed",
};

/**
 * **WHAT A PRICE IS PER, AND IT IS A CLOSED SET.**
 *
 * `'unit'` is per the item's stocking unit — a package, a head, a dozen, a
 * pound of feed — and is what every price in the system meant before catch
 * weight existed. `'lb'` is per pound of what is actually handed over, which is
 * the case a package with a weight creates: *"sometimes just sold by the
 * package or by the weight."*
 *
 * Closed for `production`'s `PRICE_UNITS` reason, and it is the stronger reason
 * here because this decides MONEY: a basis nothing implements has to be refused
 * on the way in, not fall through to whichever branch happens to be last. The
 * CHECK on `retail_prices.price_basis` says the same thing in the table.
 *
 * See [ADR 0016](../../../docs/decisions/0016-a-catch-weight-item-is-stocked-in-packages.md).
 */
export const PRICE_BASES = ["unit", "lb"] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export function isPriceBasis(value: string): value is PriceBasis {
  return (PRICE_BASES as readonly string[]).includes(value);
}

/**
 * How a basis reads beside a figure. Short, because it sits after the money.
 *
 * `'unit'` deliberately renders as the item's own unit rather than the word
 * "unit", which means nothing to anybody: "$22.00 each", "$8.00 per lb".
 */
export function priceBasisLabel(basis: string, unitSingular: string): string {
  return basis === "lb" ? "per lb" : `per ${unitSingular}`;
}

/** Mirrors the `_format` CHECKs. Kept in sync by tests/retail.test.ts. */
export const SLUG_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_FORMAT.test(value);
}

/** "farmers_market" → "Farmers market". Slugs are for machines. */
export function slugLabel(slug: string): string {
  const spaced = slug.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Channel-kind suggestions from the installed profile's `packConfig`.
 *
 * TOTAL BY CONSTRUCTION, like `speciesFrom` and `runKindsFrom`:
 * `tenant_modules.config` is jsonb with no shape constraint and most tenants
 * have no profile, so anything unreadable means an empty list and a free-text
 * field — never a crash.
 */
export function channelKindsFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).channelKinds;
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === "string" && v !== "");
    }
  }
  return [];
}
