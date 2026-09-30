import { MEASURING_MODEL, type PoseModelName } from "../core/assets";
import { rankCameras } from "../core/camera";
import { levelFrame, median, rollOf, type Point } from "../core/geometry";
import { framingLine, missingLine, moveLine, SETUP_LINES, turnLine, allSetupLines } from "../core/lines";
import { upFromLine } from "../core/plumb";
import { emptyReadout, readoutText, type SetupReadout, type ViewReadout } from "../core/readout";
import { stickerById, stickersIn, VIEWS, type View } from "../core/sticker-map";
import { aggregate, type Assignment } from "../core/stickers";
import { framingOf, midpoint, stillness, torsoLength, towardPersonSide, viewOf, type PosePoint } from "../core/views";
import type { Delegate, FrameResult, FromWorker, StickerFrame, ToWorker, WorkerTask } from "../worker/protocol";
import {
  applyLocks,
  askForCamera,
  facingModeOpens,
  frameStats,
  listCameras,
  openCamera,
  settingsForReadout,
  stopStream,
} from "./camera";
import { readDeviceSettings, writeDeviceSettings } from "./device-settings";
import { feedWorker, startPostureWorker, type FramePath } from "./frames";
import { watchOrientation, type OrientationWatch } from "./orientation";
import { sayPosture, startPostureVoice, stopPostureVoice } from "./voice";

/**
 * THE SETUP CHECK, STEP BY STEP (docs/modules/posture.md, slice 1;
 * docs/help/fitness/posture-setup.md). Plain TypeScript so the screen only
 * draws: this opens the camera, runs the worker, listens to the sensors and
 * the voice, and reports each row's state through callbacks.
 *
 * The steps: the camera (the main lens, never the ultrawide), its locks, the
 * level, the plumb line, the person head to toe with their stickers from all
 * four sides, then the pose model's speed on this phone. Every step can be
 * skipped from the screen; everything found goes into the readout.
 */

export type RowKey = "camera" | "locks" | "level" | "plumb" | "person" | "stickers" | "model";
export type RowStatus = "waiting" | "working" | "ready" | "check" | "skipped";
export type RowState = { status: RowStatus; value: string };
export type SetupAction = { id: string; label: string };

export type SetupCallbacks = {
  row(key: RowKey, state: RowState): void;
  instruction(text: string): void;
  actions(actions: SetupAction[]): void;
  frame(result: FrameResult): void;
  hideCamera(hide: boolean): void;
  done(readout: string): void;
  failed(message: string): void;
  /** Something went wrong that the check carries on past (the worker's errors), for the screen to show. */
  warning(message: string | null): void;
};

type Outcome<T> = { kind: "value"; value: T } | { kind: "action"; id: string } | { kind: "timeout" };

const HOLD_FRAMES = 10;
const VIEW_TIMEOUT_MS = 75_000;
const STILL_INDICES = [11, 12, 23, 24, 25, 26, 27, 28];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmt(n: number, places = 1): string {
  return Number.isFinite(n) ? n.toFixed(places) : "–";
}

