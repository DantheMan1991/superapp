/**
 * The two words a business is most likely to want renamed: the people it
 * invoices and the people it buys from.
 *
 * **NO DIRECTIVE, AND ITS ONLY IMPORT IS ITSELF PURE** — client components read
 * this, so importing anything that reaches `src/db/schema` would drag drizzle
 * into the bundle. `lib/packs/resolve.ts` is safe by its own header ("PURE — no
 * `server-only`, no database, no registry import"), which is why the plural rule
 * can live there and be shared rather than copied here. Otherwise the same
 * arrangement as `lib/enterprises/vocabulary.ts` and every pack's.
 *
 * ── WHY CORE OWNS THESE AT ALL ──────────────────────────────────────────────
 *
 * Until 2026-09-13 every renameable word in the product came from a PACK. The
 * two nouns that appear on an invoice were hardcoded English, which
 * `docs/modules/packs-and-profiles.md` had been calling "the bigger gap" since
 * Layer 2 shipped: *"'customer' and 'invoice' are exactly the words an industry
 * renames."* The construction pilot is the business that forced it — it says
 * **client**, and nothing could make the invoice say so.
 *
 * The keys are declared on the `accounting` module (`src/modules/index.ts`),
 * which is where the Customers and Vendors pages live. CRM and Mail render them
 * too; a feature displaying another's word is the ordinary case, the way
 * `livestock` displays `land`'s `zone`.
 *
 * **NOT `client`.** That key belongs to `professional-services`, and a second
 * claim on it would be a registry conflict. A profile renames `customer` TO
 * "Client", which is the mechanism working rather than a workaround.
 */

import { pluralOf } from "@/lib/packs/resolve";

export const CUSTOMER_KEY = "customer";
export const CUSTOMER_FALLBACK = "Customer";
export const CUSTOMER_FALLBACK_PLURAL = "Customers";

export const VENDOR_KEY = "vendor";
export const VENDOR_FALLBACK = "Vendor";
export const VENDOR_FALLBACK_PLURAL = "Vendors";

/** Every key this file names, for the test that proves each one is declared. */
export const PARTY_LABEL_KEYS = [CUSTOMER_KEY, VENDOR_KEY] as const;

/** The four words a screen needs, resolved once. */
export interface PartyWords {
  customer: string;
  customers: string;
  vendor: string;
  vendors: string;
}

/**
 * Resolve both words and both plurals from a tenant's labels.
 *
 * **ONE KEY PER WORD, and the plural comes from the shared rule.** An earlier
 * draft of this slice declared `customerPlural` and `vendorPlural` as keys of
 * their own so an irregular plural could be overridden. That was wrong twice
 * over: it put four rows in the admin editor where two belong, and — worse — it
 * disagreed with `buildVocabulary`, which the tenant GUIDES already used, so a
 * guide and the screen it describes could have printed different plurals of the
 * same word. `pluralOf` is now the single rule both call.
 *
 * The cost is that a tenant cannot correct "Clienteles". That is the behaviour
 * the product already had for every other word, the case is rare, and inventing
 * a second mechanism for it before anybody asked is exactly the speculation this
 * codebase keeps warning about.
 *
 * Pure, and takes the resolved label map rather than the tenant row, so a client
 * component can call it with what the provider handed it and a server component
 * with what `labelsForTenant` returned.
 */
export function partyWords(labels: Record<string, string>): PartyWords {
  const customer = labels[CUSTOMER_KEY] || CUSTOMER_FALLBACK;
  const vendor = labels[VENDOR_KEY] || VENDOR_FALLBACK;
  return {
    customer,
    customers: pluralOf(customer, CUSTOMER_FALLBACK, CUSTOMER_FALLBACK_PLURAL),
    vendor,
    vendors: pluralOf(vendor, VENDOR_FALLBACK, VENDOR_FALLBACK_PLURAL),
  };
}
