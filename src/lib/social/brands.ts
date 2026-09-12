/**
 * Which brand the Social screen is about — pure, so the screen and a test
 * decide it the same way, exactly as `chooseSite` does for the Website screen
 * ([ADR 0045](../../../docs/decisions/0045-a-business-may-have-several-websites-and-a-kit-may-belong-to-one.md),
 * [ADR 0047](../../../docs/decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md)).
 *
 * A brand here is one of the business's websites, or THE BUSINESS ITSELF, and
 * the second one is the whole reason this is not just `chooseSite` again.
 *
 * **WHEN THE BUSINESS APPEARS AS A BRAND OF ITS OWN**, and the third rule is
 * the one that matters:
 *
 *   1. There are no websites. Then the business is the only brand there is,
 *      and the screen never says the word "website" at all.
 *   2. There are several websites. Then an account shared between them has
 *      somewhere to live, which ADR 0047 says is a channel with no site.
 *   3. **There already ARE business-level accounts.** Without this, a business
 *      that added accounts before it had a website, and then built one, would
 *      find them unreachable — the picker would show one brand, the site, and
 *      the rows would simply be gone from the screen while sitting in the
 *      table. That is the "one of everything is the untested case" shape, and
 *      it is cheaper to hold open than to find later.
 *
 * With exactly one website and no such accounts, the site IS the business and
 * there is nothing to choose — the same promise `chooseSite` keeps.
 */

export const BUSINESS_BRAND_KEY = "business";

export interface Brand {
  /** A site id, or `business`. What goes in `?brand=`. */
  key: string;
  name: string;
  /** The column: a site's id, or null for the business's own. */
  siteId: string | null;
}

export function listBrands(
  sites: readonly { id: string; title: string; slug: string }[],
  businessName: string,
  hasBusinessChannels: boolean,
): Brand[] {
  const brands: Brand[] = sites.map((s) => ({
    key: s.id,
    name: s.title.trim() || s.slug,
    siteId: s.id,
  }));
  if (sites.length !== 1 || hasBusinessChannels) {
    brands.push({ key: BUSINESS_BRAND_KEY, name: businessName, siteId: null });
  }
  return brands;
}

/** The chosen brand, or nothing — which means: draw the list. */
export function chooseBrand(
  brands: readonly Brand[],
  asked: string | undefined,
): { brand: Brand | null; showList: boolean } {
  // One brand wins over anything asked for, so a stale `?brand=` in a bookmark
  // cannot strand a business on a list of one.
  if (brands.length === 1) return { brand: brands[0] ?? null, showList: false };
  const found = asked ? (brands.find((b) => b.key === asked) ?? null) : null;
  if (found) return { brand: found, showList: false };
  return { brand: null, showList: brands.length > 1 };
}
