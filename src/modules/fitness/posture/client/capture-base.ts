import { MEASURING_MODEL } from "../core/assets";
import { rankCameras, type CameraInfo, type RankedCamera } from "../core/camera";
import { levelFrame, median, rollOf, type Point } from "../core/geometry";
import { framingLine, moveLine, SETUP_LINES } from "../core/lines";
import { upFromLine } from "../core/plumb";
import type { View } from "../core/sticker-map";
import { framingOf, stillness, torsoLength, towardPersonSide, viewOf, type Framing, type PosePoint } from "../core/views";
import type { Delegate, FrameResult, FromWorker, StickerFrame, ToWorker, WorkerTask } from "../worker/protocol";
import { applyLocks, askForCamera, facingModeOpens, listCameras, openCamera, stopStream, type LockResult } from "./camera";
import { readDeviceSettings, writeDeviceSettings } from "./device-settings";
import { feedWorker, startPostureWorker, type FramePath } from "./frames";
import { watchOrientation, type OrientationWatch } from "./orientation";
import { sayPosture, stopPostureVoice } from "./voice";

/**
 * WHAT EVERY POSTURE CAPTURE SHARES (docs/modules/posture.md): the setup check
 * (slice 1) and the check itself (slice 2) both open the main lens, run the
 * worker, lock the camera, read the level and the plumb line, and hold the
 * person still in a view while their stickers are read. Plain TypeScript, so
 * a screen only draws what its callbacks tell it.
 *
 * Nothing here keeps a frame: the worker reads and closes each one (ADR 0118).
 */

export type CaptureAction = { id: string; label: string };

export type CaptureCallbacks = {
  instruction(text: string): void;
  actions(actions: CaptureAction[]): void;
  frame(result: FrameResult): void;
  hideCamera(hide: boolean): void;
  /** Something went wrong that the capture carries on past (the worker's errors). */
  warning(message: string | null): void;
};

export type Outcome<T> = { kind: "value"; value: T } | { kind: "action"; id: string } | { kind: "timeout" };

/** Shoulders, hips, knees and ankles: what must stay put for a person to be still. */
export const STILL_INDICES = [11, 12, 23, 24, 25, 26, 27, 28];

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type OpenedCamera = {
  label: string;
  cameras: CameraInfo[];
  chosen: RankedCamera | null;
  facingModeOpens: string | null;
};

export type PlumbFound = {
  roll: number;
  pxPerMetre: number | null;
  rmsPx: number;
  coverage: number;
  marks: number;
  /** The sensor's roll less the plumb line's, kept for next time; null without a sensor. */
  sensorOffset: number | null;
};

export type Held = {
  outcome: Outcome<true>;
  /** The frames read while framed, facing the right way and still. */
  frames: StickerFrame[];
  /** The pose points of those same frames. */
  poses: PosePoint[][];
  viewSeen: View | null;
  stillPx: number;
  size: { width: number; height: number } | null;
};

export abstract class CaptureBase<CB extends CaptureCallbacks> {
  protected worker: Worker | null = null;
  protected stream: MediaStream | null = null;
  protected track: MediaStreamTrack | null = null;
  protected feed: { path: FramePath; stop: () => void } | null = null;
  protected orientation: OrientationWatch | null = null;
  protected frameListeners = new Set<(r: FrameResult) => void>();
  protected actionWaiter: ((id: string) => void) | null = null;
  protected closed = false;
  /** True up in frame pixels: the plumb line's when found, else the sensor's. */
  protected up: Point | null = null;
  protected upFrom: "plumb" | "sensor" | "none" = "none";
  protected pxPerMetre: number | null = null;
  protected delegate: Delegate;
  protected colours: { at: number; luma: number; cb: number; cr: number }[] = [];
  protected personSeen = false;
  protected workerError: string | null = null;

  constructor(
    protected readonly video: HTMLVideoElement,
    protected readonly cb: CB,
    protected readonly naturalVoice: boolean,
    /** A picture or film standing in for the camera (development only). */
    protected readonly testSource: MediaStream | null = null,
  ) {
    this.delegate = readDeviceSettings().delegate ?? "CPU";
  }

  /** A button on the screen was pressed. */
  act(id: string): void {
    const waiter = this.actionWaiter;
    this.actionWaiter = null;
    waiter?.(id);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.act("closed");
    this.releaseCamera();
    stopPostureVoice();
  }

