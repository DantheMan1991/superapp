import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatArea, type AreaUnit } from "../core/area";
import { areaDisagrees, asBoundary, compareArea } from "../core/geo";

import { BoundaryForm } from "./boundary-controls";


/**
 * The boundary: the map, and what it measures against what somebody typed in.
 *
 * **IT REPORTS, IT NEVER CORRECTS.** The declared acreage usually comes from a
 * deed or a county record and is what the rent and the tax are based on; the
 * boundary is what the fence encloses. They disagree for real reasons — a road
 * easement, a creek, a deed written loosely — and deciding which is
 * right is the farmer's call. Land's standing rule, the same one behind
 * `zoneCoverage`: report the difference, never enforce it.
 *
 * **THE MAP IS THE FRONT DOOR AND THE PASTE BOX IS THE SIDE ONE.** 2a.0 shipped
 * with those reversed, and the founder was right about it: a textarea of GeoJSON
 * asks a farmer to produce a file he has no way to make. Pasting stays, because
 * a county GIS export is more accurate than anything traced by hand, but it is
 * a second button now rather than the only one.
 *
 * A server component: everything here renders from data the page already has,
 * and only the map and the paste dialog inside it need the client.
 */
export function BoundarySummary({
  target,
  id,
  name,
  declaredAcres,
  geometry,
  unit,
  canEdit,
  drawnAt,
}: {
  target: "zone" | "parcel";
  id: string;
  name: string;
  declaredAcres: number | null;
  /** The raw jsonb column. Anything unreadable degrades to "no boundary". */
  geometry: unknown;
  /** Neighbouring ground — the parcel and its other zones — drawn for reference. */
  unit: AreaUnit;
  canEdit: boolean;
  /**
   * Whether to draw a map here.
   *
   * **THE PARCEL PAGE PASSES FALSE, because its site plan draws the boundary
   * now** — it has the basemap toggle, the symbology, the shape picker and the
   * ability to WALK an outline rather than trace it, and keeping a weaker map
   * beside it to do one job was asking somebody to learn two tools for one act.
   *
   * What stays here either way is the READING: measured against recorded, and
   * the sentence about why they are allowed to disagree. That was always the
   * valuable half. The paste box stays too — a county GIS export is more
   * accurate than anything traced by hand, and it is now the side door to a
   * front door that lives somewhere else.
   */
  /** Where the outline IS drawn. Both callers pass it; the map lives there. */
  drawnAt?: string;
}) {
  const boundary = asBoundary(geometry);
  const comparison = compareArea(declaredAcres, boundary);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          Boundary
          {boundary && (
            <span className="font-normal text-muted-foreground">
              {" · measures "}
              {formatArea(comparison.computedAcres, unit)}
            </span>
          )}
        </h2>
        {canEdit && (
          <BoundaryForm
            target={target}
            id={id}
            name={name}
            declaredAcres={declaredAcres}
            unit={unit}
            current={boundary}
          />
        )}
      </div>

      {drawnAt && (
        <p className="text-xs text-muted-foreground">
          Traced on{" "}
          <Link href={drawnAt} className="underline underline-offset-2">
            the site plan
          </Link>
          {" — click it there, or use the paste box above."}
        </p>
      )}

      {boundary !== null && (
        <div className="rounded-md border p-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span>
              Measured{" "}
              <span className="font-medium tabular-nums">
                {formatArea(comparison.computedAcres, unit)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Recorded {formatArea(comparison.declaredAcres, unit)}
            </span>
            {areaDisagrees(comparison) && (
              <Badge variant="outline">
                {Math.round((comparison.differenceFraction ?? 0) * 100)}% apart
              </Badge>
            )}
          </div>
          <p className="mt-2 text-muted-foreground">
            {comparison.differenceAcres === null
              ? "Nothing to compare it against — no area is recorded here."
              : areaDisagrees(comparison)
                ? "Worth a look. A deed figure and a fence line disagree for real reasons — an easement, a creek, a boundary drawn casually — so neither number is corrected here."
                : "Close enough to the recorded figure. Both are kept as they are."}
          </p>
        </div>
      )}
    </div>
  );
}
