import { describe, expect, it } from "vitest";
import {
  MAX_PADDOCKS,
  subdivide,
  type SubdivideResult,
} from "../src/packs/land/core/subdivide";
import {
  boundaryAreaAcres,
  geometryLengthM,
  haversineM,
  pointInBoundary,
  validateFeatureGeometry,
  type Boundary,
  type FeatureGeometry,
  type Position,
} from "../src/packs/land/core/geo";

/**
 * Cutting paddocks off a lane — the pure half of land slice 2b.2.
 *
 * The tests that matter are the ones where a plausible implementation is
 * quietly WRONG rather than broken:
 *
 *   - splitting in DEGREES rather than metres, which is out by the cosine of
 *     the latitude and yields strips that look equal on screen and are not
 *   - equal WIDTHS instead of equal areas, which is the same thing on a
 *     rectangle and visibly wrong on any real field
 *   - strips that do not tile the ground they came from, losing acres in the
 *     gaps
 *   - a paddock the cows cannot reach, reported as fine
 */

/** A rectangle at the pilot farm's latitude, where cos ≈ 0.761. */
const SOUTH = 40.4;
const NORTH = 40.40361;
const WEST = -82.48;
const EAST = -82.47526;

const rect = (
  west: number,
  south: number,
  east: number,
  north: number,
): Boundary => ({
  type: "Polygon",
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

const FIELD = rect(WEST, SOUTH, EAST, NORTH);

/** A lane up the west edge: cuts across it run east–west, stacking strips. */
const LANE_NS: FeatureGeometry = {
  type: "LineString",
  coordinates: [
    [WEST + 0.0002, SOUTH],
    [WEST + 0.0002, NORTH],
  ],
};

/** A lane along the south edge: cuts run north–south, strips side by side. */
const LANE_EW: FeatureGeometry = {
  type: "LineString",
  coordinates: [
    [WEST, SOUTH + 0.0002],
    [EAST, SOUTH + 0.0002],
  ],
};

function ok(outcome: ReturnType<typeof subdivide>): SubdivideResult {
  if (!outcome.ok) throw new Error(`expected success, got: ${outcome.error}`);
  return outcome.result;
}

describe("equal area", () => {
  it("cuts four paddocks that are equal to within a hundredth of an acre", () => {
    const { paddocks } = ok(subdivide(FIELD, LANE_NS, 4));
    expect(paddocks).toHaveLength(4);
    const areas = paddocks.map((p) => p.areaAcres);
    for (const area of areas) {
      expect(area).toBeCloseTo(areas[0], 2);
    }
  });

  it("gives back exactly the ground it was given", () => {
    // Strips that do not tile the field lose acres in the gaps, which is the
    // failure nobody notices until the per-acre figures stop adding up.
    const { paddocks } = ok(subdivide(FIELD, LANE_NS, 5));
    const total = paddocks.reduce((sum, p) => sum + p.areaAcres, 0);
    expect(total).toBeCloseTo(boundaryAreaAcres(FIELD), 3);
  });

  it("is NOT equal widths, which is the mistake a rectangle would hide", () => {
    // A triangle: equal areas mean visibly unequal widths, so a width-splitting
    // implementation passes every rectangle test and fails this one.
    const triangle: Boundary = {
      type: "Polygon",
      coordinates: [
        [
          [WEST, SOUTH],
          [EAST, SOUTH],
          [WEST, NORTH],
          [WEST, SOUTH],
        ],
      ],
    };
    const { paddocks } = ok(subdivide(triangle, LANE_NS, 3));
    const areas = paddocks.map((p) => p.areaAcres);
    expect(areas[0]).toBeCloseTo(areas[1], 2);
    expect(areas[1]).toBeCloseTo(areas[2], 2);

    // …and the strips really are different sizes across, so the equality above
    // was earned by area rather than by symmetry.
    const spans = paddocks.map((p) => {
      const ring = p.geometry.coordinates[0];
      const lats = ring.map((c) => c[1]);
      return Math.max(...lats) - Math.min(...lats);
    });
    expect(spans[0]).not.toBeCloseTo(spans[2], 5);
  });

  it("works in METRES, not degrees", () => {
    // A field twice as tall as it is wide in DEGREES is not twice as tall on
    // the ground at 40°N. Cutting along the short axis and the long axis must
    // both give equal areas; a degrees-based split gets one of them wrong.
    const tall = rect(WEST, SOUTH, WEST + 0.002, SOUTH + 0.004);
    for (const lane of [LANE_NS, LANE_EW]) {
      const { paddocks } = ok(subdivide(tall, lane, 3));
      const areas = paddocks.map((p) => p.areaAcres);
      expect(areas[0]).toBeCloseTo(areas[1], 3);
      expect(areas[1]).toBeCloseTo(areas[2], 3);
    }
  });
});

describe("the shapes it produces", () => {
  it("produces geometry the save path already accepts", () => {
    const { paddocks, cuts } = ok(subdivide(FIELD, LANE_NS, 4));
    for (const paddock of paddocks) {
      expect(validateFeatureGeometry(paddock.geometry).ok).toBe(true);
    }
    for (const cut of cuts) {
      expect(validateFeatureGeometry(cut).ok).toBe(true);
    }
  });

  it("makes one fewer fence than paddocks", () => {
    // Four paddocks need three dividing fences. A fourth would be the field's
    // own boundary, which is already there and is not this function's to draw.
    expect(ok(subdivide(FIELD, LANE_NS, 4)).cuts).toHaveLength(3);
    expect(ok(subdivide(FIELD, LANE_NS, 2)).cuts).toHaveLength(1);
  });

  it("draws each dividing fence right across the ground", () => {
    const { cuts } = ok(subdivide(FIELD, LANE_NS, 3));
    const width = haversineM([WEST, SOUTH], [EAST, SOUTH]);
    for (const cut of cuts) {
      expect(geometryLengthM(cut)).toBeCloseTo(width, 0);
    }
  });

  it("numbers paddocks in order along the lane", () => {
    const { paddocks } = ok(subdivide(FIELD, LANE_NS, 4));
    expect(paddocks.map((p) => p.index)).toEqual([1, 2, 3, 4]);
    const lats = paddocks.map((p) =>
      Math.min(...p.geometry.coordinates[0].map((c) => c[1])),
    );
    expect([...lats]).toEqual([...lats].sort((a, b) => a - b));
  });
});

describe("gates and reachability", () => {
  it("puts a gate on the lane inside every paddock", () => {
    const { paddocks, warnings } = ok(subdivide(FIELD, LANE_NS, 4));
    expect(warnings).toEqual([]);
    for (const paddock of paddocks) {
      expect(paddock.gate).not.toBeNull();
      expect(pointInBoundary(paddock.gate as Position, paddock.geometry)).toBe(
        true,
      );
    }
  });

  it("WARNS when the cows cannot reach one, rather than refusing", () => {
    // A lane that only runs along the bottom third leaves the far strips with
    // no frontage. The shapes are still real and a drag handle can fix them;
    // silently calling them fine is what must not happen.
    const stub: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [WEST + 0.0002, SOUTH],
        [WEST + 0.0002, SOUTH + 0.0008],
      ],
    };
    const { paddocks, warnings } = ok(subdivide(FIELD, stub, 4));
    expect(paddocks).toHaveLength(4);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/cannot get to it/);
    expect(paddocks.filter((p) => p.gate === null).length).toBeGreaterThan(0);
  });
});

