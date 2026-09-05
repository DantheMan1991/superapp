import "server-only";
import type { Tx } from "@/db";
import { retailPricesBlock } from "@/packs/retail/site-blocks";
import type { SiteBlockProvider } from "./types";

/**
 * Which packs may put a block on a tenant's website (slice 9b, ADR 0028).
 *
 * **THIS FILE EXISTS SO THAT THE SITE NEVER NAMES A PACK**, the job
 * `src/lib/basis-lens/registry.ts`, `mail-extensions/registry.ts` and
 * `src/packs/run-handlers.ts` do for their seams: **a registry may know
 * that several things exist; no individual module or pack may.** The site
 * imports `@/lib/site-blocks/resolve`; the pack is named here and nowhere
 * else in that chain.
 *
 * GATED ON THE PACK BEING SWITCHED ON, unlike the basis lens: a price list
 * is a thing the business shows the public, and a business that turned
 * Retail off has stopped showing it. `resolve.ts` reads the tenant's
 * enabled packs inside the page's own transaction and offers or draws
 * nothing for the rest.
 *
 * The shop block (`retail` slice 6, online orders and pickup windows) is
 * the next provider on this list, and needs nothing new from the site.
 */
export const SITE_BLOCK_PROVIDERS: SiteBlockProvider<Tx>[] = [retailPricesBlock];
