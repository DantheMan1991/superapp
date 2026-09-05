import { describe, expect, it } from "vitest";
import {
  directionsUrl,
  lngLatToPixel,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAP_ZOOMS,
  mapKey,
  mapStatusLine,
  MARKER,
  markerSvg,
  pinFromCensus,
  pinIsFor,
  tilesForWindow,
  zoomFromKey,
} from "../src/lib/sites/map-core";
import { newSection, sectionSummary } from "../src/lib/sites/pages";
import { EMPTY_SETTINGS, SectionSchema, SiteSettingsSchema } from "../src/lib/sites/schema";
import { siteRewrite } from "../src/lib/sites/slug";

const MOUNT_VERNON = { lat: 40.3934, lng: -82.4857 };

describe("a map section", () => {
  it("starts as a neighborhood map with the address and directions", () => {
    const section = SectionSchema.parse(newSection("map"));
    expect(section).toMatchObject({ type: "map", heading: "Find us", zoom: 15, showAddress: true, directions: true });
    expect(sectionSummary(newSection("map"))).toBe("Find us: neighborhood map");
    expect(SectionSchema.safeParse({ ...newSection("map"), zoom: 17 }).success).toBe(false);
    expect(MAP_ZOOMS).toEqual([13, 15, 16]);
  });

  it("keeps the pin on the settings with the address it was placed from", () => {
    expect(SiteSettingsSchema.parse({}).map).toBeNull();
    expect(EMPTY_SETTINGS.map).toBeNull();
    const pin = { lat: 40.39, lng: -82.49, matched: "17 N MAIN ST", address: "17 Main St" };
    expect(SiteSettingsSchema.parse({ map: pin }).map).toEqual(pin);
    expect(SiteSettingsSchema.safeParse({ map: { ...pin, lat: 91 } }).success).toBe(false);
    expect(pinIsFor(pin, "17 Main St")).toBe(true);
    expect(pinIsFor(pin, " 17 Main St ")).toBe(true);
    expect(pinIsFor(pin, "18 Main St")).toBe(false);
    expect(pinIsFor(null, "17 Main St")).toBe(false);
  });

  it("projects the world onto tiles the way every web map does", () => {
    expect(lngLatToPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(lngLatToPixel(-180, 0, 1)).toEqual({ x: 0, y: 256 });
    const px = lngLatToPixel(MOUNT_VERNON.lng, MOUNT_VERNON.lat, 15);
    // Tile 8875 / 12358 at zoom 15: both forms of the projection agree to the decimal (12358.40).
    expect(Math.floor(px.x / 256)).toBe(8875);
    expect(Math.floor(px.y / 256)).toBe(12358);
  });

  it("names the tiles that cover the picture and where each one lands", () => {
    const tiles = tilesForWindow(MOUNT_VERNON, 15);
    // 960 wide needs four or five columns of 256, 540 high three or four rows.
    expect(tiles.length).toBeGreaterThanOrEqual(12);
    expect(tiles.length).toBeLessThanOrEqual(20);
    for (const t of tiles) {
      expect(t.z).toBe(15);
      expect(t.left).toBeGreaterThan(-256);
      expect(t.left).toBeLessThan(MAP_WIDTH);
      expect(t.top).toBeGreaterThan(-256);
      expect(t.top).toBeLessThan(MAP_HEIGHT);
    }
    // The pin's own tile is among them, and the pin sits in the middle of the picture.
    expect(tiles.some((t) => t.x === 8875 && t.y === 12358)).toBe(true);
    expect(MARKER.left + 20).toBe(MAP_WIDTH / 2);
    expect(MARKER.top + 51).toBe(MAP_HEIGHT / 2);
  });

  it("gives a picture a short name that changes with the pin, the zoom and the colour", () => {
    const a = mapKey(MOUNT_VERNON, 15, "#8b1e3f");
    expect(a).toMatch(/^[0-9a-f]{8}-15$/);
    expect(mapKey(MOUNT_VERNON, 15, "#8b1e3f")).toBe(a);
    expect(mapKey(MOUNT_VERNON, 16, "#8b1e3f")).not.toBe(a);
    expect(mapKey(MOUNT_VERNON, 15, "#000000")).not.toBe(a);
    expect(mapKey({ lat: 40.3935, lng: -82.4857 }, 15, "#8b1e3f")).not.toBe(a);
    expect(zoomFromKey(a)).toBe(15);
    expect(zoomFromKey("0123abcd-17")).toBeNull();
    expect(zoomFromKey("../etc/passwd")).toBeNull();
    expect(zoomFromKey("0123abcd-15.webp")).toBeNull();
  });

  it("draws the marker in the brand colour and links directions the way a person's maps app expects", () => {
    expect(markerSvg("#8b1e3f")).toContain('fill="#8b1e3f"');
    expect(markerSvg("#8b1e3f")).toContain("<svg");
    expect(directionsUrl("17 Main St\nMount Vernon, OH 43050")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=17%20Main%20St%20Mount%20Vernon%2C%20OH%2043050",
    );
  });

  it("reads the Census geocoder's first match and nothing less", () => {
    const answer = {
      result: {
        addressMatches: [
          { coordinates: { x: -82.259952293137, y: 40.451222167901 }, matchedAddress: "17 E MAIN ST, MOUNT VERNON, OH, 43050" },
          { coordinates: { x: -82.4854, y: 40.3940 }, matchedAddress: "17 N MAIN ST, MOUNT VERNON, OH, 43050" },
        ],
      },
    };
    expect(pinFromCensus(answer, "17 Main St, Mount Vernon, OH 43050")).toEqual({
      lat: 40.451222167901,
      lng: -82.259952293137,
      matched: "17 E MAIN ST, MOUNT VERNON, OH, 43050",
      address: "17 Main St, Mount Vernon, OH 43050",
    });
    expect(pinFromCensus({ result: { addressMatches: [] } }, "x")).toBeNull();
    expect(pinFromCensus({ result: { addressMatches: [{ coordinates: { x: "no", y: 1 } }] } }, "x")).toBeNull();
    expect(pinFromCensus(null, "x")).toBeNull();
    expect(pinFromCensus("<html>", "x")).toBeNull();
  });

  it("tells the owner where the map stands", () => {
    expect(mapStatusLine({ address: "", map: null })).toBe("Add an address to put the business on the map.");
    expect(mapStatusLine({ address: "17 Main St", map: null })).toBe(
      "Not on the map: the address could not be placed. Check it and save again.",
    );
    expect(mapStatusLine({ address: "17 Main St", map: { lat: 1, lng: 1, matched: "17 N MAIN ST", address: "17 Main St" } })).toBe(
      "On the map as 17 N MAIN ST.",
    );
    expect(mapStatusLine({ address: "18 Main St", map: { lat: 1, lng: 1, matched: "17 N MAIN ST", address: "17 Main St" } })).toBe(
      "Not on the map: the address could not be placed. Check it and save again.",
    );
  });

  it("is served on a site host the way photos are", () => {
    expect(siteRewrite({ kind: "site", slug: "oak-row-farm" }, "/map/0123abcd-15")).toBe("/sites/oak-row-farm/map/0123abcd-15");
    expect(siteRewrite({ kind: "custom", host: "www.oakrow.example" }, "/map/0123abcd-15")).toBe("/domain/www.oakrow.example/map/0123abcd-15");
    expect(siteRewrite({ kind: "site", slug: "oak-row-farm" }, "/map")).toBe("/hosted/oak-row-farm/map");
  });
});