export class SetupSession {
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private feed: { path: FramePath; stop: () => void } | null = null;
  private orientation: OrientationWatch | null = null;
  private frameListeners = new Set<(r: FrameResult) => void>();
  private benchListener: ((m: Extract<FromWorker, { type: "bench" }>) => void) | null = null;
  private actionWaiter: ((id: string) => void) | null = null;
  private closed = false;
  private up: Point | null = null;
  private pxPerMetre: number | null = null;
  private delegate: Delegate;
  private colours: { at: number; luma: number; cb: number; cr: number }[] = [];
  private personSeen = false;
  private workerError: string | null = null;
  private stickerTally: Partial<Record<View, string>> = {};
  private stickerAllFound: Partial<Record<View, boolean>> = {};
  readonly readout: SetupReadout;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly cb: SetupCallbacks,
    private readonly naturalVoice: boolean,
    /** A picture or film standing in for the camera (development only). */
    private readonly testSource: MediaStream | null = null,
  ) {
    const nav = navigator as Navigator & { deviceMemory?: number };
    this.readout = emptyReadout(new Date(), {
      userAgent: navigator.userAgent.slice(0, 280),
      screen: `${window.screen.width}x${window.screen.height}`,
      pixelRatio: window.devicePixelRatio || 1,
      cores: navigator.hardwareConcurrency ?? null,
      memoryGb: nav.deviceMemory ?? null,
    });
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
    this.feed?.stop();
    if (this.worker) {
      this.post({ type: "stop" });
      this.worker.terminate();
    }
    this.orientation?.stop();
    stopStream(this.stream);
    this.video.srcObject = null;
    stopPostureVoice();
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  private setTask(task: WorkerTask): void {
    this.post({ type: "task", task, up: this.up });
  }

  /** A line for the readout: short, and at most twenty of them. */
  private note(text: string): void {
    if (this.readout.notes.length < 20) this.readout.notes.push(text.slice(0, 280));
  }

  private say(text: string, repeatAfterMs?: number): void {
    sayPosture(text, { repeatAfterMs });
  }

  /** Wait for a frame to satisfy `check`, a button, a poll, or the time to run out. */
  private wait<T>(opts: {
    check?: (r: FrameResult) => T | null;
    poll?: () => T | null;
    actions?: SetupAction[];
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
    } else if (m.type === "bench") {
      this.benchListener?.(m);
    } else if (m.type === "error") {
      this.workerError = `${m.where}: ${m.message}`;
      this.note(`worker ${this.workerError}`);
      this.cb.warning(
        m.where === "preload" || m.where === "task"
          ? `The pose model could not start on this phone: ${m.message}`
          : `Reading a picture went wrong: ${m.message}`,
      );
    }
  };

  async run(): Promise<void> {
    try {
      startPostureVoice(this.naturalVoice, allSetupLines());
      await this.cameraStep();
      if (this.closed) return;
      await this.locksStep();
      if (this.closed) return;
      await this.levelStep();
      if (this.closed) return;
      await this.plumbStep();
      for (const view of VIEWS) {
        if (this.closed) return;
        await this.viewStep(view);
      }
      if (this.closed) return;
      await this.benchStep();
      if (this.closed) return;
      this.finish();
    } catch (error) {
      if (this.closed) return;
      const message = error instanceof Error ? error.message : String(error);
      this.note(`failed: ${message}`);
      this.cb.failed(message);
    }
  }

  /* ---- the camera ------------------------------------------------------ */

  private async cameraStep(): Promise<void> {
    this.cb.row("camera", { status: "working", value: "Finding the main lens" });
    this.cb.instruction("Allow the camera when your phone asks.");
    let chosenLabel = "test picture";
    if (this.testSource) {
      this.stream = this.testSource;
      this.readout.camera = {
        list: [],
        chosen: "test source",
        why: ["development test source"],
        facingModeOpens: null,
        settings: {},
        locks: { whiteBalance: "not a camera", focus: "not a camera", exposure: "not a camera" },
        colourDrift: null,
        frames: { delivered: null, discarded: null, path: "" },
      };
    } else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use the camera.");
      await askForCamera();
      const cameras = await listCameras();
      const opens = await facingModeOpens(cameras);
      const ranked = rankCameras(cameras);
      const saved = readDeviceSettings();
      const chosen = ranked.find((c) => c.deviceId === saved.cameraId) ?? ranked[0];
      if (!chosen) throw new Error("No camera that faces away from the screen was found.");
      this.stream = await openCamera(chosen.deviceId);
      chosenLabel = chosen.label || "the back camera";
      writeDeviceSettings({ cameraId: chosen.deviceId, cameraLabel: chosen.label });
      this.readout.camera = {
        list: cameras.map((c) => ({
          label: c.label.slice(0, 80),
          facing: c.facing,
          index: c.index,
          max: `${c.maxWidth}x${c.maxHeight}`,
          torch: c.torch,
          zoomMax: c.zoomMax,
        })),
        chosen: chosen.label.slice(0, 80),
        why: chosen.why,
        facingModeOpens: opens,
        settings: {},
        locks: { whiteBalance: "not tried", focus: "not tried", exposure: "not tried" },
        colourDrift: null,
        frames: { delivered: null, discarded: null, path: "" },
      };
    }
    this.track = this.stream.getVideoTracks()[0] ?? null;
    if (!this.track) throw new Error("The camera gave no picture.");
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play().catch(() => undefined);
    const settings = settingsForReadout(this.track);
    this.readout.camera!.settings = settings;
    const w = Number(settings.width ?? this.video.videoWidth);
    const h = Number(settings.height ?? this.video.videoHeight);
    if (w > h) this.note("the picture is wider than tall: the phone is on its side, or this is not a phone");

    this.worker = startPostureWorker();
    this.worker.addEventListener("message", this.onWorker);
    this.worker.addEventListener("error", (e) => {
      this.workerError = e.message || "the worker stopped";
      this.note(`worker failed to start: ${this.workerError}`);
      this.cb.warning(`The part of the check that reads the pictures stopped: ${this.workerError}`);
    });
    this.feed = feedWorker(this.worker, { track: this.track, video: this.video });
    this.readout.camera!.frames.path = this.feed.path;
    // The heavy model is 30 MB: it downloads while the phone is being set up.
    this.post({ type: "preload", model: MEASURING_MODEL, delegate: this.delegate });
    this.cb.row("camera", { status: "ready", value: `${chosenLabel} · ${w} × ${h}` });
  }

  private async locksStep(): Promise<void> {
    this.cb.row("locks", { status: "working", value: "Letting the color settle" });
    this.cb.instruction("Point the phone at your foot outline. Hold on while the color settles.");
    // Colour and brightness settle on their own first, then are held.
    this.setTask({ kind: "plumb" });
    await sleep(2500);
    if (this.closed || !this.track || this.testSource) {
      this.cb.row("locks", { status: "skipped", value: "Not a camera" });
      return;
    }
    const locks = await applyLocks(this.track);
    // Colour drift is measured from the moment the locks are on.
    this.colours = [];
    this.readout.camera!.locks = locks;
    this.readout.camera!.settings = settingsForReadout(this.track);
    const held = [locks.whiteBalance === "locked" ? "color" : null, locks.focus === "locked" ? "focus" : null, locks.exposure === "locked" ? "brightness" : null].filter(Boolean);
    this.cb.row("locks", {
      status: held.length >= 2 ? "ready" : "check",
      value: held.length > 0 ? `Locked: ${held.join(", ")}` : "This camera would not lock",
    });
  }

  /* ---- the level --------------------------------------------------------- */

  private async levelStep(): Promise<void> {
    this.cb.row("level", { status: "working", value: "Reading the tilt" });
    this.orientation = watchOrientation();
    const offset = readDeviceSettings().sensorRollOffset ?? 0;
    const shown = () => {
      const a = this.orientation?.latest();
      if (!a) return null;
      return { roll: a.roll - offset, pitch: a.pitch };
    };
    this.cb.instruction("Turn the phone on its tripod until it reads level: under a degree each way.");
    let steadySince = 0;
    const outcome = await this.wait({
      poll: () => {
        const a = shown();
        if (!a) return null;
        const ok = Math.abs(a.roll) <= 1 && Math.abs(a.pitch) <= 2;
        this.cb.row("level", { status: ok ? "ready" : "working", value: `Roll ${fmt(a.roll)}° · tilt ${fmt(a.pitch)}°` });
        if (!ok) {
          steadySince = 0;
          return null;
        }
        steadySince ||= performance.now();
        return performance.now() - steadySince >= 1500 ? a : null;
      },
      actions: [{ id: "continue", label: "Continue anyway" }],
      timeoutMs: 120_000,
    });
    const a = shown();
    this.readout.level = {
      sensor: this.orientation.kind,
      rateHz: this.orientation.rateHz(),
      roll: a?.roll ?? null,
      pitch: a?.pitch ?? null,
      rollSpread: this.orientation.rollSpread(),
      offsetFromPlumb: null,
    };
    if (!a) {
      this.cb.row("level", { status: "check", value: "This phone reports no tilt" });
    } else if (outcome.kind !== "value") {
      this.cb.row("level", { status: "check", value: `Roll ${fmt(a.roll)}° · tilt ${fmt(a.pitch)}°` });
    }
    // Until the plumb line says better, the sensor's up (less its known offset).
    const att = this.orientation.latest();
    if (att) {
      const r = ((att.roll - offset) * Math.PI) / 180;
      this.up = { x: Math.sin(r), y: -Math.cos(r) };
    }
  }

  /* ---- the plumb line ---------------------------------------------------- */

  private async plumbStep(): Promise<void> {
    this.cb.row("plumb", { status: "working", value: "Looking for it" });
    this.cb.instruction("Hang the plumb line beside your foot outline, in the picture from top to bottom.");
    this.setTask({ kind: "plumb" });
    const recent: { roll: number; pxPerMetre: number | null; rms: number; coverage: number; marks: number }[] = [];
    const outcome = await this.wait({
      check: (r) => {
        const p = r.plumb;
        if (!p?.found || p.a === null) {
          recent.length = 0;
          this.cb.row("plumb", { status: "working", value: "Looking for it" });
          return null;
        }
        const roll = rollOf(levelFrame(upFromLine({ a: p.a, b: p.b ?? 0 })));
        recent.push({ roll, pxPerMetre: p.pxPerMetre, rms: p.rmsPx ?? Number.NaN, coverage: p.coverage ?? 0, marks: p.marks });
        if (recent.length > 8) recent.shift();
        this.cb.row("plumb", {
          status: "working",
          value: p.pxPerMetre ? `Found · 1 m = ${Math.round(p.pxPerMetre)} px` : "Found · no meter marks yet",
        });
        const rolls = recent.map((x) => x.roll);
        return recent.length >= 5 && Math.max(...rolls) - Math.min(...rolls) <= 0.15 ? true : null;
      },
      actions: [{ id: "skip", label: "Skip the plumb line" }],
      timeoutMs: 90_000,
    });
    if (outcome.kind !== "value" || recent.length === 0) {
      this.readout.plumb = { found: false, roll: null, rmsPx: null, coverage: null, pxPerMetre: null, marks: 0 };
      this.cb.row("plumb", { status: outcome.kind === "action" ? "skipped" : "check", value: "Not found: the phone's sensor stands in" });
      return;
    }
    const roll = median(recent.map((x) => x.roll));
    const scales = recent.map((x) => x.pxPerMetre).filter((x): x is number => x !== null);
    this.pxPerMetre = scales.length >= 3 ? median(scales) : null;
    const r = (roll * Math.PI) / 180;
    this.up = { x: Math.sin(r), y: -Math.cos(r) };
    this.readout.plumb = {
      found: true,
      roll,
      rmsPx: median(recent.map((x) => x.rms)),
      coverage: median(recent.map((x) => x.coverage)),
      pxPerMetre: this.pxPerMetre,
      marks: Math.max(...recent.map((x) => x.marks)),
    };
    // The sensor's own error against true vertical, kept for next time.
    const sensor = this.orientation?.latest();
    if (sensor && this.readout.level) {
      const offset = sensor.roll - roll;
      this.readout.level.offsetFromPlumb = offset;
      writeDeviceSettings({ sensorRollOffset: offset });
    }
    this.cb.row("plumb", {
      status: this.pxPerMetre ? "ready" : "check",
      value: this.pxPerMetre
        ? `Found · picture turned ${fmt(roll, 2)}° · 1 m = ${Math.round(this.pxPerMetre)} px`
        : `Found · picture turned ${fmt(roll, 2)}° · no meter marks`,
    });
  }

  /* ---- the person, from four sides ---------------------------------------- */

  /** Each side's result so far, and the side being read now, on the Stickers row. */
  private showStickerTally(working: string | null): void {
    const parts = VIEWS.map((v) => this.stickerTally[v]).filter((p): p is string => !!p);
    if (working) parts.push(working);
    const done = VIEWS.every((v) => this.stickerTally[v] !== undefined);
    const allFound = VIEWS.every((v) => this.stickerAllFound[v] === true);
    this.cb.row("stickers", {
      status: working || !done ? "working" : allFound ? "ready" : "check",
      value: parts.join(" · ") || "Waiting",
    });
  }

  private async viewStep(view: View): Promise<void> {
    const expected = stickersIn(view);
    const label = { front: "Front", right: "Right side", back: "Back", left: "Left side" }[view];
    this.cb.row("person", { status: "working", value: "Waiting for you" });
    this.showStickerTally(`${label}: waiting`);
    const first = view === VIEWS[0];
    const cue = first ? SETUP_LINES.walkIn : turnLine(view);
    this.say(cue, 0);
    this.cb.instruction(cue);
    const diameterPx = this.pxPerMetre ? (this.pxPerMetre * 22) / 1000 : null;
    this.setTask({ kind: "stickers", view, model: MEASURING_MODEL, delegate: this.delegate, diameterPx });
    const frames: StickerFrame[] = [];
    const history: PosePoint[][] = [];
    let viewSeen: View | null = null;
    let stillPx = Number.NaN;
    let saidHold = false;
    const outcome = await this.wait({
      check: (r) => {
        const pose = r.pose;
        if (!pose || pose.people === 0 || !pose.points) {
          frames.length = 0;
          if (this.personSeen) this.say(SETUP_LINES.lostYou, 8000);
          return null;
        }
        if (pose.people > 1) {
          frames.length = 0;
          this.say(SETUP_LINES.twoPeople, 8000);
          return null;
        }
        const pts = pose.points;
        const size = { width: r.width, height: r.height };
        const framing = framingOf(pts, size, { margin: 0.03, minFill: 0.3, maxFill: 0.88 });
        const frame = levelFrame(this.up ?? { x: 0, y: -1 });
        const guess = viewOf(pts, frame);
        viewSeen = guess.view;
        this.cb.row("person", { status: framing.whole ? "ready" : "working", value: `Fills ${Math.round(framing.fill * 100)}% of the picture` });
        if (framing.advice) {
          frames.length = 0;
          const words =
            framing.advice === "move-picture-left" || framing.advice === "move-picture-right"
              ? moveLine(towardPersonSide(framing.advice === "move-picture-left" ? "picture-left" : "picture-right", view))
              : framingLine(framing.advice);
          if (words) this.say(words, 4000);
          return null;
        }
        if (guess.view && guess.view !== view && guess.confidence >= 0.6) {
          frames.length = 0;
          this.say(SETUP_LINES.wrongWay, 6000);
          return null;
        }
        history.push(pts);
        if (history.length > 5) history.shift();
        const torso = torsoLength(pts);
        stillPx = stillness(history, STILL_INDICES);
        if (history.length < 3 || !(stillPx <= 0.012 * torso)) {
          frames.length = 0;
          if (!saidHold && history.length >= 3) {
            saidHold = true;
            this.say(SETUP_LINES.holdStill, 0);
          }
          return null;
        }
        if (frames.length === 0) this.say(SETUP_LINES.holdStill, 6000);
        if (r.stickers) frames.push(r.stickers);
        this.showStickerTally(`${label}: reading ${frames.length} of ${HOLD_FRAMES}`);
        if (!this.readout.person && this.pxPerMetre) {
          const nose = pts[0];
          const shoulders = midpoint(pts[11], pts[12]);
          const top = nose.y - Math.max(0, shoulders.y - nose.y);
          const bottom = Math.max(pts[29].y, pts[30].y, pts[31].y, pts[32].y);
          this.readout.person = { fill: framing.fill, heightFromScale: (bottom - top) / this.pxPerMetre };
        }
        return frames.length >= HOLD_FRAMES ? true : null;
      },
      actions: [{ id: "skip", label: `Skip the ${label.toLowerCase()}` }],
      timeoutMs: VIEW_TIMEOUT_MS,
    });
    if (this.closed) return;

    const assignments: Assignment[] = frames.map((f) => ({
      found: f.found
        .map((x) => ({ sticker: stickerById(x.id)!, blob: x.blob, distance: x.distance }))
        .filter((x) => x.sticker),
      missing: f.missing.map((id) => stickerById(id)!).filter(Boolean),
      swapped: f.swapped,
    }));
    const summary = aggregate(expected, assignments);
    const missing = summary.filter((s) => s.seenIn < Math.max(1, frames.length / 2)).map((s) => s.id);
    const result: ViewReadout = {
      view,
      framesLooked: frames.length,
      viewSeen,
      stillPx,
      stickers: summary,
      missing,
      unsearched: expected.filter((s) => !frames.some((f) => f.expected.some((e) => e.id === s.id))).map((s) => s.id),
      lookedFor: missing.flatMap((id) => {
        const looks = frames.flatMap((f) => f.expected.filter((e) => e.id === id));
        if (looks.length === 0) return [];
        return [
          {
            id,
            x: median(looks.map((l) => l.at.x)),
            y: median(looks.map((l) => l.at.y)),
            radius: median(looks.map((l) => l.radius)),
          },
        ];
      }),
      swapped: frames.some((f) => f.swapped),
    };
    this.readout.views.push(result);
    const foundCount = expected.length - missing.length;
    const short = { front: "Front", right: "Right", back: "Back", left: "Left" }[view];
    if (outcome.kind !== "value") {
      this.stickerTally[view] = outcome.kind === "action" ? `${short} skipped` : `${short} no steady picture`;
      this.showStickerTally(null);
      if (!this.readout.person) this.cb.row("person", { status: "check", value: "Not seen head to toe" });
      return;
    }
    this.stickerTally[view] = `${short} ${foundCount} of ${expected.length}`;
    this.stickerAllFound[view] = missing.length === 0;
    this.showStickerTally(null);
    if (missing.length === 0) {
      this.say(SETUP_LINES.allStickers, 0);
    } else {
      for (const id of missing.slice(0, 3)) {
        const sticker = stickerById(id);
        if (sticker) this.say(missingLine(sticker), 0);
      }
    }
    this.say(SETUP_LINES.viewDone, 0);
    await sleep(1500);
  }

  /* ---- the pose model's speed ------------------------------------------- */

  private async benchStep(): Promise<void> {
    this.cb.row("model", { status: "working", value: "Timing it" });
    this.say(SETUP_LINES.timing, 0);
    this.cb.instruction(SETUP_LINES.timing);
    const runs: { model: PoseModelName; delegate: Delegate }[] = [
      { model: "heavy", delegate: "CPU" },
      { model: "full", delegate: "CPU" },
      { model: "lite", delegate: "CPU" },
      { model: "heavy", delegate: "GPU" },
    ];
    const result = await new Promise<Extract<FromWorker, { type: "bench" }> | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 120_000);
      this.benchListener = (m) => {
        window.clearTimeout(timer);
        resolve(m);
      };
      this.setTask({ kind: "bench", runs, framesEach: 6 });
      this.actionWaiter = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      this.cb.actions([{ id: "skip", label: "Skip the timing" }]);
    });
    this.benchListener = null;
    this.cb.actions([]);
    if (!result) {
      this.readout.model = { chosen: `${MEASURING_MODEL}/${this.delegate}`, timings: [], gpuVerdict: null };
      this.cb.row("model", { status: "skipped", value: "Not timed" });
      return;
    }
    const heavyCpu = result.timings.find((t) => t.model === "heavy" && t.delegate === "CPU");
    const gpuAgrees = result.gpuVerdict === "agrees with the CPU";
    const gpu = result.timings.find((t) => t.model === "heavy" && t.delegate === "GPU");
    // The GPU only once it has been checked against the CPU on this phone, and only if faster.
    this.delegate = gpuAgrees && gpu && heavyCpu && gpu.msP50 < heavyCpu.msP50 ? "GPU" : "CPU";
    writeDeviceSettings({ delegate: this.delegate });
    this.readout.model = { chosen: `${MEASURING_MODEL}/${this.delegate}`, timings: result.timings, gpuVerdict: result.gpuVerdict };
    const chosen = this.delegate === "GPU" ? gpu : heavyCpu;
    this.cb.row("model", {
      status: chosen && Number.isFinite(chosen.msP50) ? "ready" : "check",
      value: chosen ? `${fmt(chosen.msP50 / 1000, 2)} s a frame on the ${this.delegate === "GPU" ? "graphics chip" : "processor"}` : "Could not be timed",
    });
  }

  private finish(): void {
    this.setTask({ kind: "idle" });
    if (this.track && this.readout.camera) {
      const stats = frameStats(this.track);
      this.readout.camera.frames.delivered = stats.delivered;
      this.readout.camera.frames.discarded = stats.discarded;
      const first = this.colours[0];
      const last = this.colours[this.colours.length - 1];
      if (first && last && last !== first) {
        this.readout.camera.colourDrift = {
          cb: last.cb - first.cb,
          cr: last.cr - first.cr,
          luma: last.luma - first.luma,
          seconds: (last.at - first.at) / 1000,
        };
      }
    }
    if (this.workerError) this.note(`last worker error: ${this.workerError}`);
    this.say(SETUP_LINES.done, 0);
    const text = readoutText(this.readout);
    writeDeviceSettings({ lastReadout: text, lastReadoutAt: new Date().toISOString() });
    this.cb.instruction("Done. Copy the readout and send it over, then come back for the check itself.");
    this.cb.done(text);
  }
}
