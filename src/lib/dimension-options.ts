import type { DimensionTypeOption } from "@/components/app/dimension-tags";

/** The shape every caller already has from `listDimensionMembers`. */
export interface DimensionMemberRow {
  id: string;
  dimensionType: string;
  displayName: string;
  isActive: boolean;
}

/**
 * Group dimension members into the options a `DimensionTags` control takes.
 *
 * **PURE, AND THE ACTIVE FILTER LIVES HERE ON PURPose — not at each call
 * site.** `listDimensionMembers` does not filter by `is_active`, and `postEntry`
 * refuses an inactive member outright with `DIMENSION_INVALID`, so a screen that
 * forgot the filter would offer a retired line of business and then fail the
 * whole save when somebody picked it. That is a per-caller trap, and the fix for
 * a per-caller trap is to leave the caller no way to get it wrong. The posting
 * side reached the same conclusion in `enterpriseMemberIds`.
 *
 * **THE TYPES COME FROM THE DATA, exactly as the P&L's "Split by" does** —
 * `pnl/page.tsx` builds its options from the distinct `dimensionType` values in
 * this same table. Nothing anywhere holds a list of dimension types, which is
 * what keeps the word "enterprise" out of `accounting`: a tenant with paddocks
 * and no lines of business gets a paddock picker from the same code.
 *
 * **THE LABEL IS THE CAPITALISED SLUG, which is a known shortfall rather than a
 * decision.** It is what the report picker already shows, so the write side and
 * the read side agree. Resolving each type's real word from the installed
 * profile — so a farm reads "Enterprise" and a law firm reads "Line of
 * business" — is its own piece of work, and doing it here alone would leave the
 * two controls disagreeing about what the same thing is called.
 */
export function dimensionTypesFrom(
  members: readonly DimensionMemberRow[],
): DimensionTypeOption[] {
  const byType = new Map<string, DimensionTypeOption>();
  for (const m of members) {
    if (!m.isActive) continue;
    let group = byType.get(m.dimensionType);
    if (!group) {
      const words = m.dimensionType.replaceAll("_", " ");
      group = {
        type: m.dimensionType,
        label: words.charAt(0).toUpperCase() + words.slice(1),
        members: [],
      };
      byType.set(m.dimensionType, group);
    }
    group.members.push({ id: m.id, name: m.displayName });
  }
  // Stable order for both axes: a picker whose options move between renders is
  // one people mis-click.
  const groups = [...byType.values()].sort((a, b) =>
    a.type.localeCompare(b.type),
  );
  for (const g of groups) g.members.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}
