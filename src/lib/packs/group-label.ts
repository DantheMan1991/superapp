/**
 * WHAT TO CALL THE PACK GROUP IN THE RAIL.
 *
 * `tenants.industry` holds ONE profile — the last one installed — and the rail
 * used it to caption every pack the client has on. But installing a profile is
 * additive and does NOT bind (ADR 0009): a farm that also builds runs
 * `homestead-farm`'s packs and the construction profile's `jobs`, and both are
 * perfectly correct. The caption was the only thing that disagreed, which put
 * **Jobs** under the heading **Homestead Farm** and read as a bug in the rail.
 *
 * So the profile names the group only while it accounts for every pack that is
 * on. The moment one is not its own, no single industry is an honest heading
 * and the neutral word is the true one.
 *
 * Pure and here rather than inline in the layout because it is the sort of
 * one-line condition that is rewritten by somebody tidying a server component,
 * and nothing about the page would fail if it were.
 */

/** The word used when no one profile accounts for the packs that are on. */
export const NEUTRAL_PACK_GROUP = "Industry tools";

export function packGroupLabel(
  /** The installed profile's name and pack list, or null for a tenant with none. */
  profile: { name: string; packs: readonly string[] } | null,
  /** The pack slugs actually switched on and renderable for this tenant. */
  packSlugs: readonly string[],
): string {
  if (!profile) return NEUTRAL_PACK_GROUP;
  return packSlugs.every((slug) => profile.packs.includes(slug))
    ? profile.name
    : NEUTRAL_PACK_GROUP;
}
