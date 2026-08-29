"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { GeoJSONStoreFeatures, TerraDraw } from "terra-draw";
import { toast } from "sonner";
import {
  Crosshair,
  Layers,
  MapPin,
  Pencil,
  Pentagon,
  Spline,
  Trash2,
  Undo2,
} from "lucide-react";
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
  resolveWidth,
  STATUS_STYLES,
  type FeatureStatus,
  type TenantFeatureKind,
} from "../core/features";
import { formatArea, type AreaUnit } from "../core/area";
import { formatLength, type LengthUnit } from "../core/length";
import type { Basemap } from "../core/basemap";
import {
  createFeatureAction,
  setFeatureGeometryAction,
  setParcelBoundaryAction,
} from "../actions";
import { CONTINENTAL_US, FIELD_ZOOM } from "../core/basemap";
import { WalkPanel } from "./walk-panel";
import {
  hasEnoughPoints,
  walkToGeometry,
  type WalkPoint,
} from "../core/survey";

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
/** Where a vertex comes from: a click on the map, or the ground you stand on. */
type InputMode = "tap" | "walk";

/**
 * The kind picker's value for the parcel's own outline.
 *
 * **THE BOUNDARY IS DRAWN HERE NOW, AND THE SECOND MAP IS GONE.** The parcel
 * page carried two of them: one that traced the outline and one that drew
 * everything on it. The site plan was always the stronger of the two — it has
 * the basemap toggle, the symbology, the shape picker and, since 2b.1, the
 * ability to WALK a shape rather than trace it. Keeping a weaker map beside it
 * to do one job was asking somebody to learn two tools for one act.
 *
 * It sits in the kind picker rather than in a mode of its own because from the
 * founder's side that is what it is: another thing you draw on this map.
 */
const BOUNDARY_TARGET = "__parcel_boundary__";

