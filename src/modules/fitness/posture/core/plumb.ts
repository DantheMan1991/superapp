import type { Point } from "./geometry";

/**
 * THE PLUMB LINE (docs/modules/posture.md, "Level and scale"): a string with a
 * weight, hanging beside the person, is the one thing in the picture that is
 * truly vertical. Its line gives the picture's tilt against gravity, camera
 * module and all, better than the phone's sensors (Chrome rounds those to
 * about 0.6°, and a phone's accelerometer can be a degree out). Two marks on
 * it exactly one metre apart give the scale at the person's distance.
 *
 * Found in two passes, both pure so they are tested on drawn pictures:
 * 1. `lineEvidence` + `findVerticalLine` on a small, whole-frame luminance
 *    picture: every pixel much darker (or lighter) than both neighbours a few
 *    pixels away is a thin-line pixel; RANSAC keeps the near-vertical line
 *    most of them agree on. A thick edge (a door frame) is not thin and never
 *    answers; the person is left out by their box.
 * 2. `subpixelCenter` + `refineLine` on full-resolution strips along it: the
 *    centre of the string in each strip to a fraction of a pixel, and the
 *    least-squares line through them.
 */

export type Luma = { data: ArrayLike<number>; width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type LineEvidence = { x: number; y: number; strength: number; polarity: 1 | -1 };

function inside(rects: readonly Rect[] | undefined, x: number, y: number): boolean {
  if (!rects) return false;
  for (const r of rects) {
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return true;
  }
  return false;
}

/**
 * Pixels that sit on a thin line: darker (polarity 1) or lighter (-1) than
 * BOTH neighbours `half` pixels away by at least `minContrast`, and the
 * strongest such pixel among its immediate neighbours in the row.
 */
export function lineEvidence(
  img: Luma,
  opts: { half: number; minContrast: number; exclude?: readonly Rect[]; rowStep?: number },
): LineEvidence[] {
  const { width, height, data } = img;
  const { half, minContrast } = opts;
  const rowStep = Math.max(1, opts.rowStep ?? 1);
  const out: LineEvidence[] = [];
  const strength = new Float32Array(width);
  const polarity = new Int8Array(width);
  for (let y = 0; y < height; y += rowStep) {
    const row = y * width;
    strength.fill(0);
    polarity.fill(0);
    for (let x = half; x < width - half; x++) {
      const c = data[row + x];
      const l = data[row + x - half];
      const r = data[row + x + half];
      const dark = Math.min(l - c, r - c);
      const light = Math.min(c - l, c - r);
      if (dark >= minContrast) {
        strength[x] = dark;
        polarity[x] = 1;
      } else if (light >= minContrast) {
        strength[x] = light;
        polarity[x] = -1;
      }
    }
    for (let x = half; x < width - half; x++) {
      const s = strength[x];
      if (s <= 0) continue;
      if (s < strength[x - 1] || s < strength[x + 1]) continue;
      if (s === strength[x - 1] && x > half) continue; // one pixel per plateau
      if (inside(opts.exclude, x, y)) continue;
      out.push({ x, y, strength: s, polarity: polarity[x] as 1 | -1 });
    }
  }
  return out;
}

/** A line x = a·y + b in picture pixels (near-vertical lines are single-valued in y). */
export type VerticalLine = { a: number; b: number };

export type FoundLine = VerticalLine & {
  /** Evidence pixels within `inlierPx` of the line. */
  inliers: number;
  /** Share of the picture's height the inliers cover (in `bins` bands). */
  coverage: number;
  polarity: 1 | -1;
};

/** A small seeded generator, so RANSAC is repeatable in a test and on a phone. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function coverageOf(ys: readonly number[], height: number, bins: number): number {
  const hit = new Uint8Array(bins);
  for (const y of ys) hit[Math.min(bins - 1, Math.max(0, Math.floor((y / height) * bins)))] = 1;
  let n = 0;
  for (const h of hit) n += h;
  return n / bins;
}

/**
 * The near-vertical line most thin-line pixels agree on, or null. Lines
 * steeper than `maxTiltDeg` from vertical are not plumb lines; nor is one
 * covering less than `minCoverage` of the picture's height.
 */
export function findVerticalLine(
  evidence: readonly LineEvidence[],
  opts: {
    height: number;
    maxTiltDeg: number;
    inlierPx: number;
    minCoverage: number;
    iterations?: number;
    rng?: () => number;
  },
): FoundLine | null {
  if (evidence.length < 8) return null;
  const rng = opts.rng ?? seeded(7);
  const iterations = opts.iterations ?? 600;
  const maxSlope = Math.tan((opts.maxTiltDeg * Math.PI) / 180);
  const minSpan = opts.height / 4;
  let best: { a: number; b: number; score: number; polarity: 1 | -1 } | null = null;
  for (let i = 0; i < iterations; i++) {
    const p = evidence[Math.floor(rng() * evidence.length)];
    const q = evidence[Math.floor(rng() * evidence.length)];
    if (p.polarity !== q.polarity) continue;
    const dy = q.y - p.y;
    if (Math.abs(dy) < minSpan) continue;
    const a = (q.x - p.x) / dy;
    if (Math.abs(a) > maxSlope) continue;
    const b = p.x - a * p.y;
    let score = 0;
    for (const e of evidence) {
      if (e.polarity !== p.polarity) continue;
      if (Math.abs(e.x - (a * e.y + b)) <= opts.inlierPx) score += 1;
    }
    if (!best || score > best.score) best = { a, b, score, polarity: p.polarity };
  }
  if (!best) return null;
  // Refine on the inliers, twice, with the band shrinking onto the line.
  let line: VerticalLine = { a: best.a, b: best.b };
  let chosen: LineEvidence[] = [];
  for (let pass = 0; pass < 2; pass++) {
    chosen = evidence.filter(
      (e) => e.polarity === best.polarity && Math.abs(e.x - (line.a * e.y + line.b)) <= opts.inlierPx,
    );
    const fit = refineLine(chosen.map((e) => ({ x: e.x, y: e.y, weight: e.strength })));
    if (!fit) return null;
    line = { a: fit.a, b: fit.b };
  }
  if (Math.abs(line.a) > maxSlope) return null;
  const coverage = coverageOf(
    chosen.map((e) => e.y),
    opts.height,
    24,
  );
  if (coverage < opts.minCoverage) return null;
  return { ...line, inliers: chosen.length, coverage, polarity: best.polarity };
}

/**
 * Weighted least squares of x on y, with points more than three spreads off
 * the line dropped and the fit taken again (a knot, a hand passing).
 */
export function refineLine(
  samples: readonly { x: number; y: number; weight?: number }[],
): (VerticalLine & { rmsPx: number; used: number }) | null {
  let pts = samples.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  let fit: (VerticalLine & { rmsPx: number; used: number }) | null = null;
  for (let pass = 0; pass < 3; pass++) {
    if (pts.length < 3) return fit;
    let sw = 0;
    let sy = 0;
    let sx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      const w = p.weight ?? 1;
      sw += w;
      sy += w * p.y;
      sx += w * p.x;
      syy += w * p.y * p.y;
      sxy += w * p.x * p.y;
    }
    const den = sw * syy - sy * sy;
    if (Math.abs(den) < 1e-9) return fit;
    const a = (sw * sxy - sy * sx) / den;
    const b = (sx - a * sy) / sw;
    let ss = 0;
    for (const p of pts) ss += (p.x - (a * p.y + b)) ** 2;
    const rms = Math.sqrt(ss / pts.length);
    fit = { a, b, rmsPx: rms, used: pts.length };
    const limit = Math.max(3 * rms, 0.5);
    const kept = pts.filter((p) => Math.abs(p.x - (a * p.y + b)) <= limit);
    if (kept.length === pts.length) break;
    pts = kept;
  }
  return fit;
}

