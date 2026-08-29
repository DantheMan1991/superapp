import { describe, expect, it } from "vitest";
import {
  asFeatureGeometry,
  geometryLengthM,
  haversineM,
  parseFeatureGeometry,
  shapeOf,
  validateFeatureGeometry,
  type FeatureGeometry,
} from "../src/packs/land/core/geo";
import {
  formatLength,
  formatLengthTotal,
  fromMetres,
  lengthUnitFrom,
  toMetres,
  totalLength,
} from "../src/packs/land/core/length";
import {
  availableFeatureKinds,
  featureKindLabel,
  featureKindsFrom,
  featureStyle,
  isFeatureStatus,
  isLineWidth,
  isValidFeatureKind,
  LINE_WIDTH_MAX,
  LINE_WIDTH_MIN,
  LINE_WIDTH_PRESETS,
  resolveWidth,
  shapeFor,
  STATUS_STYLES,
  SUGGESTED_FEATURE_KINDS,
} from "../src/packs/land/core/features";

/**
 * Features — the pure half of land slice 2b.0.
 *
 * The tests worth writing are, as in `land-geo.test.ts`, the ones where a
 * plausible implementation is quietly WRONG rather than broken:
 *
 *   - a planar length formula, which is out by the cosine of the latitude in
 *     the east–west direction and right in the north–south one, so it looks
 *     correct on the first test anybody writes
 *   - a validator that accepts a one-point line, which measures zero feet while
 *     looking like a fence on the map
 *   - symbology that styles by the KIND's declared shape rather than by the
 *     shape actually drawn, which renders nothing at all for a building somebody
 *     dropped as a point
 *   - a length total that lets an undrawn feature read as zero, which is the
 *     `totalArea` mistake in a new place
 */

const line = (...coordinates: [number, number][]): FeatureGeometry => ({
  type: "LineString",
  coordinates,
});

// A degree of latitude is ~111.32 km everywhere; a degree of longitude is that
// only at the equator. Both directions are tested for exactly that reason.
const KNOX = 40.4; // latitude of the pilot farm, where cos ≈ 0.761

describe("haversine distance", () => {
  it("measures a degree of latitude at about 111 km", () => {
    const metres = haversineM([-82.5, 40], [-82.5, 41]);
    expect(metres).toBeGreaterThan(111_000);
    expect(metres).toBeLessThan(111_500);
  });

  it("shortens a degree of longitude by the cosine of the latitude", () => {
    const atEquator = haversineM([0, 0], [1, 0]);
    const atKnox = haversineM([-82.5, KNOX], [-81.5, KNOX]);
    // The planar mistake would make these equal. cos(40.4°) ≈ 0.761.
    expect(atKnox / atEquator).toBeCloseTo(Math.cos((KNOX * Math.PI) / 180), 3);
  });

  it("is zero for a point measured against itself", () => {
    expect(haversineM([-82.5, 40.4], [-82.5, 40.4])).toBe(0);
  });
});

