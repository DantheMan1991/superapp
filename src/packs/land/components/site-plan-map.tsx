"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { GeoJSONStoreFeatures, TerraDraw } from "terra-draw";
import { toast } from "sonner";
import { Crosshair, Layers, Pencil, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  asBoundary,
  asFeatureGeometry,
  boundaryAreaAcres,
  boundingBox,
  geometryLengthM,
  shapeOf,
  type Boundary,
  type FeatureGeometry,
  type GeometryShape,
} from "../core/geo";
import {
  featureKindLabel,
  featureStyle,
  STATUS_STYLES,
  type FeatureStatus,
  type TenantFeatureKind,
} from "../core/features";
import { formatArea, type AreaUnit } from "../core/area";
import { formatLength, type LengthUnit } from "../core/length";
import type { Basemap } from "../core/basemap";
import { createFeatureAction, setFeatureGeometryAction } from "../actions";
import { CONTINENTAL_US, FIELD_ZOOM } from "../core/basemap";

/**
 * The site plan. **ONE MAP, TWO VIEWS, AND NO TRANSFER STEP.**
 *
 * The founder asked to keep the parcel map and also have a site-plan drawing to
 * add fences, gates, buildings and waterlines to — *"I just need it transferred
 * to a line drawing"*. It turns out there is nothing to transfer: the aerial is
 * a TRACING SOURCE, the objects you draw off it are stored in lat/long like
 * everything else in this pack, and the "drawing" is those same objects with
 * the imagery layer switched off. A correction to a fence is a correction to
 * both views because there is only one fence. See docs/modules/land.md.
 *
 * SEPARATE FROM `boundary-map.tsx` ON PURPOSE. That one edits a single polygon
 * and measures it against a deed. This one renders many features of three
 * geometries in two states, and its hard parts — per-kind symbology, the dash
 * layers below, selection — would be dead weight there.
 *
 * **WHAT MAKES IT READ AS A DRAWING IS SYMBOLOGY, NOT THE TOGGLE.** With the
 * imagery off, undifferentiated grey lines on paper are worse than the photo.
 * The styles come from `core/features.ts`; this file only applies them.
 */

type ViewMode = "aerial" | "plan";
type Mode = "view" | "draw";

export interface PlanFeature {
  id: string;
  kind: string;
  name: string;
  status: FeatureStatus;
  /** The raw jsonb column. Anything unreadable degrades to "not drawn". */
  geometry: unknown;
}

/**
 * The paper, and the ink on it when the photo is off.
 *
 * LITERAL COLOURS RATHER THAN TOKENS, for the reason `core/features.ts` gives:
 * a MapLibre paint property is evaluated inside the map's renderer and cannot
 * read a CSS custom property. The dark pair is picked by looking for the `dark`
 * class the app's theming already sets, so the plan does not turn into a white
 * rectangle in the middle of a dark page.
 */
const PAPER = { light: "#f6f5f3", dark: "#1c1917" };
const GROUND = { light: "#e7e5e4", dark: "#292524" };

