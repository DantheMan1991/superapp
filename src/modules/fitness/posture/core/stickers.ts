import { jitter, median, medianPoint, toLevel, type LevelFrame, type Point } from "./geometry";
import { colourOf, type Sticker, type StickerColour, type View } from "./sticker-map";
import { midpoint, seen, torsoLength, type PosePoint } from "./views";

/**
 * FINDING THE STICKERS (docs/modules/posture.md, "Stickers"). Pure over RGBA
 * pixels, so each step is tested on drawn pictures:
 *
 * 1. `classify`: a pixel's colour in YCbCr, read as an angle and a distance
 *    from grey in the Cb/Cr plane. Skin of every tone sits in one quadrant
 *    (Cb a little low, Cr high); matte blue is Cb high and Cr low, matte green
 *    both low. Brightness barely moves the angle, which is why it is the angle
 *    that is thresholded and not the raw values.
 * 2. `blobs`: joined runs of one colour, kept when they are the size and
 *    roundness a sticker would be at this distance.
 * 3. `predict` + `assign`: each sticker is looked for near where the pose model
 *    says its bone is, and takes the nearest blob of its side's colour. In a
 *    back or front view, left and right are also tried the other way round,
 *    in case the model swapped them: the colours decide.
 * 4. `aggregate`: a hold is many frames; a sticker's place is the median, and
 *    how much it wandered (jitter) is reported.
 */

export type Rgba = { data: ArrayLike<number>; width: number; height: number };

export type ChromaColour = { hue: number; chroma: number; luma: number };

/** BT.601 full-range YCbCr, as a camera's own frames carry it, read as an angle (degrees) and a distance in the Cb/Cr plane. */
export function chromaOf(r: number, g: number, b: number): ChromaColour {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
  return { hue: (Math.atan2(cr, cb) * 180) / Math.PI, chroma: Math.hypot(cb, cr), luma };
}

export type ClassifyOptions = {
  /** Least distance from grey (8-bit Cb/Cr units) to count as coloured. */
  minChroma: number;
  minLuma: number;
  maxLuma: number;
  /** Hue windows, degrees, from atan2(Cr−128, Cb−128). */
  blue: [number, number];
  green: [number, number];
};

/**
 * Starting windows, from matte office dots against skin under white light.
 * The setup check's readout reports the hues it actually saw, so these can be
 * tuned from real stickers rather than guessed at twice.
 */
export const DEFAULT_CLASSIFY: ClassifyOptions = {
  minChroma: 22,
  minLuma: 20,
  maxLuma: 245,
  // Skin of every tone reads 100–165°, red and orange tape near it, yellow
  // near 165°: all far outside both windows.
  blue: [-85, 20],
  green: [-170, -95],
};

export function classify(c: ChromaColour, opts: ClassifyOptions = DEFAULT_CLASSIFY): StickerColour | null {
  if (c.chroma < opts.minChroma || c.luma < opts.minLuma || c.luma > opts.maxLuma) return null;
  if (c.hue >= opts.blue[0] && c.hue <= opts.blue[1]) return "blue";
  if (c.hue >= opts.green[0] && c.hue <= opts.green[1]) return "green";
  return null;
}

export type Blob = {
  colour: StickerColour;
  /** Centre in the frame's pixels, weighted by how coloured each pixel is. */
  centre: Point;
  area: number;
  /** Bounding box width and height, pixels. */
  box: { width: number; height: number };
  /** Area against the ellipse its box would hold: 1 for a clean disc. */
  fill: number;
  hue: number;
  chroma: number;
};

export type BlobOptions = ClassifyOptions & {
  /** Expected sticker diameter in pixels at this distance: the size filter's centre. */
  diameterPx: number;
  /** How far the size may be off, either way, as a factor (foreshortening makes stickers look smaller). */
  sizeTolerance: number;
  minFill: number;
};

/**
 * The coloured blobs in a patch of the frame (`region` says where the patch
 * sits in the frame, so centres come back in frame pixels).
 */
