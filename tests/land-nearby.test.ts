import { describe, expect, it } from "vitest";
import {
  NEARBY_RADIUS_M,
  boxReaches,
  distanceToGeometryM,
  nearbyFeatures,
} from "@/packs/land/core/nearby";
import {
  frameAt,
  haversineM,
  type FeatureGeometry,
  type Position,
} from "@/packs/land/core/geo";

/** A spot on the pilot farm, so the latitude scaling is a real one. */
const HERE: Position = [-82.4, 40.4];

/**
 * `metres` east of HERE, at the same latitude.
 *
 * Built from the pack's OWN frame rather than a radius typed in here — a test
 * helper with its own earth model disagrees with the code by a few centimetres,
 * which is exactly enough to put a point meant to be inside the radius outside
 * it.
 */
const FRAME = frameAt(HERE);
function east(metres: number): Position {
  return [HERE[0] + metres / FRAME.mPerLon, HERE[1]];
}

/** `metres` north of HERE. */
function north(metres: number): Position {
  return [HERE[0], HERE[1] + metres / FRAME.mPerLat];
}

describe("distanceToGeometryM", () => {
  it("measures a point the way haversine does", () => {
    const target = east(50);
    const geometry: FeatureGeometry = { type: "Point", coordinates: target };
    expect(distanceToGeometryM(HERE, geometry)).toBeCloseTo(
      haversineM(HERE, target),
      6,
    );
  });

  it("measures to the nearest part of a fence, not to a corner", () => {
    // A fence running north–south, 20 m east of us, starting well south and
    // ending well north — so the nearest point is beside us, not an end.
    const fence: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [east(20)[0], north(-100)[1]],
        [east(20)[0], north(100)[1]],
      ],
    };
    expect(distanceToGeometryM(HERE, fence)).toBeCloseTo(20, 0);
  });

  it("clamps past the end of a run, so a far corner is the answer", () => {
    // The same fence, but it stops 40 m south of us. The nearest point is its
    // end, 40 m away — not the imaginary continuation beside us.
    const stub: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [HERE[0], north(-140)[1]],
        [HERE[0], north(-40)[1]],
      ],
    };
    expect(distanceToGeometryM(HERE, stub)).toBeCloseTo(40, 0);
  });

  it("is ZERO inside an area, not the distance to its nearest wall", () => {
    const barn: FeatureGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [east(-10)[0], north(-10)[1]],
          [east(10)[0], north(-10)[1]],
          [east(10)[0], north(10)[1]],
          [east(-10)[0], north(10)[1]],
          [east(-10)[0], north(-10)[1]],
        ],
      ],
    };
    expect(distanceToGeometryM(HERE, barn)).toBe(0);
  });

  it("measures to an area's edge from outside it", () => {
    const woods: FeatureGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [east(30)[0], north(-50)[1]],
          [east(80)[0], north(-50)[1]],
          [east(80)[0], north(50)[1]],
          [east(30)[0], north(50)[1]],
          [east(30)[0], north(-50)[1]],
        ],
      ],
    };
    expect(distanceToGeometryM(HERE, woods)).toBeCloseTo(30, 0);
  });

  it("takes the nearest of several lines in a MultiLineString", () => {
    const runs: FeatureGeometry = {
      type: "MultiLineString",
      coordinates: [
        [
          [east(60)[0], north(-50)[1]],
          [east(60)[0], north(50)[1]],
        ],
        [
          [east(15)[0], north(-50)[1]],
          [east(15)[0], north(50)[1]],
        ],
      ],
    };
    expect(distanceToGeometryM(HERE, runs)).toBeCloseTo(15, 0);
  });
});

describe("nearbyFeatures", () => {
  const at = (metres: number, id: string) => ({
    id,
    geometry: { type: "Point", coordinates: east(metres) } as FeatureGeometry,
  });

  it("keeps what is inside the radius, nearest first", () => {
    const found = nearbyFeatures(HERE, [at(80, "far"), at(5, "close"), at(25, "mid")]);
    expect(found.map((f) => f.feature.id)).toEqual(["close", "mid"]);
    expect(found[0].metres).toBeLessThan(found[1].metres);
  });

  it("drops a feature nobody has drawn rather than guessing where it is", () => {
    const found = nearbyFeatures(HERE, [
      { id: "traced", geometry: { type: "Point", coordinates: east(3) } as FeatureGeometry },
      { id: "listed", geometry: null },
    ]);
    expect(found.map((f) => f.feature.id)).toEqual(["traced"]);
  });

  it("includes something exactly on the edge of the radius", () => {
    const found = nearbyFeatures(HERE, [at(NEARBY_RADIUS_M - 0.01, "edge")]);
    expect(found).toHaveLength(1);
  });

  it("100 feet is the radius, in metres", () => {
    expect(NEARBY_RADIUS_M).toBeCloseTo(30.48, 5);
  });
});

describe("boxReaches", () => {
  const box: [number, number, number, number] = [
    east(100)[0],
    north(100)[1],
    east(200)[0],
    north(200)[1],
  ];

  it("keeps a box you are standing in", () => {
    const inside: Position = [east(150)[0], north(150)[1]];
    expect(boxReaches(inside, box)).toBe(true);
  });

  it("keeps a box you are just outside, because the radius reaches into it", () => {
    const justOutside: Position = [east(90)[0], north(150)[1]];
    expect(boxReaches(justOutside, box)).toBe(true);
  });

  it("drops a box the radius cannot reach", () => {
    expect(boxReaches(HERE, box)).toBe(false);
  });
});
