import { describe, expect, it } from "vitest";
import {
  ALREADY_JOINED_M,
  movedM,
  snapLabel,
  snapPosition,
  SNAP_TOLERANCE_M,
  type SnapCandidate,
} from "../src/packs/land/core/snap";
import {
  haversineM,
  type FeatureGeometry,
  type Position,
} from "../src/packs/land/core/geo";

/**
 * Snapping — the half of land slice 2b.5 that makes a lane MEET a fence.
 *
 * The failures worth writing tests for are the ones that look like they work:
 *
 *   - measuring in DEGREES, which snaps four metres north and forty metres
 *     east at this latitude and is therefore right in one direction only
 *   - taking the nearest thing full stop, which joins a lane a metre short of
 *     the corner it was aimed at and leaves the stub this whole feature exists
 *     to remove
 *   - snapping to a point NEAR the line rather than ON it, which closes the gap
 *     on screen and leaves it in the data
 */

/** The pilot farm's latitude, where cos ≈ 0.761 — degrees are not metres here. */
const LAT = 40.4;
const LON = -82.48;

/** Metres east of the origin, as a longitude. */
const east = (metres: number): number =>
  LON + metres / (111_320 * Math.cos((LAT * Math.PI) / 180));
/** Metres north of the origin, as a latitude. */
const north = (metres: number): number => LAT + metres / 110_540;

const fence = (coordinates: Position[], name = "West Fence"): SnapCandidate => ({
  id: "fence-1",
  name,
  geometry: { type: "LineString", coordinates } as FeatureGeometry,
});

/** A fence running 200 m north from the origin. */
const NORTH_FENCE = fence([
  [LON, LAT],
  [LON, north(200)],
]);

describe("snapPosition", () => {
  it("leaves a point alone when there is nothing near it", () => {
    expect(snapPosition([east(80), north(80)], [NORTH_FENCE])).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(snapPosition([LON, LAT], [])).toBeNull();
  });

  it("pulls a point three metres off a fence onto it exactly", () => {
    const hit = snapPosition([east(3), north(100)], [NORTH_FENCE]);
    expect(hit).not.toBeNull();
    expect(hit?.kind).toBe("edge");
    expect(hit?.name).toBe("West Fence");
    expect(hit?.distanceM).toBeCloseTo(3, 1);
    // ON the fence, not merely nearer to it: the fence runs at LON exactly.
    expect(hit!.position[0]).toBeCloseTo(LON, 9);
    expect(hit!.position[1]).toBeCloseTo(north(100), 9);
  });

  it("does not reach a point beyond the tolerance", () => {
    expect(
      snapPosition([east(SNAP_TOLERANCE_M + 2), north(100)], [NORTH_FENCE]),
    ).toBeNull();
  });

  /**
   * The cosine test. Four metres east and four metres north are the same
   * distance; in degrees the eastward one is 1.3x further. An implementation
   * comparing raw coordinate differences passes one of these and fails the
   * other.
   */
  it("measures in metres, not degrees", () => {
    const eastward = snapPosition([east(4), north(100)], [NORTH_FENCE]);
    const northward = snapPosition([LON, north(204)], [NORTH_FENCE]);
    expect(eastward?.distanceM).toBeCloseTo(4, 1);
    expect(northward?.distanceM).toBeCloseTo(4, 1);
  });

  it("prefers the END of a fence over a nearer point along it", () => {
    /**
     * Two metres past the top of the fence and half a metre to the side. The
     * nearest point ON the run is the corner itself here, so to make the
     * preference bite the point sits BESIDE the run: 1 m east and 3 m below
     * the top corner. The run is 1 m away; the corner is 3.16 m away.
     */
    const hit = snapPosition([east(1), north(197)], [NORTH_FENCE]);
    expect(hit?.kind).toBe("vertex");
    expect(hit?.position[1]).toBeCloseTo(north(200), 9);
    expect(hit?.distanceM).toBeCloseTo(Math.hypot(1, 3), 1);
  });

  it("snaps to the nearer of two fences", () => {
    const other = {
      ...fence(
        [
          [east(20), LAT],
          [east(20), north(200)],
        ],
        "East Fence",
      ),
      id: "fence-2",
    };
    const hit = snapPosition([east(17), north(100)], [NORTH_FENCE, other]);
    expect(hit?.name).toBe("East Fence");
    expect(hit?.id).toBe("fence-2");
  });

  it("snaps to a gate, which is a point", () => {
    const gate: SnapCandidate = {
      id: "gate-1",
      name: "Top Gate",
      geometry: { type: "Point", coordinates: [east(2), north(100)] },
    };
    const hit = snapPosition([east(4), north(100)], [gate]);
    expect(hit?.kind).toBe("vertex");
    expect(hit?.name).toBe("Top Gate");
    expect(hit?.distanceM).toBeCloseTo(2, 1);
  });

  it("snaps to a paddock outline, which is a ring", () => {
    const paddock: SnapCandidate = {
      id: "zone-1",
      name: "North Pasture",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [LON, LAT],
            [east(100), LAT],
            [east(100), north(100)],
            [LON, north(100)],
            [LON, LAT],
          ],
        ],
      },
    };
    const hit = snapPosition([east(50), north(3)], [paddock]);
    expect(hit?.kind).toBe("edge");
    expect(hit?.position[1]).toBeCloseTo(LAT, 9);
  });

  it("walks a MultiLineString's parts", () => {
    const split: SnapCandidate = {
      id: "fence-3",
      name: "Creek Fence",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [LON, LAT],
            [LON, north(50)],
          ],
          [
            [east(60), LAT],
            [east(60), north(50)],
          ],
        ],
      },
    };
    const hit = snapPosition([east(58), north(25)], [split]);
    expect(hit?.kind).toBe("edge");
    expect(hit?.position[0]).toBeCloseTo(east(60), 9);
  });

  it("snaps nothing when the tolerance is zero", () => {
    expect(snapPosition([east(0.1), north(100)], [NORTH_FENCE], 0)).toBeNull();
  });

  /**
   * The point of the whole exercise: after snapping, the two features share a
   * coordinate to the metre, which is what lets `enclosuresFrom` treat them as
   * meeting.
   */
  it("leaves the snapped point on the candidate to within a millimetre", () => {
    const hit = snapPosition([east(4.5), north(37)], [NORTH_FENCE]);
    expect(hit).not.toBeNull();
    const onFence: Position = [LON, hit!.position[1]];
    expect(haversineM(hit!.position, onFence)).toBeLessThan(0.001);
  });
});

