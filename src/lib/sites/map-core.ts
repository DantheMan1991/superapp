/**
 * The map section's maths and words — pure, dependency-free.
 *
 * A map on a site is a PICTURE the platform draws (ADR 0026): the business's
 * address, geocoded once, becomes a pin; the pin and a zoom become a window
 * of Web Mercator tiles the server stitches into one image. Nothing here
 * runs in a browser; the visitor's browser asks the platform for an image
 * and nobody else for anything.
 */
export interface MapPin {
  lat: number;
  lng: number;
  /** The address the geocoder matched, as it said it. */
  matched: string;
  /** The address this pin was made from, so a changed address is placed again. */
  address: string;
}

export const MAP_ZOOMS = [13, 15, 16] as const;
export type MapZoom = (typeof MAP_ZOOMS)[number];
export const MAP_ZOOM_LABELS: Record<MapZoom, string> = { 13: "Town", 15: "Neighborhood", 16: "Street" };

/** The picture: 16:9, wide enough for a page column, small enough to cache everywhere. */
export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 540;
export const TILE_SIZE = 256;

export function isMapZoom(value: number): value is MapZoom {
  return (MAP_ZOOMS as readonly number[]).includes(value);
}

/** A point on the world's pixel plane at a zoom (Web Mercator, 256px tiles). */
export function lngLatToPixel(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export interface TilePlacement {
  z: number;
  x: number;
  y: number;
  /** Where the tile's top-left lands on the picture; may be negative at the edges. */
  left: number;
  top: number;
}

/** The tiles that cover a picture centred on the pin, and where each one goes. */
export function tilesForWindow(pin: { lat: number; lng: number }, zoom: number): TilePlacement[] {
  const centre = lngLatToPixel(pin.lng, pin.lat, zoom);
  const originX = Math.round(centre.x - MAP_WIDTH / 2);
  const originY = Math.round(centre.y - MAP_HEIGHT / 2);
  const n = 2 ** zoom;
  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + MAP_WIDTH - 1) / TILE_SIZE);
  const firstY = Math.floor(originY / TILE_SIZE);
  const lastY = Math.floor((originY + MAP_HEIGHT - 1) / TILE_SIZE);
  const out: TilePlacement[] = [];
  for (let ty = firstY; ty <= lastY; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = firstX; tx <= lastX; tx++) {
      // The world wraps east to west; the picture does not.
      const x = ((tx % n) + n) % n;
      out.push({ z: zoom, x, y: ty, left: tx * TILE_SIZE - originX, top: ty * TILE_SIZE - originY });
    }
  }
  return out;
}

/**
 * A short, stable name for one picture: the pin, the zoom and the colour
 * of the marker, so a moved pin or a new brand colour is a new address and
 * every cache in between forgets the old one by itself.
 */
export function mapKey(pin: { lat: number; lng: number }, zoom: number, colour: string): string {
  const text = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)},${zoom},${colour}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}-${zoom}`;
}

/** `<hash>-<zoom>` back into its zoom, or null for anything else. */
export function zoomFromKey(key: string): MapZoom | null {
  const match = /^[0-9a-f]{8}-(\d{2})$/.exec(key);
  if (!match) return null;
  const zoom = Number(match[1]);
  return isMapZoom(zoom) ? zoom : null;
}

/** Where a visitor's own maps app takes them: a link they choose to follow. */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address.replace(/\s+/g, " ").trim())}`;
}

/** The marker, drawn in the brand colour with a white edge; sized for the picture. */
export function markerSvg(colour: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52">',
    `<path d="M20 51 C20 51 4 30 4 18 A16 16 0 0 1 36 18 C36 30 20 51 20 51 Z" fill="${colour}" stroke="#ffffff" stroke-width="3"/>`,
    '<circle cx="20" cy="18" r="6" fill="#ffffff"/>',
    "</svg>",
  ].join("");
}

/** The marker's top-left on the picture: its point sits on the pin. */
export const MARKER = { width: 40, height: 52, left: MAP_WIDTH / 2 - 20, top: MAP_HEIGHT / 2 - 51 } as const;

/**
 * The Census Bureau's geocoder answer, read down to a pin, or null. Its
 * first match is the best one; a city-level fallback would be a lie about
 * where the business is, so a miss stays a miss.
 */
export function pinFromCensus(json: unknown, address: string): MapPin | null {
  if (!json || typeof json !== "object") return null;
  const result = (json as { result?: { addressMatches?: unknown } }).result;
  const matches = result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const first = matches[0] as { coordinates?: { x?: unknown; y?: unknown }; matchedAddress?: unknown };
  const lng = first.coordinates?.x;
  const lat = first.coordinates?.y;
  if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    matched: typeof first.matchedAddress === "string" ? first.matchedAddress : "",
    address,
  };
}

/** Whether the pin is for this address, so a changed address is placed again. */
export function pinIsFor(pin: MapPin | null, address: string): pin is MapPin {
  return !!pin && pin.address === address.trim();
}

/** The Website screen's line about the map. */
export function mapStatusLine(settings: { address: string; map: MapPin | null }): string {
  const address = settings.address.trim();
  if (!address) return "Add an address to put the business on the map.";
  if (pinIsFor(settings.map, address)) {
    return `On the map as ${settings.map.matched || "the address above"}.`;
  }
  return "Not on the map: the address could not be placed. Check it and save again.";
}

/**
 * USGS Topo: The National Map's public-domain topographic tiles, roads and
 * names included, zoom 0 to 16, the United States only. `{z}/{y}/{x}` is
 * ArcGIS order. The same family the Land pack draws its aerial from, and
 * for the same reason: a licence no tenant has to hold (ADR 0026).
 */
export const MAP_TILE_URL =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}";
/** Shown under the picture; a courtesy on public-domain data, and the honest thing. */
export const MAP_ATTRIBUTION = "Map: USGS The National Map";
