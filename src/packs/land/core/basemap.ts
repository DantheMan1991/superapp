/**
 * The picture under the boundaries. PURE — no imports, no database.
 *
 * **PUBLIC-DOMAIN AERIAL, NOT A COMMERCIAL BASEMAP, AND THAT IS A LICENSING
 * DECISION RATHER THAN A TECHNICAL ONE.** The obvious alternative — Esri's
 * World Imagery — serves beautiful tiles and is what most map demos reach for,
 * but its terms are a licence a commercial multi-tenant product would have to
 * hold. USGS's orthoimagery service carries USDA NAIP and is public domain:
 * every tenant can use it, forever, with attribution and no agreement. The Land
 * design chose NAIP for exactly this reason and recorded US-only coverage as
 * acceptable.
 *
 * Verified live before shipping: the service answers, serves 256px JPEG tiles,
 * and declares zoom levels 0–23.
 */

export interface Basemap {
  /** A MapLibre raster tile template. `{z}/{y}/{x}` — ArcGIS order, not `{x}/{y}`. */
  url: string;
  /** Shown on the map. Not optional: it is the condition of use. */
  attribution: string;
  /**
   * Past this, tiles stop existing and the map goes blank rather than blurry.
   * MapLibre keeps overzooming the last real tile instead, which is what a
   * person tracing a fence line actually wants.
   */
  maxZoom: number;
}

export const USGS_IMAGERY: Basemap = {
  url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
  attribution: "USDA / USGS The National Map: Orthoimagery",
  // The service declares 23. Aerial detail runs out long before that, and
  // asking for tiles that do not exist is how a map goes grey at the moment
  // somebody zooms in to place a corner.
  maxZoom: 19,
};

/**
 * A tenant's own imagery, from `packConfig.land.basemap`.
 *
 * TOTAL BY CONSTRUCTION, like `areaUnitFrom`: `tenant_modules.config` is jsonb
 * with no shape constraint, so anything unreadable means the default rather
 * than a map that fails to render. It exists because this profile is US-only
 * and the pack is not — a tenant outside NAIP coverage needs to point at their
 * own national imagery, and that must not require a deploy.
 */
export function basemapFrom(config: unknown): Basemap {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).basemap;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const candidate = value as Record<string, unknown>;
      const url = candidate.url;
      const attribution = candidate.attribution;
      // Both or neither. Imagery with no attribution is the one combination
      // that is never acceptable, so a half-filled config falls back whole.
      if (
        typeof url === "string" &&
        url.includes("{z}") &&
        typeof attribution === "string" &&
        attribution.trim() !== ""
      ) {
        const maxZoom = candidate.maxZoom;
        return {
          url,
          attribution,
          maxZoom:
            typeof maxZoom === "number" && maxZoom >= 1 && maxZoom <= 24
              ? maxZoom
              : USGS_IMAGERY.maxZoom,
        };
      }
    }
  }
  return USGS_IMAGERY;
}

/**
 * Where to look when nothing has been drawn anywhere yet.
 *
 * **The cold start of a map is worse than the cold start of a form**: a form
 * with no data is empty, and a map with no data is a picture of the wrong
 * place. The continental US is the honest default for this profile, and the
 * screen offers "use my location" as the one-tap fix — a farmer opening this is
 * usually standing on the ground in question.
 */
export const CONTINENTAL_US: [number, number, number, number] = [
  -125, 24.5, -66.9, 49.4,
];

/** Zoom at which a paddock fills the screen — where "use my location" lands. */
export const FIELD_ZOOM = 16;
