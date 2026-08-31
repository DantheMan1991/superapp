import { describe, expect, it } from "vitest";
import {
  enclosuresFrom,
  type FenceRun,
} from "../src/packs/land/core/enclosure";
import {
  compareLayouts,
  DEFAULT_LANE_WIDTH_M,
  EQUAL_ENOUGH,
  subdivide,
} from "../src/packs/land/core/subdivide";
import {
  pointInBoundary,
  validateBoundary,
  type Boundary,
  type FeatureGeometry,
  type Position,
} from "../src/packs/land/core/geo";

/**
 * **FIELDS ARE NOT RECTANGLES, AND EVERYTHING IN THIS PACK HAS ONLY EVER SEEN
 * RECTANGLES.**
 *
 * Every case in `land-enclosure.test.ts` and `land-subdivide.test.ts` is a
 * rectangle or a rectangle with a cross fence, and so was every shape driven in
 * a browser. That is the open item this file exists to close: a real field has a
 * bend in it, a corner where two fences overshoot each other, a creek taking a
 * bite out of one side, and a neighbour's line that is not parallel to anything.
 *
 * The failure mode being hunted is not a crash. It is **a plausible wrong
 * answer** — a ring that doubles back on itself, paddocks that overlap, or an
 * "equal" division that is not equal — because those get built before anybody
 * notices.
 */

const LAT = 40.4;
const LON = -82.48;

const M_PER_DEGREE = (Math.PI / 180) * 6_378_137;
const M_PER_DEGREE_LON = M_PER_DEGREE * Math.cos((LAT * Math.PI) / 180);
const east = (metres: number): number => LON + metres / M_PER_DEGREE_LON;
const north = (metres: number): number => LAT + metres / M_PER_DEGREE;
const at = (e: number, n: number): Position => [east(e), north(n)];

const run = (id: string, name: string, coordinates: Position[]): FenceRun => ({
  id,
  name,
  geometry: { type: "LineString", coordinates } as FeatureGeometry,
});

/** Metres from a position to the nearest point on a ring. */
function distanceToRing(position: Position, ring: Position[]): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i += 1) {
    const ax = (ring[i - 1][0] - position[0]) * M_PER_DEGREE_LON;
    const ay = (ring[i - 1][1] - position[1]) * M_PER_DEGREE;
    const bx = (ring[i][0] - position[0]) * M_PER_DEGREE_LON;
    const by = (ring[i][1] - position[1]) * M_PER_DEGREE;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lengthSq));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Every corner is inside the ring, or exactly on it. */
function containedBy(ring: Boundary, polygon: Boundary): boolean {
  const outer = (polygon as { coordinates: Position[][] }).coordinates[0];
  const edge = (ring as { coordinates: Position[][] }).coordinates[0];
  return outer.every(
    (position) =>
      pointInBoundary(position, ring) || distanceToRing(position, edge) < 0.05,
  );
}

/** Do two rings overlap by more than a hair? Sampled, which is enough here. */
function overlaps(a: Boundary, b: Boundary): number {
  const outer = (a as { coordinates: Position[][] }).coordinates[0];
  let inside = 0;
  let total = 0;
  // Sample the interior of `a` on a coarse grid and ask how much falls in `b`.
  const lons = outer.map((p) => p[0]);
  const lats = outer.map((p) => p[1]);
  const [w, e] = [Math.min(...lons), Math.max(...lons)];
  const [s, n] = [Math.min(...lats), Math.max(...lats)];
  for (let i = 1; i < 30; i += 1) {
    for (let j = 1; j < 30; j += 1) {
      const p: Position = [w + ((e - w) * i) / 30, s + ((n - s) * j) / 30];
      if (!pointInBoundary(p, a)) continue;
      total += 1;
      if (pointInBoundary(p, b)) inside += 1;
    }
  }
  return total === 0 ? 0 : inside / total;
}

/**
 * **AN L-SHAPED FIELD**, which is the commonest non-rectangle there is: a
 * square with a corner taken out of it by a wood, a pond or somebody else's
 * ground. Six fences, one reflex corner.
 */
const L_FIELD: FenceRun[] = [
  run("s", "South", [at(0, 0), at(300, 0)]),
  run("e", "East", [at(300, 0), at(300, 120)]),
  run("m", "Middle", [at(300, 120), at(140, 120)]),
  run("n", "Notch", [at(140, 120), at(140, 300)]),
  run("w2", "North", [at(140, 300), at(0, 300)]),
  run("w", "West", [at(0, 300), at(0, 0)]),
];

