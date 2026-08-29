import { describe, expect, it } from "vitest";
import {
  compareLayouts,
  DEFAULT_LANE_WIDTH_M,
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

/** A lane straight down the middle: ground both sides of it. */
const LANE_MID: FeatureGeometry = {
  type: "LineString",
  coordinates: [
    [(WEST + EAST) / 2, SOUTH],
    [(WEST + EAST) / 2, NORTH],
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

/** Paddocks on one side of the lane only. */
const edge = (
  area: Boundary,
  lane: FeatureGeometry,
  count: number,
): SubdivideResult => ok(subdivide(area, lane, count, { placement: "edge" }));

/** Paddocks both sides. */
const split = (
  area: Boundary,
  lane: FeatureGeometry,
  count: number,
): SubdivideResult => ok(subdivide(area, lane, count, { placement: "split" }));

/** How far apart two positions are in degrees, for crossing checks. */
const spansLon = (line: { coordinates: Position[] }) => {
  const lons = line.coordinates.map((c) => c[0]);
  return [Math.min(...lons), Math.max(...lons)] as const;
};

describe("equal area", () => {
  it("cuts four paddocks that are equal to within a hundredth of an acre", () => {
    const { paddocks } = edge(FIELD, LANE_NS, 4);
    expect(paddocks).toHaveLength(4);
    const areas = paddocks.map((p) => p.areaAcres);
    for (const area of areas) {
      expect(area).toBeCloseTo(areas[0], 2);
    }
  });

  it("gives back the ground MINUS the lane's own corridor", () => {
    // A central lane, so both sides are used and nothing is left out but the
    // corridor itself. Strips that do not tile lose acres in the gaps, which is
    // the failure nobody notices until the per-acre figures stop adding up —
    // and a lane that took no ground would be the bug this replaced.
    const { paddocks } = split(FIELD, LANE_MID, 6);
    const total = paddocks.reduce((sum, p) => sum + p.areaAcres, 0);

    const height = haversineM([WEST, SOUTH], [WEST, NORTH]);
    const corridorAcres = (DEFAULT_LANE_WIDTH_M * height) / 4046.8564224;
    expect(total).toBeCloseTo(boundaryAreaAcres(FIELD) - corridorAcres, 2);
    expect(total).toBeLessThan(boundaryAreaAcres(FIELD));
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
    const { paddocks } = edge(triangle, LANE_NS, 3);
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
      const { paddocks } = edge(tall, lane, 3);
      const areas = paddocks.map((p) => p.areaAcres);
      expect(areas[0]).toBeCloseTo(areas[1], 3);
      expect(areas[1]).toBeCloseTo(areas[2], 3);
    }
  });
});

describe("the shapes it produces", () => {
  it("produces geometry the save path already accepts", () => {
    const { paddocks, cuts } = edge(FIELD, LANE_NS, 4);
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
    expect(edge(FIELD, LANE_NS, 4).cuts).toHaveLength(3);
    expect(edge(FIELD, LANE_NS, 2).cuts).toHaveLength(1);
  });

  it("NEVER draws a divider across the lane", () => {
    // The bug this slice exists to fix: dividers spanning the whole field cut
    // straight through the walkway the cows use to reach water. Every divider
    // must now stop at the corridor.
    const laneLon = LANE_MID.coordinates[0][0];
    const { cuts } = split(FIELD, LANE_MID, 6);
    expect(cuts.length).toBeGreaterThan(0);
    for (const cut of cuts) {
      const [lo, hi] = spansLon(cut);
      const crosses = lo < laneLon && hi > laneLon;
      expect(crosses).toBe(false);
    }
  });

  it("draws each divider from the lane to the far side, and no further", () => {
    const { cuts } = split(FIELD, LANE_MID, 6);
    const halfWidth = haversineM([WEST, SOUTH], [EAST, SOUTH]) / 2;
    for (const cut of cuts) {
      // Half the field, less half the corridor.
      expect(geometryLengthM(cut)).toBeCloseTo(
        halfWidth - DEFAULT_LANE_WIDTH_M / 2,
        0,
      );
    }
  });

  it("numbers paddocks in order along the lane", () => {
    const { paddocks } = edge(FIELD, LANE_NS, 4);
    expect(paddocks.map((p) => p.index)).toEqual([1, 2, 3, 4]);
    const lats = paddocks.map((p) =>
      Math.min(...p.geometry.coordinates[0].map((c) => c[1])),
    );
    expect([...lats]).toEqual([...lats].sort((a, b) => a - b));
  });
});

describe("gates and reachability", () => {
  it("puts every gate ON the lane fence, not in the middle of a paddock", () => {
    // The other half of the bug: a strip that spanned the lane got its gate
    // dropped in its own interior, opening onto nothing.
    const laneLon = LANE_MID.coordinates[0][0];
    const { paddocks } = split(FIELD, LANE_MID, 6);
    for (const paddock of paddocks) {
      expect(paddock.gate).not.toBeNull();
      const gate = paddock.gate as Position;
      const offLane = haversineM([laneLon, gate[1]], gate);
      expect(offLane).toBeCloseTo(DEFAULT_LANE_WIDTH_M / 2, 0);
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
    const { paddocks, warnings } = split(FIELD, stub, 4);
    expect(paddocks.length).toBeGreaterThan(0);
    expect(warnings.some((w) => /cannot get to it/.test(w))).toBe(true);
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
    const { paddocks } = edge(FIELD, bent, 4);
    expect(paddocks).toHaveLength(4);
    const areas = paddocks.map((p) => p.areaAcres);
    for (const area of areas) expect(area).toBeCloseTo(areas[0], 2);
    // Less than the field, because the corridor and the far side are not in it.
    expect(paddocks.reduce((sum, p) => sum + p.areaAcres, 0)).toBeLessThan(
      boundaryAreaAcres(FIELD),
    );
  });
});

describe("edge against split — the choice, with numbers", () => {
  it("gives the count asked for either way, and differs on GROUND", () => {
    const options = compareLayouts(FIELD, LANE_MID, 6);
    expect(options.map((o) => o.placement)).toEqual(["edge", "split"]);
    const [asEdge, asSplit] = options;

    // Both honour the request — that is what makes them comparable.
    expect(asEdge.paddockCount).toBe(6);
    expect(asSplit.paddockCount).toBe(6);

    // Split covers about twice the ground, so each paddock is about twice the
    // size…
    expect(asSplit.acresInPaddocks).toBeGreaterThan(asEdge.acresInPaddocks * 1.8);
    expect(asSplit.acresPerPaddock).toBeGreaterThan(asEdge.acresPerPaddock * 1.8);

    // …for more total fence…
    expect(asSplit.fenceM).toBeGreaterThan(asEdge.fenceM);
    // …and less fence per acre, which is the number that decides it.
    expect(asSplit.fencePerAcreM).toBeLessThan(asEdge.fencePerAcreM);
  });

  it("shows the ground an edge lane leaves out of the rotation", () => {
    const options = compareLayouts(FIELD, LANE_MID, 6);
    const [asEdge, asSplit] = options;
    // Roughly half the field is not in an edge layout off a central lane, and
    // that is the honest cost of the cheaper option.
    expect(asEdge.acresInPaddocks).toBeLessThan(asSplit.acresInPaddocks * 0.6);
    expect(asEdge.warnings.some((w) => /far side of the lane/.test(w))).toBe(
      true,
    );
  });

  it("does not pretend a lane on the boundary has two sides", () => {
    // LANE_NS runs just inside the west edge, so `split` has almost nothing to
    // put on the far side. Both options are still offered; the numbers are what
    // say which is silly.
    const options = compareLayouts(FIELD, LANE_NS, 4);
    expect(options.length).toBeGreaterThan(0);
    const asEdge = options.find((o) => o.placement === "edge");
    expect(asEdge?.paddockCount).toBe(4);
  });

  it("counts the alley's own sides as fence to build", () => {
    // The lane fences are the thing an edge layout buys one of and a split
    // layout two — leaving them out of the total would make the comparison a
    // lie in favour of split.
    const one = split(FIELD, LANE_MID, 6);
    expect(one.laneFences).toHaveLength(2);
    const other = edge(FIELD, LANE_MID, 6);
    expect(other.laneFences).toHaveLength(1);
  });
});
