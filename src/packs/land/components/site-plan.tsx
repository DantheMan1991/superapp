"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";
import { MapIcon } from "lucide-react";
import { SitePlanMap } from "./site-plan-map";
import { FeaturePanel, StatusBadge, type PanelFeature } from "./feature-panel";
import { PlanLegend } from "./plan-legend";
import { featureKindLabel, type TenantFeatureKind } from "../core/features";
import {
  asFeatureGeometry,
  geometryLengthM,
  shapeOf,
  type Boundary,
} from "../core/geo";
import {
  formatLength,
  formatLengthTotal,
  totalLength,
  type LengthUnit,
} from "../core/length";
import type { AreaUnit } from "../core/area";
import type { Basemap } from "../core/basemap";

/**
 * The site plan section: the map, what is selected, and the list.
 *
 * A CLIENT COMPONENT ONLY BECAUSE SELECTION IS SHARED. Clicking a fence on the
 * map has to highlight its row, and clicking the row has to highlight the
 * fence, so one piece of state has to sit above both. Everything else here is
 * derived from props the server already fetched.
 *
 * **THE LIST HIDES `removed` BY DEFAULT AND THE MAP DOES NOT.** That is not an
 * inconsistency: a query is the right place to filter history out, and a paint
 * property is not — a map that silently omitted rows would disagree with the
 * count beside it. So a pulled fence is dimmed on the drawing and behind a
 * toggle in the list.
 */
export function SitePlan({
  parcelId,
  parcelBoundary,
  zones,
  features,
  kinds,
  basemap,
  areaUnit,
  lengthUnit,
  canEdit,
}: {
  parcelId: string;
  parcelBoundary: Boundary | null;
  zones: { name: string; geometry: unknown }[];
  features: PanelFeature[];
  kinds: TenantFeatureKind[];
  basemap: Basemap;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
  canEdit: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const listed = useMemo(
    () => features.filter((f) => showRemoved || f.status !== "removed"),
    [features, showRemoved],
  );
  const removedCount = features.filter((f) => f.status === "removed").length;
  const selected = features.find((f) => f.id === selectedId) ?? null;

  /** What can feed something else. Anything not removed, named for a picker. */
  const sources = useMemo(
    () =>
      features
        .filter((f) => f.status !== "removed")
        .map((f) => ({
          id: f.id,
          label: f.name || featureKindLabel(f.kind),
        })),
    [features],
  );

  const lengths = listed.map((f) => {
    const geometry = asFeatureGeometry(f.geometry);
    if (!geometry) return null;
    return shapeOf(geometry) === "point" ? null : geometryLengthM(geometry);
  });

  return (
    <div className="space-y-4">
      <SitePlanMap
        parcelId={parcelId}
        parcelBoundary={parcelBoundary}
        zones={zones}
        features={features}
        kinds={kinds}
        basemap={basemap}
        areaUnit={areaUnit}
        lengthUnit={lengthUnit}
        canEdit={canEdit}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {/* Under the map, above the list: it explains what you are looking at,
          so it belongs between the drawing and the inventory of it. */}
      <PlanLegend features={features} />

      {selected && (
        <FeaturePanel
          feature={selected}
          kinds={kinds}
          sources={sources}
          lengthUnit={lengthUnit}
          canEdit={canEdit}
          onClose={() => setSelectedId(null)}
        />
      )}

      {listed.length === 0 ? (
        <EmptyState
          icon={<MapIcon className="h-5 w-5" />}
          title="Nothing on the plan yet"
          description="Pick what you are adding, then trace it off the aerial. Switch to Site plan to see it as a drawing."
        />
      ) : (
        <div className="space-y-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Length</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listed.map((feature, index) => (
                <TableRow
                  key={feature.id}
                  onClick={() =>
                    setSelectedId((current) =>
                      current === feature.id ? null : feature.id,
                    )
                  }
                  className={`cursor-pointer ${
                    feature.id === selectedId ? "bg-muted" : ""
                  }`}
                >
                  <TableCell className="font-medium">
                    {feature.name || (
                      <span className="text-muted-foreground">
                        {featureKindLabel(feature.kind)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {featureKindLabel(feature.kind)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={feature.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatLength(lengths[index], lengthUnit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {/* A total that let an undrawn feature read as zero would be
                confidently wrong — `totalLength` reports the unknowns instead. */}
            <span>{formatLengthTotal(totalLength(lengths), lengthUnit)} in all</span>
            {removedCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowRemoved((v) => !v)}
              >
                {showRemoved
                  ? "Hide what was removed"
                  : `Show ${removedCount} removed`}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