  /** A line for a readout; a capture that keeps none ignores it. */
  protected note(text: string): void {
    void text;
  }

  /** Messages the base does not handle (the setup's bench, the check's photos). */
  protected onMessage(message: FromWorker): void {
    void message;
  }

  /**
   * The camera off and the worker gone: at the end of a capture, and when the
   * screen is left. The voice is not part of it, so a last line is still said.
   */
  protected releaseCamera(): void {
    this.feed?.stop();
    this.feed = null;
    if (this.worker) {
      this.post({ type: "stop" });
      this.worker.terminate();
      this.worker = null;
    }
    this.orientation?.stop();
    this.orientation = null;
    stopStream(this.stream);
    this.stream = null;
    this.video.srcObject = null;
  }

  protected post(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  protected setTask(task: WorkerTask): void {
    this.post({ type: "task", task, up: this.up });
  }

  protected say(text: string, repeatAfterMs?: number): void {
    sayPosture(text, { repeatAfterMs });
  }

  /** Wait for a frame to satisfy `check`, a button, a poll, or the time to run out. */
  protected wait<T>(opts: {
    check?: (r: FrameResult) => T | null;
    poll?: () => T | null;
    actions?: CaptureAction[];
    timeoutMs?: number;
  }): Promise<Outcome<T>> {
    return new Promise((resolve) => {
      let settled = false;
      let timer = 0;
      let poller = 0;
      const finish = (outcome: Outcome<T>) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.clearInterval(poller);
        if (listener) this.frameListeners.delete(listener);
        this.actionWaiter = null;
        this.cb.actions([]);
        resolve(outcome);
      };
      const listener = opts.check
        ? (r: FrameResult) => {
            const v = opts.check!(r);
            if (v !== null && v !== undefined) finish({ kind: "value", value: v });
          }
        : null;
      if (listener) this.frameListeners.add(listener);
      if (opts.poll) {
        poller = window.setInterval(() => {
          const v = opts.poll!();
          if (v !== null && v !== undefined) finish({ kind: "value", value: v });
        }, 200);
      }
      if (opts.timeoutMs) timer = window.setTimeout(() => finish({ kind: "timeout" }), opts.timeoutMs);
      this.actionWaiter = (id) => finish({ kind: "action", id });
      this.cb.actions(opts.actions ?? []);
    });
  }

  private onWorker = (event: MessageEvent<FromWorker>) => {
    const m = event.data;
    if (m.type === "frame") {
      if (m.colour) this.colours.push({ at: performance.now(), ...m.colour });
      if (this.colours.length > 400) this.colours.splice(1, 1); // keep the first, drop the oldest after it
      if (!this.personSeen && m.pose?.points) {
        // A person has walked in: from now on the screen shows a stick
        // figure, not them (ADR 0118).
        this.personSeen = true;
        this.cb.hideCamera(true);
      }
      this.cb.frame(m);
      for (const listener of [...this.frameListeners]) listener(m);
    } else if (m.type === "error") {
      this.workerError = `${m.where}: ${m.message}`;
      this.note(`worker ${this.workerError}`);
      this.cb.warning(
        m.where === "preload" || m.where === "task"
          ? `The pose model could not start on this phone: ${m.message}`
          : `Reading a picture went wrong: ${m.message}`,
      );
    } else {
      this.onMessage(m);
    }
  };

