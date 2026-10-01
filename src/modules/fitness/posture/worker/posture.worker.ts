/// <reference lib="webworker" />
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { POSE_BUNDLE_URL, POSE_MODELS, POSE_WASM_BASE, type PoseModelName } from "../core/assets";
import { levelFrame, median, percentile, type Point } from "../core/geometry";
import {
  findVerticalLine,
  lineEvidence,
  marksAlong,
  refineLine,
  scaleFromMarks,
  subpixelCenter,
  type Rect,
} from "../core/plumb";
import { stickersIn, type View } from "../core/sticker-map";
import { assign, blobs, chromaOf, dedupe, DEFAULT_CLASSIFY, predict, type Blob, type ClassifyOptions } from "../core/stickers";
import { torsoLength, viewOf, type PosePoint } from "../core/views";
import type { Delegate, FromWorker, PhotoRequest, PlumbResult, PoseResult, StickerFrame, ToWorker, WorkerTask } from "./protocol";
import type { ModelTiming } from "../core/readout";
import { keepPhoto } from "./photo-writer";

/**
 * THE POSTURE WORKER (docs/modules/posture.md, "How a frame is read"; ADR 0118).
 *
 * Every camera frame of a posture check is read HERE, off the page's thread,
 * and goes nowhere else: each frame is closed as soon as it has been read, and
 * only numbers are posted back (`send` checks). The one exception is a photo
 * the person chose to keep: one frame per view, written by `photo-writer.ts`
 * straight into this phone's own storage for the site, never to the page.
 *
 * Per frame, depending on the task the page set:
 * - a small copy of the whole frame (960 px on its long side) for the pose
 *   model and the plumb line's first search;
 * - full-resolution strips along the plumb line, and full-resolution patches
 *   around each bone a sticker belongs on, for the fine work.
 *
 * MediaPipe is imported at run time from this site's own copy
 * (scripts/copy-pose-assets.ts), not bundled: it loads its WebAssembly with a
 * dynamic `import(url)` a bundler would rewrite.
 */

declare const self: DedicatedWorkerGlobalScope;

/**
 * A path on this site as a full address. The worker starts from a blob, to be
 * held to the page's lock (ADR 0122, client/frames.ts), and a path like
 * `/pose/…` means nothing against a blob's address; its origin is still this
 * site's.
 */
function onThisSite(path: string): string {
  return new URL(path, self.location.origin).href;
}

type Vision = typeof import("@mediapipe/tasks-vision");

const SMALL_LONG_SIDE = 960;

let visionLoad: Promise<{ vision: Vision; fileset: Awaited<ReturnType<Vision["FilesetResolver"]["forVisionTasks"]>> }> | null = null;
/** One promise per model and delegate, so a frame arriving mid-load waits for it rather than loading it twice. */
const landmarkers = new Map<string, Promise<PoseLandmarker>>();
let task: WorkerTask = { kind: "idle" };
let up: Point | null = null;
let classifyOpts: ClassifyOptions = DEFAULT_CLASSIFY;
let lastPoints: PosePoint[] | null = null;
/** The next frame is to be kept as a photo (the person chose to keep them). */
let pendingPhoto: PhotoRequest | null = null;
let busy = false;
let stopped = false;

// Scratch canvases, made once.
const small = new OffscreenCanvas(1, 1);
const smallCtx = small.getContext("2d", { willReadFrequently: true })!;
const patch = new OffscreenCanvas(1, 1);
const patchCtx = patch.getContext("2d", { willReadFrequently: true })!;

// The bench's state: one run at a time, its first frame (which loads the
// model) not counted.
let bench: {
  runs: { model: PoseModelName; delegate: Delegate }[];
  framesEach: number;
  index: number;
  warmed: boolean;
  times: number[];
  offs: number[];
  error: string | null;
  results: ModelTiming[];
} | null = null;

function hasBinary(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) return true;
  if (typeof ImageData !== "undefined" && value instanceof ImageData) return true;
  if (typeof VideoFrame !== "undefined" && value instanceof VideoFrame) return true;
  for (const v of Object.values(value)) if (hasBinary(v, depth + 1)) return true;
  return false;
}

/** The only way out of this worker: numbers and words, never pixels. */
function send(message: FromWorker): void {
  if (hasBinary(message)) throw new Error("posture worker: refused to post binary data");
  self.postMessage(message);
}

