import type { View } from "./sticker-map";
import type { StickerSummary } from "./stickers";

/**
 * THE SETUP CHECK'S READOUT (docs/modules/posture.md, slice 1): numbers about
 * the phone, the camera, the level, the plumb line, the pose model and the
 * stickers, which the person copies and sends so the next slice is built on
 * what their phone really does rather than on what a spec says it should.
 *
 * NUMBERS ONLY. It is built from the worker's results, which are numbers,
 * and `readoutText` refuses anything that looks like a picture (a long string,
 * a data URL, a big array) so a later change cannot slip one in.
 */

export type ModelTiming = {
  model: string;
  delegate: "CPU" | "GPU";
  frames: number;
  msP50: number;
  msP90: number;
  /** Mean distance from the CPU's points, in torso lengths, when compared. */
  offFromCpu?: number;
  error?: string;
};

export type ViewReadout = {
  view: View;
  framesLooked: number;
  viewSeen: View | null;
  stillPx: number;
  stickers: StickerSummary[];
  missing: string[];
  /**
   * Stickers never looked for in any frame, because the pose model was unsure
   * of the bone they are anchored to: missing for the model's sake, not the
   * sticker's.
   */
  unsearched: string[];
  /** Where each missing sticker was looked for (the median over the hold), and how far around. */
  lookedFor: { id: string; x: number; y: number; radius: number }[];
  swapped: boolean;
};

export type SetupReadout = {
  version: 1;
  when: string;
  device: {
    userAgent: string;
    screen: string;
    pixelRatio: number;
    cores: number | null;
    memoryGb: number | null;
  };
  camera: {
    list: { label: string; facing: string; index: number | null; max: string; torch: boolean; zoomMax: number | null }[];
    chosen: string | null;
    why: string[];
    facingModeOpens: string | null;
    settings: Record<string, number | string | boolean | null>;
    locks: { whiteBalance: string; focus: string; exposure: string };
    colourDrift: { cb: number; cr: number; luma: number; seconds: number } | null;
    frames: { delivered: number | null; discarded: number | null; path: string };
  } | null;
  level: {
    sensor: string;
    rateHz: number | null;
    roll: number | null;
    pitch: number | null;
    rollSpread: number | null;
    offsetFromPlumb: number | null;
  } | null;
  plumb: {
    found: boolean;
    roll: number | null;
    rmsPx: number | null;
    coverage: number | null;
    pxPerMetre: number | null;
    marks: number;
  } | null;
  person: {
    fill: number | null;
    heightFromScale: number | null;
  } | null;
  model: { chosen: string | null; timings: ModelTiming[]; gpuVerdict: string | null } | null;
  views: ViewReadout[];
  notes: string[];
};

export function emptyReadout(now: Date, device: SetupReadout["device"]): SetupReadout {
  return {
    version: 1,
    when: now.toISOString(),
    device,
    camera: null,
    level: null,
    plumb: null,
    person: null,
    model: null,
    views: [],
    notes: [],
  };
}

const MAX_STRING = 300;
const MAX_ARRAY = 64;

/** Rounds every number to `places` and throws on anything picture-shaped. */
function clean(value: unknown, path: string, places: number): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const f = 10 ** places;
    return Math.round(value * f) / f;
  }
  if (typeof value === "string") {
    if (value.startsWith("data:") || value.startsWith("blob:")) throw new Error(`readout: ${path} is a picture URL`);
    if (value.length > MAX_STRING) throw new Error(`readout: ${path} is ${value.length} characters`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) throw new Error(`readout: ${path} has ${value.length} items`);
    return value.map((v, i) => clean(v, `${path}[${i}]`, places));
  }
  if (value && typeof value === "object") {
    if (ArrayBuffer.isView(value)) throw new Error(`readout: ${path} is binary`);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = clean(v, `${path}.${k}`, places);
    }
    return out;
  }
  return value;
}

/** The readout as the text the person copies: JSON, numbers rounded, nothing but numbers and words. */
export function readoutText(readout: SetupReadout): string {
  return JSON.stringify(clean(readout, "readout", 3), null, 1);
}
