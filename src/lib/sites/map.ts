import "server-only";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveBrandForSite } from "@/lib/brand/read";
import { PUBLIC_IMAGE_CACHE } from "./images";
import {
  MAP_HEIGHT,
  MAP_TILE_URL,
  MAP_WIDTH,
  MARKER,
  mapKey,
  markerSvg,
  pinFromCensus,
  pinIsFor,
  TILE_SIZE,
  tilesForWindow,
  zoomFromKey,
  type MapPin,
} from "./map-core";
import type { SiteHit } from "./read";
import { readSiteSettings } from "./schema";

/**
 * The map as a picture the platform draws — ADR 0026.
 *
 * GEOCODING happens once, when the details are saved: the Census Bureau's
 * geocoder turns the address into a pin that is kept with the address it
 * came from. DRAWING happens when the picture is asked for: the tiles that
 * cover a window around the pin are fetched from USGS Topo, stitched with
 * `sharp`, the marker is laid on top in the brand colour, and the result
 * goes out as WebP under the same public cache headers as a photo. The
 * picture's address carries a hash of the pin, the zoom and the colour, so
 * a moved pin is a new address and every cache forgets the old one by
 * itself; a key that does not match what the site holds is a 404.
 *
 * Both are the SERVER talking to public-domain services with the business's
 * own public address. A visitor's browser asks the platform for one image
 * and nobody else for anything, which is the rule the fonts set (ADR 0024).
 */
const GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const USER_AGENT = "Yosher site map (yosherapp.com)";
const FETCH_MS = 8000;

/** The Census geocoder's first match, or null: no answer, no pin, never a guess. */
export async function geocodeAddress(address: string): Promise<MapPin | null> {
  const clean = address.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  try {
    const query = new URLSearchParams({ address: clean, benchmark: "Public_AR_Current", format: "json" });
    const res = await fetch(`${GEOCODER}?${query}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return pinFromCensus(await res.json(), address.trim());
  } catch (err) {
    console.error("site map: geocoding failed", err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchTile(z: number, x: number, y: number): Promise<Buffer | null> {
  try {
    const url = MAP_TILE_URL.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_MS) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    // A missing tile leaves a grey square; the rest of the map still draws.
    return null;
  }
}

/** The picture: the tiles around the pin, cut to size, the marker on top. */
export async function renderMap(pin: MapPin, zoom: number, colour: string): Promise<Buffer> {
  const tiles = tilesForWindow(pin, zoom);
  const buffers = await Promise.all(tiles.map((t) => fetchTile(t.z, t.x, t.y)));
  // Compose on a canvas that holds every tile whole, then cut the window
  // out: `sharp` places overlays at non-negative offsets only.
  const shiftX = -Math.min(0, ...tiles.map((t) => t.left));
  const shiftY = -Math.min(0, ...tiles.map((t) => t.top));
  const canvasWidth = Math.max(MAP_WIDTH + shiftX, ...tiles.map((t) => t.left + shiftX + TILE_SIZE));
  const canvasHeight = Math.max(MAP_HEIGHT + shiftY, ...tiles.map((t) => t.top + shiftY + TILE_SIZE));
  const layers = tiles.flatMap((t, i) => {
    const input = buffers[i];
    return input ? [{ input, left: t.left + shiftX, top: t.top + shiftY }] : [];
  });
  const stitched = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#e5e7eb" },
  })
    .composite(layers)
    .png()
    .toBuffer();
  return sharp(stitched)
    .extract({ left: shiftX, top: shiftY, width: MAP_WIDTH, height: MAP_HEIGHT })
    .composite([{ input: Buffer.from(markerSvg(colour)), left: MARKER.left, top: MARKER.top }])
    .webp({ quality: 82 })
    .toBuffer();
}

function notFound(): Response {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

function picture(body: Buffer, key: string, cacheControl: string): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(body.length),
      "Cache-Control": cacheControl,
      ETag: `"${key}"`,
      "Content-Disposition": 'inline; filename="map.webp"',
    },
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** The site's pin and the marker's colour, inside the caller's context. Null when there is no pin for the address. */
async function pinAndColour(
  tx: Tx,
  tenantId: string,
  siteId: string,
  publishedOnly: boolean,
): Promise<{ pin: MapPin; colour: string } | null> {
  const site = await tx.query.sites.findFirst({
    where: and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.id, siteId)),
    columns: { settings: true, status: true },
  });
  if (!site || (publishedOnly && site.status !== "published")) return null;
  const settings = readSiteSettings(site.settings);
  if (!pinIsFor(settings.map, settings.address)) return null;
  // The site's primary colour (ADR 0045): the pin is drawn in the brand
  // whose page it appears on.
  const brand = await resolveBrandForSite(tx, tenantId, siteId);
  return { pin: settings.map, colour: brand.primaryColor ?? "#1f2937" };
}

/** A published site's map, addressed by its free address or its domain. */
export async function siteMapResponse(hit: SiteHit | null, key: string, ifNoneMatch: string | null): Promise<Response> {
  const zoom = zoomFromKey(key);
  if (!hit || hit.status !== "published" || !zoom) return notFound();
  const found = await withTenant(hit.tenantId, (tx) => pinAndColour(tx, hit.tenantId, hit.id, true));
  if (!found || mapKey(found.pin, zoom, found.colour) !== key) return notFound();
  if (ifNoneMatch === `"${key}"`) return new Response(null, { status: 304 });
  return picture(await renderMap(found.pin, zoom, found.colour), key, PUBLIC_IMAGE_CACHE);
}

/** The same picture for a signed-in member: the editor's preview and an unpublished draft. */
export async function memberMapResponse(
  ctx: { tenantId: string; role: "owner" | "staff" | "expert" },
  siteId: string,
  key: string,
  ifNoneMatch: string | null,
): Promise<Response> {
  const zoom = zoomFromKey(key);
  if (!zoom) return notFound();
  const found = await withTenant(
    ctx.tenantId,
    async (tx) => {
      // NAMED, not found. This used to take the tenant's first site, which
      // stopped being an answer at ADR 0045 — with two sites it drew one
      // site's pin in the other's brand colour.
      const site = await tx.query.sites.findFirst({
        where: and(eq(schema.sites.tenantId, ctx.tenantId), eq(schema.sites.id, siteId)),
        columns: { id: true },
      });
      return site ? pinAndColour(tx, ctx.tenantId, site.id, false) : null;
    },
    { role: ctx.role },
  );
  if (!found || mapKey(found.pin, zoom, found.colour) !== key) return notFound();
  if (ifNoneMatch === `"${key}"`) return new Response(null, { status: 304 });
  return picture(await renderMap(found.pin, zoom, found.colour), key, "private, max-age=3600");
}