describe("an L-shaped field", () => {
  it("is found as one enclosure with the right acreage", () => {
    const found = enclosuresFrom(L_FIELD);
    expect(found.length).toBeGreaterThanOrEqual(1);
    // 300x120 plus 140x180 = 36,000 + 25,200 = 61,200 m2 = 15.123 acres.
    expect(found[0].areaAcres).toBeCloseTo(15.12, 1);
  });

  it("produces geometry the rest of the pack will accept", () => {
    const found = enclosuresFrom(L_FIELD);
    expect(validateBoundary(found[0].ring).ok).toBe(true);
  });

  /**
   * **THE REFLEX CORNER IS THE POINT.** A ring that walked the fences in the
   * wrong order, or dropped the notch, would still be a valid polygon with a
   * plausible acreage — it would just be the WRONG field. So this asks whether
   * the bite really is missing: a point in the notch must be OUTSIDE.
   */
  it("leaves the notch out", () => {
    const ring = enclosuresFrom(L_FIELD)[0].ring;
    expect(pointInBoundary(at(200, 200), ring)).toBe(false);
    expect(pointInBoundary(at(60, 200), ring)).toBe(true);
    expect(pointInBoundary(at(200, 60), ring)).toBe(true);
  });
});

/**
 * **DIVIDING A CONCAVE FIELD.** This is where a strip-cutter can be plausibly
 * wrong rather than broken: cutting an L across the short way gives strips that
 * are fine, and cutting it the other way gives strips that are in TWO PIECES —
 * a paddock whose halves are a hundred metres apart, which is not a paddock.
 */
