import { MEASURING_MODEL, type PoseModelName } from "../core/assets";
import { median } from "../core/geometry";
import { missingLine, SETUP_LINES, turnLine, allSetupLines } from "../core/lines";
import { emptyReadout, readoutText, type SetupReadout, type ViewReadout } from "../core/readout";
import { stickerById, stickersIn, VIEWS, type View } from "../core/sticker-map";
import { aggregate, type Assignment } from "../core/stickers";
import { midpoint } from "../core/views";
import type { Delegate, FromWorker } from "../worker/protocol";
import { frameStats, settingsForReadout } from "./camera";
import { CaptureBase, sleep, type CaptureAction, type CaptureCallbacks } from "./capture-base";
import { writeDeviceSettings } from "./device-settings";
import { startPostureVoice } from "./voice";

/**
 * THE SETUP CHECK, STEP BY STEP (docs/modules/posture.md, slice 1;
 * docs/help/fitness/posture-setup.md). Plain TypeScript so the screen only
 * draws: the camera, the worker, the sensors and the voice are the shared
 * machinery (`capture-base.ts`); this reports each row's state through
 * callbacks and writes the readout.
 *
 * The steps: the camera (the main lens, never the ultrawide), its locks, the
 * level, the plumb line, the person head to toe with their stickers from all
 * four sides, then the pose model's speed on this phone. Every step can be
 * skipped from the screen; everything found goes into the readout.
 */

export type RowKey = "camera" | "locks" | "level" | "plumb" | "person" | "stickers" | "model";
export type RowStatus = "waiting" | "working" | "ready" | "check" | "skipped";
export type RowState = { status: RowStatus; value: string };
export type SetupAction = CaptureAction;

export type SetupCallbacks = CaptureCallbacks & {
  row(key: RowKey, state: RowState): void;
  done(readout: string): void;
  failed(message: string): void;
};

const HOLD_FRAMES = 10;
const VIEW_TIMEOUT_MS = 75_000;

function fmt(n: number, places = 1): string {
  return Number.isFinite(n) ? n.toFixed(places) : "–";
}

export class SetupSession extends CaptureBase<SetupCallbacks> {
  private benchListener: ((m: Extract<FromWorker, { type: "bench" }>) => void) | null = null;
  private stickerTally: Partial<Record<View, string>> = {};
  private stickerAllFound: Partial<Record<View, boolean>> = {};
  readonly readout: SetupReadout;

  constructor(video: HTMLVideoElement, cb: SetupCallbacks, naturalVoice: boolean, testSource: MediaStream | null = null) {
    super(video, cb, naturalVoice, testSource);
    const nav = navigator as Navigator & { deviceMemory?: number };
    this.readout = emptyReadout(new Date(), {
      userAgent: navigator.userAgent.slice(0, 280),
      screen: `${window.screen.width}x${window.screen.height}`,
      pixelRatio: window.devicePixelRatio || 1,
      cores: navigator.hardwareConcurrency ?? null,
      memoryGb: nav.deviceMemory ?? null,
    });
  }

  /** A line for the readout: short, and at most twenty of them. */
  protected override note(text: string): void {
    if (this.readout.notes.length < 20) this.readout.notes.push(text.slice(0, 280));
  }

