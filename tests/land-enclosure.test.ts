import { describe, expect, it } from "vitest";
import {
  enclosuresFrom,
  MAX_ENCLOSURES,
  MIN_ENCLOSURE_ACRES,
  type FenceRun,
} from "../src/packs/land/core/enclosure";
import { subdivide } from "../src/packs/land/core/subdivide";
import {
  boundaryAreaAcres,
  pointInBoundary,
  validateBoundary,
  type FeatureGeometry,
  type Position,
} from "../src/packs/land/core/geo";

/**
 * The ground inside a set of fences — the half of land slice 2b.5 that stops
 * paddocks running out past the fence.
 *
 * What has to be true, in order of how badly it bites:
 *
 *   1. Four fence runs round a field make ONE field, whichever direction each
 *      was drawn in. A chain that does not reverse the runs it needs to encloses
 *      nothing and quietly returns a sliver.
 *   2. Fences that stop short of each other still join, within about a GPS fix
 *      — otherwise nothing already on the map ever forms a loop.
 *   3. A fence that does NOT close encloses nothing, and says so by returning
 *      nothing rather than by guessing a closing side.
 *   4. Paddocks cut from an enclosure stay inside the FENCE, which is the whole
 *      point and is asserted against the fence ring, not against the parcel.
 */

const LAT = 40.4;
const LON = -82.48;

/**
 * The SAME sphere `geo.ts` measures on. Rounder constants (111_320 / 110_540)
 * put a "200 m" side out by most of a metre, which is 0.7% on the acreage and
 * enough to make an assertion argue with a correct implementation.
 */
const M_PER_DEGREE = (Math.PI / 180) * 6_378_137;
const M_PER_DEGREE_LON = M_PER_DEGREE * Math.cos((LAT * Math.PI) / 180);

const east = (metres: number): number => LON + metres / M_PER_DEGREE_LON;
const north = (metres: number): number => LAT + metres / M_PER_DEGREE;

/** A 200 m x 200 m field, 40,000 m2, which is 9.884 acres. */
const SW: Position = [LON, LAT];
const SE: Position = [east(200), LAT];
const NE: Position = [east(200), north(200)];
const NW: Position = [LON, north(200)];

const run = (id: string, name: string, coordinates: Position[]): FenceRun => ({
  id,
  name,
  geometry: { type: "LineString", coordinates } as FeatureGeometry,
});

/** The four sides, each drawn as its own run, all going anticlockwise. */
const FOUR_SIDES: FenceRun[] = [
  run("s", "South Fence", [SW, SE]),
  run("e", "East Fence", [SE, NE]),
  run("n", "North Fence", [NE, NW]),
  run("w", "West Fence", [NW, SW]),
];

