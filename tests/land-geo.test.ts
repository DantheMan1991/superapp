import { describe, expect, it } from "vitest";
import {
  areaDisagrees,
  asBoundary,
  boundaryAreaAcres,
  boundaryAreaSqM,
  boundingBox,
  centroid,
  compareArea,
  parseBoundary,
  pointInBoundary,
  validateBoundary,
  type Boundary,
  type LinearRing,
} from "../src/packs/land/core/geo";

/**
 * Boundaries. The pure half of land slice 2a.
 *
 * The tests worth writing here are the ones where a plausible implementation is
 * quietly wrong rather than broken: a planar area formula (out by the cosine of
 * the latitude), winding order taken on trust (a valid boundary measuring
 * negative), and a paste box that only accepts the one GeoJSON shape no real
 * tool exports.
 */

/** A closed rectangle, in [lon, lat] order — GeoJSON's order, not speech's. */
function box(west: number, south: number, east: number, north: number): LinearRing {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

const polygon = (...rings: LinearRing[]): Boundary => ({
  type: "Polygon",
  coordinates: rings,
});

describe("area", () => {
  it("measures a paddock at 40°N to within half a percent", () => {
    // 0.01° square. Independently: 0.01° of latitude on a sphere of radius
    // 6,378,137 m is 1,113.19 m; the same angle of longitude at 40°N is that
    // times cos(40°) ≈ 852.7 m. So ≈ 949,200 m², ≈ 234.6 acres.
    const area = boundaryAreaSqM(polygon(box(-96.0, 40.0, -95.99, 40.01)));
    expect(area).toBeGreaterThan(949_200 * 0.995);
    expect(area).toBeLessThan(949_200 * 1.005);
    expect(boundaryAreaAcres(polygon(box(-96.0, 40.0, -95.99, 40.01)))).toBeCloseTo(
      234.56,
      0,
    );
  });

  it("SHRINKS the same box toward the pole, which a planar formula would not", () => {
    // The whole reason the formula is spherical. A degree of longitude is a
    // shorter distance at 60°N than at 20°N, and at 40°N a planar answer is out
    // by about 23% — over two acres on a ten-acre paddock.
    const low = boundaryAreaSqM(polygon(box(0, 20.0, 0.01, 20.01)));
    const high = boundaryAreaSqM(polygon(box(0, 60.0, 0.01, 60.01)));
    expect(high).toBeLessThan(low);
    // cos(60°)/cos(20°) ≈ 0.532
    expect(high / low).toBeCloseTo(0.532, 2);
  });

  it("ignores winding order", () => {
    // GeoJSON asks for counter-clockwise outer rings and plenty of real files
    // disagree. Trusting the winding would make a perfectly good boundary
    // measure negative, and a negative paddock is not a state anything here can
    // report on.
    const ring = box(-96.0, 40.0, -95.99, 40.01);
    const clockwise = [...ring].reverse();
    expect(boundaryAreaSqM(polygon(clockwise))).toBeCloseTo(
      boundaryAreaSqM(polygon(ring)),
      6,
    );
  });

  it("subtracts a hole", () => {
    const outer = box(-96.0, 40.0, -95.99, 40.01);
    const pond = box(-95.996, 40.004, -95.994, 40.006);
    const whole = boundaryAreaSqM(polygon(outer));
    const pondArea = boundaryAreaSqM(polygon(pond));
    expect(boundaryAreaSqM(polygon(outer, pond))).toBeCloseTo(whole - pondArea, 3);
  });

  it("adds the parts of a MultiPolygon", () => {
    // A parcel split by a road is one parcel and two pieces of ground.
    const a = box(-96.0, 40.0, -95.99, 40.01);
    const b = box(-95.98, 40.0, -95.97, 40.01);
    const multi: Boundary = { type: "MultiPolygon", coordinates: [[a], [b]] };
    expect(boundaryAreaSqM(multi)).toBeCloseTo(
      boundaryAreaSqM(polygon(a)) + boundaryAreaSqM(polygon(b)),
      3,
    );
  });
});

describe("containment", () => {
  const paddock = polygon(box(-96.0, 40.0, -95.99, 40.01));

  it("knows which paddock you are standing in", () => {
    expect(pointInBoundary([-95.995, 40.005], paddock)).toBe(true);
    expect(pointInBoundary([-95.98, 40.005], paddock)).toBe(false);
  });

  it("treats a hole as outside", () => {
    // A pond in the middle of a paddock is not the paddock, and a phone sitting
    // on the bank must not read as "in the water".
    const withPond = polygon(
      box(-96.0, 40.0, -95.99, 40.01),
      box(-95.996, 40.004, -95.994, 40.006),
    );
    expect(pointInBoundary([-95.995, 40.005], withPond)).toBe(false);
    expect(pointInBoundary([-95.992, 40.008], withPond)).toBe(true);
  });

  it("puts a point on a shared edge in exactly one of two touching paddocks", () => {
    // Half-open ray casting. Both answering "yes" would make the pre-fill
    // ambiguous exactly where paddocks meet, which is where a person walks.
    const west = polygon(box(-96.0, 40.0, -95.99, 40.01));
    const east = polygon(box(-95.99, 40.0, -95.98, 40.01));
    const onTheFence: [number, number] = [-95.99, 40.005];
    const hits = [west, east].filter((p) => pointInBoundary(onTheFence, p));
    expect(hits).toHaveLength(1);
  });

  it("finds nothing in an empty MultiPolygon rather than throwing", () => {
    expect(
      pointInBoundary([0, 0], { type: "MultiPolygon", coordinates: [] }),
    ).toBe(false);
  });
});

describe("bounding box and centroid", () => {
  it("bounds in GeoJSON order — west, south, east, north", () => {
    expect(boundingBox(polygon(box(-96.0, 40.0, -95.99, 40.01)))).toEqual([
      -96.0, 40.0, -95.99, 40.01,
    ]);
  });

  it("puts a square's centroid in the middle", () => {
    const [lon, lat] = centroid(polygon(box(-96.0, 40.0, -95.99, 40.01)));
    expect(lon).toBeCloseTo(-95.995, 6);
    expect(lat).toBeCloseTo(40.005, 6);
  });

  it("falls back to the box centre for a degenerate ring instead of NaN", () => {
    // A ring with no area still has to answer, because the weather lookup that
    // consumes this cannot be handed a NaN latitude.
    const flat: LinearRing = [
      [-96.0, 40.0],
      [-95.99, 40.0],
      [-96.0, 40.0],
      [-96.0, 40.0],
    ];
    const [lon, lat] = centroid(polygon(flat));
    expect(Number.isNaN(lon)).toBe(false);
    expect(lat).toBeCloseTo(40.0, 6);
  });
});

describe("parsing what somebody pasted", () => {
  const ring = box(-96.0, 40.0, -95.99, 40.01);
  const geometry = { type: "Polygon", coordinates: [ring] };

  it("takes a bare geometry", () => {
    const result = parseBoundary(geometry);
    expect(result.ok && result.boundary.type).toBe("Polygon");
  });

  it("takes a Feature and a one-shape FeatureCollection", () => {
    // What every real source actually hands you. geojson.io exports a
    // FeatureCollection; so does a county GIS download.
    expect(parseBoundary({ type: "Feature", geometry }).ok).toBe(true);
    expect(
      parseBoundary({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry }],
      }).ok,
    ).toBe(true);
  });

  it("refuses a multi-shape file by saying how many are in it", () => {
    const result = parseBoundary({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry },
        { type: "Feature", geometry },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("2 shapes");
  });

  it("names the shape it got when it is a point or a line", () => {
    // Troughs and fences are real and they are slice 2b. Saying so beats
    // "invalid GeoJSON" for somebody who pasted the right file by mistake.
    const result = parseBoundary({
      type: "LineString",
      coordinates: [
        [-96, 40],
        [-95.99, 40],
      ],
    });
    expect(result.ok === false && result.error).toContain("LineString");
  });

  it("takes a JSON string as well as an object", () => {
    expect(parseBoundary(JSON.stringify(geometry)).ok).toBe(true);
    expect(parseBoundary("   ").ok).toBe(false);
    expect(parseBoundary("{not json").ok).toBe(false);
  });

  it("refuses a ring that does not close", () => {
    const open = ring.slice(0, -1);
    expect(validateBoundary({ type: "Polygon", coordinates: [open] }).ok).toBe(false);
  });

  it("refuses coordinates off the planet, and swapped ones that show as such", () => {
    // The classic paste error is lat/long instead of long/lat. It only fails
    // loudly when the latitude is over 90 — which is most of the United States,
    // longitudes being what they are.
    expect(
      validateBoundary({ type: "Polygon", coordinates: [box(40, -96, 40.01, -95.99)] })
        .ok,
    ).toBe(false);
  });

  it("drops altitude rather than choking on it", () => {
    // GPS exports carry a third number. Nothing here has any use for it, and
    // refusing the file over it would be refusing most phone tracks.
    const withZ = [
      [-96.0, 40.0, 431.2],
      [-95.99, 40.0, 430.9],
      [-95.99, 40.01, 429.8],
      [-96.0, 40.01, 430.1],
      [-96.0, 40.0, 431.2],
    ];
    const result = parseBoundary({ type: "Polygon", coordinates: [withZ] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.boundary.coordinates[0][0]).toEqual([-96.0, 40.0]);
  });

  it("degrades a garbage jsonb column to no boundary rather than a crash", () => {
    // The column has no shape constraint, so a page has to survive whatever is
    // in it — the same discipline `areaUnitFrom` follows for pack config.
    expect(asBoundary(null)).toBeNull();
    expect(asBoundary({ type: "Polygon", coordinates: "nope" })).toBeNull();
    expect(asBoundary(geometry)).not.toBeNull();
  });
});

describe("declared against drawn", () => {
  const paddock = polygon(box(-96.0, 40.0, -95.99, 40.01)); // ≈ 234.6 acres

  it("reports the gap without taking a side", () => {
    const comparison = compareArea(240, paddock);
    expect(comparison.declaredAcres).toBe(240);
    expect(comparison.computedAcres).toBeCloseTo(234.56, 1);
    expect(comparison.differenceAcres).toBeLessThan(0);
    expect(areaDisagrees(comparison)).toBe(false); // ~2.3%, inside the threshold
  });

  it("flags a real disagreement", () => {
    expect(areaDisagrees(compareArea(400, paddock))).toBe(true);
  });

  it("says nothing when either side is missing", () => {
    // "Not measured" and "they agree" are different facts, and a comparison
    // that returned 0 for the first would read as the second.
    expect(compareArea(null, paddock).differenceAcres).toBeNull();
    expect(compareArea(10, null).differenceAcres).toBeNull();
    expect(areaDisagrees(compareArea(null, null))).toBe(false);
  });

  it("does not divide by a declared zero", () => {
    expect(compareArea(0, paddock).differenceFraction).toBeNull();
  });
});