describe("geometryLengthM", () => {
  it("sums the segments of a line", () => {
    const one = haversineM([-82.5, 40.4], [-82.5, 40.401]);
    const two = haversineM([-82.5, 40.401], [-82.5, 40.402]);
    expect(geometryLengthM(line([-82.5, 40.4], [-82.5, 40.401], [-82.5, 40.402])))
      .toBeCloseTo(one + two, 6);
  });

  it("is zero for a point, which is not a fudge", () => {
    expect(
      geometryLengthM({ type: "Point", coordinates: [-82.5, 40.4] }),
    ).toBe(0);
  });

  it("returns the PERIMETER of an area, because that is the fence round it", () => {
    // A closed square, 0.001° on a side at 40.4°N.
    const ring: [number, number][] = [
      [-82.5, 40.4],
      [-82.499, 40.4],
      [-82.499, 40.401],
      [-82.5, 40.401],
      [-82.5, 40.4],
    ];
    const perimeter = geometryLengthM({ type: "Polygon", coordinates: [ring] });
    // Summed segment by segment rather than as 2×side + 2×top: the north edge
    // is measurably SHORTER than the south one, because a degree of longitude
    // narrows as you go up. A millimetre on a 392 m square, and the reason a
    // "rectangle" on a sphere is not one.
    let expected = 0;
    for (let i = 1; i < ring.length; i += 1) {
      expected += haversineM(ring[i - 1], ring[i]);
    }
    expect(perimeter).toBeCloseTo(expected, 9);
    expect(haversineM(ring[2], ring[3])).toBeLessThan(
      haversineM(ring[0], ring[1]),
    );
  });

  it("counts a hole, because an interior fence is still fence you build", () => {
    const outer: [number, number][] = [
      [-82.5, 40.4],
      [-82.49, 40.4],
      [-82.49, 40.41],
      [-82.5, 40.41],
      [-82.5, 40.4],
    ];
    const hole: [number, number][] = [
      [-82.497, 40.403],
      [-82.495, 40.403],
      [-82.495, 40.405],
      [-82.497, 40.405],
      [-82.497, 40.403],
    ];
    const withHole = geometryLengthM({
      type: "Polygon",
      coordinates: [outer, hole],
    });
    const without = geometryLengthM({ type: "Polygon", coordinates: [outer] });
    expect(withHole).toBeGreaterThan(without);
  });

  it("adds up the runs of a MultiLineString — one fence, two stretches", () => {
    const a = line([-82.5, 40.4], [-82.5, 40.401]);
    const b = line([-82.5, 40.403], [-82.5, 40.404]);
    const joined = geometryLengthM({
      type: "MultiLineString",
      coordinates: [
        [
          [-82.5, 40.4],
          [-82.5, 40.401],
        ],
        [
          [-82.5, 40.403],
          [-82.5, 40.404],
        ],
      ],
    });
    expect(joined).toBeCloseTo(geometryLengthM(a) + geometryLengthM(b), 6);
  });
});

describe("shapeOf", () => {
  it("collapses six GeoJSON types into the three a renderer cares about", () => {
    expect(shapeOf({ type: "Point", coordinates: [0, 0] })).toBe("point");
    expect(shapeOf(line([0, 0], [1, 1]))).toBe("line");
    expect(
      shapeOf({ type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] }),
    ).toBe("line");
    expect(shapeOf({ type: "Polygon", coordinates: [] })).toBe("area");
    expect(shapeOf({ type: "MultiPolygon", coordinates: [] })).toBe("area");
  });
});

