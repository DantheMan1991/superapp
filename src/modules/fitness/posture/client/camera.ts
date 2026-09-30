import { lockPlan, parseCameraLabel, streamConstraints, type CameraInfo, type LockPlan } from "../core/camera";

/**
 * THE CAMERA, IN THE BROWSER (docs/modules/posture.md, "The camera"). Every
 * stream opened here is stopped by whoever opened it; nothing here ever
 * records, photographs or keeps a frame.
 *
 * The Image Capture constraints (white balance, focus, exposure) are Chrome's
 * and not in TypeScript's DOM types, hence the loose records.
 */

type Loose = Record<string, unknown>;

function stop(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function capsOf(track: MediaStreamTrack): Loose {
  return typeof track.getCapabilities === "function" ? (track.getCapabilities() as unknown as Loose) : {};
}

export function settingsOf(track: MediaStreamTrack): Loose {
  return track.getSettings() as unknown as Loose;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number.NaN;
}

function range(v: unknown): { min: number; max: number } | null {
  if (v && typeof v === "object" && "max" in v) {
    const r = v as { min?: number; max?: number };
    return { min: num(r.min), max: num(r.max) };
  }
  return null;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** Ask once, so the labels are filled in; the stream is stopped at once. */
export async function askForCamera(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  stop(stream);
}

/** Every camera, opened one at a time for what it can do, back cameras only opened. */
export async function listCameras(): Promise<CameraInfo[]> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  const out: CameraInfo[] = [];
  for (const d of devices) {
    const { index, facing } = parseCameraLabel(d.label);
    let caps: Loose = {};
    if (facing !== "front") {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId } }, audio: false });
        caps = capsOf(stream.getVideoTracks()[0]);
      } catch {
        // A camera that will not open is listed with nothing known about it.
      } finally {
        stop(stream);
      }
    }
    out.push({
      deviceId: d.deviceId,
      label: d.label,
      facing,
      index,
      maxWidth: range(caps.width)?.max ?? 0,
      maxHeight: range(caps.height)?.max ?? 0,
      torch: caps.torch === true,
      zoomMax: range(caps.zoom)?.max ?? null,
      focusModes: list(caps.focusMode),
      exposureModes: list(caps.exposureMode),
      whiteBalanceModes: list(caps.whiteBalanceMode),
    });
  }
  return out;
}

/** Which camera `facingMode: "environment"` opens: on a Samsung, often the ultrawide. */
export async function facingModeOpens(cameras: readonly CameraInfo[]): Promise<string | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    const id = String(settingsOf(stream.getVideoTracks()[0]).deviceId ?? "");
    return cameras.find((c) => c.deviceId === id)?.label ?? (id ? "a camera not in the list" : null);
  } catch {
    return null;
  } finally {
    stop(stream);
  }
}

export async function openCamera(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(streamConstraints(deviceId) as MediaStreamConstraints);
}

export type LockResult = { whiteBalance: string; focus: string; exposure: string };

/**
 * Lock white balance and focus where the camera allows it, and exposure only
 * with its ISO read back (Chrome's manual exposure keeps the time but not the
 * ISO). Each lock is tried on its own, so one refusal does not undo another,
 * and read back to see whether it held.
 */
export async function applyLocks(track: MediaStreamTrack): Promise<LockResult> {
  const plan: LockPlan = lockPlan(
    {
      whiteBalanceMode: list(capsOf(track).whiteBalanceMode),
      focusMode: list(capsOf(track).focusMode),
      exposureMode: list(capsOf(track).exposureMode),
    },
    {
      focusDistance: num(settingsOf(track).focusDistance),
      iso: num(settingsOf(track).iso),
      exposureTime: num(settingsOf(track).exposureTime),
    },
  );
  const result: LockResult = { whiteBalance: "not offered", focus: "not offered", exposure: "not offered" };
  async function tryLock(name: keyof LockResult, constraint: Loose, check: (s: Loose) => boolean): Promise<void> {
    try {
      await track.applyConstraints({ advanced: [constraint] } as unknown as MediaTrackConstraints);
      result[name] = check(settingsOf(track)) ? "locked" : "asked, did not hold";
    } catch (error) {
      result[name] = `refused: ${error instanceof Error ? error.name : String(error)}`;
    }
  }
  if (plan.whiteBalance) await tryLock("whiteBalance", { whiteBalanceMode: "manual" }, (s) => s.whiteBalanceMode === "manual");
  if (plan.focus) {
    const c: Loose = { focusMode: "manual" };
    if (plan.focus.distance !== null) c.focusDistance = plan.focus.distance;
    await tryLock("focus", c, (s) => s.focusMode === "manual");
  }
  if (plan.exposure) {
    await tryLock(
      "exposure",
      { exposureMode: "manual", iso: plan.exposure.iso, exposureTime: plan.exposure.exposureTime },
      (s) => s.exposureMode === "manual",
    );
  }
  return result;
}

/** A few of the track's settings, for the readout: sizes, rate, and what the locks left behind. */
export function settingsForReadout(track: MediaStreamTrack): Record<string, number | string | boolean | null> {
  const s = settingsOf(track);
  const keep = ["width", "height", "frameRate", "resizeMode", "whiteBalanceMode", "colorTemperature", "focusMode", "focusDistance", "exposureMode", "exposureTime", "exposureCompensation", "iso", "zoom", "torch"];
  const out: Record<string, number | string | boolean | null> = {};
  for (const k of keep) {
    const v = s[k];
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Frames delivered and dropped by the camera (Chrome 120+), when the browser says. */
export function frameStats(track: MediaStreamTrack): { delivered: number | null; discarded: number | null } {
  const stats = (track as unknown as { stats?: { deliveredFrames?: number; discardedFrames?: number } }).stats;
  return { delivered: stats?.deliveredFrames ?? null, discarded: stats?.discardedFrames ?? null };
}

export { stop as stopStream };
