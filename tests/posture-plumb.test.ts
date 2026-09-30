import { describe, expect, it } from "vitest";
import { rollOf, levelFrame } from "../src/modules/fitness/posture/core/geometry";
import {
  findVerticalLine,
  lineEvidence,
  marksAlong,
  refineLine,
  scaleFromMarks,
  seeded,
  subpixelCenter,
  upFromLine,
} from "../src/modules/fitness/posture/core/plumb";

/**
 * THE PLUMB LINE (docs/modules/posture.md, "Level and scale"), found on a
 * DRAWN picture: a grey wall, a dark string hanging 0.7° off the picture's
 * vertical (so the phone is turned 0.7°), noise, a person-sized block, and a
 * door frame (a thick dark edge) that must not be mistaken for the string.
 */

const W = 540;
const H = 960;

function drawScene(opts: { tiltDeg: number; x0: number; noise: number; seed: number }) {
  const rng = seeded(opts.seed);
  const data = new Float32Array(W * H);
  const slope = Math.tan((opts.tiltDeg * Math.PI) / 180);
  for (let y = 0; y < H; y++) {
    const cx = opts.x0 + slope * y; // the string's centre in this row
    for (let x = 0; x < W; x++) {
      let v = 180;
      // A door frame: 30 px of dark paint down the left.
      if (x >= 20 && x < 50) v = 70;
      // The person: a block in the middle, which the search leaves out.
      if (x >= 220 && x < 330 && y >= 120 && y < 900) v = 120;
      // The string, 2.4 px wide, anti-aliased by how much of each pixel it covers.
      const cover = Math.max(0, Math.min(1, 1.2 + 0.5 - Math.abs(x - cx)));
      v = v * (1 - cover) + 50 * cover;
      // Noise, uniform ±noise.
      v += (rng() * 2 - 1) * opts.noise;
      data[y * W + x] = v;
    }
  }
  return data;
}

describe("finding the string", () => {
  const tilt = 0.7;
  const img = { data: drawScene({ tiltDeg: tilt, x0: 400, noise: 6, seed: 3 }), width: W, height: H };
  const person = { x: 210, y: 110, width: 130, height: 800 };
  const evidence = lineEvidence(img, { half: 4, minContrast: 30, exclude: [person] });
  const found = findVerticalLine(evidence, { height: H, maxTiltDeg: 8, inlierPx: 2, minCoverage: 0.6 });

  it("finds it, and not the door frame", () => {
    expect(found).not.toBeNull();
    expect(found!.polarity).toBe(1); // darker than the wall
    expect(Math.abs(found!.b - 400)).toBeLessThan(1.5);
    expect(found!.coverage).toBeGreaterThan(0.9);
  });

  it("reads the picture's tilt from it to a few hundredths of a degree", () => {
    const up = upFromLine(found!);
    // The string hangs down to the right (slope > 0): true up leans to the
    // picture's LEFT, so the roll is negative.
    expect(rollOf(levelFrame(up))).toBeCloseTo(-tilt, 1);
    expect(Math.abs(rollOf(levelFrame(up)) + tilt)).toBeLessThan(0.05);
  });

  it("finds its centre in a strip to a fraction of a pixel, and the line through the centres", () => {
    const samples: { x: number; y: number }[] = [];
    for (let y = 0; y < H; y += 8) {
      const guess = Math.round(found!.a * y + found!.b);
      const from = guess - 12;
      const profile = Array.from({ length: 25 }, (_, i) => img.data[y * W + from + i]);
      const c = subpixelCenter(profile, 1, { minContrast: 25, halfWindow: 3 });
      if (c !== null) samples.push({ x: from + c, y });
    }
    const fit = refineLine(samples)!;
    const slope = Math.tan((tilt * Math.PI) / 180);
    expect(Math.abs(fit.a - slope)).toBeLessThan(0.0008); // under 0.05°
    expect(Math.abs(fit.b - 400)).toBeLessThan(0.5);
    expect(fit.rmsPx).toBeLessThan(0.6);
  });

  it("finds nothing on a bare wall", () => {
    const wall = new Float32Array(W * H).fill(180);
    const none = lineEvidence({ data: wall, width: W, height: H }, { half: 4, minContrast: 30 });
    expect(findVerticalLine(none, { height: H, maxTiltDeg: 8, inlierPx: 2, minCoverage: 0.6 })).toBeNull();
  });

  it("refuses a line leaning further than a plumb line could look", () => {
    const leaning = { data: drawScene({ tiltDeg: 15, x0: 150, noise: 2, seed: 5 }), width: W, height: H };
    const ev = lineEvidence(leaning, { half: 4, minContrast: 30, exclude: [person] });
    expect(findVerticalLine(ev, { height: H, maxTiltDeg: 8, inlierPx: 2, minCoverage: 0.6 })).toBeNull();
  });
});

describe("the line through strip centres", () => {
  it("drops a centre knocked off the line and fits the rest", () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: 100 + 0.01 * i * 10, y: i * 10 }));
    pts[17] = { x: 160, y: 170 }; // a hand passing the string
    const fit = refineLine(pts)!;
    expect(fit.a).toBeCloseTo(0.01, 6);
    expect(fit.b).toBeCloseTo(100, 6);
    expect(fit.used).toBe(39);
  });

  it("finds no centre in a strip with nothing in it", () => {
    expect(subpixelCenter(new Array(25).fill(180), 1, { minContrast: 25, halfWindow: 3 })).toBeNull();
  });
});

describe("the metre marks", () => {
  it("finds two runs of coloured tape and the pixels between them", () => {
    const samples = Array.from({ length: 1000 }, (_, t) => ({
      t,
      chroma: (t >= 100 && t < 110) || (t >= 991 && t < 999) ? 60 : 3,
    }));
    const marks = marksAlong(samples, { minChroma: 30, minRunPx: 4 });
    // Runs 100–109 and 991–998: their middles.
    expect(marks.map((m) => m.center)).toEqual([104.5, 994.5]);
    const scale = scaleFromMarks(marks, { minApartPx: 100 });
    expect(scale!.pxPerMetre).toBeCloseTo(890, 6);
  });

  it("says nothing with one mark, or with one mark seen twice", () => {
    expect(scaleFromMarks([{ center: 10, strength: 5 }], { minApartPx: 100 })).toBeNull();
    expect(
      scaleFromMarks(
        [
          { center: 10, strength: 5 },
          { center: 30, strength: 5 },
        ],
        { minApartPx: 100 },
      ),
    ).toBeNull();
  });

  it("ignores a speck too short to be tape", () => {
    const samples = Array.from({ length: 200 }, (_, t) => ({ t, chroma: t === 50 || t === 51 ? 90 : 0 }));
    expect(marksAlong(samples, { minChroma: 30, minRunPx: 4 })).toEqual([]);
  });
});