describe("what it refuses, and how it says so", () => {
  it("wants two or more", () => {
    const outcome = subdivide(FIELD, LANE_NS, 1);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/Two or more/);
  });

  it("refuses a silly number rather than trying", () => {
    const outcome = subdivide(FIELD, LANE_NS, MAX_PADDOCKS + 1);
    expect(outcome.ok).toBe(false);
  });

  it("refuses ground that is in two pieces, and says why", () => {
    // Built as literals rather than from `rect`, whose return type is the
    // Polygon-or-MultiPolygon union and so cannot be nested.
    const piece = (w: number, e: number): Position[][] => [
      [
        [w, SOUTH],
        [e, SOUTH],
        [e, NORTH],
        [w, NORTH],
        [w, SOUTH],
      ],
    ];
    const split: Boundary = {
      type: "MultiPolygon",
      coordinates: [piece(WEST, WEST + 0.001), piece(EAST - 0.001, EAST)],
    };
    const outcome = subdivide(split, LANE_NS, 3);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/more than one piece/);
  });

  it("refuses ground with a hole in it", () => {
    const donut: Boundary = {
      type: "Polygon",
      coordinates: [
        // Spelled out rather than taken from FIELD, whose type is the
        // Polygon-or-MultiPolygon union.
        [
          [WEST, SOUTH],
          [EAST, SOUTH],
          [EAST, NORTH],
          [WEST, NORTH],
          [WEST, SOUTH],
        ],
        [
          [-82.4785, 40.4015],
          [-82.4780, 40.4015],
          [-82.4780, 40.4020],
          [-82.4785, 40.4020],
          [-82.4785, 40.4015],
        ],
      ],
    };
    const outcome = subdivide(donut, LANE_NS, 3);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/hole/);
  });

  it("refuses a lane too short to give a direction", () => {
    const dot: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [WEST, SOUTH],
        [WEST + 0.000001, SOUTH],
      ],
    };
    const outcome = subdivide(FIELD, dot, 3);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/too short/);
  });

  it("refuses a lane that is not a line", () => {
    const outcome = subdivide(
      FIELD,
      { type: "Point", coordinates: [WEST, SOUTH] },
      3,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("a bent lane", () => {
  /**
   * The design predicted this as the fiddly case: cuts perpendicular to the
   * lane's LOCAL direction fan out around a dogleg and can cross each other,
   * making a wedge that is not a paddock. Cutting perpendicular to the lane's
   * OVERALL direction dissolves it — parallel lines cannot cross — at the cost
   * of a fence meeting a bent lane at an angle rather than square.
   */
  it("still produces equal, non-crossing paddocks", () => {
    const bent: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [WEST + 0.0002, SOUTH],
        [WEST + 0.0020, SOUTH + 0.0018],
        [WEST + 0.0002, NORTH],
      ],
    };
    const { paddocks } = ok(subdivide(FIELD, bent, 4));
    expect(paddocks).toHaveLength(4);
    const areas = paddocks.map((p) => p.areaAcres);
    for (const area of areas) expect(area).toBeCloseTo(areas[0], 2);

    const total = paddocks.reduce((sum, p) => sum + p.areaAcres, 0);
    expect(total).toBeCloseTo(boundaryAreaAcres(FIELD), 3);
  });
});
