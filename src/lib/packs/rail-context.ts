/**
 * "I AM WORKING ON THE CABINET SHOP TODAY" (ADR 0090, extended by ADR 0091).
 *
 * A workspace holds companies, and a company holds divisions. Either can be a
 * side of the business worth putting a menu together for:
 *
 * - **A company is in a line of business**, so its packs follow from the
 *   installed profile. Shrock Premier builds; construction lists `assets`,
 *   `inventory` and `jobs`; that is the menu.
 * - **…until the company says otherwise** (ADR 0092). A profile lists the packs
 *   a TRADE uses, and a company is one business inside one: Shrock Prefab is in
 *   construction and runs a factory. So the profile is the default and
 *   `entities.packs` is the override — and a company that has said its own
 *   tools becomes a side named after ITSELF, because it no longer shares a menu
 *   with the others in its trade.
 * - **A division is not an industry**, and there will never be a cabinet-shop
 *   profile. *Cabinet Shop* wants Jobs for its change orders and its estimates,
 *   Production for the runs and Inventory for the sheet goods — a set nothing
 *   can infer from a manifest. So a division carries the list itself.
 *
 * All three end up as the same thing here: a name, a line underneath, and the
 * packs it uses. Everything downstream reads `packs` and never asks which kind
 * it came from.
 *
 * ── IT IS A VIEW. IT SCOPES NOTHING. ────────────────────────────────────────
 *
 * No query filters on it, no policy reads it, every page stays reachable by
 * URL, and the books are untouched — accounting's company picker keeps its own
 * `?entity=`, which means the same thing in a link for everybody. **The shell
 * filters TOOLS, the page filters BOOKS.**
 *
 * ── CORE TOOLS NEVER MOVE ───────────────────────────────────────────────────
 *
 * Only Layer 2a packs are ever put away. Every division posts to the same
 * books, raises the same documents and sends the same mail; a cabinet shop that
 * lost Accounting would be a cabinet shop that could not be invoiced for.
 */

export interface ProfileView {
  slug: string;
  name: string;
  packs: readonly string[];
}

/** A company as this file needs it. `packs` empty means it has not said. */
export interface CompanyView {
  id: string;
  name: string;
  industry: string | null;
  packs?: readonly string[];
}

/** A division as this file needs it. `packs` empty means it has not said. */
export interface DivisionView {
  id: string;
  name: string;
  packs: readonly string[];
}

export interface RailContext {
  /**
   * What the cookie holds. Prefixed by kind, because a company's id, a
   * division's id and an industry's slug live in the same value and must not
   * be able to collide.
   */
  slug: string;
  /** "Construction", "Cabinet Shop", "Shrock Prefab". */
  label: string;
  /**
   * The line underneath, which is whatever grounds the label: the companies in
   * an industry, the trade a company works in, and nothing for a division. Empty
   * draws no second line at all.
   */
  hint: string;
  /** The Layer 2a packs this side of the business uses. */
  packs: string[];
}

export const industryKey = (slug: string): string => `industry:${slug}`;
export const divisionKey = (id: string): string => `division:${id}`;
export const companyKey = (id: string): string => `company:${id}`;

/**
 * The sides worth offering: every industry the companies name, every company
 * that overrode its industry's tools, then every division that has said which
 * packs it uses.
 *
 * **NOTHING BELOW TWO**, which is the rule accounting's company picker already
 * keeps in its own words: *the single-company client never learns the concept
 * exists*. One side is not a choice, and a control with one option is
 * furniture. A company that has not said what it does, and a division that has
 * not picked any packs, are in every view and never a view of their own —
 * "unassigned" is a state, not a side of the business.
 */
export function railContexts(
  companies: readonly CompanyView[],
  profiles: readonly ProfileView[],
  divisions: readonly DivisionView[] = [],
): RailContext[] {
  const byIndustry = new Map<string, RailContext>();
  const named: RailContext[] = [];
  for (const company of companies) {
    const profile = company.industry
      ? profiles.find((p) => p.slug === company.industry)
      : undefined;
    /**
     * A COMPANY THAT SAID ITS OWN TOOLS IS A SIDE OF ITS OWN (ADR 0092), and
     * it has to be: two companies in one trade with different menus cannot
     * share one row, and the row they would share is named after the trade.
     * Its line of business still grounds the label underneath, when it has one.
     */
    if (company.packs && company.packs.length > 0) {
      named.push({
        slug: companyKey(company.id),
        label: company.name,
        hint: profile?.name ?? "",
        packs: [...company.packs],
      });
      continue;
    }
    if (!company.industry) continue;
    // A slug whose profile was renamed or retired reads as "not said" rather
    // than offering a side of the business nothing can describe.
    if (!profile) continue;
    const existing = byIndustry.get(company.industry);
    if (existing) existing.hint = `${existing.hint}, ${company.name}`;
    else {
      byIndustry.set(company.industry, {
        slug: industryKey(company.industry),
        label: profile.name,
        hint: company.name,
        packs: [...profile.packs],
      });
    }
  }
  const fromDivisions = divisions
    .filter((d) => d.packs.length > 0)
    .map((d) => ({
      slug: divisionKey(d.id),
      label: d.name,
      hint: "",
      packs: [...d.packs],
    }));
  const contexts = [...byIndustry.values(), ...named, ...fromDivisions];
  return contexts.length > 1 ? contexts : [];
}

/**
 * The pack slugs this side of the business puts away.
 *
 * **Wrong in the safe direction**: no context, or one that is not on offer,
 * hides nothing. A rail row that should not be there is a row you ignore; a
 * missing one is a feature somebody thinks was taken away.
 */
export function hiddenPacks(
  contextSlug: string | null,
  packSlugs: readonly string[],
  contexts: readonly RailContext[],
): string[] {
  if (!contextSlug) return [];
  const context = contexts.find((c) => c.slug === contextSlug);
  if (!context) return [];
  return packSlugs.filter((slug) => !context.packs.includes(slug));
}

/** The cookie, so the SERVER can render the right rail on the first paint. */
export const RAIL_CONTEXT_COOKIE = "yosher_rail_context";

/**
 * A stored value only counts while it is still one of the sides on offer — so
 * a division that was deleted, or a company that changed its line of business,
 * quietly falls back to Everything rather than hiding a menu nothing explains.
 */
export function resolveContext(
  stored: string | undefined,
  contexts: readonly RailContext[],
): string | null {
  if (!stored) return null;
  return contexts.some((c) => c.slug === stored) ? stored : null;
}
