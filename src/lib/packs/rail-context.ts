/**
 * "I AM WORKING ON THE BUILDING SIDE TODAY" (ADR 0090).
 *
 * A tenant may run more than one industry — installing a profile is additive
 * and does not bind (ADR 0009) — and a builder who also farms was looking at
 * seven farm rows in the rail all day. This works out which sides there are to
 * switch between, and which packs each one puts away.
 *
 * ── IT IS A VIEW. IT SCOPES NOTHING. ────────────────────────────────────────
 *
 * No query filters on it, no policy reads it, every page stays reachable by
 * URL, and the books are untouched — accounting's company picker keeps its own
 * `?entity=`, which means the same thing in a link for everybody. That
 * separation is the whole design: **the shell filters TOOLS, the page filters
 * BOOKS.** A shell preference that changed what a bare accounting URL means
 * would make the same link show two people different numbers.
 *
 * ── LABELLED BY INDUSTRY, NOT BY COMPANY ────────────────────────────────────
 *
 * The mapping underneath is per company (`entities.industry`), because that is
 * how the question gets asked — *Shrock Premier builds, Hilltop Farm farms*.
 * But the control says **Building**, with the company names beneath it, so
 * nobody mistakes it for the picker that chooses whose books they are looking
 * at. Two controls named "company" would be read as one.
 */

export interface ProfileView {
  slug: string;
  name: string;
  packs: readonly string[];
}

export interface RailContext {
  /** The industry profile's slug — what the cookie holds. */
  slug: string;
  /** "Building". The profile's own name. */
  label: string;
  /** The companies that work in it, for the line underneath. */
  companies: string[];
}

/**
 * The sides worth offering.
 *
 * **NOTHING BELOW TWO**, which is the rule accounting's company picker already
 * keeps in its own words: *the single-company client never learns the concept
 * exists*. One industry is not a choice, and a control with one option is
 * furniture. A company that has not said what it does is in every view, never
 * a view of its own — "unassigned" is a state, not a line of business.
 */
export function railContexts(
  companies: readonly { name: string; industry: string | null }[],
  profiles: readonly ProfileView[],
): RailContext[] {
  const bySlug = new Map<string, RailContext>();
  for (const company of companies) {
    const slug = company.industry;
    if (!slug) continue;
    const profile = profiles.find((p) => p.slug === slug);
    // A slug whose profile was renamed or retired reads as "not said" rather
    // than offering a side of the business nothing can describe.
    if (!profile) continue;
    const existing = bySlug.get(slug);
    if (existing) existing.companies.push(company.name);
    else bySlug.set(slug, { slug, label: profile.name, companies: [company.name] });
  }
  const contexts = [...bySlug.values()];
  return contexts.length > 1 ? contexts : [];
}

/**
 * The pack slugs this side of the business puts away.
 *
 * **Wrong in the safe direction**: no context, an unknown context, or a context
 * with no offer behind it all hide nothing. A rail row that should not be there
 * is a row you ignore; a missing one is a feature somebody thinks was taken
 * away.
 */
export function hiddenPacks(
  contextSlug: string | null,
  packSlugs: readonly string[],
  contexts: readonly RailContext[],
  profiles: readonly ProfileView[],
): string[] {
  if (!contextSlug) return [];
  if (!contexts.some((c) => c.slug === contextSlug)) return [];
  const profile = profiles.find((p) => p.slug === contextSlug);
  if (!profile) return [];
  return packSlugs.filter((slug) => !profile.packs.includes(slug));
}

/** The cookie, so the SERVER can render the right rail on the first paint. */
export const RAIL_CONTEXT_COOKIE = "yosher_rail_context";

/** A stored value only counts while it is still one of the sides on offer. */
export function resolveContext(
  stored: string | undefined,
  contexts: readonly RailContext[],
): string | null {
  if (!stored) return null;
  return contexts.some((c) => c.slug === stored) ? stored : null;
}