describe("dividing an L-shaped field", () => {
  const ring = enclosuresFrom(L_FIELD)[0].ring;

  /** Up the leg of the L, so the cuts run across the narrow part. */
  const laneUpTheLeg: FeatureGeometry = {
    type: "LineString",
    coordinates: [at(70, 10), at(70, 290)],
  };

  it("divides into the number asked for", () => {
    const result = subdivide(ring, laneUpTheLeg, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.paddocks).toHaveLength(4);
  });

  it("keeps every paddock inside the fence", () => {
    const result = subdivide(ring, laneUpTheLeg, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const paddock of result.result.paddocks) {
      expect(containedBy(ring, paddock.geometry)).toBe(true);
    }
  });

  it("does not overlap the paddocks with each other", () => {
    const result = subdivide(ring, laneUpTheLeg, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paddocks = result.result.paddocks;
    for (let i = 0; i < paddocks.length; i += 1) {
      for (let j = i + 1; j < paddocks.length; j += 1) {
        expect(
          overlaps(paddocks[i].geometry, paddocks[j].geometry),
        ).toBeLessThan(0.02);
      }
    }
  });

  /**
   * **"EQUAL AREAS" HAS TO SURVIVE A CONCAVE SHAPE, OR ADMIT THAT IT CANNOT.**
   *
   * The lane cannot be central on an L, so the two sides come out about 1.95 to
   * one. Four whole paddocks cannot express that: whatever split you choose,
   * some paddocks differ. What the code owes is the BEST available split and an
   * honest word about the rest — so that is what is asserted, by working out
   * every split there is and checking the chosen one wins.
   *
   * **THE MEASURE IS LARGEST-OVER-SMALLEST, NOT SPREAD ABOUT THE MEAN**, and
   * getting that wrong sent me the wrong way once already. Two and two here is
   * 1.95:1 with every paddock 32% off the mean; three and one is 1.54:1 with
   * three paddocks identical and one odd. The second is plainly better on a
   * farm and worse by mean-deviation, which is how a sensible-looking metric
   * argues for the worse layout.
   */
  it("picks the split that makes them as equal as they can be", () => {
    const result = subdivide(ring, laneUpTheLeg, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ratioOf(result.result.paddocks.map((p) => p.areaAcres))).toBeCloseTo(
      bestPossibleRatio(ring, laneUpTheLeg, 4),
      2,
    );
  });

  it("says out loud that they are not equal", () => {
    const result = subdivide(ring, laneUpTheLeg, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.warnings.join(" ")).toMatch(/cannot come out equal/i);
  });

  it("does not cry wolf when they ARE equal", () => {
    const square: Boundary = {
      type: "Polygon",
      coordinates: [[at(0, 0), at(400, 0), at(400, 200), at(0, 200), at(0, 0)]],
    };
    const centred: FeatureGeometry = {
      type: "LineString",
      coordinates: [at(200, 5), at(200, 195)],
    };
    const result = subdivide(square, centred, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ratioOf(result.result.paddocks.map((p) => p.areaAcres))).toBeLessThan(
      1 + EQUAL_ENOUGH,
    );
    expect(result.result.warnings.join(" ")).not.toMatch(/cannot come out equal/i);
  });
});

/**
 * **THE BUG THE L-SHAPED FIELD EXPOSED IS NOT ABOUT L-SHAPED FIELDS.**
 *
 * The count used to be split `round(count / sides)` — two and two, whatever the
 * two sides weighed. On a rectangle with the lane down the middle that is
 * right, and a rectangle with the lane down the middle was the only thing this
 * had ever been run on, in every test and every drive. Move the lane a quarter
 * of the way across and the sides are 1:3, so four paddocks came out as two
 * small and two large under a dialog that says "Equal areas".
 *
 * This is the case that would have bitten first on a real farm, because a lane
 * goes where the gate and the water are, not down the middle.
 */
describe("a lane that is not down the middle", () => {
  const FIELD: Boundary = {
    type: "Polygon",
    coordinates: [[at(0, 0), at(400, 0), at(400, 200), at(0, 200), at(0, 0)]],
  };
  const laneAt = (offset: number): FeatureGeometry => ({
    type: "LineString",
    coordinates: [at(offset, 5), at(offset, 195)],
  });

  for (const [where, offset, count] of [
    ["a quarter across, into 8", 100, 8],
    ["an eighth across, into 8", 50, 8],
    ["two thirds across, into 8", 267, 8],
    ["a quarter across, into 4", 100, 4],
  ] as const) {
    it(`is as equal as it can be with the lane ${where}`, () => {
      const result = subdivide(FIELD, laneAt(offset), count);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ratio = ratioOf(result.result.paddocks.map((p) => p.areaAcres));
      expect(ratio).toBeCloseTo(bestPossibleRatio(FIELD, laneAt(offset), count), 2);
      // ...and the warning agrees with the arithmetic, either way round.
      const cried = /cannot come out equal/i.test(result.result.warnings.join(" "));
      expect(cried).toBe(ratio > 1 + EQUAL_ENOUGH);
    });
  }

  /**
   * A quarter across into four is the case the old code got plainly wrong: the
   * sides are 1:3, so one and three is exact and two and two is not.
   */
  it("cuts a 1:3 lane into four genuinely equal paddocks", () => {
    const result = subdivide(FIELD, laneAt(100), 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ratioOf(result.result.paddocks.map((p) => p.areaAcres))).toBeLessThan(
      1 + EQUAL_ENOUGH,
    );
  });
});

/**
 * The dialog does not call `subdivide` — it calls `compareLayouts`, and costs
 * the two placements side by side before anybody presses anything. A warning
 * that exists in the outcome and not in the option is a warning nobody sees
 * until after they have built it.
 */
describe("the warning reaches the screen that decides", () => {
  const FIELD: Boundary = {
    type: "Polygon",
    coordinates: [[at(0, 0), at(400, 0), at(400, 200), at(0, 200), at(0, 0)]],
  };

  it("carries it into the costed option", () => {
    const lopsided: FeatureGeometry = {
      type: "LineString",
      coordinates: [at(40, 5), at(40, 195)],
    };
    const options = compareLayouts(FIELD, lopsided, 3, DEFAULT_LANE_WIDTH_M);
    const split = options.find((o) => o.placement === "split");
    expect(split).toBeDefined();
    expect(split!.warnings.join(" ")).toMatch(/cannot come out equal/i);
  });

  it("and stays quiet on ground that divides evenly", () => {
    const centred: FeatureGeometry = {
      type: "LineString",
      coordinates: [at(200, 5), at(200, 195)],
    };
    const options = compareLayouts(FIELD, centred, 4, DEFAULT_LANE_WIDTH_M);
    for (const option of options) {
      expect(option.warnings.join(" ")).not.toMatch(/cannot come out equal/i);
    }
  });
});

/** How unequal a set of paddocks is: biggest over smallest. */
function ratioOf(areas: readonly number[]): number {
  const smallest = Math.min(...areas);
  return smallest > 0 ? Math.max(...areas) / smallest : Infinity;
}

/**
 * The best ratio ANY split of the count between the two sides could achieve.
 *
 * Worked out from the ground each side actually has — measured by asking
 * `subdivide` for a one-per-side layout and reading the two areas back, so the
 * test does no geometry of its own and cannot disagree with the thing it is
 * checking about where the corridor fell.
 */
function bestPossibleRatio(
  area: Boundary,
  lane: FeatureGeometry,
  count: number,
): number {
  const probe = subdivide(area, lane, 2);
  if (!probe.ok) return Infinity;
  const sides = probe.result.paddocks.map((p) => p.areaAcres);
  if (sides.length < 2) return 1;
  let best = Infinity;
  for (let first = 1; first <= count - 1; first += 1) {
    const one = sides[0] / first;
    const two = sides[1] / (count - first);
    best = Math.min(best, Math.max(one, two) / Math.min(one, two));
  }
  return best;
}
