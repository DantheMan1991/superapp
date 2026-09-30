/**
 * THE POSTURE CHECK'S GEOMETRY (docs/modules/posture.md, "Conventions"): pure,
 * so every angle a report shows is tested here and nowhere else.
 *
 * - **Image points** are pixels with y pointing DOWN, as a camera frame has them.
 * - **Level points** are what a measure is taken in: x to true right, y to true
 *   UP, where "up" is gravity's, found from the plumb line or the phone's own
 *   sensors (`levelFrame`). A crooked phone never becomes a crooked shoulder.
 * - Angles are degrees. A line against horizontal is signed so that its FIRST
 *   point being lower reads positive: pass the person's right side first and
 *   "positive" means "right side lower", the report's convention.
 */

export type Point = { x: number; y: number };
export type Vector3 = { x: number; y: number; z: number };

const DEG = 180 / Math.PI;

export function degrees(radians: number): number {
  return radians * DEG;
}

export function radians(deg: number): number {
  return deg / DEG;
}

function length(x: number, y: number): number {
  return Math.hypot(x, y);
}

/**
 * The frame a measure is taken in: `up` is true up expressed in image pixels
 * (a unit vector, y down); `origin` is any image point. Level coordinates are
 * (x to true right, y to true up).
 */
export type LevelFrame = { up: Point; right: Point; origin: Point };

export function levelFrame(up: Point, origin: Point = { x: 0, y: 0 }): LevelFrame {
  const n = length(up.x, up.y);
  if (!(n > 0)) throw new Error("levelFrame: up has no direction");
  const u = { x: up.x / n, y: up.y / n };
  // True right is true up turned a quarter clockwise on the screen: with y
  // down, (x, y) -> (-y, x). A level camera's up (0, -1) gives right (1, 0).
  return { up: u, right: { x: -u.y, y: u.x }, origin };
}

/** A level camera's frame: true up is straight up the image. */
export const IMAGE_LEVEL: LevelFrame = levelFrame({ x: 0, y: -1 });

export function toLevel(frame: LevelFrame, p: Point): Point {
  const dx = p.x - frame.origin.x;
  const dy = p.y - frame.origin.y;
  return {
    x: dx * frame.right.x + dy * frame.right.y,
    y: dx * frame.up.x + dy * frame.up.y,
  };
}

/**
 * How far the image is turned from true vertical, in degrees: the angle from
 * the image's own up to true up, positive when true up leans to the image's
 * RIGHT (the phone turned anticlockwise, seen from behind its screen).
 */
export function rollOf(frame: LevelFrame): number {
  return degrees(Math.atan2(frame.up.x, -frame.up.y));
}

/** The line a→b against true horizontal: positive when `a` is the lower end. */
export function tiltFromHorizontal(frame: LevelFrame, a: Point, b: Point): number {
  const pa = toLevel(frame, a);
  const pb = toLevel(frame, b);
  const dx = Math.abs(pb.x - pa.x);
  const dy = pb.y - pa.y;
  // Measured from a toward b, whichever side b is on: b higher than a means
  // a is the lower end, so the angle is positive.
  return degrees(Math.atan2(dy, dx));
}

/**
 * The line from `low` up to `high` against true vertical: positive when
 * `high` sits to the true RIGHT of `low`. Which way "right" is for the body
 * (forward or back) depends on the view, and the measure says so.
 */
export function leanFromVertical(frame: LevelFrame, low: Point, high: Point): number {
  const pl = toLevel(frame, low);
  const ph = toLevel(frame, high);
  return degrees(Math.atan2(ph.x - pl.x, ph.y - pl.y));
}

/** The angle at `b` between b→a and b→c, 0–180. */
export function angleAt(a: Point, b: Point, c: Point): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const n = length(ux, uy) * length(vx, vy);
  if (!(n > 0)) return Number.NaN;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / n));
  return degrees(Math.acos(cos));
}