export function blobs(patch: Rgba, region: Point, opts: BlobOptions): Blob[] {
  const { width, height, data } = patch;
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const colourAt = new Int8Array(n); // 0 none, 1 blue, 2 green
  const weight = new Float32Array(n);
  const hueAt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const c = chromaOf(data[o], data[o + 1], data[o + 2]);
    const k = classify(c, opts);
    if (k) {
      colourAt[i] = k === "blue" ? 1 : 2;
      weight[i] = c.chroma;
      hueAt[i] = c.hue;
    }
  }
  const minArea = (Math.PI / 4) * (opts.diameterPx / opts.sizeTolerance) ** 2;
  const maxArea = (Math.PI / 4) * (opts.diameterPx * opts.sizeTolerance) ** 2;
  const out: Blob[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (colourAt[start] === 0 || label[start] !== -1) continue;
    const kind = colourAt[start];
    const id = next++;
    let area = 0;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sh = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      const w = weight[i];
      area++;
      sw += w;
      sx += w * x;
      sy += w * y;
      sh += hueAt[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // 8-connected: a disc's rim pixels touch diagonally.
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (colourAt[j] === kind && label[j] === -1) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
    }
    if (area < minArea || area > maxArea) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const fill = area / ((Math.PI / 4) * bw * bh);
    const aspect = bw / bh;
    if (fill < opts.minFill || aspect < 0.4 || aspect > 2.5) continue;
    out.push({
      colour: kind === 1 ? "blue" : "green",
      centre: { x: region.x + sx / sw, y: region.y + sy / sw },
      area,
      box: { width: bw, height: bh },
      fill,
      hue: sh / area,
      chroma: sw / area,
    });
  }
  return out;
}

/**
 * One blob per sticker when two search patches overlap (a shoulder tip's and
 * the neck's) and both found it: the same centre within `withinPx`.
 */
export function dedupe(candidates: readonly Blob[], withinPx = 2): Blob[] {
  const out: Blob[] = [];
  for (const b of candidates) {
    if (out.some((o) => o.colour === b.colour && Math.hypot(o.centre.x - b.centre.x, o.centre.y - b.centre.y) <= withinPx)) {
      continue;
    }
    out.push(b);
  }
  return out;
}

export type Prediction = { sticker: Sticker; at: Point; radius: number };

/**
 * Where each sticker of a view should be, from the pose points (picture
 * pixels). `facing` is the side view's nose direction (+1 picture right).
 * A sticker whose anchor points the model is unsure of is not predicted.
 */
export function predict(
  stickers: readonly Sticker[],
  view: View,
  points: readonly PosePoint[],
  frame: LevelFrame,
  facing: 1 | -1 | 0,
  radiusTorsos = 0.2,
): Prediction[] {
  const torso = torsoLength(points);
  if (!(torso > 0)) return [];
  const ls = points[11];
  const rs = points[12];
  const lh = points[23];
  const rh = points[24];
  const mid = ls && rs && lh && rh ? midpoint(midpoint(ls, rs), midpoint(lh, rh)) : null;
  const out: Prediction[] = [];
  for (const sticker of stickers) {
    const anchor = sticker.anchors[view];
    if (!anchor) continue;
    const pts = anchor.points.map((i) => points[i]);
    if (!pts.every((p) => seen(p, 0.3))) continue;
    const base = pts.length === 1 ? { x: pts[0].x, y: pts[0].y } : midpoint(pts[0], pts[1]);
    // "Out": away from the midline (front and back), or toward the body's
    // front (side views), as a unit vector along true horizontal.
    let outSign = 0;
    if (view === "front" || view === "back") {
      if (mid && sticker.side !== "mid") {
        outSign = Math.sign(toLevel(frame, base).x - toLevel(frame, mid).x) || 0;
      }
    } else {
      outSign = facing;
    }
    const at = {
      x: base.x + torso * (anchor.up * frame.up.x + anchor.out * outSign * frame.right.x),
      y: base.y + torso * (anchor.up * frame.up.y + anchor.out * outSign * frame.right.y),
    };
    out.push({ sticker, at, radius: radiusTorsos * torso });
  }
  return out;
}