describe("enclosuresFrom", () => {
  it("finds nothing in an empty plan", () => {
    expect(enclosuresFrom([])).toEqual([]);
  });

  it("finds nothing in a single fence that goes nowhere near itself", () => {
    expect(enclosuresFrom([run("a", "Road Fence", [SW, SE])])).toEqual([]);
  });

  it("finds nothing in three sides of a square", () => {
    const open = FOUR_SIDES.slice(0, 3);
    expect(enclosuresFrom(open)).toEqual([]);
  });

  it("makes one field out of four fence runs", () => {
    const found = enclosuresFrom(FOUR_SIDES);
    expect(found).toHaveLength(1);
    expect(found[0].areaAcres).toBeCloseTo(9.884, 2);
    expect(found[0].names.sort()).toEqual([
      "East Fence",
      "North Fence",
      "South Fence",
      "West Fence",
    ]);
  });

  /**
   * Nobody draws four fences all the same way round. Reversing two of them
   * must not change the field they enclose — and an implementation that
   * chains coordinates without orienting them produces a bow tie whose area
   * is near zero, so this fails loudly rather than subtly.
   */
  it("does not care which direction each run was drawn in", () => {
    const mixed: FenceRun[] = [
      run("s", "South Fence", [SE, SW]),
      run("e", "East Fence", [SE, NE]),
      run("n", "North Fence", [NW, NE]),
      run("w", "West Fence", [NW, SW]),
    ];
    const found = enclosuresFrom(mixed);
    expect(found).toHaveLength(1);
    expect(found[0].areaAcres).toBeCloseTo(9.884, 2);
  });

  it("closes a corner where the runs stop a metre short of each other", () => {
    const sloppy: FenceRun[] = [
      run("s", "South Fence", [SW, [east(199), LAT]]),
      run("e", "East Fence", [[east(200), north(1)], NE]),
      run("n", "North Fence", [NE, NW]),
      run("w", "West Fence", [NW, SW]),
    ];
    const found = enclosuresFrom(sloppy);
    expect(found).toHaveLength(1);
    // A shade under the tidy square: the sloppy corner really does cut a
    // metre off it, and reporting the acreage of the fence as DRAWN rather
    // than of the square it was meant to be is the honest answer.
    expect(found[0].areaAcres).toBeCloseTo(9.86, 1);
  });

  it("does not close a corner the fences are nowhere near", () => {
    const gapped: FenceRun[] = [
      run("s", "South Fence", [SW, [east(160), LAT]]),
      run("e", "East Fence", [SE, NE]),
      run("n", "North Fence", [NE, NW]),
      run("w", "West Fence", [NW, SW]),
    ];
    expect(enclosuresFrom(gapped)).toEqual([]);
  });

  /**
   * The founder's own workflow, 2026-08-28: walk the four corners, tick "close
   * it", and the fence comes back as a LineString whose last position repeats
   * its first. That is a field on its own and must not need a graph at all.
   */
  it("treats a fence that closes on itself as a field", () => {
    const walked = run("a", "Home Fence", [SW, SE, NE, NW, SW]);
    const found = enclosuresFrom([walked]);
    expect(found).toHaveLength(1);
    expect(found[0].runIds).toEqual(["a"]);
    expect(found[0].areaAcres).toBeCloseTo(9.884, 2);
  });

  it("finds both fields when a cross fence splits one", () => {
    const cross: FenceRun[] = [
      ...FOUR_SIDES,
      run("x", "Cross Fence", [[LON, north(100)], [east(200), north(100)]]),
    ];
    const found = enclosuresFrom(cross);
    expect(found.length).toBeGreaterThanOrEqual(2);
    // The two halves, each about half the whole.
    expect(found[0].areaAcres).toBeCloseTo(4.94, 1);
    expect(found[1].areaAcres).toBeCloseTo(4.94, 1);
  });

  it("ignores a loop too small to be a field", () => {
    const tiny = 5;
    const scrap: FenceRun[] = [
      run("a", "A", [SW, [east(tiny), LAT]]),
      run("b", "B", [[east(tiny), LAT], [east(tiny), north(tiny)]]),
      run("c", "C", [[east(tiny), north(tiny)], SW]),
    ];
    const found = enclosuresFrom(scrap);
    expect(found).toEqual([]);
    // ...and it really was below the floor rather than simply not found.
    expect(((tiny * tiny) / 2) / 4046.86).toBeLessThan(MIN_ENCLOSURE_ACRES);
  });

  it("returns valid boundary geometry", () => {
    const found = enclosuresFrom(FOUR_SIDES);
    const parsed = validateBoundary(found[0].ring);
    expect(parsed.ok).toBe(true);
  });

  it("returns the biggest first and never more than the cap", () => {
    const found = enclosuresFrom(FOUR_SIDES);
    expect(found.length).toBeLessThanOrEqual(MAX_ENCLOSURES);
    for (let i = 1; i < found.length; i += 1) {
      expect(found[i - 1].areaAcres).toBeGreaterThanOrEqual(found[i].areaAcres);
    }
  });

  it("ignores features that are not lines", () => {
    const gate: FenceRun = {
      id: "g",
      name: "Gate",
      geometry: { type: "Point", coordinates: SW },
    };
    expect(enclosuresFrom([...FOUR_SIDES, gate])).toHaveLength(1);
  });
});

