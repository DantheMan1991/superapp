"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crosshair, Pencil, Trash2, Undo2 } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { GeoJSONStoreFeatures, TerraDraw } from "terra-draw";
import "maplibre-gl/dist/maplibre-gl.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setParcelBoundaryAction, setZoneBoundaryAction } from "../actions";
import { boundaryAreaAcres, type Boundary } from "../core/geo";
import { formatArea, type AreaUnit } from "../core/area";
import {
  CONTINENTAL_US,
  FIELD_ZOOM,
  type Basemap,
} from "../core/basemap";

/**
 * Trace a boundary on aerial imagery. **THE ENTRY PATH THIS SLICE EXISTS TO
 * REPLACE IS A TEXTAREA FULL OF JSON.**
 *
 * 2a.0 shipped a paste box, and the founder's verdict on driving it was the
 * right one: *"I don't understand pasting the json coordinates. That seems
 * complicated. I was expecting to have a map pull up and be able to trace the
 * parcels."* Nothing under the box was wrong — the storage, the spherical
 * acreage, the containment test and the declared-vs-measured comparison all
 * survive unchanged and this component feeds exactly the same ops. What was
 * wrong was asking a farmer to produce a file he has no way to make.
 *
 * Three things it does that the box could not:
 *
 *   1. **You can see the ground.** Public-domain USDA/USGS orthoimagery, so
 *      a boundary can be checked against the fence line rather than trusted.
 *   2. **The acreage updates as you trace.** Same `boundaryAreaAcres` the
 *      server will run — not a preview of a guess.
 *   3. **Context.** A zone is drawn with its parcel and its sibling paddocks
 *      on screen, because ground is subdivided in relation to what is already
 *      there.
 *
 * MapLibre and Terra Draw load through `await import()` inside an effect rather
 * than at module scope: both touch `window` on construction, and a static
 * import would break the server render of every page that shows a map.
 */

export interface MapContextShape {
  name: string;
  boundary: Boundary;
}

type Mode = "view" | "draw";