export interface PlanFeature {
  id: string;
  kind: string;
  name: string;
  status: FeatureStatus;
  /** The raw jsonb column. Anything unreadable degrades to "not drawn". */
  geometry: unknown;
  /** Stroke weight override; null means the kind's own. */
  lineWidth: number | null;
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
/**
 * The walk in progress. Not from the kind palette on purpose: this is not a
 * feature yet, and colouring it as one would make a half-walked fence
 * indistinguishable from a saved one at a glance.
 */
const WALK_COLOR = "#2563eb";

/**
 * Ground a layout proposed and nobody has fenced. Dotted and faint for the
 * same reason a planned FENCE is: a proposal must never read as a fact, and
 * this one covers acres rather than a line.
 */
const PROPOSED = "#7c3aed";

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

/**
 * The shape picker, in the order a plan is usually built: the outline first,
 * then what runs across it, then what sits on it.
 */
const SHAPE_CHOICES: {
  shape: GeometryShape;
  label: string;
  Icon: typeof Spline;
}[] = [
  { shape: "area", label: "Draw an area", Icon: Pentagon },
  { shape: "line", label: "Draw a line", Icon: Spline },
  { shape: "point", label: "Drop a point", Icon: MapPin },
];

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
  canEditBoundary,
  parcelName,
  declaredAcres,
  selectedId,
  onSelect,
}: {
  parcelId: string;
  parcelBoundary: Boundary | null;
  /**
   * Drawn faintly underneath, so a fence has paddocks to sit between.
   * `planned` ones — ground a layout proposed and nobody has fenced — are
   * drawn separately and more strongly: they are a proposal to look at, not
   * context to ignore.
   */
  zones: { name: string; geometry: unknown; status: string }[];
  features: PlanFeature[];
  kinds: TenantFeatureKind[];
  basemap: Basemap;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
  canEdit: boolean;
  /** Whether the parcel's own boundary can be drawn here. Owner-only. */
  canEditBoundary: boolean;
  parcelName: string;
  /** The deed's figure, for the live comparison while tracing the boundary. */
  declaredAcres: number | null;
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
  /** Mirrors `mode` for the map handlers, which are registered once. */
  const drawingRef = useRef(false);
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
  /**
   * A shape chosen instead of the kind's own, or null to follow the kind.
   *
   * **THE KIND'S SHAPE WAS ALWAYS A HINT AND NOW THE SCREEN SAYS SO.**
   * `featureStyle` has taken a kind and a shape separately since 2b.0
   * precisely because the two come apart: a stand of trees is a `woods` area
   * and a windbreak is a `tree_line`, but a barn somebody only knows the rough
   * position of is a point, and a pond traced as its outline is an area. The
   * data model never minded; only the draw tool did, because it opened one
   * mode and offered no way out of it. Cleared whenever the kind changes, so
   * picking a kind gets you that kind's usual shape without any memory of the
   * last override.
   */
  const [shapeOverride, setShapeOverride] = useState<GeometryShape | null>(null);
  /** Whether what is about to be drawn is the parcel's own outline. */
  const boundaryTarget = drawKind === BOUNDARY_TARGET;
  /**
   * How the next shape gets its vertices: by clicking the map, or by standing
   * on each corner.
   *
   * **AN INPUT MODE, NOT A SECOND KIND OF FEATURE.** Both produce the same
   * geometry through the same validator and the same save action; the only
   * difference is where the coordinates come from. That is what keeps this a
   * slice rather than a fork — see `core/survey.ts`.
   */
  const [input, setInput] = useState<InputMode>("tap");
  const [walk, setWalk] = useState<WalkPoint[]>([]);
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
  /**
   * What the TAP path has drawn so far, pushed here by Terra Draw's `change`
   * event. The walk path needs no equivalent — see `measured` below.
   */
  const [tapMeasured, setTapMeasured] = useState<FeatureGeometry | null>(null);
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
      const width = resolveWidth(feature.kind, shape, feature.lineWidth);
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
          width: selected ? width + 2 : width,
          casingWidth: (selected ? width + 2 : width) + 2.5,
          opacity: status.opacity,
          fill: style.fill * status.opacity,
          radius: width,
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
          data: groundCollection(
            parcelBoundary,
            zones.filter((zone) => zone.status !== "planned"),
          ),
        });
        instance.addSource("ground-planned", {
          type: "geojson",
          data: groundCollection(
            null,
            zones.filter((zone) => zone.status === "planned"),
          ),
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

        /**
         * Proposed ground, between the context and the features. Its own pair
         * of layers rather than a filter, because `line-dasharray` is not
         * data-driven in MapLibre — the same constraint the feature symbology
         * ran into.
         */
        instance.addLayer({
          id: "ground-planned-fill",
          type: "fill",
          source: "ground-planned",
          paint: { "fill-color": PROPOSED, "fill-opacity": 0.12 },
        });
        instance.addLayer({
          id: "ground-planned-line",
          type: "line",
          source: "ground-planned",
          paint: {
            "line-color": PROPOSED,
            "line-width": 1.75,
            "line-dasharray": [1, 2],
            "line-opacity": 0.9,
          },
        });

        instance.addSource("features", { type: "geojson", data: collection() });
        instance.addSource("feature-points", {
          type: "geojson",
          data: collection("point"),
        });

        /**
         * The walk in progress: the corners stood on, and the shape they make
         * so far. Its own source so it can be updated without touching the
         * saved features, and drawn ABOVE them — you are placing this one now,
         * and it has to be findable among everything already on the plan.
         */
        instance.addSource("walk", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
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
        // Terra Draw owns the clicks while a shape is being drawn; selecting
        // something underneath it would swap the panel out mid-trace.
        if (drawingRef.current) return;
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
        // **NOT WHILE DRAWING**, and this handler is why the cursor was a grab
        // hand over a fence line you were trying to place a corner on: it runs
        // on every mouse move and reset the canvas cursor to the default, which
        // MapLibre paints as `grab`. A hand has no point to aim with. Reading
        // the mode from a ref rather than from state because the handler is
        // registered once, at map creation, and would otherwise close over
        // whatever `mode` was then — always "view".
        if (drawingRef.current) return;
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

    if (!instance.getLayer("walk-vertex")) {
      instance.addLayer({
        id: "walk-shape",
        type: "line",
        source: "walk",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": WALK_COLOR,
          "line-width": 2.5,
          "line-dasharray": [2, 1],
        },
      });
      instance.addLayer({
        id: "walk-vertex-casing",
        type: "circle",
        source: "walk",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-color": "#ffffff", "circle-radius": 7 },
      });
      instance.addLayer({
        id: "walk-vertex",
        type: "circle",
        source: "walk",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-color": WALK_COLOR, "circle-radius": 5 },
      });
    }
  }, [ready, dashKeys]);

  /**
   * Push the walk to the map as it happens.
   *
   * Corners as points AND the shape they currently make, in one collection, so
   * a half-walked paddock reads as a paddock being walked rather than as four
   * unrelated dots.
   *
   * The geometry is rebuilt INSIDE the effect rather than taken from `measured`
   * above: that is a new object on every render, so depending on it would push
   * the same data to the map continuously. The corners are the real input.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const source = instance.getSource("walk");
    if (!source || !("setData" in source)) return;

    const shapes: { type: "Feature"; properties: object; geometry: object }[] =
      walk.map((point) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point", coordinates: point.position },
      }));
    const shape = walkToGeometry(walk, drawingShape);
    if (shape && shape.type !== "Point") {
      shapes.push({ type: "Feature" as const, properties: {}, geometry: shape });
    }
    (source as { setData: (d: unknown) => void }).setData({
      type: "FeatureCollection",
      features: shapes,
    });
  }, [drawingShape, ready, walk]);

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

      /**
       * **WALK MODE NEVER STARTS TERRA DRAW.** Terra Draw turns map clicks into
       * vertices, and in a walk the vertices come from the ground under your
       * feet — there is nothing for it to listen to. Loading it anyway would
       * mean a stray tap on the map silently adding a corner you did not stand
       * on, which is the one thing this input mode exists to prevent.
       */
      if (input === "walk") {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          toast.error("This browser cannot report a location.");
          return;
        }
        const existingWalked = feature ? asFeatureGeometry(feature.geometry) : null;
        drawingRef.current = true;
        setWalk([]);
        setTapMeasured(null);
        setRedrawing(feature);
        setDrawingShape(
          feature
            ? existingWalked
              ? shapeOf(existingWalked)
              : shapeOfKind(feature.kind)
            : drawKind === BOUNDARY_TARGET
              ? // A boundary is an area however it is placed. Without this the
                // walk branch asked `shapeOfKind` about a value that is not a
                // kind, got "point" back, and four walked corners came out as a
                // single dot saying "Placed where you are standing".
                "area"
              : (shapeOverride ?? shapeOfKind(drawKind)),
        );
        setMode("draw");
        return;
      }

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
      // A redraw keeps the shape it already IS — changing a fence line into a
      // polygon halfway through its life would strand every length ever
      // reported from it. Only a new feature reads the picker.
      const shape = feature
        ? existing
          ? shapeOf(existing)
          : shapeOfKind(feature.kind)
        : drawKind === BOUNDARY_TARGET
          ? "area"
          : (shapeOverride ?? shapeOfKind(drawKind));

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
        setTapMeasured(
          last ? asFeatureGeometry(last.geometry as unknown as object) : null,
        );
      };
      // The measurement moves as the shape does, and it is the SAME function
      // the server will run — so what the screen says while drawing is what
      // gets stored.
      instanceDraw.on("change", measure);
      instanceDraw.on("finish", measure);

      draw.current = instanceDraw;
      drawingRef.current = true;
      // **A CROSSHAIR, NOT A HAND.** MapLibre paints `grab` on its canvas
      // because panning is what a map normally does; placing a corner on a
      // fence line needs something with a point to aim with. Set here rather
      // than in CSS so it survives the hover handler above, which is what was
      // putting the hand back on every mouse move.
      instance.getCanvas().style.cursor = "crosshair";
      setTapMeasured(existing);
      setRedrawing(feature);
      setDrawingShape(shape);
      setMode("draw");
    },
    [drawKind, input, shapeOfKind, shapeOverride],
  );

  const stopDrawing = useCallback(() => {
    draw.current?.stop();
    draw.current = null;
    drawingRef.current = false;
    const canvas = map.current?.getCanvas();
    // Back to MapLibre's own cursor: "" lets it paint grab/grabbing again,
    // which is right the moment panning is what the map is for.
    if (canvas) canvas.style.cursor = "";
    setTapMeasured(null);
    setRedrawing(null);
    setWalk([]);
    setMode("view");
  }, []);

  const save = useCallback(async () => {
    /**
     * **ONE SAVE PATH FOR BOTH INPUT MODES.** A walked shape and a tapped one
     * are the same geometry by the time they reach here, which is the claim
     * `core/survey.ts` exists to make true — everything downstream (the
     * validator, the action, the audit entry, the symbology) is reached once.
     */
    let geometry: object | null = null;
    if (input === "walk") {
      geometry = walkToGeometry(walk, drawingShape);
      if (!geometry) {
        toast.error("Not enough corners walked yet.");
        return;
      }
    } else {
      const instanceDraw = draw.current;
      if (!instanceDraw) return;
      const last = lastDrawn(instanceDraw.getSnapshot(), drawingShape);
      if (!last) {
        toast.error("Nothing drawn yet.");
        return;
      }
      geometry = last.geometry as unknown as object;
    }

    setPending(true);
    const result = boundaryTarget
      ? // The boundary REPLACES rather than creating, so it has its own action
        // — and its own audit entry, which somebody will go looking for.
        //
        // **IT TAKES A JSON STRING, NOT AN OBJECT.** That action was written for
        // the paste box, where what arrives is text somebody copied out of a
        // county GIS export, and `parseBoundary` reads either. Passing the
        // object failed Zod and returned a generic "check the details" that is
        // easy to miss in a toast — which is exactly how this was found.
        await setParcelBoundaryAction({
          id: parcelId,
          geojson: JSON.stringify(geometry),
        })
      : redrawing
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
      boundaryTarget
        ? `${parcelName}'s boundary saved`
        : redrawing
          ? "Redrawn"
          : drawStatus === "planned"
            ? `${featureKindLabel(drawKind)} added as a proposal`
            : `${featureKindLabel(drawKind)} added`,
    );
    stopDrawing();
    router.refresh();
  }, [
    boundaryTarget,
    drawKind,
    drawStatus,
    drawingShape,
    input,
    parcelId,
    parcelName,
    redrawing,
    router,
    stopDrawing,
    walk,
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

  /**
   * What is currently drawn, whichever way it was placed.
   *
   * **DERIVED FOR THE WALK, NOT MIRRORED.** A walked shape is a pure function
   * of the corners walked, so keeping a copy in state would be the cascading
   * render React's own guidance warns about — and worse, a second thing that
   * can disagree with `walk`. The tap path genuinely does need state, because
   * its vertices live inside Terra Draw and only an event tells us they moved.
   */
  const measured =
    input === "walk" ? walkToGeometry(walk, drawingShape) : tapMeasured;

  const dropWalkPoint = useCallback((point: WalkPoint) => {
    setWalk((current) => [...current, point]);
  }, []);

  const undoWalkPoint = useCallback(() => {
    setWalk((current) => current.slice(0, -1));
  }, []);

  const selectedKind = kinds.find((k) => k.kind === drawKind);
  // A boundary is an area, always. Offering a shape picker for it would be
  // offering a parcel whose outline is a single point, and every acreage in
  // the pack would then be silently zero.
  const nextShape = boundaryTarget
    ? "area"
    : (shapeOverride ?? selectedKind?.shape ?? "point");
  // While a session is open the shape is whatever that session opened with;
  // otherwise it is what the picker would open next.
  const drawShape = mode === "draw" ? drawingShape : nextShape;

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
                input={input}
                boundary={boundaryTarget}
                declaredAcres={declaredAcres}
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
                <Select
                  value={drawKind}
                  onValueChange={(value) => {
                    setDrawKind(value);
                    // Picking a kind gets you that kind's usual shape. Carrying
                    // the last override forward would silently draw the next
                    // waterline as an area because the last thing was woods.
                    setShapeOverride(null);
                  }}
                >
                  <SelectTrigger size="sm" className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {canEditBoundary && (
                      <SelectItem value={BOUNDARY_TARGET}>
                        {parcelName}&rsquo;s boundary
                      </SelectItem>
                    )}
                    {kinds.map((kind) => (
                      <SelectItem key={kind.kind} value={kind.kind}>
                        {kind.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!boundaryTarget && (
                <div className="inline-flex overflow-hidden rounded-md border">
                  {SHAPE_CHOICES.map(({ shape, label, Icon }) => (
                    <button
                      key={shape}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-pressed={nextShape === shape}
                      onClick={() => setShapeOverride(shape)}
                      className={`px-2.5 py-1.5 transition-colors ${
                        nextShape === shape
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
                )}
                {!boundaryTarget && (
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
                )}
                <div className="inline-flex overflow-hidden rounded-md border">
                  {(["tap", "walk"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setInput(option)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        input === option
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {option === "tap" ? "Tap the map" : "Walk it"}
                    </button>
                  ))}
                </div>
                <Button size="sm" onClick={() => startDrawing(null)} disabled={!ready}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {boundaryTarget
                    ? input === "walk"
                      ? "Walk the boundary"
                      : "Trace the boundary"
                    : input === "walk"
                      ? "Walk it"
                      : "Draw it"}
                </Button>
                {/* The existing outline, with handles. `startDrawing` takes a
                    FEATURE, so the boundary borrows the shape of one — nothing
                    is written until Save, which routes on `boundaryTarget`. */}
                {boundaryTarget && parcelBoundary && input === "tap" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!ready}
                    onClick={() =>
                      startDrawing({
                        id: parcelId,
                        kind: "fence",
                        name: parcelName,
                        status: "built",
                        geometry: parcelBoundary,
                        lineWidth: null,
                      })
                    }
                  >
                    Move the corners
                  </Button>
                )}
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
            <Button
              size="sm"
              onClick={save}
              disabled={
                pending ||
                (input === "walk" && !hasEnoughPoints(walk, drawingShape))
              }
            >
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
                setWalk([]);
                setTapMeasured(null);
                draw.current?.setMode(DRAW_MODE[drawShape]);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Start over
            </Button>
          </>
        )}
      </div>

      {mode === "draw" && input === "walk" && (
        <WalkPanel
          points={walk}
          shape={drawingShape}
          lengthUnit={lengthUnit}
          onDrop={dropWalkPoint}
          onUndo={undoWalkPoint}
        />
      )}

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
  input,
  boundary,
  declaredAcres,
  areaUnit,
  lengthUnit,
}: {
  geometry: FeatureGeometry | null;
  shape: GeometryShape;
  input: InputMode;
  boundary: boolean;
  declaredAcres: number | null;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
}) {
  // **THE INSTRUCTION HAS TO MATCH THE INPUT MODE.** Telling somebody to
  // double-click to finish while they are stood in a field walking a fence is
  // the kind of copy that makes a screen feel like it was built for a
  // different job than the one being done with it.
  if (!geometry) {
    if (boundary) {
      return (
        <span className="text-muted-foreground">
          {input === "walk"
            ? "Stand on each corner of the property and drop a point."
            : "Click each corner of the property. Click the first one again to close it."}
        </span>
      );
    }
    if (input === "walk") {
      return (
        <span className="text-muted-foreground">
          {shape === "point"
            ? "Stand where it is and drop a point below."
            : shape === "line"
              ? "Walk it, dropping a point at each corner."
              : "Walk the corners. The shape closes itself."}
        </span>
      );
    }
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
    return (
      <span className="text-muted-foreground">
        {input === "walk"
          ? "Placed where you are standing. Save it."
          : "Placed. Save it, or click again to move it."}
      </span>
    );
  }

  const length = geometryLengthM(geometry);
  const area = asBoundary(geometry);

  /**
   * **TRACING A BOUNDARY LEADS WITH ACRES, NOT FEET**, and shows the deed's
   * figure beside it while you are still moving the corners. That comparison is
   * what the old boundary map existed for, and it is the one thing that had to
   * survive folding it in here: a live "you said 40 acres, this encloses 38.6"
   * is a real finding, and it is far more use before you save than after.
   *
   * It REPORTS and never corrects — the standing rule since 2a.0. A deed and a
   * fence line disagree for real reasons.
   */
  if (boundary && area) {
    const acres = boundaryAreaAcres(area);
    const difference =
      declaredAcres === null ? null : Math.round((acres - declaredAcres) * 10_000) / 10_000;
    return (
      <span className="flex items-center gap-2">
        <span className="font-medium tabular-nums">
          {formatArea(acres, areaUnit)}
        </span>
        {difference !== null && Math.abs(difference) >= 0.01 && (
          <span className="text-muted-foreground">
            {difference > 0 ? "+" : "−"}
            {formatArea(Math.abs(difference), areaUnit)} against the{" "}
            {formatArea(declaredAcres, areaUnit)} recorded
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="font-medium tabular-nums">
        {formatLength(length, lengthUnit)}
      </span>
      {area && (
        <span className="text-muted-foreground tabular-nums">
          {formatArea(boundaryAreaAcres(area), areaUnit)} enclosed
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
