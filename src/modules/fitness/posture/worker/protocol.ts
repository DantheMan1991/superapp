import type { PoseModelName } from "../core/assets";
import type { Point } from "../core/geometry";
import type { ModelTiming } from "../core/readout";
import type { View } from "../core/sticker-map";
import type { Blob, ClassifyOptions } from "../core/stickers";
import type { PosePoint } from "../core/views";

/**
 * WHAT THE PAGE AND THE POSTURE WORKER SAY TO EACH OTHER (ADR 0118).
 *
 * Frames go IN (a stream of `VideoFrame`s, or `ImageBitmap`s one at a time)
 * and only NUMBERS come out: points, angles, blob centres, milliseconds. The
 * worker's `send` refuses a message carrying anything binary, so no later
 * change can post a picture back to the page, let alone past it.
 */

export type Delegate = "CPU" | "GPU";

export type WorkerTask =
  | { kind: "idle" }
  | { kind: "plumb" }
  | { kind: "pose"; model: PoseModelName; delegate: Delegate }
  | { kind: "stickers"; view: View; model: PoseModelName; delegate: Delegate; diameterPx: number | null }
  | { kind: "bench"; runs: { model: PoseModelName; delegate: Delegate }[]; framesEach: number };

/**
 * Keep the next frame as a photo, on this phone (ADR 0118): only when the
 * person turned "Keep a photo of each view on this phone" on. The worker makes
 * it a JPEG and writes it to the phone's own storage itself
 * (`photo-writer.ts`); the page is told only that it was kept, and its size.
 */
export type PhotoRequest = { checkId: string; view: View; round: number; longSide: number; quality: number };

export type ToWorker =
  | { type: "preload"; model: PoseModelName; delegate: Delegate }
  | { type: "stream"; readable: ReadableStream<VideoFrame> }
  | { type: "bitmap"; bitmap: ImageBitmap; t: number }
  | { type: "task"; task: WorkerTask; up: Point | null; classify?: ClassifyOptions }
  | { type: "photo"; request: PhotoRequest }
  | { type: "stop" };

export type PlumbResult = {
  found: boolean;
  /** The line x = a·y + b in frame pixels, when found. */
  a: number | null;
  b: number | null;
  rmsPx: number | null;
  coverage: number | null;
  polarity: 1 | -1 | null;
  /** Pixels per metre from the tape marks, when two were seen. */
  pxPerMetre: number | null;
  marks: number;
};

export type PoseResult = {
  model: PoseModelName;
  delegate: Delegate;
  /** People the model saw (it looks for two, to notice a second). */
  people: number;
  /** The biggest person's 33 points, in frame pixels. */
  points: PosePoint[] | null;
};

export type StickerFrame = {
  view: View;
  found: { id: string; blob: Blob; distance: number }[];
  missing: string[];
  /** Where each sticker of the view was looked for, so the screen can show where one is missing. */
  expected: { id: string; at: Point; radius: number }[];
  swapped: boolean;
  /** Every coloured blob seen near a bone, found or not, for tuning the colours. */
  candidates: number;
};

export type FrameResult = {
  type: "frame";
  t: number;
  width: number;
  height: number;
  /** A frame's rotation, when the browser reports one (Chrome 138+). */
  rotation: number | null;
  ms: { total: number; pose?: number; plumb?: number; stickers?: number };
  plumb?: PlumbResult;
  pose?: PoseResult;
  stickers?: StickerFrame;
  /** The whole picture's mean colour, for watching the locks hold. */
  colour: { luma: number; cb: number; cr: number };
};

/** A photo kept, or not: its size in numbers, never the picture. */
export type PhotoResult = {
  type: "photo";
  view: View;
  round: number;
  ok: boolean;
  width: number | null;
  height: number | null;
  bytes: number | null;
  message: string | null;
};

export type FromWorker =
  | { type: "status"; message: string }
  | { type: "error"; where: string; message: string }
  | { type: "need" }
  | FrameResult
  | PhotoResult
  | { type: "bench"; timings: ModelTiming[]; gpuVerdict: string };
