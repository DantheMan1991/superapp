import { AREA_SEPARATOR, moduleOf } from "./can";
import type { AreaDefinition } from "@/modules/types";

/**
 * WHICH PART OF A TOOL A PAGE BELONGS TO (ADR 0095). PURE — no database, no
 * headers, no registry import that would drag the whole feature tree in.
 *
 * The caller hands in the tool's own `areas`, declared beside its slug and icon
 * (`src/modules/types.ts`), so this file knows nothing about any particular
 * tool and a pack built next year needs no edit here.
 */

/** `/dashboard/m/accounting/reports/pnl` → `accounting`. */
export const MODULE_PREFIX = "/dashboard/m/";

export function moduleSlugFromPath(pathname: string): string | null {
  if (!pathname.startsWith(MODULE_PREFIX)) return null;
  const slug = pathname.slice(MODULE_PREFIX.length).split("/")[0];
  return slug === "" ? null : slug;
}

/** The segments an area owns. Defaults to the key, which is the usual case. */
export function pathsOf(area: AreaDefinition): string[] {
  return area.paths && area.paths.length > 0 ? area.paths : [area.key];
}

/**
 * The area key for a path, or null when the path belongs to none.
 *
 * **NULL IS THE TOOL'S FRONT DOOR, AND IT IS ALWAYS REACHABLE.**
 * `/dashboard/m/jobs` is in no area, so a level that takes every area away
 * leaves a working overview rather than a tool whose only page 404s. A path
 * under a segment nobody declared is null too — an area that does not exist
 * cannot be taken away, and inventing a denial for it would hide a screen
 * nobody chose to hide.
 *
 * **LONGEST MATCH WINS**, so a nested area can carve itself out of a broader
 * one: `reports/tax` beats `reports` if somebody ever declares both.
 */
export function areaForPath(
  pathname: string,
  areas: readonly AreaDefinition[] | undefined,
): string | null {
  const slug = moduleSlugFromPath(pathname);
  if (!slug || !areas || areas.length === 0) return null;
  const rest = pathname.slice(MODULE_PREFIX.length + slug.length).replace(/^\//, "");
  if (rest === "") return null;

  const segments = rest.split("/");
  let best: { key: string; length: number } | null = null;
  for (const area of areas) {
    for (const path of pathsOf(area)) {
      const p = path.replace(/^\/+|\/+$/g, "");
      if (p === "") continue;
      if (!matchesPrefix(segments, p.split("/"))) continue;
      if (!best || p.length > best.length) best = { key: area.key, length: p.length };
    }
  }
  return best ? `${slug}${AREA_SEPARATOR}${best.key}` : null;
}

/**
 * Does this path start with this pattern, segment by segment?
 *
 * **SEGMENTS, NEVER CHARACTERS.** `report` must not claim `reports` — the bug
 * every naive `startsWith` has, and the reason this is a loop rather than one
 * comparison.
 *
 * **`*` MATCHES EXACTLY ONE SEGMENT**, which is what makes a detail page's tabs
 * expressible at all. A job's real features — estimating, change orders,
 * selections — do not live at `/dashboard/m/jobs/estimates`; they live at
 * `/dashboard/m/jobs/<the job>/estimates`, and an area that could only name
 * top-level segments could never reach them. That is the gap the founder found
 * by opening the screen: Jobs offered six sections and none of them was the
 * work.
 *
 * One segment, not many: a `*` is a job id, never a path. A greedy wildcard
 * could let a pattern ending in `cost` claim `/settings/anything/cost`, and an
 * area that quietly owns more than it names is how a screen disappears for a
 * reason nobody can find.
 *
 * **DO NOT WRITE A WILDCARD PATH INSIDE A BLOCK COMMENT.** The star-slash in
 * one closes the comment, and the backticks after it open a template literal
 * that never ends — which is exactly how this paragraph broke the file the
 * first time, four parse errors pointing at a line seventy lines further down.
 */
function matchesPrefix(segments: string[], pattern: string[]): boolean {
  if (pattern.length > segments.length) return false;
  return pattern.every((p, i) => p === "*" || p === segments[i]);
}

/** Every key this tool's areas can be denied by, for the settings screen. */
export function areaKeys(
  slug: string,
  areas: readonly AreaDefinition[] | undefined,
): string[] {
  return (areas ?? []).map((a) => `${slug}${AREA_SEPARATOR}${a.key}`);
}

/**
 * The denied AREA keys, as route patterns the client can compare (ADR 0095).
 *
 * The one place the server and the client agree about what a key means. The
 * dashboard layout calls this and hands the result to `AccessProvider`;
 * `useIsDenied` matches against it with the same segment-and-wildcard rule
 * `areaForPath` uses here. Written as a function rather than inline in the
 * layout so the join between the two halves is testable — a pattern that never
 * matches a real URL would leave a tab in the strip while its page refused,
 * which is the failure that makes a permission screen worthless.
 *
 * Whole-tool denials are left out: the tool is already gone from the rail and
 * its strip never renders.
 */
export function deniedAreaPaths(
  denied: readonly string[],
  areasFor: (slug: string) => readonly AreaDefinition[] | undefined,
): string[] {
  return denied
    .filter((key) => moduleOf(key) !== key)
    .flatMap((key) => {
      const slug = moduleOf(key);
      const area = (areasFor(slug) ?? []).find((a) => `${slug}${AREA_SEPARATOR}${a.key}` === key);
      return area
        ? pathsOf(area).map((path) => `${MODULE_PREFIX}${slug}/${path.replace(/^\/+/, "")}`)
        : [];
    });
}