export type Assignment = {
  found: { sticker: Sticker; blob: Blob; distance: number }[];
  missing: Sticker[];
  /** True when the pose model's left and right were read the other way round. */
  swapped: boolean;
};

function assignOnce(predictions: readonly Prediction[], candidates: readonly Blob[]): Assignment {
  const pairs: { p: Prediction; b: Blob; d: number }[] = [];
  for (const p of predictions) {
    const want = colourOf(p.sticker.side);
    for (const b of candidates) {
      if (want && b.colour !== want) continue;
      const d = Math.hypot(b.centre.x - p.at.x, b.centre.y - p.at.y);
      if (d <= p.radius) pairs.push({ p, b, d: d / p.radius });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedBlob = new Set<Blob>();
  const done = new Map<string, { sticker: Sticker; blob: Blob; distance: number }>();
  for (const { p, b, d } of pairs) {
    if (done.has(p.sticker.id) || usedBlob.has(b)) continue;
    usedBlob.add(b);
    done.set(p.sticker.id, { sticker: p.sticker, blob: b, distance: d * p.radius });
  }
  return {
    found: [...done.values()],
    missing: predictions.filter((p) => !done.has(p.sticker.id)).map((p) => p.sticker),
    swapped: false,
  };
}

/** The mirror of a prediction: a left sticker looked for where the right one's bone is, and back. */
function swapSides(predictions: readonly Prediction[]): Prediction[] {
  const byId = new Map(predictions.map((p) => [p.sticker.id, p]));
  return predictions.map((p) => {
    if (p.sticker.side === "mid") return p;
    const twin = p.sticker.side === "left" ? p.sticker.id.replace(/^left-/, "right-") : p.sticker.id.replace(/^right-/, "left-");
    const other = byId.get(twin);
    return other ? { ...p, at: other.at } : p;
  });
}

export function assign(predictions: readonly Prediction[], candidates: readonly Blob[], view: View): Assignment {
  const straight = assignOnce(predictions, candidates);
  if (view !== "front" && view !== "back") return straight;
  const crossed = { ...assignOnce(swapSides(predictions), candidates), swapped: true };
  const total = (a: Assignment) => a.found.reduce((s, f) => s + f.distance, 0);
  if (crossed.found.length > straight.found.length) return crossed;
  if (crossed.found.length === straight.found.length && crossed.found.length > 0 && total(crossed) < total(straight)) {
    return crossed;
  }
  return straight;
}

export type StickerSummary = {
  id: string;
  /** Frames it was found in, out of the frames looked at. */
  seenIn: number;
  of: number;
  at: Point | null;
  /** Median distance from its median place, pixels. */
  jitterPx: number;
  diameterPx: number;
  hue: number;
  chroma: number;
};

/** A hold's frames, one assignment each, down to one place per sticker. */
export function aggregate(stickers: readonly Sticker[], frames: readonly Assignment[]): StickerSummary[] {
  return stickers.map((sticker) => {
    const hits = frames.flatMap((f) => f.found.filter((x) => x.sticker.id === sticker.id));
    const places = hits.map((h) => h.blob.centre);
    return {
      id: sticker.id,
      seenIn: hits.length,
      of: frames.length,
      at: places.length > 0 ? medianPoint(places) : null,
      jitterPx: places.length > 1 ? jitter(places) : Number.NaN,
      diameterPx: hits.length > 0 ? median(hits.map((h) => Math.sqrt((4 * h.blob.area) / Math.PI))) : Number.NaN,
      hue: hits.length > 0 ? median(hits.map((h) => h.blob.hue)) : Number.NaN,
      chroma: hits.length > 0 ? median(hits.map((h) => h.blob.chroma)) : Number.NaN,
    };
  });
}