  protected override onMessage(m: FromWorker): void {
    if (m.type === "bench") this.benchListener?.(m);
  }

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
    const opened = await this.openMainLens(true);
    if (this.testSource) {
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
      this.readout.camera = {
        list: opened.cameras.map((c) => ({
          label: c.label.slice(0, 80),
          facing: c.facing,
          index: c.index,
          max: `${c.maxWidth}x${c.maxHeight}`,
          torch: c.torch,
          zoomMax: c.zoomMax,
        })),
        chosen: (opened.chosen?.label ?? opened.label).slice(0, 80),
        why: opened.chosen?.why ?? [],
        facingModeOpens: opened.facingModeOpens,
        settings: {},
        locks: { whiteBalance: "not tried", focus: "not tried", exposure: "not tried" },
        colourDrift: null,
        frames: { delivered: null, discarded: null, path: "" },
      };
    }
    const pipeline = await this.startPipeline();
    const settings = settingsForReadout(this.track!);
    this.readout.camera!.settings = settings;
    const w = Number(settings.width ?? pipeline.width);
    const h = Number(settings.height ?? pipeline.height);
    if (w > h) this.note("the picture is wider than tall: the phone is on its side, or this is not a phone");
    this.readout.camera!.frames.path = pipeline.path;
    this.cb.row("camera", { status: "ready", value: `${opened.label} · ${w} × ${h}` });
  }

  private async locksStep(): Promise<void> {
    this.cb.row("locks", { status: "working", value: "Letting the color settle" });
    this.cb.instruction("Point the phone at your foot outline. Hold on while the color settles.");
    const locks = await this.settleAndLock();
    if (!locks || !this.track) {
      this.cb.row("locks", { status: "skipped", value: "Not a camera" });
      return;
    }
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
    this.startLevel();
    const orientation = this.orientation!;
    this.cb.instruction("Turn the phone on its tripod until it reads level: under a degree each way.");
    let steadySince = 0;
    const outcome = await this.wait({
      poll: () => {
        const a = this.sensorAttitude();
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
    const a = this.sensorAttitude();
    this.readout.level = {
      sensor: orientation.kind,
      rateHz: orientation.rateHz(),
      roll: a?.roll ?? null,
      pitch: a?.pitch ?? null,
      rollSpread: orientation.rollSpread(),
      offsetFromPlumb: null,
    };
    if (!a) {
      this.cb.row("level", { status: "check", value: "This phone reports no tilt" });
    } else if (outcome.kind !== "value") {
      this.cb.row("level", { status: "check", value: `Roll ${fmt(a.roll)}° · tilt ${fmt(a.pitch)}°` });
    }
    // Until the plumb line says better, the sensor's up (less its known offset).
    this.useSensorUp();
  }

  /* ---- the plumb line ---------------------------------------------------- */

  private async plumbStep(): Promise<void> {
    this.cb.row("plumb", { status: "working", value: "Looking for it" });
    this.cb.instruction("Hang the plumb line beside your foot outline, in the picture from top to bottom.");
    const { outcome, found } = await this.findPlumb({
      actions: [{ id: "skip", label: "Skip the plumb line" }],
      timeoutMs: 90_000,
      progress: (seen, pxPerMetre) =>
        this.cb.row("plumb", {
          status: "working",
          value: !seen ? "Looking for it" : pxPerMetre ? `Found · 1 m = ${Math.round(pxPerMetre)} px` : "Found · no meter marks yet",
        }),
    });
    if (!found) {
      this.readout.plumb = { found: false, roll: null, rmsPx: null, coverage: null, pxPerMetre: null, marks: 0 };
      this.cb.row("plumb", { status: outcome.kind === "action" ? "skipped" : "check", value: "Not found: the phone's sensor stands in" });
      return;
    }
    this.readout.plumb = {
      found: true,
      roll: found.roll,
      rmsPx: found.rmsPx,
      coverage: found.coverage,
      pxPerMetre: found.pxPerMetre,
      marks: found.marks,
    };
    if (found.sensorOffset !== null && this.readout.level) this.readout.level.offsetFromPlumb = found.sensorOffset;
    this.cb.row("plumb", {
      status: found.pxPerMetre ? "ready" : "check",
      value: found.pxPerMetre
        ? `Found · picture turned ${fmt(found.roll, 2)}° · 1 m = ${Math.round(found.pxPerMetre)} px`
        : `Found · picture turned ${fmt(found.roll, 2)}° · no meter marks`,
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
    const { outcome, frames, viewSeen, stillPx } = await this.holdView(view, {
      holdFrames: HOLD_FRAMES,
      timeoutMs: VIEW_TIMEOUT_MS,
      actions: [{ id: "skip", label: `Skip the ${label.toLowerCase()}` }],
      progress: (read, framing, pts) => {
        this.cb.row("person", { status: framing.whole ? "ready" : "working", value: `Fills ${Math.round(framing.fill * 100)}% of the picture` });
        if (read === 0) return;
        this.showStickerTally(`${label}: reading ${read} of ${HOLD_FRAMES}`);
        if (!this.readout.person && this.pxPerMetre) {
          const nose = pts[0];
          const shoulders = midpoint(pts[11], pts[12]);
          const top = nose.y - Math.max(0, shoulders.y - nose.y);
          const bottom = Math.max(pts[29].y, pts[30].y, pts[31].y, pts[32].y);
          this.readout.person = { fill: framing.fill, heightFromScale: (bottom - top) / this.pxPerMetre };
        }
      },
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
    // Nothing more to look at: the camera goes off now, not when the screen is left.
    this.cb.hideCamera(true);
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
    this.releaseCamera();
    this.cb.done(text);
  }
}
