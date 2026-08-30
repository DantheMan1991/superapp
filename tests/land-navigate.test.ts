import { describe, expect, it } from "vitest";
import {
  arrival,
  arrivalNote,
  arrivalRadiusM,
  bearingDegrees,
  compassPoint,
  CLOSE_MULTIPLE,
  nearestTarget,
  progressOf,
  PROGRESS_NOISE_M,
  targetsOf,
} from "../src/packs/land/core/navigate";
import type { FeatureGeometry, Position } from "../src/packs/land/core/geo";

/**
 * Walking to a point you drew — the pure half of land slice 2b.3.
 *
 * The failures worth writing down are the ones that look like they work:
 *
 *   - a bearing computed from raw coordinate differences, which is out by the
 *     cosine of the latitude and points a person 15 degrees wrong at 40N
 *   - arrival measured against a FIXED distance, which either never triggers
 *     under a tree line or triggers in the next field
 *   - a ring whose closing repeat is walked, sending somebody back to the
 *     corner they started at
 */

const LAT = 40.4;
const LON = -82.48;

const M_PER_DEGREE = (Math.PI / 180) * 6_378_137;
const M_PER_DEGREE_LON = M_PER_DEGREE * Math.cos((LAT * Math.PI) / 180);
const east = (metres: number): number => LON + metres / M_PER_DEGREE_LON;
const north = (metres: number): number => LAT + metres / M_PER_DEGREE;

const HERE: Position = [LON, LAT];

describe("bearingDegrees", () => {
  it("reads the four cardinals", () => {
    expect(bearingDegrees(HERE, [LON, north(100)])).toBeCloseTo(0, 1);
    expect(bearingDegrees(HERE, [east(100), LAT])).toBeCloseTo(90, 1);
    expect(bearingDegrees(HERE, [LON, north(-100)])).toBeCloseTo(180, 1);
    expect(bearingDegrees(HERE, [east(-100), LAT])).toBeCloseTo(270, 1);
  });

  /**
   * The cosine test. A hundred metres east and a hundred north is northeast on
   * the ground; in raw degrees the eastward leg looks 1.3x longer at this
   * latitude, so a naive `atan2(dLon, dLat)` reports about 52 degrees.
   */
  it("is a real bearing, not an angle between coordinate differences", () => {
    expect(bearingDegrees(HERE, [east(100), north(100)])).toBeCloseTo(45, 0);
  });

  it("always comes back in 0..360", () => {
    for (const to of [
      [east(-1), north(-1)],
      [east(-1), north(1)],
      [east(1), north(-1)],
    ] as Position[]) {
      const bearing = bearingDegrees(HERE, to);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });
});

describe("compassPoint", () => {
  it("names the sixteen points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(90)).toBe("E");
    expect(compassPoint(180)).toBe("S");
    expect(compassPoint(270)).toBe("W");
    expect(compassPoint(45)).toBe("NE");
    expect(compassPoint(22.5)).toBe("NNE");
  });

  it("wraps rather than falling off the end", () => {
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(360)).toBe("N");
    expect(compassPoint(-90)).toBe("W");
  });
});

/**
 * **ARRIVAL IS MEASURED AGAINST THE ACCURACY, NOT A FIXED DISTANCE**, and that
 * is the honest limit made into the interface. Standing 4 m away on a +/-6 m
 * fix, the phone cannot tell you are not on it. On a +/-2 m fix, it can.
 */
describe("arrival", () => {
  it("says arrived when the target is inside the uncertainty", () => {
    expect(arrival(4, 6)).toBe("arrived");
    expect(arrival(2, 2)).toBe("arrived");
  });

  it("does not say arrived when the phone can tell the difference", () => {
    expect(arrival(4, 2)).toBe("close");
  });

  it("opens up under a bad sky and tightens under a good one", () => {
    // The SAME distance, two different verdicts, which is the whole point.
    expect(arrival(15, 20)).toBe("arrived");
    expect(arrival(15, 3)).toBe("walking");
  });

  it("has a close band before the arrived one", () => {
    expect(arrival(5 * CLOSE_MULTIPLE - 1, 5)).toBe("close");
    expect(arrival(5 * CLOSE_MULTIPLE + 1, 5)).toBe("walking");
  });

  /**
   * A missing accuracy is treated as BAD, not as perfect. The failure mode of
   * the other choice is telling somebody they have arrived.
   */
  it("treats an unusable accuracy as a wide circle, never a narrow one", () => {
    expect(arrival(10, Number.NaN)).toBe("arrived");
    expect(arrival(200, Number.NaN)).toBe("walking");
    expect(arrival(10, 0)).toBe("arrived");
  });
});

