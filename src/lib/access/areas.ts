import { AREA_SEPARATOR } from "./can";
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

  let best: { key: string; length: number } | null = null;
  for (const area of areas) {
    for (const path of pathsOf(area)) {
      const p = path.replace(/^\/+|\/+$/g, "");
      if (p === "") continue;
      // A prefix must end on a segment boundary: `report` must not claim
      // `reports`, which is the bug every naive startsWith has.
      if (rest !== p && !rest.startsWith(p + "/")) continue;
      if (!best || p.length > best.length) best = { key: area.key, length: p.length };
    }
  }
  return best ? `${slug}${AREA_SEPARATOR}${best.key}` : null;
}

/** Every key this tool's areas can be denied by, for the settings screen. */
export function areaKeys(
  slug: string,
  areas: readonly AreaDefinition[] | undefined,
): string[] {
  return (areas ?? []).map((a) => `${slug}${AREA_SEPARATOR}${a.key}`);
}
