import { describe, expect, it } from "vitest";
import { IMAGE_LEVEL } from "../src/modules/fitness/posture/core/geometry";
import { LM, STICKERS, stickerById, stickersIn } from "../src/modules/fitness/posture/core/sticker-map";
import {
  aggregate,
  assign,
  blobs,
  chromaOf,
  classify,
  DEFAULT_CLASSIFY,
  dedupe,
  predict,
  type Blob,
} from "../src/modules/fitness/posture/core/stickers";
import type { PosePoint } from "../src/modules/fitness/posture/core/views";

/**
 * THE STICKERS (docs/modules/posture.md, "Stickers"): the colours told apart
 * from skin of every tone, discs found to a fraction of a pixel on a drawn
 * patch, and each sticker given to the right bone, even when the pose model
 * swaps left and right.
 */

const SKIN = [
  [241, 194, 165], // light
  [224, 172, 140],
  [198, 134, 100],
  [141, 85, 60],
  [96, 58, 42], // deep
  [60, 38, 30], // deepest, in shadow
] as const;

describe("the colours", () => {
  it("never reads skin, grey or the red and orange of the plumb line's tape as a sticker", () => {
    for (const [r, g, b] of SKIN) expect(classify(chromaOf(r, g, b))).toBeNull();
    for (const v of [30, 128, 230]) expect(classify(chromaOf(v, v, v))).toBeNull();
    expect(classify(chromaOf(210, 40, 40))).toBeNull(); // red tape
    expect(classify(chromaOf(245, 130, 30))).toBeNull(); // orange tape
    expect(classify(chromaOf(230, 210, 40))).toBeNull(); // yellow
  });

  it("reads matte blue as blue and matte green as green, bright or in shade", () => {
    for (const [r, g, b] of [
      [40, 90, 200],
      [20, 45, 110], // blue in shade
      [0, 150, 220], // a cyan-leaning blue
      [80, 120, 230],
    ]) {
      expect(classify(chromaOf(r, g, b))).toBe("blue");
    }
    for (const [r, g, b] of [
      [40, 160, 80],
      [20, 80, 40], // green in shade
      [120, 255, 60], // fluorescent
    ]) {
      expect(classify(chromaOf(r, g, b))).toBe("green");
    }
  });

  it("puts skin in a quadrant of its own, whatever its tone", () => {
    for (const [r, g, b] of SKIN) {
      const hue = chromaOf(r, g, b).hue;
      expect(hue).toBeGreaterThan(95);
      expect(hue).toBeLessThan(170);
    }
  });
});

/** A patch of skin with discs drawn on it, anti-aliased by area. */
function patch(width: number, height: number, discs: { x: number; y: number; r: number; rgb: [number, number, number] }[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rgb = [198, 134, 100];
      for (const d of discs) {
        // Coverage of this pixel by the disc, sampled 4×4.
        let inside = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const px = x + (sx + 0.5) / 4;
            const py = y + (sy + 0.5) / 4;
            if (Math.hypot(px - d.x, py - d.y) <= d.r) inside++;
          }
        }
        const f = inside / 16;
        if (f > 0) rgb = rgb.map((v, i) => v * (1 - f) + d.rgb[i] * f);
      }
      const o = (y * width + x) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("finding discs", () => {
  const opts = { ...DEFAULT_CLASSIFY, diameterPx: 20, sizeTolerance: 2, minFill: 0.6 };

  it("finds a blue and a green disc, each centre to within a tenth of a pixel", () => {
    // Centres are pixel coordinates of the disc; a pixel's centre is at +0.5.
    const p = patch(120, 80, [
      { x: 30.3, y: 40.7, r: 10, rgb: [40, 90, 200] },
      { x: 85.6, y: 35.2, r: 9, rgb: [40, 160, 80] },
    ]);
    const found = blobs(p, { x: 1000, y: 2000 }, opts);
    expect(found).toHaveLength(2);
    const blue = found.find((b) => b.colour === "blue")!;
    const green = found.find((b) => b.colour === "green")!;
    expect(Math.abs(blue.centre.x - (1000 + 30.3 - 0.5))).toBeLessThan(0.1);
    expect(Math.abs(blue.centre.y - (2000 + 40.7 - 0.5))).toBeLessThan(0.1);
    expect(Math.abs(green.centre.x - (1000 + 85.6 - 0.5))).toBeLessThan(0.1);
    expect(Math.abs(green.centre.y - (2000 + 35.2 - 0.5))).toBeLessThan(0.1);
    expect(blue.fill).toBeGreaterThan(0.8);
  });

  it("drops a speck too small and a stripe too long to be a sticker", () => {
    const p = patch(160, 80, [
      { x: 20, y: 20, r: 2, rgb: [40, 90, 200] }, // a speck
    ]);
    // A blue stripe (a vein? a tattoo? a strap): long and thin.
    for (let y = 60; y < 64; y++) {
      for (let x = 10; x < 150; x++) {
        const o = (y * 160 + x) * 4;
        p.data[o] = 40;
        p.data[o + 1] = 90;
        p.data[o + 2] = 200;
      }
    }
    expect(blobs(p, { x: 0, y: 0 }, opts)).toEqual([]);
  });

  it("counts one sticker once when two search patches both saw it", () => {
    const b = (x: number): Blob => ({
      colour: "blue",
      centre: { x, y: 10 },
      area: 300,
      box: { width: 20, height: 20 },
      fill: 1,
      hue: -30,
      chroma: 60,
    });
    expect(dedupe([b(10), b(10.5), b(40)])).toHaveLength(2);
  });
});