describe("arrivalNote", () => {
  it("names the uncertainty rather than claiming you are there", () => {
    expect(arrivalNote("arrived", "20 ft")).toContain("20 ft");
    expect(arrivalNote("arrived", "20 ft")).toMatch(/as close as the phone/i);
  });

  /**
   * **THE RADIUS ARRIVES ALREADY FORMATTED.** The first version wrote metres in
   * itself, so a farm working in feet read "7 ft" in letters an inch tall and
   * "Within 6 m" underneath it. Caught by driving it, not by a test.
   */
  it("says nothing about units of its own", () => {
    const note = arrivalNote("arrived", "20 ft");
    expect(note).toContain("20 ft");
    // No metres anywhere: a bare number followed by "m" is the shape the
    // first version emitted beside a distance in feet.
    expect(note).not.toMatch(/[0-9]+\s*m\b/);
  });

  it("says something useful in the other two states", () => {
    expect(arrivalNote("close", "4 m")).toMatch(/slow down/i);
    expect(arrivalNote("walking", "4 m")).toMatch(/keep going/i);
  });
});

/**
 * The note has to describe the circle `arrival` actually judged against — two
 * places quietly disagreeing is how a screen claims something the decision
 * underneath it never said.
 */
describe("arrivalRadiusM", () => {
  it("is the accuracy when the accuracy is usable", () => {
    expect(arrivalRadiusM(4.2)).toBe(4.2);
  });

  it("agrees with arrival about an unusable one", () => {
    const radius = arrivalRadiusM(Number.NaN);
    expect(arrival(radius, Number.NaN)).toBe("arrived");
    expect(arrival(radius + 1, Number.NaN)).not.toBe("arrived");
    expect(arrivalRadiusM(0)).toBe(50);
  });
});

describe("progressOf", () => {
  it("says nothing on the first fix", () => {
    expect(progressOf(null, 40)).toBe("holding");
  });

  it("reads a real approach and a real retreat", () => {
    expect(progressOf(40, 30)).toBe("closer");
    expect(progressOf(30, 40)).toBe("further");
  });

  /**
   * A stationary phone drifts by a metre or so between readings. Calling that
   * "further away" would flicker while somebody stands still, which reads as
   * the app being broken rather than as the instrument being what it is.
   */
  it("ignores drift below the noise floor", () => {
    expect(progressOf(40, 40 - (PROGRESS_NOISE_M - 0.1))).toBe("holding");
    expect(progressOf(40, 40 + (PROGRESS_NOISE_M - 0.1))).toBe("holding");
  });
});

describe("targetsOf", () => {
  it("makes one target of a gate", () => {
    const gate: FeatureGeometry = { type: "Point", coordinates: HERE };
    const targets = targetsOf(gate);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ index: 1, total: 1 });
  });

  it("walks a fence's corners in the order it was drawn", () => {
    const fence: FeatureGeometry = {
      type: "LineString",
      coordinates: [HERE, [east(50), LAT], [east(50), north(50)]],
    };
    const targets = targetsOf(fence);
    expect(targets.map((t) => t.index)).toEqual([1, 2, 3]);
    expect(targets.every((t) => t.total === 3)).toBe(true);
    expect(targets[2].position).toEqual([east(50), north(50)]);
  });

  /**
   * **A RING'S CLOSING REPEAT IS DROPPED.** Walking to it would tell somebody
   * to go back to the corner they started at.
   */
  it("does not send you back to the corner you started at", () => {
    const paddock: FeatureGeometry = {
      type: "Polygon",
      coordinates: [
        [HERE, [east(100), LAT], [east(100), north(100)], [LON, north(100)], HERE],
      ],
    };
    const targets = targetsOf(paddock);
    expect(targets).toHaveLength(4);
    expect(targets[3].position).toEqual([LON, north(100)]);
  });

  it("walks every part of a MultiLineString", () => {
    const split: FeatureGeometry = {
      type: "MultiLineString",
      coordinates: [
        [HERE, [east(50), LAT]],
        [[east(80), LAT], [east(80), north(50)]],
      ],
    };
    expect(targetsOf(split)).toHaveLength(4);
  });
});

/**
 * **WHICH CORNER TO OFFER FIRST IS NOT "THE ONE DRAWN FIRST".** Somebody
 * opening this is already somewhere, usually at one end of the run, and being
 * sent to the far end because that vertex happens to be index 1 wastes a walk.
 */
describe("nearestTarget", () => {
  it("starts you at the end of the run you are standing at", () => {
    const fence: FeatureGeometry = {
      type: "LineString",
      coordinates: [HERE, [east(200), LAT], [east(400), LAT]],
    };
    const targets = targetsOf(fence);
    expect(nearestTarget([east(390), north(5)], targets)?.index).toBe(3);
    expect(nearestTarget([east(5), north(5)], targets)?.index).toBe(1);
  });

  it("is null for a shape with nothing to stand on", () => {
    expect(nearestTarget(HERE, [])).toBeNull();
  });
});
