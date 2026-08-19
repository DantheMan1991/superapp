import { Badge } from "@/components/ui/badge";
import { formatArea, type AreaUnit } from "../core/area";
import { areaDisagrees, asBoundary, compareArea } from "../core/geo";
import { BoundaryForm } from "./boundary-controls";

/**
 * What the drawn boundary measures, against what somebody typed in.
 *
 * **IT REPORTS, IT NEVER CORRECTS.** The declared acreage usually comes from a
 * deed or a county record and is what the rent and the tax are based on; the
 * boundary is what the fence encloses. They disagree for real reasons — a road
 * easement, a creek, a deed written loosely — and deciding which is
 * right is the farmer's call. Land's standing rule, the same one behind
 * `zoneCoverage`: report the difference, never enforce it.
 *
 * A server component: it renders from data the page already has and only the
 * paste dialog inside it needs the client.
 */
export function BoundarySummary({
  target,
  id,
  name,
  declaredAcres,
  geometry,
  unit,
  canEdit,
}: {
  target: "zone" | "parcel";
  id: string;
  name: string;
  declaredAcres: number | null;
  /** The raw jsonb column. Anything unreadable degrades to "no boundary". */
  geometry: unknown;
  unit: AreaUnit;
  canEdit: boolean;
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

      {boundary === null ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {/* Honest about what it does and does not buy today. The map is 2a.1
              and the standing-in-a-field pre-fill is 2a.2; this slice is the
              shape and the arithmetic. */}
          No boundary recorded. With one, this {target} gets a measured acreage
          to check the recorded figure against — and, once the map lands, a
          picture and a phone that knows which {target} you are standing in.
        </p>
      ) : (
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
