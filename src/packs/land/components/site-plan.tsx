"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { SitePlanMap } from "./site-plan-map";
import { FeaturePanel, type PanelFeature } from "./feature-panel";
import { FeatureList } from "./feature-list";
import { PlanLegend } from "./plan-legend";
import { featureKindLabel, type TenantFeatureKind } from "../core/features";
import type { Boundary } from "../core/geo";
import type { LengthUnit } from "../core/length";
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
 * filter in the list.
 *
 * **THE LIST ITSELF MOVED OUT** on 2026-08-30 (`feature-list.tsx`). It grew
 * filtering, sorting and a multi-select, none of which this component needs to
 * know about — what stays here is the one thing that genuinely is shared, which
 * is which feature is selected.
 */
export function SitePlan({
  parcelId,
  parcelBoundary,
  zones,
  features,
  plans,
  kinds,
  basemap,
  areaUnit,
  lengthUnit,
  canEdit,
  canEditBoundary,
  parcelName,
  zoneWord,
  declaredAcres,
}: {
  parcelId: string;
  parcelBoundary: Boundary | null;
  zones: {
    id: string;
    name: string;
    geometry: unknown;
    status: string;
    areaAcres: number | null;
  }[];
  features: PanelFeature[];
  /** Named sets of proposals. The list groups by them; the map does not. */
  plans: { id: string; name: string }[];
  kinds: TenantFeatureKind[];
  basemap: Basemap;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
  canEdit: boolean;
  /** Owner-only: the outline is a legal fact, not a chore. */
  canEditBoundary: boolean;
  parcelName: string;
  zoneWord: string;
  declaredAcres: number | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Whether the next panel to mount should be scrolled to.
   *
   * **TAPPING A FENCE ON THE MAP USED TO DO NOTHING VISIBLE.** Measured at
   * 375px: the map ends at y=1069 and this panel starts at y=1512 — 443px
   * below it, under the legend — and nothing moved the page. You tapped the
   * thing you wanted and the screen sat still.
   *
   * **ONLY FROM THE MAP.** A click in the LIST is already looking at the row
   * it came from, and yanking the page out from under a finger that is working
   * down a list is worse than not scrolling at all. So the two callers are two
   * handlers rather than one, which also costs the map file nothing.
   *
   * A ref rather than state: it is a fact about the click that just happened,
   * not something to render, and putting it in state would re-render the whole
   * plan to record it.
   */
  const scrollToPanel = useRef(false);

  const selectFromMap = useCallback((id: string | null) => {
    scrollToPanel.current = id !== null;
    setSelectedId(id);
  }, []);

  const selectFromList = useCallback((id: string | null) => {
    scrollToPanel.current = false;
    setSelectedId(id);
  }, []);

  /**
   * Scrolls the panel into view as it mounts, once, if the map asked for it.
   *
   * A callback ref rather than an effect, because "when this element appears"
   * is exactly what a callback ref means — and the wrapper is KEYED ON THE
   * FEATURE below, so it really does mount again for each one.
   */
  const panelRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !scrollToPanel.current) return;
    scrollToPanel.current = false;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  /**
   * Which paddock's outline is being worked on, or null for the parcel's.
   *
   * Held beside the feature selection rather than folded into it: a feature and
   * a paddock are different things with different panels, and one nullable id
   * each says so more plainly than a tagged union that every reader has to
   * unwrap.
   */
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
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
        canEditBoundary={canEditBoundary}
        parcelName={parcelName}
        zoneWord={zoneWord}
        declaredAcres={declaredAcres}
        selectedId={selectedId}
        onSelect={selectFromMap}
        selectedZoneId={selectedZoneId}
        onSelectZone={setSelectedZoneId}
      />

      {/* Under the map, above the list: it explains what you are looking at,
          so it belongs between the drawing and the inventory of it. */}
      <PlanLegend features={features} />

      {selected && (
        /**
         * **KEYED ON THE FEATURE, AND IT IS NOT ONLY ABOUT THE SCROLL.** The
         * panel used to stay mounted while you clicked from one fence to the
         * next — its own `navigatingId` comment says so — and two pieces of its
         * state were initialised once and never again: `editing`, and
         * `details`, which is seeded from `feature.attributes` at mount. So
         * opening `Edit details` on a second fence showed the FIRST one's
         * attributes, and saving wrote them onto the second. A key makes each
         * feature its own instance, which is what the state was assuming all
         * along.
         */
        <div key={selected.id} ref={panelRef}>
          <FeaturePanel
            feature={selected}
            kinds={kinds}
            sources={sources}
            lengthUnit={lengthUnit}
            canEdit={canEdit}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}

      <FeatureList
        features={features}
        plans={plans}
        lengthUnit={lengthUnit}
        canEdit={canEdit}
        selectedId={selectedId}
        onSelect={selectFromList}
      />
    </div>
  );
}