function isDark(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

/**
 * A dash pattern as a layer key.
 *
 * **`line-dasharray` IS NOT DATA-DRIVEN IN MapLibre**, which is the one real
 * constraint the symbology design ran into. Colour, width and opacity can all
 * be read per feature with `["get", …]`; a dash cannot, so every distinct
 * pattern needs its own layer with a filter. The keys are computed from the
 * data actually present, so a plan with only solid fences builds one line layer
 * rather than six.
 */
function dashKey(dash: [number, number] | null): string {
  return dash ? `${dash[0]}-${dash[1]}` : "solid";
}

function dashFromKey(key: string): [number, number] | null {
  if (key === "solid") return null;
  const [a, b] = key.split("-").map(Number);
  return [a, b];
}

/** Terra Draw's mode name for a shape. */
const DRAW_MODE: Record<GeometryShape, string> = {
  point: "point",
  line: "linestring",
  area: "polygon",
};

/**
 * The GeoJSON type Terra Draw stores for a shape.
 *
 * **THE SNAPSHOT HOLDS MORE THAN WHAT YOU ARE DRAWING**, and taking the last
 * entry from it is wrong in a way that looks right until you try it: while a
 * line is being drawn the store also holds a `Point` for each vertex placed, so
 * the newest feature is a point and the readout says "Placed. Save it" in the
 * middle of tracing a fence. Found by drawing one. `boundary-map.tsx` has the
 * same filter for the same reason, which is why polygons never showed it.
 */
const DRAWN_TYPE: Record<GeometryShape, string> = {
  point: "Point",
  line: "LineString",
  area: "Polygon",
};

function lastDrawn(
  snapshot: GeoJSONStoreFeatures[],
  shape: GeometryShape,
): GeoJSONStoreFeatures | undefined {
  const matching = snapshot.filter(
    (f) => f.geometry?.type === DRAWN_TYPE[shape],
  );
  return matching[matching.length - 1];
}

export function SitePlanMap({
  parcelId,
  parcelBoundary,
  zones,
  features,
  kinds,
  basemap,
  areaUnit,
  lengthUnit,
  canEdit,
  selectedId,
  onSelect,
}: {
  parcelId: string;
  parcelBoundary: Boundary | null;
  /** Drawn faintly underneath, so a fence has paddocks to sit between. */
  zones: { name: string; geometry: unknown }[];
  features: PlanFeature[];
  kinds: TenantFeatureKind[];
  basemap: Basemap;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
  canEdit: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const draw = useRef<TerraDraw | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<ViewMode>("aerial");
  const [mode, setMode] = useState<Mode>("view");
  const [drawKind, setDrawKind] = useState(kinds[0]?.kind ?? "fence");
  /**
   * Whether what is about to be drawn EXISTS or is being proposed.
   *
   * **DEFAULTS TO `built`, and offering it at all is the point.** Tracing what
   * is already there is the common act and the one that pays immediately, so it
   * is the default; but without this control the planned/built split would be
   * unreachable from the screen — you could only ever draw a fact and demote it
   * afterwards, which is not how anybody costs a fence.
   */
  const [drawStatus, setDrawStatus] = useState<FeatureStatus>("built");
  /** Set while REDRAWING an existing feature; null while tracing a new one. */
  const [redrawing, setRedrawing] = useState<PlanFeature | null>(null);
  /**
   * The shape the open draw session is producing. Held in state rather than
   * recomputed at save time, because a redraw takes its shape from the geometry
   * ALREADY STORED and the kind picker is free to say something else — reading
   * the picker on save would filter the snapshot for the wrong type and find
   * nothing to save.
   */
  const [drawingShape, setDrawingShape] = useState<GeometryShape>("line");
  const [measured, setMeasured] = useState<FeatureGeometry | null>(null);
  const [pending, setPending] = useState(false);

  const shapeOfKind = useCallback(
    (kind: string): GeometryShape =>
      kinds.find((k) => k.kind === kind)?.shape ?? "point",
    [kinds],
  );

  /**
   * Every feature as GeoJSON with its style baked into the properties.
   *
   * The style is computed HERE rather than in a MapLibre expression because it
   * depends on the kind, the shape actually drawn and the status together —
   * three inputs and a fallback, which is a paragraph of TypeScript and would
   * be an unreadable nest of `case` expressions in a style spec.
   */
  const drawn = useMemo(() => {
    const shapes: {
      feature: PlanFeature;
      geometry: FeatureGeometry;
      shape: GeometryShape;
      dash: string;
      properties: Record<string, unknown>;
    }[] = [];

    for (const feature of features) {
      const geometry = asFeatureGeometry(feature.geometry);
      if (!geometry) continue;
      const shape = shapeOf(geometry);
      const style = featureStyle(feature.kind, shape);
      const status = STATUS_STYLES[feature.status];
      // Status wins over the kind's own dash rather than combining with it:
      // two patterns multiplied together read as neither, and a proposal has
      // to be unmistakable.
      const dash = status.keepKindDash ? style.dash : status.dash;
      const selected = feature.id === selectedId;
      shapes.push({
        feature,
        geometry,
        shape,
        dash: dashKey(dash),
        properties: {
          id: feature.id,
          color: style.color,
          casing: style.casing,
          width: selected ? style.width + 2 : style.width,
          casingWidth: (selected ? style.width + 2 : style.width) + 2.5,
          opacity: status.opacity,
          fill: style.fill * status.opacity,
          radius: style.width,
          dashKey: dashKey(dash),
        },
      });
    }
    return shapes;
  }, [features, selectedId]);

  const dashKeys = useMemo(
    () => Array.from(new Set(drawn.map((d) => d.dash))).sort(),
    [drawn],
  );

  const collection = useCallback(
    (only?: GeometryShape) => ({
      type: "FeatureCollection" as const,
      features: drawn
        .filter((d) => (only ? d.shape === only : true))
        .map((d) => ({
          type: "Feature" as const,
          properties: d.properties,
          geometry: d.geometry,
        })),
    }),
    [drawn],
  );

  // ------------------------------------------------------------ the map ---

  useEffect(() => {
    let cancelled = false;
    let disposeMap: MapLibreMap | null = null;

    (async () => {
      const [{ Map: MapLibre, AttributionControl, NavigationControl, LngLatBounds, setWorkerUrl }] =
        await Promise.all([import("maplibre-gl")]);
      if (cancelled || !container.current) return;

      // Same reason as boundary-map.tsx: Next does not emit the worker's
      // sibling chunk, so we serve both from `public/maplibre/`.
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

      const dark = isDark();
      const instance = new MapLibre({
        container: container.current,
        style: {
          version: 8,
          sources: {
            imagery: {
              type: "raster",
              tiles: [basemap.url],
              tileSize: 256,
              maxzoom: basemap.maxZoom,
              attribution: basemap.attribution,
            },
          },
          layers: [
            // The paper the plan is drawn on, under the photo rather than
            // instead of it — switching views is then a visibility flag and
            // never a style rebuild, which would throw away the pan and zoom.
            {
              id: "paper",
              type: "background",
              paint: { "background-color": dark ? PAPER.dark : PAPER.light },
            },
            { id: "imagery", type: "raster", source: "imagery" },
          ],
        },
        // **THE COLD START, AND IT IS NOT COSMETIC.** Without this MapLibre
        // opens at zoom 0 over the null island, which renders as the arctic and
        // reads as a broken map rather than an empty one. `boundary-map.tsx`
        // learned this in 2a.1 and this map shipped without it until the first
        // parcel with no boundary was opened.
        bounds: CONTINENTAL_US,
        // Past the imagery's own zoom MapLibre overzooms the last real tile,
        // which is blurry but present — better than grey exactly when somebody
        // is placing a gate on a fence line.
        maxZoom: 22,
        attributionControl: false,
      });
      disposeMap = instance;
      map.current = instance;
      instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
      instance.addControl(new AttributionControl({ compact: true }), "bottom-right");

      // **MAPLIBRE ERRORS ARE EVENTS, NOT EXCEPTIONS**, and without this they
      // are silent — the failure mode 2a.1 wrote up, where a map rendered a
      // working zoom control over nothing and said so nowhere.
      instance.on("error", (event) => {
        console.error("site plan map", event.error ?? event);
      });

      instance.on("load", () => {
        if (cancelled) return;

        // Fit BEFORE adding layers, for the reason boundary-map.tsx records: a
        // layer that throws used to leave the map over the whole country,
        // which reads as broken imagery rather than as a broken layer.
        // The parcel if it has been traced, otherwise whatever features exist,
        // otherwise the constructor's CONTINENTAL_US. A parcel with no boundary
        // and one drawn trough should still open on the trough.
        const bounds = new LngLatBounds();
        let any = false;
        const extend = (positions: [number, number][]) => {
          for (const position of positions) {
            bounds.extend(position);
            any = true;
          }
        };
        if (parcelBoundary) {
          const [west, south, east, north] = boundingBox(parcelBoundary);
          extend([
            [west, south],
            [east, north],
          ]);
        } else {
          drawn.forEach((d) => extend(coordinatesOf(d.geometry)));
        }
        if (any) {
          instance.fitBounds(bounds, {
            padding: 48,
            animate: false,
            // A single point would otherwise fit to zoom 22 and show four
            // pixels of grass.
            maxZoom: FIELD_ZOOM + 2,
          });
        }

        // The ground: the parcel and its paddocks, faint, never editable here.
        instance.addSource("ground", {
          type: "geojson",
          data: groundCollection(parcelBoundary, zones),
        });
        instance.addLayer({
          id: "ground-fill",
          type: "fill",
          source: "ground",
          paint: {
            "fill-color": dark ? GROUND.dark : GROUND.light,
            "fill-opacity": 0.35,
          },
        });
        instance.addLayer({
          id: "ground-line",
          type: "line",
          source: "ground",
          paint: {
            "line-color": dark ? "#78716c" : "#a8a29e",
            "line-width": 1.25,
            "line-dasharray": [2, 2],
          },
        });

        instance.addSource("features", { type: "geojson", data: collection() });
        instance.addSource("feature-points", {
          type: "geojson",
          data: collection("point"),
        });

        instance.addLayer({
          id: "feature-fill",
          type: "fill",
          source: "features",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": ["get", "fill"],
          },
        });

        setReady(true);
      });

      instance.on("click", (event) => {
        const hits = instance.queryRenderedFeatures(event.point, {
          layers: instance
            .getStyle()
            .layers.map((l) => l.id)
            .filter((id) => id.startsWith("feature-")),
        });
        const id = hits[0]?.properties?.id;
        onSelect(typeof id === "string" ? id : null);
      });
      instance.on("mousemove", (event) => {
        const hits = instance.queryRenderedFeatures(event.point, {
          layers: instance
            .getStyle()
            .layers.map((l) => l.id)
            .filter((id) => id.startsWith("feature-")),
        });
        instance.getCanvas().style.cursor = hits.length > 0 ? "pointer" : "";
      });
    })();

    return () => {
      cancelled = true;
      draw.current?.stop();
      draw.current = null;
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      disposeMap?.remove();
      map.current = null;
    };
    // Rebuilding on every data change would throw away the pan and zoom. The
    // layers below are updated in place instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Line and casing layers, one pair per dash pattern actually in the data. */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    for (const key of dashKeys) {
      const casingId = `feature-casing-${key}`;
      const lineId = `feature-line-${key}`;
      if (instance.getLayer(lineId)) continue;
      const dash = dashFromKey(key);
      const filter = ["==", ["get", "dashKey"], key] as unknown as never;

      instance.addLayer({
        id: casingId,
        type: "line",
        source: "features",
        filter,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "casing"],
          "line-width": ["get", "casingWidth"],
          "line-opacity": ["*", ["get", "opacity"], 0.55],
          ...(dash ? { "line-dasharray": dash } : {}),
        },
      });
      instance.addLayer({
        id: lineId,
        type: "line",
        source: "features",
        filter,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": ["get", "opacity"],
          ...(dash ? { "line-dasharray": dash } : {}),
        },
      });
    }

    // Points go on top of every line, so a gate is never buried under the
    // fence it sits in.
    if (!instance.getLayer("feature-point")) {
      instance.addLayer({
        id: "feature-point-casing",
        type: "circle",
        source: "feature-points",
        paint: {
          "circle-color": ["get", "casing"],
          "circle-radius": ["+", ["get", "radius"], 2],
          "circle-opacity": ["get", "opacity"],
        },
      });
      instance.addLayer({
        id: "feature-point",
        type: "circle",
        source: "feature-points",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["get", "radius"],
          "circle-opacity": ["get", "opacity"],
        },
      });
    }
  }, [ready, dashKeys]);

  /** Keep the drawn data in step after a save, without rebuilding the map. */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    for (const [id, data] of [
      ["features", collection()],
      ["feature-points", collection("point")],
    ] as const) {
      const source = instance.getSource(id);
      if (source && "setData" in source) {
        (source as { setData: (d: unknown) => void }).setData(data);
      }
    }
  }, [ready, collection]);

  /**
   * Names, as HTML markers rather than a symbol layer.
   *
   * **THIS CLOSES THE QUESTION `boundary-map.tsx` LEFT OPEN IN 2a.1**, which
   * shipped with no labels at all and said they would come back with 2b when a
   * glyph source could be chosen deliberately. The answer is not to choose one:
   * a `text-field` needs a `glyphs` endpoint, which means another external host
   * to depend on, be down, and agree terms with. An HTML marker needs none of
   * that, inherits the app's own typography, and stays legible on both the
   * photo and the paper because it carries its own background.
   *
   * Only NAMED features get one. A run of fence is just fence, and labelling
   * forty of them "Fence" would bury the gate you were looking for.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    let cancelled = false;

    (async () => {
      const { Marker } = await import("maplibre-gl");
      if (cancelled) return;
      markers.current.forEach((m) => m.remove());
      markers.current = [];

      for (const item of drawn) {
        if (!item.feature.name) continue;
        const at = labelPoint(item.geometry);
        if (!at) continue;
        const el = document.createElement("div");
        el.className =
          "pointer-events-none rounded bg-background/85 px-1.5 py-0.5 text-[11px] font-medium leading-none shadow-sm";
        el.style.opacity = String(STATUS_STYLES[item.feature.status].opacity);
        el.textContent = item.feature.name;
        markers.current.push(new Marker({ element: el }).setLngLat(at).addTo(instance));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, drawn]);

  /** The view toggle: a visibility flag, never a style rebuild. */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    instance.setLayoutProperty(
      "imagery",
      "visibility",
      view === "aerial" ? "visible" : "none",
    );
    instance.setPaintProperty(
      "ground-fill",
      "fill-opacity",
      view === "aerial" ? 0.05 : 0.35,
    );
  }, [ready, view]);

  // ----------------------------------------------------------- drawing ---

  const startDrawing = useCallback(
    async (feature: PlanFeature | null) => {
      const instance = map.current;
      if (!instance) return;
      const [
        {
          TerraDraw,
          TerraDrawPointMode,
          TerraDrawLineStringMode,
          TerraDrawPolygonMode,
          TerraDrawSelectMode,
          ValidateNotSelfIntersecting,
        },
        { TerraDrawMapLibreGLAdapter },
      ] = await Promise.all([
        import("terra-draw"),
        import("terra-draw-maplibre-gl-adapter"),
      ]);

      const existing = feature ? asFeatureGeometry(feature.geometry) : null;
      const shape = feature
        ? existing
          ? shapeOf(existing)
          : shapeOfKind(feature.kind)
        : shapeOfKind(drawKind);

      const instanceDraw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: instance }),
        modes: [
          new TerraDrawPointMode({}),
          new TerraDrawLineStringMode({ pointerDistance: 20 }),
          new TerraDrawPolygonMode({
            // A self-intersecting building has no area the formula can trust,
            // the same reason boundary-map.tsx validates it while drawing.
            validation: ValidateNotSelfIntersecting,
            pointerDistance: 20,
          }),
          new TerraDrawSelectMode({
            flags: {
              point: { feature: { draggable: true } },
              linestring: {
                feature: {
                  draggable: true,
                  coordinates: { midpoints: true, draggable: true, deletable: true },
                },
              },
              polygon: {
                feature: {
                  draggable: true,
                  coordinates: { midpoints: true, draggable: true, deletable: true },
                },
              },
            },
          }),
        ],
      });
      instanceDraw.start();

      if (existing) {
        // `mode` on the properties is how Terra Draw knows which mode owns the
        // feature; without it the points are drawn but not editable. The trap
        // boundary-map.tsx hit and wrote up in 2a.1.
        const seeded = {
          type: "Feature",
          properties: { mode: DRAW_MODE[shape] },
          geometry: existing,
        } as GeoJSONStoreFeatures;
        const [validation] = instanceDraw.addFeatures([seeded]);
        if (validation && !validation.valid) {
          toast.error("That shape cannot be edited on the map — draw it again.");
        }
        instanceDraw.setMode("select");
        const [added] = instanceDraw.getSnapshot();
        // Selecting it is what makes the handles appear. Select mode alone only
        // means "clicking would select"; the draggable vertices belong to a
        // SELECTED feature.
        if (added?.id !== undefined) instanceDraw.selectFeature(added.id, "select");
      } else {
        instanceDraw.setMode(DRAW_MODE[shape]);
      }

      const measure = () => {
        const last = lastDrawn(instanceDraw.getSnapshot(), shape);
        setMeasured(
          last ? asFeatureGeometry(last.geometry as unknown as object) : null,
        );
      };
      // The measurement moves as the shape does, and it is the SAME function
      // the server will run — so what the screen says while drawing is what
      // gets stored.
      instanceDraw.on("change", measure);
      instanceDraw.on("finish", measure);

      draw.current = instanceDraw;
      setMeasured(existing);
      setRedrawing(feature);
      setDrawingShape(shape);
      setMode("draw");
    },
    [drawKind, shapeOfKind],
  );

  const stopDrawing = useCallback(() => {
    draw.current?.stop();
    draw.current = null;
    setMeasured(null);
    setRedrawing(null);
    setMode("view");
  }, []);

  const save = useCallback(async () => {
    const instanceDraw = draw.current;
    if (!instanceDraw) return;
    const last = lastDrawn(instanceDraw.getSnapshot(), drawingShape);
    if (!last) {
      toast.error("Nothing drawn yet.");
      return;
    }
    const geometry = last.geometry as unknown as object;

    setPending(true);
    const result = redrawing
      ? await setFeatureGeometryAction({ id: redrawing.id, geometry })
      : await createFeatureAction({
          parcelId,
          kind: drawKind,
          status: drawStatus,
          geometry,
        });
    setPending(false);

    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(
      redrawing
        ? "Redrawn"
        : drawStatus === "planned"
          ? `${featureKindLabel(drawKind)} added as a proposal`
          : `${featureKindLabel(drawKind)} added`,
    );
    stopDrawing();
    router.refresh();
  }, [
    drawKind,
    drawStatus,
    drawingShape,
    parcelId,
    redrawing,
    router,
    stopDrawing,
  ]);

  const locate = useCallback(() => {
    const instance = map.current;
    if (!instance || !navigator.geolocation) {
      toast.error("This browser cannot report a location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        instance.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: FIELD_ZOOM,
        });
      },
      () => toast.error("Could not get a location. Check the browser's permission."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const selectedKind = kinds.find((k) => k.kind === drawKind);
  // While a session is open the shape is whatever that session opened with;
  // otherwise it is what the picker would open next.
  const drawShape =
    mode === "draw" ? drawingShape : (selectedKind?.shape ?? "point");

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-md border">
        <div ref={container} className="h-[480px] w-full" />

        <div className="absolute left-3 top-3">
          <div className="inline-flex overflow-hidden rounded-md border bg-background/95 shadow-sm">
            {(["aerial", "plan"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  view === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {option === "aerial" ? "Aerial" : "Site plan"}
              </button>
            ))}
          </div>
        </div>

        {mode === "draw" && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="pointer-events-auto rounded-md bg-background/95 px-3 py-2 text-sm shadow">
              <Measurement
                geometry={measured}
                shape={drawShape}
                areaUnit={areaUnit}
                lengthUnit={lengthUnit}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {mode === "view" ? (
          <>
            {canEdit && (
              <>
                <Select value={drawKind} onValueChange={setDrawKind}>
                  <SelectTrigger size="sm" className="w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kinds.map((kind) => (
                      <SelectItem key={kind.kind} value={kind.kind}>
                        {kind.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="inline-flex overflow-hidden rounded-md border">
                  {(["built", "planned"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setDrawStatus(option)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        drawStatus === option
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {option === "built" ? "It is there" : "Proposed"}
                    </button>
                  ))}
                </div>
                <Button size="sm" onClick={() => startDrawing(null)} disabled={!ready}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Draw it
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={locate} disabled={!ready}>
              <Crosshair className="mr-2 h-4 w-4" />
              Find my location
            </Button>
            <Badge variant="outline" className="ml-auto gap-1">
              <Layers className="h-3 w-3" />
              {drawn.length} drawn
            </Badge>
          </>
        ) : (
          <>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : redrawing ? "Save the shape" : "Save it"}
            </Button>
            <Button size="sm" variant="outline" onClick={stopDrawing} disabled={pending}>
              <Undo2 className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                draw.current?.clear();
                setMeasured(null);
                draw.current?.setMode(DRAW_MODE[drawShape]);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Start over
            </Button>
          </>
        )}
      </div>

      {canEdit && selectedId && mode === "view" && (
        <RedrawButton
          feature={features.find((f) => f.id === selectedId) ?? null}
          onRedraw={startDrawing}
          disabled={!ready}
        />
      )}
    </div>
  );
}

function RedrawButton({
  feature,
  onRedraw,
  disabled,
}: {
  feature: PlanFeature | null;
  onRedraw: (feature: PlanFeature) => void;
  disabled: boolean;
}) {
  if (!feature) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={() => onRedraw(feature)}
    >
      <Pencil className="mr-2 h-4 w-4" />
      {feature.geometry ? "Move the points" : "Draw"} —{" "}
      {feature.name || featureKindLabel(feature.kind)}
    </Button>
  );
}

/**
 * What the readout says while a shape is being drawn.
 *
 * A LENGTH FOR A LINE, AN AREA *AND* A PERIMETER FOR A SHAPE, and nothing at
 * all for a point — because a point has no measurement and "0 ft" would read
 * as one that measures nothing. The perimeter is there because the question
 * asked of a drawn building or paddock is usually how much fence goes round it.
 */
function Measurement({
  geometry,
  shape,
  areaUnit,
  lengthUnit,
}: {
  geometry: FeatureGeometry | null;
  shape: GeometryShape;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
}) {
  if (!geometry) {
    return (
      <span className="text-muted-foreground">
        {shape === "point"
          ? "Click where it is."
          : shape === "line"
            ? "Click along it. Double-click to finish."
            : "Click each corner. Click the first one again to close it."}
      </span>
    );
  }
  if (geometry.type === "Point") {
    return <span className="text-muted-foreground">Placed. Save it, or click again to move it.</span>;
  }

  const length = geometryLengthM(geometry);
  const boundary = asBoundary(geometry);
  return (
    <span className="flex items-center gap-2">
      <span className="font-medium tabular-nums">
        {formatLength(length, lengthUnit)}
      </span>
      {boundary && (
        <span className="text-muted-foreground tabular-nums">
          {formatArea(boundaryAreaAcres(boundary), areaUnit)} enclosed
        </span>
      )}
    </span>
  );
}

/** Every position in a geometry, for a bounding box over a mixed set. */
function coordinatesOf(geometry: FeatureGeometry): [number, number][] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
      return geometry.coordinates.flat();
    case "Polygon":
      return geometry.coordinates.flat();
    default:
      return geometry.coordinates.flat(2);
  }
}

/**
 * Where a name goes.
 *
 * The FIRST point of a line rather than its middle: a fence label at the
 * midpoint of a long run lands in the middle of a paddock with nothing under
 * it, while the end of the run is where somebody looks for it.
 */
function labelPoint(geometry: FeatureGeometry): [number, number] | null {
  const all = coordinatesOf(geometry);
  return all.length > 0 ? all[0] : null;
}

function groundCollection(
  parcel: Boundary | null,
  zones: { name: string; geometry: unknown }[],
) {
  const shapes = [
    ...(parcel ? [parcel] : []),
    ...zones
      .map((zone) => asBoundary(zone.geometry))
      .filter((b): b is Boundary => b !== null),
  ];
  return {
    type: "FeatureCollection" as const,
    features: shapes.map((geometry) => ({
      type: "Feature" as const,
      properties: {},
      geometry,
    })),
  };
}
