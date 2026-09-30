import { cameraAttitude, mad, upFromQuaternion, type Point, type Vector3 } from "../core/geometry";

/**
 * THE PHONE'S TILT, LIVE (docs/modules/posture.md, "Level and scale"): for
 * guiding the phone level on its tripod. The plumb line, not this, is what a
 * measure is corrected by; this is how close to level you got it.
 *
 * Best first: the orientation quaternion (`RelativeOrientationSensor`),
 * which Chrome rounds to about a tenth of a degree; then the gravity sensor
 * and the motion event's gravity, which Chrome rounds to 0.1 m/s² (steps of
 * about 0.6° of roll). None of them needs a permission prompt in Chrome on
 * Android; all of them need a secure page.
 */

export type Attitude = { roll: number; pitch: number; up: Point; at: number };

export type OrientationWatch = {
  kind: string;
  latest(): Attitude | null;
  /** Readings a second over the last few seconds. */
  rateHz(): number | null;
  /** How much the roll wanders (a standard deviation, degrees) over the last readings. */
  rollSpread(): number | null;
  stop(): void;
};

type SensorLike = EventTarget & {
  start(): void;
  stop(): void;
  quaternion?: number[] | null;
  x?: number | null;
  y?: number | null;
  z?: number | null;
};
type SensorClass = new (options: { frequency: number; referenceFrame?: string }) => SensorLike;

export function watchOrientation(onReading?: (a: Attitude) => void): OrientationWatch {
  const recent: Attitude[] = [];
  let kind = "none";
  let cleanup: () => void = () => undefined;

  function record(up: Vector3): void {
    const n = Math.hypot(up.x, up.y, up.z);
    if (!(n > 0)) return;
    const att = cameraAttitude(up);
    const a: Attitude = { roll: att.roll, pitch: att.pitch, up: att.upInImage, at: performance.now() };
    recent.push(a);
    if (recent.length > 120) recent.shift();
    onReading?.(a);
  }

  const w = window as unknown as {
    RelativeOrientationSensor?: SensorClass;
    GravitySensor?: SensorClass;
  };

  function tryMotion(): void {
    kind = "devicemotion";
    const handler = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (g && g.x !== null && g.y !== null && g.z !== null) record({ x: g.x, y: g.y, z: g.z });
    };
    window.addEventListener("devicemotion", handler);
    cleanup = () => window.removeEventListener("devicemotion", handler);
  }

  function trySensor(Kind: SensorClass | undefined, name: string, read: (s: SensorLike) => Vector3 | null, next: () => void): void {
    if (!Kind) return next();
    try {
      const sensor = new Kind({ frequency: 30, referenceFrame: "device" });
      let given = false;
      let silent = 0;
      const onReading = () => {
        const up = read(sensor);
        if (up) record(up);
      };
      const release = () => {
        window.clearTimeout(silent);
        sensor.removeEventListener("reading", onReading);
        sensor.removeEventListener("error", giveUp);
        sensor.stop();
      };
      // Once only, however it fails: an error and then the silence timer
      // must not start the next sensor twice.
      function giveUp() {
        if (given) return;
        given = true;
        release();
        next();
      }
      sensor.addEventListener("reading", onReading);
      sensor.addEventListener("error", giveUp);
      sensor.start();
      kind = name;
      // A sensor that starts and then says nothing (no error either) is
      // passed over after a second and a half.
      silent = window.setTimeout(() => {
        if (recent.length === 0) giveUp();
      }, 1500);
      cleanup = release;
    } catch {
      next();
    }
  }

  trySensor(
    w.RelativeOrientationSensor,
    "RelativeOrientationSensor",
    (s) => {
      const q = s.quaternion;
      return q && q.length === 4 ? upFromQuaternion([q[0], q[1], q[2], q[3]]) : null;
    },
    () =>
      trySensor(
        w.GravitySensor,
        "GravitySensor",
        (s) => (s.x != null && s.y != null && s.z != null ? { x: s.x, y: s.y, z: s.z } : null),
        tryMotion,
      ),
  );

  return {
    get kind() {
      return kind;
    },
    latest: () => recent[recent.length - 1] ?? null,
    rateHz: () => {
      if (recent.length < 2) return null;
      const span = (recent[recent.length - 1].at - recent[0].at) / 1000;
      return span > 0 ? (recent.length - 1) / span : null;
    },
    rollSpread: () => (recent.length >= 10 ? mad(recent.slice(-60).map((a) => a.roll)) : null),
    stop: () => cleanup(),
  };
}