/**
 * The string's centre across one strip of pixels, to a fraction of a pixel:
 * the contrast-weighted centroid around the darkest (or lightest) sample,
 * against the strip's own background. Null when nothing stands out.
 */
export function subpixelCenter(
  profile: ArrayLike<number>,
  polarity: 1 | -1,
  opts: { minContrast: number; halfWindow: number },
): number | null {
  const n = profile.length;
  if (n < 5) return null;
  const edge = Math.max(2, Math.floor(n / 6));
  const ends: number[] = [];
  for (let i = 0; i < edge; i++) ends.push(profile[i], profile[n - 1 - i]);
  ends.sort((a, b) => a - b);
  const background = ends[ends.length >> 1];
  let peak = -1;
  let peakAt = -1;
  for (let i = 0; i < n; i++) {
    const c = polarity * (background - profile[i]);
    if (c > peak) {
      peak = c;
      peakAt = i;
    }
  }
  if (peak < opts.minContrast) return null;
  let sw = 0;
  let sx = 0;
  const from = Math.max(0, peakAt - opts.halfWindow);
  const to = Math.min(n - 1, peakAt + opts.halfWindow);
  for (let i = from; i <= to; i++) {
    const c = Math.max(0, polarity * (background - profile[i]));
    sw += c;
    sx += c * i;
  }
  return sw > 0 ? sx / sw : null;
}

/** True up, in picture pixels, from a plumb line x = a·y + b (a string hangs DOWN the picture). */
export function upFromLine(line: VerticalLine): Point {
  const n = Math.hypot(line.a, 1);
  return { x: -line.a / n, y: -1 / n };
}

/**
 * The marks on the string: runs of strongly coloured samples along it (tape
 * wrapped round the string). `samples` are taken down the line at position
 * `t` (pixels along it) with `chroma`, the colour's distance from grey.
 * Returns each run's centre.
 */
export function marksAlong(
  samples: readonly { t: number; chroma: number }[],
  opts: { minChroma: number; minRunPx: number; maxGapPx?: number },
): { center: number; strength: number }[] {
  const runs: { from: number; to: number; strength: number }[] = [];
  const gap = opts.maxGapPx ?? 2;
  let open: { from: number; to: number; strength: number } | null = null;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  for (const s of sorted) {
    if (s.chroma >= opts.minChroma) {
      if (open && s.t - open.to <= gap) {
        open.to = s.t;
        open.strength += s.chroma;
      } else {
        if (open) runs.push(open);
        open = { from: s.t, to: s.t, strength: s.chroma };
      }
    }
  }
  if (open) runs.push(open);
  return runs
    .filter((r) => r.to - r.from + 1 >= opts.minRunPx)
    .map((r) => ({ center: (r.from + r.to) / 2, strength: r.strength }));
}

/**
 * Pixels per metre from the marks, when there are two: the two strongest runs
 * are the tape, a metre apart. Null with fewer, or with two closer than
 * `minApartPx` (one mark seen twice).
 */
export function scaleFromMarks(
  marks: readonly { center: number; strength: number }[],
  opts: { minApartPx: number; metres?: number },
): { pxPerMetre: number; marks: [number, number] } | null {
  if (marks.length < 2) return null;
  const top = [...marks].sort((a, b) => b.strength - a.strength).slice(0, 2);
  const [p, q] = top.map((m) => m.center).sort((a, b) => a - b);
  const apart = q - p;
  if (apart < opts.minApartPx) return null;
  return { pxPerMetre: apart / (opts.metres ?? 1), marks: [p, q] };
}