/**
 * **SNAPPING TWICE MUST BE THE SAME AS SNAPPING ONCE**, and this is not a
 * theoretical nicety. Terra Draw snaps a click twice — once for the provisional
 * vertex following the pointer, once when the click commits — and it feeds the
 * second pass the first pass's answer. When `snap(snap(p))` moved, both answers
 * ended up in the line: a two-click fence came out with three vertices, the
 * middle one nine metres from anywhere anybody clicked.
 *
 * The vertex preference is what breaks it unaided, so that is the case tested.
 */
describe("snapping is idempotent", () => {
  it("leaves a point that is already ON a line exactly where it is", () => {
    const onTheRun: Position = [LON, north(196)];
    expect(snapPosition(onTheRun, [NORTH_FENCE])).toBeNull();
  });

  it("does not pull a point on the run up to the corner it is near", () => {
    // Four metres below the top corner and exactly on the fence. The corner is
    // within tolerance and outranks a run — and must not win, because the point
    // has already joined.
    const first = snapPosition([east(0.5), north(196)], [NORTH_FENCE]);
    expect(first).not.toBeNull();
    expect(snapPosition(first!.position, [NORTH_FENCE])).toBeNull();
  });

  it("still moves a point that is further off than the floor", () => {
    const justOutside: Position = [east(ALREADY_JOINED_M * 3), north(100)];
    expect(snapPosition(justOutside, [NORTH_FENCE])).not.toBeNull();
  });

  it("holds for a snap onto a corner too", () => {
    const near = snapPosition([east(1), north(199)], [NORTH_FENCE]);
    expect(near?.kind).toBe("vertex");
    expect(snapPosition(near!.position, [NORTH_FENCE])).toBeNull();
  });
});

describe("snapLabel", () => {
  it("says nothing when nothing snapped", () => {
    expect(snapLabel(null)).toBeNull();
  });

  it("distinguishes an end from a run", () => {
    expect(
      snapLabel({
        position: [LON, LAT],
        kind: "vertex",
        id: "a",
        name: "West Fence",
        distanceM: 1,
      }),
    ).toBe("Joined to the end of West Fence");
    expect(
      snapLabel({
        position: [LON, LAT],
        kind: "edge",
        id: "a",
        name: "West Fence",
        distanceM: 1,
      }),
    ).toBe("Joined to West Fence");
  });
});

describe("movedM", () => {
  it("reports how far a snap moved the point", () => {
    expect(movedM([LON, LAT], [east(4), LAT])).toBeCloseTo(4, 1);
  });
});