export function BoundaryMap({
  target,
  id,
  declaredAcres,
  current,
  context,
  unit,
  basemap,
  canEdit,
}: {
  target: "zone" | "parcel";
  id: string;
  declaredAcres: number | null;
  current: Boundary | null;
  /** The parcel and any sibling zones, drawn for reference and never edited. */
  context: MapContextShape[];
  unit: AreaUnit;
  basemap: Basemap;
  canEdit: boolean;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const draw = useRef<TerraDraw | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [drawnAcres, setDrawnAcres] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  /** The saved shape, drawn as a plain layer whenever we are not editing it. */
  const savedFeature = useCallback(
    () => ({
      type: "FeatureCollection" as const,
      features: current
        ? [{ type: "Feature" as const, properties: {}, geometry: current }]
        : [],
    }),
    [current],
  );

  useEffect(() => {
    let cancelled = false;
    let disposeMap: MapLibreMap | null = null;

    (async () => {
      const [
        {
          Map: MapLibre,
          AttributionControl,
          NavigationControl,
          LngLatBounds,
          setWorkerUrl,
        },
      ] = await Promise.all([import("maplibre-gl")]);
      if (cancelled || !container.current) return;

      /**
       * **SERVE THE WORKER OURSELVES.** MapLibre's module worker imports a
       * sibling chunk with a relative specifier; Next copies the worker into
       * `/_next/static/media/` under a hashed name without emitting that
       * sibling, so the import 404s into the HTML shell and the worker never
       * starts. Raster tiles still draw on the main thread, which is why the
       * map looked alive while every GeoJSON layer silently never rendered.
       *
       * `public/maplibre/` keeps the two files next to each other, so the
       * relative import resolves. Copied by `scripts/copy-map-worker.ts` on
       * prebuild and predev so it cannot drift from the installed version.
       */
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

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
          layers: [{ id: "imagery", type: "raster", source: "imagery" }],
        },
        bounds: CONTINENTAL_US,
        // Past the imagery's own zoom MapLibre overzooms the last real tile,
        // which is blurry but present — better than the grey a hard cap gives
        // exactly when somebody is placing a corner on a fence.
        maxZoom: 22,
        attributionControl: false,
      });
      disposeMap = instance;
      map.current = instance;
      instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
      instance.addControl(new AttributionControl({ compact: true }), "bottom-right");

      /**
       * Fit to what we know: this shape, else its neighbours, else the country
       * — which is the honest "we do not know where your farm is".
       */
      const fitToKnownGround = (
        target: MapLibreMap,
        Bounds: typeof LngLatBounds,
      ) => {
        const bounds = new Bounds();
        let any = false;
        const walk = (boundary: Boundary) => {
          const polygons =
            boundary.type === "Polygon"
              ? [boundary.coordinates]
              : boundary.coordinates;
          for (const rings of polygons) {
            for (const [lon, lat] of rings[0] ?? []) {
              bounds.extend([lon, lat]);
              any = true;
            }
          }
        };
        if (current) walk(current);
        else context.forEach((shape) => walk(shape.boundary));
        if (any) target.fitBounds(bounds, { padding: 48, animate: false });
      };

      // **MAPLIBRE ERRORS ARE EVENTS, NOT EXCEPTIONS**, and without this they
      // are silent: the first time this map failed it rendered a white square
      // with a working zoom control and said nothing anywhere.
      instance.on("error", (event) => {
        console.error("boundary map", event.error ?? event);
      });

      instance.on("load", () => {
        if (cancelled) return;
        // Fit BEFORE the layers. A failure adding one used to leave the map
        // over the whole continental US, which reads as "the imagery is
        // broken" rather than "a layer threw".
        fitToKnownGround(instance, LngLatBounds);

        instance.addSource("context", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: context.map((shape) => ({
              type: "Feature",
              properties: { name: shape.name },
              geometry: shape.boundary,
            })),
          },
        });
        instance.addLayer({
          id: "context-fill",
          type: "fill",
          source: "context",
          paint: { "fill-color": "#ffffff", "fill-opacity": 0.06 },
        });
        instance.addLayer({
          id: "context-line",
          type: "line",
          source: "context",
          paint: {
            "line-color": "#ffffff",
            "line-width": 1.5,
            "line-opacity": 0.7,
            "line-dasharray": [2, 2],
          },
        });
        /**
         * **NO LABELS ON THE CONTEXT SHAPES, AND THAT IS A DEPENDENCY DECISION.**
         * A `text-field` needs a `glyphs` endpoint in the style, which means a
         * font service — another external host, another thing to be down, and
         * another set of terms. Adding a symbol layer without one throws inside
         * the load handler, which is exactly how this map first shipped: a white
         * square with a working zoom control, no boundary, and a dead toolbar,
         * because the throw happened before `fitBounds` and `setReady`.
         *
         * The neighbours are dashed and the shape being edited is solid green,
         * which is enough to tell them apart. Names come back with 2b, when
         * points and lines need rendering anyway and a glyph source can be
         * chosen deliberately.
         */
        instance.addSource("saved", { type: "geojson", data: savedFeature() });
        instance.addLayer({
          id: "saved-fill",
          type: "fill",
          source: "saved",
          paint: { "fill-color": "#34d399", "fill-opacity": 0.2 },
        });
        instance.addLayer({
          id: "saved-line",
          type: "line",
          source: "saved",
          paint: { "line-color": "#34d399", "line-width": 2.5 },
        });

        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      draw.current?.stop();
      draw.current = null;
      disposeMap?.remove();
      map.current = null;
    };
    // Rebuilding the map on every context change would throw away the user's
    // pan and zoom. The layers below are updated in place instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Keep the saved-shape layer in step after a save without rebuilding the map. */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const source = instance.getSource("saved");
    if (source && "setData" in source) {
      (source as { setData: (data: unknown) => void }).setData(savedFeature());
    }
  }, [ready, savedFeature]);

  const startDrawing = useCallback(
    async (seed: Boundary | null) => {
      const instance = map.current;
      if (!instance) return;
      const [
        { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, ValidateNotSelfIntersecting },
        { TerraDrawMapLibreGLAdapter },
      ] = await Promise.all([
        import("terra-draw"),
        import("terra-draw-maplibre-gl-adapter"),
      ]);

      const instanceDraw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: instance }),
        modes: [
          new TerraDrawPolygonMode({
            // **A FIGURE-OF-EIGHT PADDOCK HAS NO AREA THE FORMULA CAN TRUST.**
            // Refusing the self-intersection while it is being drawn is far
            // kinder than storing a shape whose acreage is quietly nonsense.
            validation: ValidateNotSelfIntersecting,
            pointerDistance: 20,
          }),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  draggable: true,
                  coordinates: {
                    midpoints: true,
                    draggable: true,
                    deletable: true,
                  },
                },
              },
            },
          }),
        ],
      });
      instanceDraw.start();

      if (seed) {
        // Editing an existing boundary means its corners, not a fresh trace.
        // `mode` on the properties is how Terra Draw knows which mode owns the
        // feature; without it the corners are drawn but not editable. No `id`
        // — letting the store assign one keeps it inside whatever id strategy
        // the instance was configured with.
        const feature = {
          type: "Feature",
          properties: { mode: "polygon" },
          geometry: seed,
        } as GeoJSONStoreFeatures;
        const [validation] = instanceDraw.addFeatures([feature]);
        if (validation && !validation.valid) {
          // A stored boundary this mode will not accept is not something to
          // fail silently on: the corners simply would not appear.
          toast.error("That boundary cannot be edited on the map — redraw it.");
        }
        instanceDraw.setMode("select");
      } else {
        instanceDraw.setMode("polygon");
      }

      const measure = () => {
        const drawn = instanceDraw
          .getSnapshot()
          .filter((f) => f.geometry?.type === "Polygon");
        const last = drawn[drawn.length - 1];
        setDrawnAcres(
          last
            ? boundaryAreaAcres(last.geometry as unknown as Boundary)
            : null,
        );
      };
      // The acreage moves as the shape does — the same function the server
      // runs, so what the screen says while tracing is what gets stored.
      instanceDraw.on("change", measure);
      instanceDraw.on("finish", measure);

      draw.current = instanceDraw;
      setDrawnAcres(seed ? boundaryAreaAcres(seed) : null);
      setMode("draw");
    },
    [],
  );

  const stopDrawing = useCallback(() => {
    draw.current?.stop();
    draw.current = null;
    setDrawnAcres(null);
    setMode("view");
  }, []);

  const save = useCallback(async () => {
    const instanceDraw = draw.current;
    if (!instanceDraw) return;
    const drawn = instanceDraw
      .getSnapshot()
      .filter((f) => f.geometry?.type === "Polygon");
    const last = drawn[drawn.length - 1];
    if (!last) {
      toast.error("Nothing drawn yet — click the corners of the boundary.");
      return;
    }

    setPending(true);
    const action = target === "zone" ? setZoneBoundaryAction : setParcelBoundaryAction;
    const result = await action({
      id,
      geojson: JSON.stringify(last.geometry),
    });
    setPending(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Boundary saved");
    stopDrawing();
    router.refresh();
  }, [id, router, stopDrawing, target]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("This browser will not share a location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.current?.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: FIELD_ZOOM,
        });
      },
      () => toast.error("Could not get a location. Check the browser's permission."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const difference =
    drawnAcres !== null && declaredAcres !== null ? drawnAcres - declaredAcres : null;

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-md border">
        <div ref={container} className="h-[420px] w-full" />

        {mode === "draw" && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="pointer-events-auto rounded-md bg-background/95 px-3 py-2 text-sm shadow">
              {drawnAcres === null ? (
                <span>Click each corner. Click the first one again to close it.</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {formatArea(drawnAcres, unit)}
                  </span>
                  {difference !== null && Math.abs(difference) >= 0.01 && (
                    <span className="text-muted-foreground">
                      {difference > 0 ? "+" : "−"}
                      {formatArea(Math.abs(difference), unit)} against the{" "}
                      {formatArea(declaredAcres, unit)} recorded
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {mode === "view" ? (
          <>
            {canEdit && (
              <Button size="sm" onClick={() => startDrawing(null)} disabled={!ready}>
                <Pencil className="mr-2 h-4 w-4" />
                {current ? "Trace it again" : `Trace this ${target}`}
              </Button>
            )}
            {canEdit && current && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => startDrawing(current)}
                disabled={!ready}
              >
                Move the corners
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={locate} disabled={!ready}>
              <Crosshair className="mr-2 h-4 w-4" />
              Find my location
            </Button>
            {current && (
              <Badge variant="outline" className="ml-auto">
                {formatArea(boundaryAreaAcres(current), unit)} traced
              </Badge>
            )}
          </>
        ) : (
          <>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save boundary"}
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
                setDrawnAcres(null);
                draw.current?.setMode("polygon");
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Start over
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
