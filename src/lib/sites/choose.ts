/**
 * Which of a business's websites a screen is about — pure, so both screens
 * that ask (the Website screen and the shot list) decide it the same way and
 * a test can hold them to it.
 *
 * The rules, in order, and the order is the point (ADR 0045):
 *
 *   1. `new` is not an id. It is how a business that already has a site asks
 *      for another, and it resolves to nothing so the screen draws its build
 *      form — the same one a business with no site sees.
 *   2. ONE SITE WINS OVER ANYTHING ASKED FOR. A business with a single site
 *      never learns the plural exists, which is the same promise ADR 0010
 *      keeps about companies, and a stale `?site=` in a bookmark cannot strand
 *      it on a list of one.
 *   3. Otherwise the asked-for id, but only if it is in the list. The list
 *      came from `withTenant`, so an id belonging to somebody else is simply
 *      absent — RLS decided before this function saw anything, and there is
 *      no separate "not yours" answer to leak.
 *   4. Nothing, which means: draw the list when there are several, or the
 *      build form when there are none.
 */
export type ChosenSite<T> = { site: T | null; wantsNew: boolean; showList: boolean };

export function chooseSite<T extends { id: string }>(
  sites: readonly T[],
  asked: string | undefined,
): ChosenSite<T> {
  const wantsNew = asked === "new";
  if (wantsNew) return { site: null, wantsNew: true, showList: false };
  if (sites.length === 1) return { site: sites[0] ?? null, wantsNew: false, showList: false };
  const found = asked ? (sites.find((s) => s.id === asked) ?? null) : null;
  if (found) return { site: found, wantsNew: false, showList: false };
  return { site: null, wantsNew: false, showList: sites.length > 1 };
}