describe("validateFeatureGeometry", () => {
  it("accepts a point", () => {
    const result = validateFeatureGeometry({
      type: "Point",
      coordinates: [-82.5, 40.4],
    });
    expect(result.ok).toBe(true);
  });

  it("REFUSES a one-point line, which a drawing tool leaves behind", () => {
    const result = validateFeatureGeometry({
      type: "LineString",
      coordinates: [[-82.5, 40.4]],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least two points/);
  });

  it("refuses a latitude outside ±90", () => {
    const result = validateFeatureGeometry({
      type: "Point",
      coordinates: [-82.5, 140.4],
    });
    expect(result.ok).toBe(false);
  });

  it("CANNOT catch a reversed US coordinate, and that is worth knowing", () => {
    // [40.4, -82.5] is the pilot farm's lat/long written the wrong way round.
    // It is also perfectly legal GeoJSON for a point in the Southern Ocean, so
    // range checking cannot refuse it and this validator does not pretend to.
    // What catches it is the map: the shape lands 8,000 miles from the parcel.
    const result = validateFeatureGeometry({
      type: "Point",
      coordinates: [40.4, -82.5],
    });
    expect(result.ok).toBe(true);
  });

  it("drops altitude, as the boundary parser does", () => {
    const result = validateFeatureGeometry({
      type: "LineString",
      coordinates: [
        [-82.5, 40.4, 320],
        [-82.5, 40.401, 322],
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.geometry).toEqual({
        type: "LineString",
        coordinates: [
          [-82.5, 40.4],
          [-82.5, 40.401],
        ],
      });
    }
  });

  it("still accepts an area, because a feature may be one", () => {
    const result = validateFeatureGeometry({
      type: "Polygon",
      coordinates: [
        [
          [-82.5, 40.4],
          [-82.499, 40.4],
          [-82.499, 40.401],
          [-82.5, 40.4],
        ],
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("names what it wanted when handed something else", () => {
    const result = validateFeatureGeometry({ type: "GeometryCollection" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/point, a line or an area/);
  });
});

describe("parseFeatureGeometry", () => {
  it("unwraps a single-shape FeatureCollection, which is what every tool exports", () => {
    const result = parseFeatureGeometry(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [-82.5, 40.4],
                [-82.5, 40.401],
              ],
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a collection with several shapes, and says how many", () => {
    const one = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-82.5, 40.4] },
    };
    const result = parseFeatureGeometry({
      type: "FeatureCollection",
      features: [one, one, one],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/3 shapes/);
  });
});

describe("asFeatureGeometry", () => {
  it("degrades to null rather than throwing, so a bad row still lists", () => {
    expect(asFeatureGeometry(null)).toBeNull();
    expect(asFeatureGeometry({ type: "Nonsense" })).toBeNull();
    expect(asFeatureGeometry("not json at all")).toBeNull();
  });
});

describe("length display", () => {
  it("converts metres to feet exactly", () => {
    expect(fromMetres(0.3048, "foot")).toBeCloseTo(1, 10);
    expect(toMetres(1, "foot")).toBeCloseTo(0.3048, 10);
    expect(fromMetres(5, "metre")).toBe(5);
  });

  it("rounds to the whole unit, because a traced line cannot support more", () => {
    expect(formatLength(377.95)).toBe("1,240 ft");
  });

  it("renders an undrawn feature as an em dash, NEVER as zero", () => {
    expect(formatLength(null)).toBe("—");
  });

  it("falls back to feet for unreadable config", () => {
    expect(lengthUnitFrom(null)).toBe("foot");
    expect(lengthUnitFrom({ lengthUnit: "furlong" })).toBe("foot");
    expect(lengthUnitFrom({ lengthUnit: "metre" })).toBe("metre");
  });

  it("keeps an undrawn feature out of a total instead of adding zero", () => {
    const total = totalLength([100, null, 200]);
    expect(total).toEqual({ metres: 300, unknown: 1, count: 3 });
    expect(formatLengthTotal(total, "metre")).toBe("300 m (1 not drawn)");
  });

  it("says 'not drawn' rather than '0 ft' when nothing has been", () => {
    expect(formatLengthTotal(totalLength([null, null]))).toBe("not drawn");
  });
});

describe("feature vocabulary", () => {
  it("names no industry — no trough, no energizer (ADR 0004)", () => {
    const kinds = SUGGESTED_FEATURE_KINDS.map((k) => k.kind);
    expect(kinds).not.toContain("trough");
    expect(kinds).not.toContain("energizer");
    expect(kinds).toContain("fence");
    expect(kinds).toContain("buried_electric");
  });

  it("checks the FORMAT of a kind and never its values", () => {
    expect(isValidFeatureKind("trough")).toBe(true);
    expect(isValidFeatureKind("Trough")).toBe(false);
    expect(isValidFeatureKind("2_wire")).toBe(false);
    expect(isValidFeatureKind("")).toBe(false);
  });

  it("labels an unknown kind readably rather than refusing it", () => {
    expect(featureKindLabel("buried_electric")).toBe("Buried electric");
    expect(featureKindLabel("cattle_guard")).toBe("Cattle guard");
  });

  it("knows its three statuses and nothing else", () => {
    expect(isFeatureStatus("planned")).toBe(true);
    expect(isFeatureStatus("built")).toBe(true);
    expect(isFeatureStatus("removed")).toBe(true);
    expect(isFeatureStatus("proposed")).toBe(false);
  });
});

describe("symbology", () => {
  it("styles by the shape DRAWN, not the shape the kind expected", () => {
    // A building dropped as a point: it must still get a marker style with a
    // width, or the map renders nothing where the barn is.
    const asArea = featureStyle("building", "area");
    const asPoint = featureStyle("building", "point");
    expect(asArea.fill).toBeGreaterThan(0);
    expect(asPoint.color).toBe(asArea.color);
    expect(asPoint.width).toBeGreaterThan(0);
  });

  it("gives an unrecognised kind the fallback for its shape", () => {
    const trough = featureStyle("trough", "point");
    expect(trough.color).toBeTruthy();
    expect(trough.casing).toBeTruthy();
  });

  it("dashes what is buried and leaves what you can walk up to solid", () => {
    expect(featureStyle("fence", "line").dash).toBeNull();
    expect(featureStyle("waterline", "line").dash).not.toBeNull();
    expect(featureStyle("buried_electric", "line").dash).not.toBeNull();
  });

  it("makes a PROPOSAL look unlike a fact, whatever its kind says", () => {
    expect(STATUS_STYLES.built.dash).toBeNull();
    expect(STATUS_STYLES.built.keepKindDash).toBe(true);
    // The one rule the map must not get wrong: planned overrides the kind's own
    // dash rather than combining with it.
    expect(STATUS_STYLES.planned.dash).not.toBeNull();
    expect(STATUS_STYLES.planned.keepKindDash).toBe(false);
    expect(STATUS_STYLES.planned.opacity).toBeLessThan(
      STATUS_STYLES.built.opacity,
    );
    expect(STATUS_STYLES.removed.opacity).toBeLessThan(
      STATUS_STYLES.planned.opacity,
    );
  });

  it("keeps a PROPOSED buried service apart from a built one", () => {
    // The regression this was written for. Colour carries the kind, so status
    // has only opacity and dash left — and for a kind that is ALREADY dashed
    // (every buried service is), a small opacity step and a similar dash make
    // a proposal and a fact look the same. That is the one confusion this
    // column exists to prevent, in the one place it matters most: somebody
    // standing over a line deciding whether it is safe to dig.
    const kindDash = featureStyle("buried_electric", "line").dash;
    expect(kindDash).not.toBeNull();
    expect(STATUS_STYLES.planned.dash).not.toEqual(kindDash);
    expect(
      STATUS_STYLES.built.opacity - STATUS_STYLES.planned.opacity,
    ).toBeGreaterThanOrEqual(0.4);
  });
});

describe("woods, trees, and a shape that is a hint", () => {
  it("has a block of trees AND a line of them, which are different things", () => {
    const kinds = SUGGESTED_FEATURE_KINDS.map((k) => k.kind);
    expect(kinds).toContain("tree_line");
    expect(kinds).toContain("woods");
    expect(shapeFor("tree_line")).toBe("line");
    expect(shapeFor("woods")).toBe("area");
    // Same colour family, because they are both vegetation, and a legend that
    // showed them in different greens would imply a distinction that is not
    // there. The SHAPE is what tells them apart.
    expect(featureStyle("woods", "area").color).toBe(
      featureStyle("tree_line", "line").color,
    );
  });

  it("can drop a single tree", () => {
    expect(shapeFor("tree")).toBe("point");
    expect(featureStyle("tree", "point").width).toBeGreaterThan(0);
  });

  it("styles any kind as any shape, because the kind's shape is a HINT", () => {
    // The draw tool now lets the shape be overridden, so every combination is
    // reachable from the screen and none of them may render nothing.
    for (const kind of SUGGESTED_FEATURE_KINDS) {
      for (const shape of ["point", "line", "area"] as const) {
        const style = featureStyle(kind.kind, shape);
        expect(style.width).toBeGreaterThan(0);
        expect(style.color).toBeTruthy();
      }
    }
  });
});

describe("line thickness", () => {
  it("falls back to the kind's own weight for anything unusable", () => {
    const own = featureStyle("fence", "line").width;
    expect(resolveWidth("fence", "line", null)).toBe(own);
    expect(resolveWidth("fence", "line", undefined)).toBe(own);
    // Out of range, NaN and a string all mean "default" rather than a line a
    // thousand pixels wide covering the parcel it is drawn on.
    expect(resolveWidth("fence", "line", 0)).toBe(own);
    expect(resolveWidth("fence", "line", 99)).toBe(own);
    expect(resolveWidth("fence", "line", Number.NaN)).toBe(own);
    expect(resolveWidth("fence", "line", "3" as unknown as number)).toBe(own);
  });

  it("uses an override that is in range", () => {
    expect(resolveWidth("buried_electric", "line", 1)).toBe(1);
    expect(resolveWidth("lane", "line", 6)).toBe(6);
  });

  it("offers presets that the column would actually accept", () => {
    for (const preset of LINE_WIDTH_PRESETS) {
      expect(isLineWidth(preset.width)).toBe(true);
      expect(preset.width).toBeGreaterThanOrEqual(LINE_WIDTH_MIN);
      expect(preset.width).toBeLessThanOrEqual(LINE_WIDTH_MAX);
    }
  });

  it("agrees with the CHECK on both bounds", () => {
    expect(isLineWidth(LINE_WIDTH_MIN)).toBe(true);
    expect(isLineWidth(LINE_WIDTH_MAX)).toBe(true);
    expect(isLineWidth(LINE_WIDTH_MIN - 0.01)).toBe(false);
    expect(isLineWidth(LINE_WIDTH_MAX + 0.01)).toBe(false);
  });
});

describe("tenant feature kinds", () => {
  it("is total by construction, like every other config reader here", () => {
    expect(featureKindsFrom(null)).toEqual([]);
    expect(featureKindsFrom("nonsense")).toEqual([]);
    expect(featureKindsFrom({ featureKinds: "trough" })).toEqual([]);
    expect(featureKindsFrom({ featureKinds: [1, null, "x"] })).toEqual([]);
  });

  it("is how a farm profile contributes the words this pack refuses to know", () => {
    const config = {
      featureKinds: [
        { kind: "trough", label: "Trough", shape: "point" },
        { kind: "energizer", label: "Energizer", shape: "point" },
      ],
    };
    expect(featureKindsFrom(config)).toEqual([
      { kind: "trough", label: "Trough", shape: "point" },
      { kind: "energizer", label: "Energizer", shape: "point" },
    ]);
    expect(shapeFor("trough", config)).toBe("point");
  });

  it("refuses to let a tenant restyle a pack kind by redefining it", () => {
    const config = { featureKinds: [{ kind: "fence", label: "FENCE!!" }] };
    expect(featureKindsFrom(config)).toEqual([]);
    expect(availableFeatureKinds(config).filter((k) => k.kind === "fence"))
      .toHaveLength(1);
  });

  it("defaults a shapeless entry to a point rather than dropping it", () => {
    const kinds = featureKindsFrom({ featureKinds: [{ kind: "cattle_guard" }] });
    expect(kinds).toEqual([
      { kind: "cattle_guard", label: "Cattle guard", shape: "point" },
    ]);
  });

  it("puts the pack's kinds first, so the common case stays the quick one", () => {
    const kinds = availableFeatureKinds({
      featureKinds: [{ kind: "trough", label: "Trough", shape: "point" }],
    });
    expect(kinds[0].kind).toBe("fence");
    expect(kinds[kinds.length - 1].kind).toBe("trough");
  });
});