function fail(where: string, error: unknown): void {
  send({ type: "error", where, message: error instanceof Error ? error.message : String(error) });
}

/**
 * Whether this worker runs as a classic script. Next bundles it as one, even
 * when asked for a module worker, and MediaPipe loads its WebAssembly loader
 * with `importScripts` when it can: the module build of that loader uses
 * `import.meta` and fails there, the classic build works. `importScripts()`
 * with nothing to import does nothing in a classic worker and throws in a
 * module worker, so it tells them apart.
 */
function isClassicWorker(): boolean {
  try {
    importScripts();
    return true;
  } catch {
    return false;
  }
}

function loadVision() {
  visionLoad ??= (async () => {
    send({ type: "status", message: "Loading the pose model" });
    const vision = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ onThisSite(POSE_BUNDLE_URL))) as Vision;
    const fileset = await vision.FilesetResolver.forVisionTasks(onThisSite(POSE_WASM_BASE), !isClassicWorker());
    return { vision, fileset };
  })();
  // A failed load is forgotten, so the next ask tries again rather than
  // failing for ever on the first one's error.
  visionLoad.catch(() => {
    visionLoad = null;
  });
  return visionLoad;
}

function landmarker(model: PoseModelName, delegate: Delegate): Promise<PoseLandmarker> {
  const key = `${model}:${delegate}`;
  let made = landmarkers.get(key);
  if (!made) {
    made = loadVision().then(({ vision, fileset }) =>
      vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: onThisSite(POSE_MODELS[model].path), delegate },
        runningMode: "IMAGE",
        // Two, so a second person in the picture is noticed rather than measured.
        numPoses: 2,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    );
    // A failed load is forgotten, so the next ask tries again.
    made.catch(() => landmarkers.delete(key));
    landmarkers.set(key, made);
  }
  return made;
}

type Source = VideoFrame | ImageBitmap;

function sizeOf(source: Source): { width: number; height: number } {
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  return { width: (source as ImageBitmap).width, height: (source as ImageBitmap).height };
}

function drawSmall(source: Source, width: number, height: number): ImageData {
  const k = SMALL_LONG_SIDE / Math.max(width, height);
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  if (small.width !== w || small.height !== h) {
    small.width = w;
    small.height = h;
  }
  smallCtx.drawImage(source, 0, 0, w, h);
  return smallCtx.getImageData(0, 0, w, h);
}

function readPatch(source: Source, r: Rect): ImageData {
  if (patch.width !== r.width || patch.height !== r.height) {
    patch.width = r.width;
    patch.height = r.height;
  }
  patchCtx.clearRect(0, 0, r.width, r.height);
  patchCtx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  return patchCtx.getImageData(0, 0, r.width, r.height);
}

function clampRect(r: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(width, Math.ceil(r.x + r.width));
  const y2 = Math.min(height, Math.ceil(r.y + r.height));
  if (x2 - x < 4 || y2 - y < 4) return null;
  return { x, y, width: x2 - x, height: y2 - y };
}

/**
 * The mean colour of the picture's top band: wall, above the head of a person
 * framed with room to spare. Watched over the check, it says whether the
 * white balance and exposure locks held (a person walking in would move a
 * whole-picture mean for no fault of the camera's).
 */
function meanColour(img: ImageData): { luma: number; cb: number; cr: number } {
  const d = img.data;
  let y = 0;
  let cb = 0;
  let cr = 0;
  let n = 0;
  const end = Math.max(1, Math.floor(img.height * 0.06)) * img.width * 4;
  // Every 7th pixel is plenty for a mean.
  for (let i = 0; i < end; i += 28) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    y += 0.299 * r + 0.587 * g + 0.114 * b;
    cb += -0.168736 * r - 0.331264 * g + 0.5 * b;
    cr += 0.5 * r - 0.418688 * g - 0.081312 * b;
    n++;
  }
  return { luma: y / n, cb: cb / n, cr: cr / n };
}

