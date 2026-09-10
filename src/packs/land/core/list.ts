/**
 * Showing a list of ground and what is on it: how names order, how rows fall
 * into categories, and what a typed word matches. PURE — no React, no
 * database, no `navigator`.
 *
 * All three questions are asked by more than one screen (the plan's feature
 * list, the paddock table, and the ops reads that feed the map's pickers), and
 * all three were answered differently in each of them before this file existed.
 */

/**
 * **`Paddock 1, 10, 11, 12, 2, 3`.** That is what a plain `localeCompare` does
 * to the names this pack MINTS: `layoutPaddocks` emits `${prefix} ${n}`,
 * `${prefix} division ${n}`, `${prefix} lane fence ${n}` and
 * `${prefix} ${n} gate`, so the pack's flagship act produces exactly the names
 * lexicographic ordering scrambles. Lay out twelve paddocks and the list reads
 * 1, 10, 11, 12, 2 — and the founder is looking for number four.
 *
 * `numeric: true` is the whole fix and it costs nothing: it compares runs of
 * digits as numbers and everything else as before, so `North 40` and
 * `Creek field` are unaffected.
 *
 * **It is a comparator rather than a key**, because a name can carry several
 * numbers (`North 3 gate`) and there is no single key that orders those
 * correctly.
 */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** What the plan list is broken up by. `none` is the flat list it used to be. */
export type GroupBy = "kind" | "plan" | "none";

/** The residual group: everything drawn on its own, not as part of a plan. */
export const NO_PLAN = "__no_plan__";

/** The single group `none` produces. Never rendered as a heading. */
export const ONE_GROUP = "__all__";

/** The least a row has to be to fall into a group. */
export interface Groupable {
  id: string;
  kind: string;
  name: string;
  /** The plan this was proposed as part of, or null for one drawn on its own. */
  planId: string | null;
}

export interface Group<T> {
  /** Stable across renders — it is what an open/closed set is keyed by. */
  key: string;
  label: string;
  rows: T[];
}

/**
 * Rows under headings, in the order the headings should appear.
 *
 * **WHY THERE IS NO `by paddock` HERE, and it is not the migration.** A
 * dividing fence bounds TWO paddocks, so "which paddock is this fence in" is
 * not a function: any grouping by paddock has to either duplicate the row under
 * two headings or pick one of them arbitrarily. A `zone_id` on the feature
 * would pick one silently, and `core/enclosure.ts` answers a different question
 * — *what ground do these fences enclose* — which is not *which paddock does
 * this fence belong to*. Gates are the exception, one paddock each, which is
 * why the idea looks right until you try it on a fence.
 *
 * **`plan` needs no migration either.** `land_features.plan_id` has existed
 * since 2b.4 and `layoutPaddocks` stamps every feature it emits with the plan
 * it creates, so "these thirty rows came from one decision" is already
 * recorded, under the name the person typed.
 *
 * `labelOf` resolves a key to what a reader sees — the kind's label, or the
 * plan's name — because this file knows about neither.
 *
 * Groups order by label, with the residual `NO_PLAN` group LAST however it is
 * named: it is what is left over, not a peer of the plans above it. Rows keep
 * the order they arrived in, which is the caller's chosen sort.
 */
export function groupRows<T extends Groupable>(
  rows: readonly T[],
  groupBy: GroupBy,
  labelOf: (key: string) => string,
): Group<T>[] {
  if (groupBy === "none") {
    return [{ key: ONE_GROUP, label: "", rows: [...rows] }];
  }

  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key =
      groupBy === "kind" ? row.kind : (row.planId ?? NO_PLAN);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  return [...byKey.entries()]
    .map(([key, groupedRows]) => ({
      key,
      label: labelOf(key),
      rows: groupedRows,
    }))
    .sort((a, b) => {
      if (a.key === NO_PLAN) return 1;
      if (b.key === NO_PLAN) return -1;
      return compareNames(a.label, b.label);
    });
}

/**
 * Does a typed word match any of these?
 *
 * Case- and whitespace-insensitive substring, over whatever the caller thinks
 * is worth searching. **Not a fuzzy match**: on a list you can already filter
 * and sort, "shows me things I did not type" is worse than "shows me nothing".
 *
 * An empty term matches everything, so a caller can pass it straight through
 * without a branch.
 */
export function matchesTerm(term: string, ...values: (string | null)[]): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return values.some(
    (value) => value !== null && value.toLowerCase().includes(needle),
  );
}