  /**
   * The main lens: the one this phone chose before, or the best back camera.
   * `survey` also lists every camera and tries what `facingMode` opens, for
   * the setup check's readout; the check itself goes straight to the lens.
   */
  protected async openMainLens(survey: boolean): Promise<OpenedCamera> {
    if (this.testSource) {
      this.stream = this.testSource;
      return { label: "test picture", cameras: [], chosen: null, facingModeOpens: null };
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use the camera.");
    const saved = readDeviceSettings();
    if (!survey && saved.cameraId) {
      try {
        this.stream = await openCamera(saved.cameraId);
        return { label: saved.cameraLabel ?? "the back camera", cameras: [], chosen: null, facingModeOpens: null };
      } catch {
        // The saved lens went away (a new phone, a reset): choose again below.
      }
    }
    await askForCamera();
    const cameras = await listCameras();
    const opens = survey ? await facingModeOpens(cameras) : null;
    const ranked = rankCameras(cameras);
    const chosen = ranked.find((c) => c.deviceId === saved.cameraId) ?? ranked[0];
    if (!chosen) throw new Error("No camera that faces away from the screen was found.");
    this.stream = await openCamera(chosen.deviceId);
    writeDeviceSettings({ cameraId: chosen.deviceId, cameraLabel: chosen.label });
    return { label: chosen.label || "the back camera", cameras, chosen, facingModeOpens: opens };
  }

  /** The stream into the preview and the worker, and the heavy model downloading. */
  protected async startPipeline(): Promise<{ path: FramePath; width: number; height: number }> {
    this.track = this.stream?.getVideoTracks()[0] ?? null;
    if (!this.track) throw new Error("The camera gave no picture.");
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play().catch(() => undefined);
    const s = this.track.getSettings();
    this.worker = startPostureWorker();
    this.worker.addEventListener("message", this.onWorker);
    this.worker.addEventListener("error", (e) => {
      this.workerError = e.message || "the worker stopped";
      this.note(`worker failed to start: ${this.workerError}`);
      this.cb.warning(`The part of the check that reads the pictures stopped: ${this.workerError}`);
    });
    this.feed = feedWorker(this.worker, { track: this.track, video: this.video });
    // The heavy model is 30 MB: it downloads while everything else settles.
    this.post({ type: "preload", model: MEASURING_MODEL, delegate: this.delegate });
    return { path: this.feed.path, width: Number(s.width ?? this.video.videoWidth), height: Number(s.height ?? this.video.videoHeight) };
  }

  /** Color and brightness settle on their own, then are held (a test picture has nothing to lock). */
  protected async settleAndLock(): Promise<LockResult | null> {
    this.setTask({ kind: "plumb" });
    await sleep(2500);
    if (this.closed || !this.track || this.testSource) return null;
    const locks = await applyLocks(this.track);
    // Color drift is measured from the moment the locks are on.
    this.colours = [];
    return locks;
  }

  /** The phone's own sense of up, less the offset its last plumb line found. */
  protected startLevel(): void {
    this.orientation ??= watchOrientation();
  }

  protected sensorAttitude(): { roll: number; pitch: number } | null {
    const a = this.orientation?.latest();
    if (!a) return null;
    return { roll: a.roll - (readDeviceSettings().sensorRollOffset ?? 0), pitch: a.pitch };
  }

  /** Up from the sensor, until the plumb line says better. */
  protected useSensorUp(): void {
    const a = this.sensorAttitude();
    if (!a) return;
    const r = (a.roll * Math.PI) / 180;
    this.up = { x: Math.sin(r), y: -Math.cos(r) };
    this.upFrom = "sensor";
  }

  /**
   * Wait for the plumb line: five frames in a row agreeing to 0.15°. Sets true
   * up and the scale, and keeps the sensor's offset from it for next time.
   */
  protected async findPlumb(opts: {
    actions?: CaptureAction[];
    timeoutMs: number;
    progress?: (found: boolean, pxPerMetre: number | null) => void;
  }): Promise<{ outcome: Outcome<true>; found: PlumbFound | null }> {
    this.setTask({ kind: "plumb" });
    const recent: { roll: number; pxPerMetre: number | null; rms: number; coverage: number; marks: number }[] = [];
    const outcome = await this.wait<true>({
      check: (r) => {
        const p = r.plumb;
        if (!p?.found || p.a === null) {
          recent.length = 0;
          opts.progress?.(false, null);
          return null;
        }
        const roll = rollOf(levelFrame(upFromLine({ a: p.a, b: p.b ?? 0 })));
        recent.push({ roll, pxPerMetre: p.pxPerMetre, rms: p.rmsPx ?? Number.NaN, coverage: p.coverage ?? 0, marks: p.marks });
        if (recent.length > 8) recent.shift();
        opts.progress?.(true, p.pxPerMetre);
        const rolls = recent.map((x) => x.roll);
        return recent.length >= 5 && Math.max(...rolls) - Math.min(...rolls) <= 0.15 ? true : null;
      },
      actions: opts.actions,
      timeoutMs: opts.timeoutMs,
    });
    if (outcome.kind !== "value" || recent.length === 0) return { outcome, found: null };
    const roll = median(recent.map((x) => x.roll));
    const scales = recent.map((x) => x.pxPerMetre).filter((x): x is number => x !== null);
    this.pxPerMetre = scales.length >= 3 ? median(scales) : null;
    const r = (roll * Math.PI) / 180;
    this.up = { x: Math.sin(r), y: -Math.cos(r) };
    this.upFrom = "plumb";
    // The sensor's own error against true vertical, kept for next time.
    const sensor = this.orientation?.latest();
    const sensorOffset = sensor ? sensor.roll - roll : null;
    if (sensorOffset !== null) writeDeviceSettings({ sensorRollOffset: sensorOffset });
    return {
      outcome,
      found: {
        roll,
        pxPerMetre: this.pxPerMetre,
        rmsPx: median(recent.map((x) => x.rms)),
        coverage: median(recent.map((x) => x.coverage)),
        marks: Math.max(...recent.map((x) => x.marks)),
        sensorOffset,
      },
    };
  }

  /**
   * Hold the person still in one view until `holdFrames` good frames are read:
   * the whole person in the picture, facing the right way, still. Says what to
   * fix when they are not (in the coach's voice), and starts over when they
   * move, leave or are joined by somebody.
   */
  protected async holdView(
    view: View,
    opts: {
      holdFrames: number;
      timeoutMs: number;
      actions?: CaptureAction[];
      progress?: (read: number, framing: Framing, points: PosePoint[]) => void;
    },
  ): Promise<Held> {
    const diameterPx = this.pxPerMetre ? (this.pxPerMetre * 22) / 1000 : null;
    this.setTask({ kind: "stickers", view, model: MEASURING_MODEL, delegate: this.delegate, diameterPx });
    const frames: StickerFrame[] = [];
    const poses: PosePoint[][] = [];
    const history: PosePoint[][] = [];
    let viewSeen: View | null = null;
    let stillPx = Number.NaN;
    let saidHold = false;
    let size: Held["size"] = null;
    const restart = () => {
      frames.length = 0;
      poses.length = 0;
    };
    const outcome = await this.wait<true>({
      check: (r) => {
        const pose = r.pose;
        size = { width: r.width, height: r.height };
        if (!pose || pose.people === 0 || !pose.points) {
          restart();
          if (this.personSeen) this.say(SETUP_LINES.lostYou, 8000);
          return null;
        }
        if (pose.people > 1) {
          restart();
          this.say(SETUP_LINES.twoPeople, 8000);
          return null;
        }
        const pts = pose.points;
        const framing = framingOf(pts, { width: r.width, height: r.height }, { margin: 0.03, minFill: 0.3, maxFill: 0.88 });
        const guess = viewOf(pts, levelFrame(this.up ?? { x: 0, y: -1 }));
        viewSeen = guess.view;
        if (framing.advice) {
          restart();
          const words =
            framing.advice === "move-picture-left" || framing.advice === "move-picture-right"
              ? moveLine(towardPersonSide(framing.advice === "move-picture-left" ? "picture-left" : "picture-right", view))
              : framingLine(framing.advice);
          if (words) this.say(words, 4000);
          opts.progress?.(0, framing, pts);
          return null;
        }
        if (guess.view && guess.view !== view && guess.confidence >= 0.6) {
          restart();
          this.say(SETUP_LINES.wrongWay, 6000);
          opts.progress?.(0, framing, pts);
          return null;
        }
        history.push(pts);
        if (history.length > 5) history.shift();
        stillPx = stillness(history, STILL_INDICES);
        if (history.length < 3 || !(stillPx <= 0.012 * torsoLength(pts))) {
          restart();
          if (!saidHold && history.length >= 3) {
            saidHold = true;
            this.say(SETUP_LINES.holdStill, 0);
          }
          opts.progress?.(0, framing, pts);
          return null;
        }
        if (frames.length === 0) this.say(SETUP_LINES.holdStill, 6000);
        if (r.stickers) {
          frames.push(r.stickers);
          poses.push(pts);
        }
        opts.progress?.(frames.length, framing, pts);
        return frames.length >= opts.holdFrames ? true : null;
      },
      actions: opts.actions,
      timeoutMs: opts.timeoutMs,
    });
    return { outcome, frames, poses, viewSeen, stillPx, size };
  }
}