function lumaOf(img: ImageData): Float32Array {
  const d = img.data;
  const out = new Float32Array(img.width * img.height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return out;
}

/** The person's box in small-picture pixels, padded, for the plumb search to leave out. */
function personBox(points: PosePoint[] | null, scale: number, w: number, h: number): Rect[] {
  if (!points) return [];
  const xs = points.filter((p) => p.visibility > 0.3).map((p) => p.x * scale);
  const ys = points.filter((p) => p.visibility > 0.3).map((p) => p.y * scale);
  if (xs.length === 0) return [];
  const padX = 0.25 * (Math.max(...xs) - Math.min(...xs)) + 10;
  const padY = 0.12 * (Math.max(...ys) - Math.min(...ys)) + 10;
  const r = clampRect(
    { x: Math.min(...xs) - padX, y: Math.min(...ys) - padY * 2, width: Math.max(...xs) - Math.min(...xs) + 2 * padX, height: Math.max(...ys) - Math.min(...ys) + 3 * padY },
    w,
    h,
  );
  return r ? [r] : [];
}

function findPlumb(source: Source, img: ImageData, width: number, height: number): PlumbResult {
  const none: PlumbResult = { found: false, a: null, b: null, rmsPx: null, coverage: null, polarity: null, pxPerMetre: null, marks: 0 };
  const scale = img.width / width;
  const luma = { data: lumaOf(img), width: img.width, height: img.height };
  const evidence = lineEvidence(luma, {
    half: 4,
    minContrast: 18,
    exclude: personBox(lastPoints, scale, img.width, img.height),
  });
  const coarse = findVerticalLine(evidence, { height: img.height, maxTiltDeg: 8, inlierPx: 2, minCoverage: 0.5 });
  if (!coarse) return none;
  // Back to full resolution: x = a·y + b scales as b/scale with the same a.
  const a = coarse.a;
  const b = coarse.b / scale;
  const polarity = coarse.polarity;
  const samples: { x: number; y: number }[] = [];
  const chroma: { t: number; chroma: number }[] = [];
  const segments = 24;
  const segH = Math.ceil(height / segments);
  const halfWidth = Math.max(8, Math.round(4 / scale));
  for (let s = 0; s < segments; s++) {
    const y0 = s * segH;
    const y1 = Math.min(height, y0 + segH);
    const xa = a * y0 + b;
    const xb = a * y1 + b;
    const strip = clampRect(
      { x: Math.min(xa, xb) - halfWidth, y: y0, width: Math.abs(xb - xa) + 2 * halfWidth + 1, height: y1 - y0 },
      width,
      height,
    );
    if (!strip) continue;
    const px = readPatch(source, strip);
    const rowStep = 2;
    for (let yy = 0; yy < strip.height; yy += rowStep) {
      const y = strip.y + yy;
      const cx = a * y + b - strip.x;
      const from = Math.max(0, Math.round(cx) - halfWidth);
      const to = Math.min(strip.width - 1, Math.round(cx) + halfWidth);
      const profile: number[] = [];
      for (let xx = from; xx <= to; xx++) {
        const o = (yy * strip.width + xx) * 4;
        profile.push(0.299 * px.data[o] + 0.587 * px.data[o + 1] + 0.114 * px.data[o + 2]);
      }
      const c = subpixelCenter(profile, polarity, { minContrast: 12, halfWindow: Math.max(2, Math.round(halfWidth / 3)) });
      if (c !== null) samples.push({ x: strip.x + from + c, y });
      // The colour right on the string, for the tape marks.
      const at = Math.round(cx);
      if (at >= 0 && at < strip.width) {
        const o = (yy * strip.width + at) * 4;
        chroma.push({ t: y * Math.hypot(a, 1), chroma: chromaOf(px.data[o], px.data[o + 1], px.data[o + 2]).chroma });
      }
    }
  }
  const fit = refineLine(samples);
  if (!fit) return none;
  const marks = marksAlong(chroma, { minChroma: 30, minRunPx: 6, maxGapPx: 6 });
  const scaled = scaleFromMarks(marks, { minApartPx: height * 0.1 });
  return {
    found: true,
    a: fit.a,
    b: fit.b,
    rmsPx: fit.rmsPx,
    coverage: coarse.coverage,
    polarity,
    pxPerMetre: scaled?.pxPerMetre ?? null,
    marks: marks.length,
  };
}

function toPoints(landmarks: { x: number; y: number; visibility?: number }[], width: number, height: number): PosePoint[] {
  return landmarks.map((l) => ({ x: l.x * width, y: l.y * height, visibility: l.visibility ?? 0 }));
}

/** The pose model on the small copy of the frame just drawn (`drawSmall`); points come back in full-frame pixels. */
async function runPose(model: PoseModelName, delegate: Delegate, width: number, height: number): Promise<PoseResult> {
  const lm = await landmarker(model, delegate);
  const result = lm.detect(small);
  const people = result.landmarks.length;
  if (people === 0) return { model, delegate, people: 0, points: null };
  // The biggest person is the one being measured.
  let best: PosePoint[] | null = null;
  let bestSize = -1;
  for (const person of result.landmarks) {
    const pts = toPoints(person, width, height);
    const size = torsoLength(pts);
    if (size > bestSize) {
      bestSize = size;
      best = pts;
    }
  }
  return { model, delegate, people, points: best };
}

function findStickers(source: Source, view: View, points: PosePoint[], width: number, height: number, diameterPx: number | null): StickerFrame {
  const frame = levelFrame(up ?? { x: 0, y: -1 });
  const guess = viewOf(points, frame);
  const predictions = predict(stickersIn(view), view, points, frame, guess.facing);
  const torso = torsoLength(points);
  // A sticker 19–25 mm across, on a torso about 480 mm long, when the plumb
  // line has not given a scale.
  const diameter = diameterPx ?? (torso > 0 ? (torso * 22) / 480 : 20);
  const found: Blob[] = [];
  for (const p of predictions) {
    const r = clampRect({ x: p.at.x - p.radius, y: p.at.y - p.radius, width: 2 * p.radius, height: 2 * p.radius }, width, height);
    if (!r) continue;
    const px = readPatch(source, r);
    found.push(
      ...blobs({ data: px.data, width: r.width, height: r.height }, { x: r.x, y: r.y }, {
        ...classifyOpts,
        diameterPx: diameter,
        sizeTolerance: 2.2,
        minFill: 0.55,
      }),
    );
  }
  const candidates = dedupe(found);
  const result = assign(predictions, candidates, view);
  return {
    view,
    found: result.found.map((f) => ({ id: f.sticker.id, blob: f.blob, distance: f.distance })),
    missing: result.missing.map((s) => s.id),
    expected: predictions.map((p) => ({ id: p.sticker.id, at: p.at, radius: p.radius })),
    swapped: result.swapped,
    candidates: candidates.length,
  };
}

function landmarkOffset(a: PosePoint[], b: PosePoint[]): number {
  const torso = torsoLength(a);
  if (!(torso > 0)) return Number.NaN;
  const d: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].visibility > 0.5 && b[i].visibility > 0.5) d.push(Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y) / torso);
  }
  return d.length > 0 ? d.reduce((s, v) => s + v, 0) / d.length : Number.NaN;
}