/** A person facing the phone: 33 points in picture pixels (left side on the picture's right). */
function facingPoints(): PosePoint[] {
  const p: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const set = (i: number, x: number, y: number) => (p[i] = { x, y, visibility: 0.99 });
  set(LM.nose, 500, 300);
  set(LM.leftEye, 515, 290);
  set(LM.rightEye, 485, 290);
  set(LM.leftEar, 540, 300);
  set(LM.rightEar, 460, 300);
  set(LM.leftShoulder, 600, 420);
  set(LM.rightShoulder, 400, 420);
  set(LM.leftHip, 560, 870);
  set(LM.rightHip, 440, 870);
  set(LM.leftKnee, 560, 1250);
  set(LM.rightKnee, 440, 1250);
  set(LM.leftAnkle, 560, 1630);
  set(LM.rightAnkle, 440, 1630);
  return p;
}

const blob = (colour: "blue" | "green", x: number, y: number): Blob => ({
  colour,
  centre: { x, y },
  area: 300,
  box: { width: 20, height: 20 },
  fill: 0.95,
  hue: colour === "blue" ? -30 : -110,
  chroma: 60,
});

describe("giving each sticker its bone", () => {
  const points = facingPoints();
  const front = stickersIn("front");
  const predictions = predict(front, "front", points, IMAGE_LEVEL, 0);

  it("predicts every front sticker near its bone, the right side on the picture's left", () => {
    const at = (id: string) => predictions.find((p) => p.sticker.id === id)!.at;
    expect(predictions.map((p) => p.sticker.id).sort()).toEqual(front.map((s) => s.id).sort());
    expect(at("right-shoulder").x).toBeLessThan(at("left-shoulder").x);
    // Offsets go up (picture y smaller) and out, away from the midline.
    expect(at("right-front-hip").y).toBeLessThan(870);
    expect(at("right-front-hip").x).toBeLessThan(440);
    expect(at("left-front-hip").x).toBeGreaterThan(560);
  });

  it("gives each blob of the side's colour to the nearest bone that wants it", () => {
    const at = (id: string) => predictions.find((p) => p.sticker.id === id)!.at;
    const rs = at("right-shoulder");
    const ls = at("left-shoulder");
    const result = assign(
      predictions,
      [blob("green", rs.x + 5, rs.y - 3), blob("blue", ls.x - 4, ls.y + 2), blob("blue", rs.x + 8, rs.y + 8)],
      "front",
    );
    const ids = result.found.map((f) => f.sticker.id).sort();
    expect(ids).toEqual(["left-shoulder", "right-shoulder"]);
    // The stray blue near the right shoulder is not the right shoulder's: right is green.
    expect(result.found.find((f) => f.sticker.id === "right-shoulder")!.blob.colour).toBe("green");
    expect(result.missing.map((s) => s.id)).toContain("right-front-hip");
    expect(result.swapped).toBe(false);
  });

  it("lets the colours win when the pose model swapped left and right", () => {
    // From behind, the model called the left shoulder the right: the stickers'
    // colours sit where the OTHER predictions are.
    const back = stickersIn("back");
    const pts = facingPoints(); // left shoulder on the picture's right...
    const preds = predict(back, "back", pts, IMAGE_LEVEL, 0);
    const at = (id: string) => preds.find((p) => p.sticker.id === id)!.at;
    // ...but it is really a back view, so the green (right) sticker is on the picture's right.
    const result = assign(
      preds,
      [blob("green", at("left-shoulder").x, at("left-shoulder").y), blob("blue", at("right-shoulder").x, at("right-shoulder").y)],
      "back",
    );
    expect(result.swapped).toBe(true);
    expect(result.found.map((f) => f.sticker.id).sort()).toEqual(["left-shoulder", "right-shoulder"]);
  });

  it("sums a hold up to one place per sticker, with how much it wandered", () => {
    const rs = predictions.find((p) => p.sticker.id === "right-shoulder")!.at;
    const frames = [0, 1, 2, 3, 4].map((i) =>
      assign(predictions, [blob("green", rs.x + (i % 2 ? 0.4 : -0.4), rs.y)], "front"),
    );
    const summary = aggregate(front, frames).find((s) => s.id === "right-shoulder")!;
    expect(summary.seenIn).toBe(5);
    expect(summary.of).toBe(5);
    expect(summary.at!.x).toBeCloseTo(rs.x - 0.4, 6);
    expect(summary.jitterPx).toBeCloseTo(0, 6);
    const neck = aggregate(front, frames).find((s) => s.id === "breastbone")!;
    expect(neck.seenIn).toBe(0);
    expect(neck.at).toBeNull();
  });
});

describe("the sticker catalogue", () => {
  it("has twenty stickers: two on the midline and nine pairs", () => {
    expect(STICKERS).toHaveLength(20);
    expect(STICKERS.filter((s) => s.side === "mid")).toHaveLength(2);
    expect(STICKERS.filter((s) => s.side === "left")).toHaveLength(9);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(20);
  });

  it("marks the two a person cannot place well alone", () => {
    expect(STICKERS.filter((s) => s.helper).map((s) => s.id).sort()).toEqual([
      "left-back-hip",
      "neck",
      "right-back-hip",
    ]);
  });

  it("can see every sticker from at least one side", () => {
    for (const s of STICKERS) expect(Object.keys(s.anchors).length).toBeGreaterThan(0);
    expect(stickerById("neck")!.anchors.back).toBeTruthy();
    expect(stickersIn("right").every((s) => s.side !== "left")).toBe(true);
  });
});
