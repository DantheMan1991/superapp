import { describe, expect, it } from "vitest";
import {
  ACCURACY_FAIR_M,
  ACCURACY_GOOD_M,
  MIN_POINT_SPACING_M,
  accuracyBand,
  canClose,
  hasEnoughPoints,
  pointsNeeded,
  tooCloseToLast,
  walkToGeometry,
  worstAccuracyM,
  type WalkPoint,
} from "../src/packs/land/core/survey";
import {
  asFeatureGeometry,
  geometryLengthM,
  haversineM,
  validateFeatureGeometry,
  type Position,
} from "../src/packs/land/core/geo";
import { formatAccuracy } from "../src/packs/land/core/length";

/**
 * Walking a shape onto the map — the pure half of land slice 2b.1.
 *
 * The tests that matter are the ones where a plausible implementation is
 * quietly WRONG:
 *
 *   - a ring that does not close, which `validateFeatureGeometry` refuses and
 *     which nobody would notice until they tried to save a walked paddock
 *   - a three-corner paddock refused because the code counted the closing
 *     repeat as a corner somebody has to walk to
 *   - an AVERAGED accuracy, which flatters a run whose last corner was taken
 *     under a tree
 *   - a mis-tap guard measured against the nearest point rather than the last
 *     one, which refuses a fence that doglegs back past an earlier corner
 */

const at = (
  lon: number,
  lat: number,
  accuracyM = 3,
): WalkPoint => ({ position: [lon, lat] as Position, accuracyM });

// The pilot farm, where a degree of longitude is about 0.761 of one of latitude.
const CORNERS = [
  at(-82.48, 40.4),
  at(-82.47526, 40.4),
  at(-82.47526, 40.40361),
  at(-82.48, 40.40361),
];

describe("accuracy bands", () => {
  it("reports rather than refuses, at every level", () => {
    expect(accuracyBand(2)).toBe("good");
    expect(accuracyBand(ACCURACY_GOOD_M)).toBe("good");
    expect(accuracyBand(ACCURACY_GOOD_M + 0.1)).toBe("fair");
    expect(accuracyBand(ACCURACY_FAIR_M)).toBe("fair");
    expect(accuracyBand(ACCURACY_FAIR_M + 0.1)).toBe("poor");
  });

  it("treats a missing or nonsense reading as poor, never as good", () => {
    expect(accuracyBand(Number.NaN)).toBe("poor");
    expect(accuracyBand(Number.POSITIVE_INFINITY)).toBe("poor");
  });

  it("takes the WORST corner, because that is what places the shape", () => {
    const points = [at(-82.48, 40.4, 3), at(-82.47, 40.4, 18), at(-82.47, 40.41, 4)];
    // An average would say 8.3 and read as "fair"; the run is only as good as
    // the corner taken under the tree line.
    expect(worstAccuracyM(points)).toBe(18);
    expect(accuracyBand(worstAccuracyM(points)!)).toBe("fair");
  });

  it("is null for a walk with nothing in it, never zero", () => {
    // Zero would render as a perfect fix rather than as no fix at all.
    expect(worstAccuracyM([])).toBeNull();
  });

  it("rounds UP, because claiming better than the instrument gave is the wrong way to be wrong", () => {
    expect(formatAccuracy(3.4, "metre")).toBe("±4 m");
    expect(formatAccuracy(3, "metre")).toBe("±3 m");
    expect(formatAccuracy(null)).toBe("±?");
    expect(formatAccuracy(Number.NaN)).toBe("±?");
    // 3 m is 9.84 ft, which must not read as 9.
    expect(formatAccuracy(3, "foot")).toBe("±10 ft");
  });
});

describe("how many corners a shape needs", () => {
  it("wants one for a point, two for a line, three for a ring", () => {
    expect(hasEnoughPoints([CORNERS[0]], "point")).toBe(true);
    expect(hasEnoughPoints([], "point")).toBe(false);

    expect(hasEnoughPoints(CORNERS.slice(0, 2), "line")).toBe(true);
    expect(hasEnoughPoints(CORNERS.slice(0, 1), "line")).toBe(false);

    // THREE, not four. The fourth position in the stored ring is the closing
    // repeat, and asking somebody to walk back to their first corner and tap
    // it again is asking them not to bother.
    expect(hasEnoughPoints(CORNERS.slice(0, 3), "area")).toBe(true);
    expect(hasEnoughPoints(CORNERS.slice(0, 2), "area")).toBe(false);
  });

  it("says how many more, so the screen can be specific", () => {
    expect(pointsNeeded([], "area")).toBe(3);
    expect(pointsNeeded(CORNERS.slice(0, 2), "area")).toBe(1);
    expect(pointsNeeded(CORNERS, "area")).toBe(0);
  });
});