async function benchStep(width: number, height: number): Promise<void> {
  if (!bench) return;
  const run = bench.runs[bench.index];
  if (!run) return;
  try {
    const t0 = performance.now();
    const res = await runPose(run.model, run.delegate, width, height);
    const ms = performance.now() - t0;
    if (!bench.warmed) {
      // The first frame of a model also loads it: not a fair time.
      bench.warmed = true;
    } else {
      bench.times.push(ms);
      // The GPU's points against the CPU's on the same frame: on some phones'
      // graphics chips (the Galaxy S25's among them) the GPU path answers,
      // quickly and wrongly.
      if (run.delegate === "GPU" && res.points) {
        const cpu = await runPose(run.model, "CPU", width, height);
        if (cpu.points) bench.offs.push(landmarkOffset(cpu.points, res.points));
      }
    }
  } catch (error) {
    bench.error = error instanceof Error ? error.message : String(error);
  }
  if (bench.times.length >= bench.framesEach || bench.error) {
    bench.results.push({
      model: run.model,
      delegate: run.delegate,
      frames: bench.times.length,
      msP50: percentile(bench.times, 50),
      msP90: percentile(bench.times, 90),
      offFromCpu: bench.offs.length > 0 ? median(bench.offs) : undefined,
      error: bench.error ?? undefined,
    });
    bench.index++;
    bench.warmed = false;
    bench.times = [];
    bench.offs = [];
    bench.error = null;
    if (bench.index >= bench.runs.length) {
      const gpu = bench.results.filter((r) => r.delegate === "GPU");
      const verdict =
        gpu.length === 0
          ? "not tried"
          : gpu.some((r) => r.error)
            ? `fails: ${gpu.find((r) => r.error)!.error}`
            : gpu.some((r) => (r.offFromCpu ?? 0) > 0.05)
              ? "disagrees with the CPU: use the CPU"
              : "agrees with the CPU";
      send({ type: "bench", timings: bench.results, gpuVerdict: verdict });
      bench = null;
      task = { kind: "idle" };
    }
  }
}

