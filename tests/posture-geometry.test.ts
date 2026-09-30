import { describe, expect, it } from "vitest";
import {
  angleAt,
  cameraAttitude,
  IMAGE_LEVEL,
  jitter,
  leanFromVertical,
  levelFrame,
  mad,
  median,
  percentile,
  rollOf,
  sideOfLine,
  tiltFromHorizontal,
  toLevel,
  upFromQuaternion,
} from "../src/modules/fitness/posture/core/geometry";

/**
 * THE POSTURE CHECK'S GEOMETRY (docs/modules/posture.md, "Conventions"): every
 * angle a report shows goes through these, so their signs are pinned here.
 * Picture pixels have y DOWN; level coordinates have y UP along gravity.
 */

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** A frame whose true up is turned `deg` degrees to the picture's right. */
function turned(deg: number) {
  const r = (deg * Math.PI) / 180;
  return levelFrame({ x: Math.sin(r), y: -Math.cos(r) });
}

describe("the level frame", () => {
  it("is the picture itself, flipped to y up, when the camera is level", () => {
    expect(toLevel(IMAGE_LEVEL, { x: 10, y: 20 })).toEqual({ x: 10, y: -20 });
    close(rollOf(IMAGE_LEVEL), 0);
  });

  it("reads a picture turned by the camera straight again", () => {
    // True up leans 3° to the picture's right: a truly level line shows in the
    // picture running down to the right by 3°... and measures level again.
    const frame = turned(3);
    close(rollOf(frame), 3);
    const r = (3 * Math.PI) / 180;
    const a = { x: 100, y: 500 };
    const b = { x: 100 + 300 * Math.cos(r), y: 500 + 300 * Math.sin(r) };
    close(tiltFromHorizontal(frame, a, b), 0, 1e-9);
    // The same line in an uncorrected picture looks 3° off.
    close(Math.abs(tiltFromHorizontal(IMAGE_LEVEL, a, b)), 3, 1e-9);
  });

  it("will not build a frame with no direction", () => {
    expect(() => levelFrame({ x: 0, y: 0 })).toThrow();
  });
});

describe("a line against horizontal", () => {
  it("is positive when the first point given is the lower one, whichever side it is on", () => {
    // Picture y is down: a larger y is lower.
    const low = { x: 400, y: 510 };
    const high = { x: 100, y: 500 };
    expect(tiltFromHorizontal(IMAGE_LEVEL, low, high)).toBeGreaterThan(0);
    expect(tiltFromHorizontal(IMAGE_LEVEL, high, low)).toBeLessThan(0);
    close(tiltFromHorizontal(IMAGE_LEVEL, low, high), (Math.atan2(10, 300) * 180) / Math.PI);
  });

  it("is zero for a level line", () => {
    close(tiltFromHorizontal(IMAGE_LEVEL, { x: 0, y: 7 }, { x: 50, y: 7 }), 0);
  });
});

describe("a line against vertical", () => {
  it("is positive when the upper point sits to true right", () => {
    close(leanFromVertical(IMAGE_LEVEL, { x: 100, y: 900 }, { x: 100, y: 100 }), 0);
    expect(leanFromVertical(IMAGE_LEVEL, { x: 100, y: 900 }, { x: 120, y: 100 })).toBeGreaterThan(0);
    close(leanFromVertical(IMAGE_LEVEL, { x: 0, y: 100 }, { x: 100, y: 0 }), 45);
  });
});

describe("an angle at a point", () => {
  it("measures 0 to 180 between the two arms", () => {
    close(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90);
    close(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 }), 180);
    // acos is steep near 1: a straight line reads a hair over zero.
    close(angleAt({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 2 }), 0, 1e-4);
  });

  it("is not a number when an arm has no length", () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNaN();
  });

  it("tells which side of a line a point is on", () => {
    // Hip at the top, ankle at the bottom, knee to the picture's left.
    const hip = { x: 100, y: 0 };
    const ankle = { x: 100, y: 200 };
    expect(sideOfLine(IMAGE_LEVEL, hip, { x: 90, y: 100 }, ankle)).toBe(-sideOfLine(IMAGE_LEVEL, hip, { x: 110, y: 100 }, ankle));
    expect(sideOfLine(IMAGE_LEVEL, hip, { x: 100, y: 100 }, ankle)).toBe(0);
  });
});

describe("the phone's attitude from its sensors", () => {
  it("reads flat on its back as the identity quaternion", () => {
    const up = upFromQuaternion([0, 0, 0, 1]);
    expect(up).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("reads an upright phone as level, looking straight ahead", () => {
    const s = Math.SQRT1_2;
    const up = upFromQuaternion([s, 0, 0, s]); // tipped 90° up about x
    close(up.x, 0);
    close(up.y, 1);
    close(up.z, 0, 1e-12);
    const att = cameraAttitude(up);
    close(att.roll, 0);
    close(att.pitch, 0, 1e-9);
    close(att.upInImage.x, 0);
    close(att.upInImage.y, -1);
  });

  it("reads a phone turned a little on its tripod as roll, with the same sign as a turned picture", () => {
    const r = (2 * Math.PI) / 180;
    // Up leans toward the device's +x: the picture's true up leans right.
    const att = cameraAttitude({ x: Math.sin(r), y: Math.cos(r), z: 0 });
    close(att.roll, 2, 1e-9);
    close(rollOf(levelFrame(att.upInImage)), 2, 1e-9);
  });

  it("reads a phone tipped back as a camera looking down", () => {
    const t = (5 * Math.PI) / 180;
    const att = cameraAttitude({ x: 0, y: Math.cos(t), z: Math.sin(t) });
    close(att.pitch, 5, 1e-9);
    close(att.roll, 0, 1e-9);
  });

  it("agrees with the accelerometer's convention: face up reads z = +9.81", () => {
    const att = cameraAttitude({ x: 0, y: 9.81, z: 0 });
    close(att.pitch, 0);
  });
});

describe("robust numbers for a hold", () => {
  it("takes the median, ignoring what is not a number", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1, Number.NaN, 3])).toBe(2);
    expect(median([])).toBeNaN();
  });

  it("scales the median absolute deviation to a standard deviation", () => {
    expect(mad([1, 1, 1])).toBe(0);
    close(mad([1, 2, 3, 4, 100]), 1.4826 * 1);
  });

  it("interpolates percentiles", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([10, 20, 30, 40], 90)).toBe(37);
  });

  it("measures how far points wander around their middle", () => {
    expect(jitter([{ x: 0, y: 0 }])).toBe(0);
    close(jitter([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }]), 1);
  });
});