describe("walkToGeometry", () => {
  it("makes a point from one corner", () => {
    expect(walkToGeometry([CORNERS[0]], "point")).toEqual({
      type: "Point",
      coordinates: [-82.48, 40.4],
    });
  });

  it("makes a line that measures what was walked", () => {
    const geometry = walkToGeometry(CORNERS.slice(0, 2), "line");
    expect(geometry).not.toBeNull();
    expect(geometryLengthM(geometry!)).toBeCloseTo(
      haversineM(CORNERS[0].position, CORNERS[1].position),
      6,
    );
  });

  it("CLOSES the ring, which nobody walks back to do", () => {
    const geometry = walkToGeometry(CORNERS, "area");
    expect(geometry?.type).toBe("Polygon");
    const ring = (geometry as { coordinates: Position[][] }).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it("does not close a ring twice when the walk already returned to the start", () => {
    const geometry = walkToGeometry([...CORNERS, CORNERS[0]], "area");
    const ring = (geometry as { coordinates: Position[][] }).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("returns null rather than a half-built shape", () => {
    // A one-point "line" is exactly what validateFeatureGeometry refuses, and
    // building it here would put the refusal a long way from the person.
    expect(walkToGeometry([], "point")).toBeNull();
    expect(walkToGeometry(CORNERS.slice(0, 1), "line")).toBeNull();
    expect(walkToGeometry(CORNERS.slice(0, 2), "area")).toBeNull();
  });

  it("produces geometry the SAVE PATH already accepts, for every shape", () => {
    // The whole claim of the slice: walking is an input mode, not a second kind
    // of feature. If any of these needed a different validator, it would not be.
    for (const [shape, points] of [
      ["point", CORNERS.slice(0, 1)],
      ["line", CORNERS.slice(0, 2)],
      ["area", CORNERS.slice(0, 3)],
    ] as const) {
      const geometry = walkToGeometry(points, shape);
      expect(validateFeatureGeometry(geometry).ok).toBe(true);
      expect(asFeatureGeometry(geometry)).not.toBeNull();
    }
  });

  it("drops the accuracy, because the geometry column has nowhere to put it", () => {
    const geometry = walkToGeometry([at(-82.48, 40.4, 17)], "point");
    expect(geometry).toEqual({ type: "Point", coordinates: [-82.48, 40.4] });
  });
});

describe("the mis-tap guard", () => {
  it("catches a double tap on the corner just placed", () => {
    const points = [at(-82.48, 40.4)];
    // Half a metre north: a shift of weight, not a corner.
    expect(tooCloseToLast(points, [-82.48, 40.400_0045])).toBe(true);
  });

  it("lets a real corner through", () => {
    const points = [at(-82.48, 40.4)];
    expect(tooCloseToLast(points, CORNERS[1].position)).toBe(false);
  });

  it("allows the FIRST point, which has nothing to be close to", () => {
    expect(tooCloseToLast([], [-82.48, 40.4])).toBe(false);
  });

  it("measures against the LAST corner, not the nearest one", () => {
    // A fence that doglegs back past where it started is a real fence. Checking
    // the nearest of all points would refuse the corner that comes back round.
    const walked = [
      at(-82.48, 40.4),
      at(-82.47, 40.4),
      at(-82.47, 40.401),
    ];
    expect(tooCloseToLast(walked, [-82.48, 40.400_0045])).toBe(false);
  });

  it("uses a guard smaller than the instrument's own error, on purpose", () => {
    // A larger one would start refusing real corners on a tight jog around a
    // gatepost. This only catches the tap that was never meant.
    expect(MIN_POINT_SPACING_M).toBeLessThan(ACCURACY_GOOD_M);
  });
});

describe("closing a walked fence into a loop", () => {
  /**
   * Found in a field: four corners walked round a paddock came out as THREE
   * sides. That is correct for a fence that stops, and wrong for one that goes
   * all the way round, so it is a choice rather than a default.
   */
  it("leaves an open run open, which is still the common case", () => {
    const open = walkToGeometry(CORNERS, "line");
    expect(open).not.toBeNull();
    const coords = (open as { coordinates: Position[] }).coordinates;
    expect(coords).toHaveLength(4);
    expect(coords[0]).not.toEqual(coords[3]);
  });

  it("adds the side you cannot walk", () => {
    const closed = walkToGeometry(CORNERS, "line", true);
    const coords = (closed as { coordinates: Position[] }).coordinates;
    // Four corners, five positions: the last is the first again.
    expect(coords).toHaveLength(5);
    expect(coords[4]).toEqual(coords[0]);
  });

  it("is still a LineString, because a ring of fence is a line", () => {
    // A Polygon would give it an area nobody asked for, and `geometryLengthM`
    // would report its PERIMETER rather than its run — the same number here by
    // luck, and not the same thing.
    const closed = walkToGeometry(CORNERS, "line", true);
    expect(closed?.type).toBe("LineString");
    expect(validateFeatureGeometry(closed).ok).toBe(true);
  });

  it("counts the closing side in the length", () => {
    const open = walkToGeometry(CORNERS, "line")!;
    const closed = walkToGeometry(CORNERS, "line", true)!;
    const backToStart = haversineM(
      CORNERS[3].position,
      CORNERS[0].position,
    );
    expect(geometryLengthM(closed)).toBeCloseTo(
      geometryLengthM(open) + backToStart,
      6,
    );
  });

  it("takes the closing side from the FIRST corner, not a second reading of it", () => {
    // You cannot walk back to a corner you have already left — no two GPS
    // readings of the same spot agree, and a metre-wide gap in a fence is a
    // metre of wire nobody buys.
    const closed = walkToGeometry(CORNERS, "line", true);
    const coords = (closed as { coordinates: Position[] }).coordinates;
    expect(coords[4]).toEqual(CORNERS[0].position);
  });

  it("refuses to close a two-corner line, which would be a fence walked back along itself", () => {
    expect(canClose(CORNERS.slice(0, 2), "line")).toBe(false);
    const closed = walkToGeometry(CORNERS.slice(0, 2), "line", true);
    expect((closed as { coordinates: Position[] }).coordinates).toHaveLength(2);
  });

  it("does not offer it for a point or an area", () => {
    expect(canClose(CORNERS, "point")).toBe(false);
    // An area closes itself; asking again would be a second closing repeat.
    expect(canClose(CORNERS, "area")).toBe(false);
    const ring = walkToGeometry(CORNERS, "area", true);
    const coords = (ring as { coordinates: Position[][] }).coordinates[0];
    expect(coords).toHaveLength(5);
  });

  it("offers it as soon as there are three corners", () => {
    expect(canClose(CORNERS.slice(0, 3), "line")).toBe(true);
  });
});