/** Keep this frame as the photo asked for, and say so in numbers. */
async function photograph(source: Source, width: number, height: number, request: PhotoRequest): Promise<void> {
  try {
    const kept = await keepPhoto(source, width, height, request);
    send({ type: "photo", view: request.view, round: request.round, ok: true, ...kept, message: null });
  } catch (error) {
    send({
      type: "photo",
      view: request.view,
      round: request.round,
      ok: false,
      width: null,
      height: null,
      bytes: null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readFrame(source: Source, t: number): Promise<void> {
  const t0 = performance.now();
  const { width, height } = sizeOf(source);
  const rotation =
    typeof VideoFrame !== "undefined" && source instanceof VideoFrame
      ? ((source as VideoFrame & { rotation?: number }).rotation ?? null)
      : null;
  if (pendingPhoto) {
    const request = pendingPhoto;
    pendingPhoto = null;
    await photograph(source, width, height, request);
    if (task.kind === "idle") return;
  }
  const img = drawSmall(source, width, height);
  const colour = meanColour(img);
  const ms: { total: number; pose?: number; plumb?: number; stickers?: number } = { total: 0 };
  let plumb: PlumbResult | undefined;
  let pose: PoseResult | undefined;
  let stickers: StickerFrame | undefined;

  if (task.kind === "bench") {
    await benchStep(width, height);
    return;
  }
  if (task.kind === "plumb") {
    const p0 = performance.now();
    plumb = findPlumb(source, img, width, height);
    ms.plumb = performance.now() - p0;
  }
  if (task.kind === "pose" || task.kind === "stickers") {
    const p0 = performance.now();
    pose = await runPose(task.model, task.delegate, width, height);
    ms.pose = performance.now() - p0;
    lastPoints = pose.points;
    if (task.kind === "stickers" && pose.points && pose.people === 1) {
      const s0 = performance.now();
      stickers = findStickers(source, task.view, pose.points, width, height, task.diameterPx);
      ms.stickers = performance.now() - s0;
    }
  }
  ms.total = performance.now() - t0;
  send({ type: "frame", t, width, height, rotation, ms, plumb, pose, stickers, colour });
}

async function pump(readable: ReadableStream<VideoFrame>): Promise<void> {
  const reader = readable.getReader();
  while (!stopped) {
    const { value: frame, done } = await reader.read();
    if (done || !frame) break;
    if (busy || (task.kind === "idle" && !pendingPhoto)) {
      frame.close();
      continue;
    }
    busy = true;
    try {
      await readFrame(frame, frame.timestamp / 1000);
    } catch (error) {
      fail("frame", error);
    } finally {
      frame.close();
      busy = false;
    }
  }
  reader.releaseLock();
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "preload":
        // The 30 MB model downloads while the phone is still being set up.
        await landmarker(message.model, message.delegate);
        send({ type: "status", message: "Pose model ready" });
        break;
      case "stream":
        void pump(message.readable);
        break;
      case "bitmap": {
        const bitmap = message.bitmap;
        if (busy || (task.kind === "idle" && !pendingPhoto)) {
          bitmap.close();
          send({ type: "need" });
          break;
        }
        busy = true;
        try {
          await readFrame(bitmap, message.t);
        } finally {
          bitmap.close();
          busy = false;
          send({ type: "need" });
        }
        break;
      }
      case "task":
        task = message.task;
        up = message.up;
        if (message.classify) classifyOpts = message.classify;
        if (task.kind === "bench") {
          bench = { runs: task.runs, framesEach: task.framesEach, index: 0, warmed: false, times: [], offs: [], error: null, results: [] };
        }
        // A model is loaded as soon as it is asked for, not on the first frame.
        if (task.kind === "pose" || task.kind === "stickers") {
          await landmarker(task.model, task.delegate);
          send({ type: "status", message: "Pose model ready" });
        }
        break;
      case "photo":
        // Kept from the next frame read (`readFrame`), which is closed after
        // like every other.
        pendingPhoto = message.request;
        break;
      case "stop":
        stopped = true;
        pendingPhoto = null;
        for (const made of landmarkers.values()) void made.then((lm) => lm.close()).catch(() => undefined);
        landmarkers.clear();
        self.close();
        break;
    }
  } catch (error) {
    fail(message.type, error);
  }
};