/**
 * The end of the complaint: "I want to make sure when we auto generate padocks
 * it stays withing the border of the fence. It cant leack out."
 *
 * The fence here sits 20 m inside a deed line. Dividing the DEED puts paddocks
 * outside the fence; dividing the ENCLOSURE does not. Both halves are asserted,
 * because the second one only means anything if the first one is the bug.
 */
describe("paddocks cut from an enclosure stay inside the fence", () => {
  const INSET = 20;
  const fenced: FenceRun[] = [
    run("s", "South Fence", [
      [east(INSET), north(INSET)],
      [east(200 - INSET), north(INSET)],
    ]),
    run("e", "East Fence", [
      [east(200 - INSET), north(INSET)],
      [east(200 - INSET), north(200 - INSET)],
    ]),
    run("n", "North Fence", [
      [east(200 - INSET), north(200 - INSET)],
      [east(INSET), north(200 - INSET)],
    ]),
    run("w", "West Fence", [
      [east(INSET), north(200 - INSET)],
      [east(INSET), north(INSET)],
    ]),
  ];

  /** A lane up the middle, from one fence to the other. */
  const lane: FeatureGeometry = {
    type: "LineString",
    coordinates: [
      [east(100), north(INSET)],
      [east(100), north(200 - INSET)],
    ],
  };

  const deed = {
    type: "Polygon" as const,
    coordinates: [[SW, SE, NE, NW, SW]],
  };

  it("the deed line is the leak: paddocks cut from it fall outside the fence", () => {
    const result = subdivide(deed, lane, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ring = enclosuresFrom(fenced)[0].ring;
    const outside = result.result.paddocks.filter((paddock) =>
      paddock.geometry.coordinates[0].some(
        (position) => !pointInBoundary(position, ring),
      ),
    );
    expect(outside.length).toBeGreaterThan(0);
  });

  it("the enclosure is the fix: every corner lands inside the fence", () => {
    const ring = enclosuresFrom(fenced)[0].ring;
    const result = subdivide(ring, lane, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const paddock of result.result.paddocks) {
      for (const position of paddock.geometry.coordinates[0]) {
        // On the fence counts as inside; a corner exactly on the ring is what
        // the clipper produces, and `pointInBoundary` is not asked to decide.
        const onOrIn =
          pointInBoundary(position, ring) ||
          distanceToRing(position, ring.coordinates[0]) < 0.01;
        expect(onOrIn).toBe(true);
      }
    }
  });

  it("the paddocks still add up to the fenced acreage, not the deed's", () => {
    const enclosure = enclosuresFrom(fenced)[0];
    const result = subdivide(enclosure.ring, lane, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = result.result.paddocks.reduce((t, p) => t + p.areaAcres, 0);
    // Less than the enclosure by the lane, and a long way under the deed.
    expect(total).toBeLessThan(enclosure.areaAcres);
    expect(total).toBeGreaterThan(enclosure.areaAcres * 0.9);
    expect(boundaryAreaAcres(deed)).toBeGreaterThan(enclosure.areaAcres * 1.4);
  });
});

/** Metres from a position to the nearest point on a ring, roughly. */
function distanceToRing(position: Position, ring: Position[]): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i += 1) {
    const [ax, ay] = ring[i - 1];
    const [bx, by] = ring[i];
    const mx = M_PER_DEGREE_LON;
    const my = M_PER_DEGREE;
    const px = (position[0] - ax) * mx;
    const py = (position[1] - ay) * my;
    const dx = (bx - ax) * mx;
    const dy = (by - ay) * my;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
  }
  return best;
}