/** Which side of the line a→c the point b is on: +1 left of it (in level coordinates), -1 right, 0 on it. */
export function sideOfLine(frame: LevelFrame, a: Point, b: Point, c: Point): -1 | 0 | 1 {
  const pa = toLevel(frame, a);
  const pb = toLevel(frame, b);
  const pc = toLevel(frame, c);
  const cross = (pc.x - pa.x) * (pb.y - pa.y) - (pc.y - pa.y) * (pb.x - pa.x);
  return cross > 1e-9 ? 1 : cross < -1e-9 ? -1 : 0;
}

/* ---------------------------------------------------------------------------
 * The phone's sensors.
 *
 * Device axes (W3C): x to the screen's right, y up the screen, z out of the
 * screen toward whoever is looking at it. The REAR camera looks along -z, and
 * its picture's right is the device's +x, its picture's down the device's -y
 * (a rear camera's picture is not mirrored).
 *
 * "Up" in device axes is what an accelerometer reads at rest (it reports the
 * floor pushing up: flat and face up reads z = +9.81), or what an orientation
 * quaternion says the earth's up is.
 * ------------------------------------------------------------------------- */

/**
 * True up in device axes from a `RelativeOrientationSensor` quaternion
 * [x, y, z, w], which turns device axes into earth axes (earth z up): up is the
 * third row of that rotation. The identity is a phone flat on its back.
 */
export function upFromQuaternion(q: readonly [number, number, number, number]): Vector3 {
  const [x, y, z, w] = q;
  return {
    x: 2 * (x * z - y * w),
    y: 2 * (y * z + x * w),
    z: 1 - 2 * (x * x + y * y),
  };
}

/**
 * Roll and pitch of a phone standing upright for the REAR camera.
 * - `roll`: degrees the picture is turned, positive when true up leans to the
 *   picture's right (the same sign as `rollOf`).
 * - `pitch`: degrees the camera looks DOWN (negative: up).
 * - `upInImage`: true up as a unit vector in picture pixels (y down), for
 *   `levelFrame`.
 */
export function cameraAttitude(upDevice: Vector3): { roll: number; pitch: number; upInImage: Point } {
  const n = Math.hypot(upDevice.x, upDevice.y, upDevice.z);
  if (!(n > 0)) throw new Error("cameraAttitude: no up");
  const ux = upDevice.x / n;
  const uy = upDevice.y / n;
  const uz = upDevice.z / n;
  const inPlane = Math.hypot(ux, uy) || 1;
  return {
    roll: degrees(Math.atan2(ux, uy)),
    // The screen tipped back (up gains +z) points the rear camera down.
    pitch: degrees(Math.asin(Math.max(-1, Math.min(1, uz)))),
    upInImage: { x: ux / inPlane, y: -uy / inPlane },
  };
}

/* ---------------------------------------------------------------------------
 * Robust numbers: a hold is many frames, and the report's number is their
 * median, with the spread saying how much to trust it.
 * ------------------------------------------------------------------------- */

export function median(values: readonly number[]): number {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Median absolute deviation, scaled to estimate a standard deviation (×1.4826). */
export function mad(values: readonly number[]): number {
  const m = median(values);
  if (!Number.isFinite(m)) return Number.NaN;
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}

export function percentile(values: readonly number[], p: number): number {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const i = Math.min(v.length - 1, Math.max(0, (p / 100) * (v.length - 1)));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

export function medianPoint(points: readonly Point[]): Point {
  return { x: median(points.map((p) => p.x)), y: median(points.map((p) => p.y)) };
}

/** How far points wander around their median, in pixels (the median distance). */
export function jitter(points: readonly Point[]): number {
  if (points.length === 0) return Number.NaN;
  const m = medianPoint(points);
  return median(points.map((p) => Math.hypot(p.x - m.x, p.y - m.y)));
}

export function round(value: number, places: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
