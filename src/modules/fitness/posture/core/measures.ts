import { angleAt, levelFrame, toLevel, type LevelFrame, type Point } from "./geometry";
import type { View } from "./sticker-map";
import type { PosePoint } from "./views";

/**
 * THE MEASURES (docs/modules/posture.md, "What it measures"; ADR 0119).
 *
 * Pure: a view held still (`ViewCapture`: where each sticker and each pose
 * point sat, as medians over the hold) in, plain geometry out. Every angle is
 * taken in the level frame, so true up is the plumb line's (or the phone's
 * sensor's, when there was no plumb line), never the picture's own.
 *
 * Stickers are the points wherever a measure depends on a bone. The pose
 * model's points stand in only where the research allows (the ears, and the
 * shoulders when their stickers are missing, which drops that reading to
 * trend-only); a measure whose stickers are missing is not taken at all.
 *
 * `mdc` is the smallest change between two checks that is more than
 * measuring noise, from the published full re-test figures (the dossier
 * cites each). Slice 3 replaces them with the person's own.
 */

export type ViewCapture = {
  view: View;
  round: number;
  /** True up in frame pixels, and where it came from. */
  up: Point;
  upFrom: "plumb" | "sensor" | "none";
  pxPerMetre: number | null;
  width: number;
  height: number;
  /** Median place of each sticker found, by sticker id, frame pixels. */
  stickers: Record<string, Point>;
  /** Median place of each of the pose model's 33 points. */
  pose: PosePoint[] | null;
  frames: number;
  /** How far the body moved over the hold, pixels; null when it was not measured. */
  stillPx: number | null;
};

export type MeasureKey =
  | "shoulder-level"
  | "front-hip-level"
  | "back-hip-level"
  | "head-tilt"
  | "trunk-lean"
  | "knee-in-right"
  | "knee-in-left"
  | "head-forward"
  | "body-line"
  | "pelvic-tilt"
  | "shoulder-forward-right"
  | "shoulder-forward-left"
  | "knee-back-right"
  | "knee-back-left";

export type Tier = "reliable" | "trend";

export type MeasureDef = {
  key: MeasureKey;
  name: string;
  tier: Tier;
  /** The unit the report leads with. */
  unit: "deg" | "mm";
  /** Smallest real change between checks, in `unit`. */
  mdc: number;
  /** One neutral line of context, or null. Never a verdict (ADR 0119). */
  context: string | null;
  /** Said when the measure could not be taken. */
  needs: string;
};

export const MEASURES: Record<MeasureKey, MeasureDef> = {
  "shoulder-level": {
    key: "shoulder-level",
    name: "Shoulder level",
    tier: "reliable",
    unit: "deg",
    mdc: 3.6,
    context: "Most people's shoulders are a little uneven.",
    needs: "Needs both shoulder tip stickers, from the front or the back.",
  },
  "head-forward": {
    key: "head-forward",
    name: "Head over shoulders",
    tier: "reliable",
    unit: "deg",
    mdc: 5,
    context: "The angle up from the base of your neck to your ear. Healthy adults in studies average about 49°; lower means the head sits further forward.",
    needs: "Needs the base of the neck sticker, seen from the side.",
  },
  "body-line": {
    key: "body-line",
    name: "Body line",
    tier: "reliable",
    unit: "deg",
    mdc: 2.9,
    context: "Shoulder tip over outer ankle bone. Healthy adults in studies lean about 1.5° forward.",
    needs: "Needs the shoulder tip and outer ankle bone stickers, seen from the side.",
  },
  "knee-in-right": {
    key: "knee-in-right",
    name: "Right knee, standing",
    tier: "reliable",
    unit: "deg",
    mdc: 2.7,
    context: "Front hip bone, kneecap and front of the ankle, seen from the front. A straight leg reads near 0°.",
    needs: "Needs the right front hip bone, kneecap and front of the ankle stickers.",
  },
  "knee-in-left": {
    key: "knee-in-left",
    name: "Left knee, standing",
    tier: "reliable",
    unit: "deg",
    mdc: 2.7,
    context: "Front hip bone, kneecap and front of the ankle, seen from the front. A straight leg reads near 0°.",
    needs: "Needs the left front hip bone, kneecap and front of the ankle stickers.",
  },
  "front-hip-level": {
    key: "front-hip-level",
    name: "Front hip bones",
    tier: "trend",
    unit: "deg",
    mdc: 5.8,
    context: "Hip bones are hard to place a sticker on exactly: compare this only with your own checks.",
    needs: "Needs both front hip bone stickers.",
  },
  "back-hip-level": {
    key: "back-hip-level",
    name: "Low back dimples",
    tier: "trend",
    unit: "mm",
    mdc: 20,
    context: "Differences under about 2 cm cannot be told apart from where the stickers went.",
    needs: "Needs both low back dimple stickers, and the plumb line's tape marks for the scale.",
  },
  "pelvic-tilt": {
    key: "pelvic-tilt",
    name: "Pelvis tilt",
    tier: "trend",
    unit: "deg",
    mdc: 8,
    context: "Bone shape alone varies this by up to 11° between people, so compare it only with your own checks.",
    needs: "Needs the front hip bone and low back dimple stickers, seen from the side.",
  },
  "head-tilt": {
    key: "head-tilt",
    name: "Head tilt",
    tier: "trend",
    unit: "deg",
    mdc: 3,
    context: "Most people tilt their head a degree or two.",
    needs: "Needs your ears in view from the front.",
  },
  "trunk-lean": {
    key: "trunk-lean",
    name: "Trunk over hips",
    tier: "trend",
    unit: "deg",
    mdc: 6.5,
    context: null,
    needs: "Needs the breastbone and front hip bone stickers, or the neck and low back dimple stickers.",
  },
  "shoulder-forward-right": {
    key: "shoulder-forward-right",
    name: "Right shoulder, from the side",
    tier: "trend",
    unit: "deg",
    mdc: 8,
    context: "Where the shoulder tip sits against the line from the side hip bone up to the ear.",
    needs: "Needs the right ear, shoulder tip and side hip bone, seen from the right.",
  },
  "shoulder-forward-left": {
    key: "shoulder-forward-left",
    name: "Left shoulder, from the side",
    tier: "trend",
    unit: "deg",
    mdc: 8,
    context: "Where the shoulder tip sits against the line from the side hip bone up to the ear.",
    needs: "Needs the left ear, shoulder tip and side hip bone, seen from the left.",
  },
  "knee-back-right": {
    key: "knee-back-right",
    name: "Right knee, from the side",
    tier: "trend",
    unit: "deg",
    mdc: 12.7,
    context: null,
    needs: "Needs the right side hip bone, outer knee and outer ankle bone stickers.",
  },
  "knee-back-left": {
    key: "knee-back-left",
    name: "Left knee, from the side",
    tier: "trend",
    unit: "deg",
    mdc: 12.7,
    context: null,
    needs: "Needs the left side hip bone, outer knee and outer ankle bone stickers.",
  },
};

/** The order the report lists them in: reliable first, then trend-only. */
export const MEASURE_ORDER: MeasureKey[] = [
  "shoulder-level",
  "head-forward",
  "body-line",
  "knee-in-right",
  "knee-in-left",
  "front-hip-level",
  "back-hip-level",
  "pelvic-tilt",
  "head-tilt",
  "trunk-lean",
  "shoulder-forward-right",
  "shoulder-forward-left",
  "knee-back-right",
  "knee-back-left",
];

/** One measure, read from one view of one round. */
export type Reading = {
  key: MeasureKey;
  view: View;
  round: number;
  /** Degrees, signed per the measure (see `wordsFor`). */
  deg: number;
  /** Millimetres where the plumb line gave a scale and the measure has one. */
  mm: number | null;
  from: "stickers" | "model";
  /** The lines to draw over the figure or a photo, frame pixels. */
  lines: [Point, Point][];
};

const DEG = 180 / Math.PI;

function lvl(frame: LevelFrame, p: Point): Point {
  return toLevel(frame, p);
}

/** `a` lower than `b` reads positive, against true horizontal; and the drop in mm when there is a scale. */
function heightDrop(frame: LevelFrame, a: Point, b: Point, pxPerMetre: number | null): { deg: number; mm: number | null } {
  const pa = lvl(frame, a);
  const pb = lvl(frame, b);
  const dy = pb.y - pa.y;
  return {
    deg: Math.atan2(dy, Math.abs(pb.x - pa.x)) * DEG,
    mm: pxPerMetre ? (dy / pxPerMetre) * 1000 : null,
  };
}

/**
 * How far `mid` sits off the line from `a` to `c`, across it, in level
 * pixels at `mid`'s height: positive toward level +x.
 */
function offsetFromLine(frame: LevelFrame, a: Point, mid: Point, c: Point): number {
  const pa = lvl(frame, a);
  const pm = lvl(frame, mid);
  const pc = lvl(frame, c);
  const span = pc.y - pa.y;
  if (Math.abs(span) < 1e-9) return 0;
  const t = (pm.y - pa.y) / span;
  return pm.x - (pa.x + t * (pc.x - pa.x));
}

function seenPose(pose: PosePoint[] | null, i: number, min = 0.5): Point | null {
  const p = pose?.[i];
  return p && p.visibility >= min && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
}

/** Everything one held view can say. */
export function readView(c: ViewCapture): Reading[] {
  const frame = levelFrame(c.up);
  const s = c.stickers;
  const out: Reading[] = [];
  const push = (r: Omit<Reading, "view" | "round">) => out.push({ ...r, view: c.view, round: c.round });

  if (c.view === "front" || c.view === "back") {
    // Shoulder level, right lower positive. From the back the person's right
    // is on the picture's right; `heightDrop` does not care which side is which.
    let rs: Point | null = s["right-shoulder"] ?? null;
    let ls: Point | null = s["left-shoulder"] ?? null;
    let from: Reading["from"] = "stickers";
    if (!rs || !ls) {
      rs = seenPose(c.pose, 12);
      ls = seenPose(c.pose, 11);
      from = "model";
    }
    if (rs && ls) {
      const d = heightDrop(frame, rs, ls, c.pxPerMetre);
      push({ key: "shoulder-level", deg: d.deg, mm: d.mm, from, lines: [[rs, ls]] });
    }
  }

  if (c.view === "front") {
    const ra = s["right-front-hip"];
    const la = s["left-front-hip"];
    if (ra && la) {
      const d = heightDrop(frame, ra, la, c.pxPerMetre);
      push({ key: "front-hip-level", deg: d.deg, mm: d.mm, from: "stickers", lines: [[ra, la]] });
    }
    // Head tilt from the pose model's ears (the ear stickers face the sides).
    const re = seenPose(c.pose, 8);
    const le = seenPose(c.pose, 7);
    if (re && le) {
      const d = heightDrop(frame, re, le, null);
      push({ key: "head-tilt", deg: d.deg, mm: null, from: "model", lines: [[re, le]] });
    }
    // Trunk over hips: the breastbone against the middle of the front hip
    // bones. From the front the person's right is the picture's left, so a
    // shift to picture-left is a shift to their right: positive.
    const bb = s.breastbone;
    if (bb && ra && la) {
      const mid = { x: (ra.x + la.x) / 2, y: (ra.y + la.y) / 2 };
      const pm = lvl(frame, mid);
      const pb = lvl(frame, bb);
      const lean = Math.atan2(pb.x - pm.x, pb.y - pm.y) * DEG;
      push({ key: "trunk-lean", deg: -lean, mm: null, from: "stickers", lines: [[mid, bb]] });
    }
    // Standing knee alignment (the frontal plane projection angle, standing):
    // 180° less the angle at the kneecap, positive when the knee sits inward
    // of the hip-to-ankle line. The person's right leg is on the picture's
    // left, so "inward" is picture-right for it and picture-left for the left.
    for (const side of ["right", "left"] as const) {
      const hip = s[`${side}-front-hip`];
      const knee = s[`${side}-kneecap`];
      const ankle = s[`${side}-ankle-front`];
      if (!hip || !knee || !ankle) continue;
      const bend = 180 - angleAt(hip, knee, ankle);
      const inward = side === "right" ? 1 : -1;
      const off = offsetFromLine(frame, hip, knee, ankle) * inward;
      push({
        key: side === "right" ? "knee-in-right" : "knee-in-left",
        deg: off >= 0 ? bend : -bend,
        mm: null,
        from: "stickers",
        lines: [
          [hip, knee],
          [knee, ankle],
        ],
      });
    }
  }

  if (c.view === "back") {
    const rp = s["right-back-hip"];
    const lp = s["left-back-hip"];
    if (rp && lp && c.pxPerMetre) {
      const d = heightDrop(frame, rp, lp, c.pxPerMetre);
      push({ key: "back-hip-level", deg: d.deg, mm: d.mm, from: "stickers", lines: [[rp, lp]] });
    }
    // Trunk over hips from behind: the base of the neck against the middle of
    // the low back dimples. From behind the person's right is the picture's right.
    const c7 = s.neck;
    if (c7 && rp && lp) {
      const mid = { x: (rp.x + lp.x) / 2, y: (rp.y + lp.y) / 2 };
      const pm = lvl(frame, mid);
      const pc = lvl(frame, c7);
      const lean = Math.atan2(pc.x - pm.x, pc.y - pm.y) * DEG;
      push({ key: "trunk-lean", deg: lean, mm: null, from: "stickers", lines: [[mid, c7]] });
    }
  }

  if (c.view === "right" || c.view === "left") {
    const side = c.view;
    // Facing: the right side to the phone means facing the picture's right.
    const forward = side === "right" ? 1 : -1;
    const c7 = s.neck;
    let ear: Point | null = s[`${side}-ear`] ?? null;
    let earFrom: Reading["from"] = "stickers";
    if (!ear) {
      ear = seenPose(c.pose, side === "right" ? 8 : 7, 0.3);
      earFrom = "model";
    }
    const acr = s[`${side}-shoulder`];
    const asis = s[`${side}-front-hip`];
    const psis = s[`${side}-back-hip`];
    const troch = s[`${side}-hip-side`];
    const knee = s[`${side}-knee-side`];
    const mall = s[`${side}-ankle-side`];

    if (c7 && ear) {
      // The craniovertebral angle: up from the neck sticker to the ear,
      // against the horizontal pointing forward.
      const a = lvl(frame, c7);
      const b = lvl(frame, ear);
      push({
        key: "head-forward",
        deg: Math.atan2(b.y - a.y, (b.x - a.x) * forward) * DEG,
        mm: null,
        from: earFrom,
        lines: [[c7, ear]],
      });
    }
    if (acr && mall) {
      // Shoulder tip over outer ankle bone against vertical; forward positive.
      const a = lvl(frame, mall);
      const b = lvl(frame, acr);
      push({
        key: "body-line",
        deg: Math.atan2((b.x - a.x) * forward, b.y - a.y) * DEG,
        mm: null,
        from: "stickers",
        lines: [[mall, acr]],
      });
    }
    if (asis && psis) {
      // Front hip bone lower than the low back dimple: tipped forward, positive.
      const a = lvl(frame, asis);
      const p = lvl(frame, psis);
      push({
        key: "pelvic-tilt",
        deg: Math.atan2(p.y - a.y, Math.abs(p.x - a.x)) * DEG,
        mm: null,
        from: "stickers",
        lines: [[asis, psis]],
      });
    }
    if (acr && troch && ear) {
      // The shoulder tip against the line from the side hip bone up to the
      // ear: the angle at the hip between the two, forward positive.
      const t = lvl(frame, troch);
      const e = lvl(frame, ear);
      const a = lvl(frame, acr);
      const toEar = Math.atan2((e.x - t.x) * forward, e.y - t.y);
      const toAcr = Math.atan2((a.x - t.x) * forward, a.y - t.y);
      push({
        key: side === "right" ? "shoulder-forward-right" : "shoulder-forward-left",
        deg: (toAcr - toEar) * DEG,
        mm: null,
        from: earFrom,
        lines: [
          [troch, ear],
          [troch, acr],
        ],
      });
    }
    if (troch && knee && mall) {
      // A knee behind the hip-to-ankle line bends back (positive); in front of
      // it, it stays a little bent (negative).
      const bend = 180 - angleAt(troch, knee, mall);
      const off = offsetFromLine(frame, troch, knee, mall) * forward;
      push({
        key: side === "right" ? "knee-back-right" : "knee-back-left",
        deg: off <= 0 ? bend : -bend,
        mm: null,
        from: "stickers",
        lines: [
          [troch, knee],
          [knee, mall],
        ],
      });
    }
  }
  return out;
}

/** Plain words for a value, signed the way `readView` signs it. */
export function wordsFor(key: MeasureKey, deg: number, mm: number | null): string {
  const a = Math.abs(deg);
  const d = `${a.toFixed(1)}°`;
  const withMm = mm !== null && Number.isFinite(mm) ? ` (${Math.round(Math.abs(mm))} mm)` : "";
  const level = a < 0.3;
  switch (key) {
    case "shoulder-level":
      return level ? "Level" : `${deg > 0 ? "Right" : "Left"} shoulder lower by ${d}${withMm}`;
    case "front-hip-level":
      return level ? "Level" : `${deg > 0 ? "Right" : "Left"} front hip bone lower by ${d}${withMm}`;
    case "back-hip-level":
      return mm === null ? `${deg > 0 ? "Right" : "Left"} side lower by ${d}` : Math.abs(mm) < 1 ? "Level" : `${deg > 0 ? "Right" : "Left"} dimple lower by ${Math.round(Math.abs(mm))} mm`;
    case "head-tilt":
      return level ? "Level" : `Tilted to your ${deg > 0 ? "right" : "left"} by ${d}`;
    case "trunk-lean":
      return level ? "Straight over your hips" : `Shifted to your ${deg > 0 ? "right" : "left"} by ${d}`;
    case "knee-in-right":
    case "knee-in-left":
      return level ? "Straight" : `Turns ${deg > 0 ? "in" : "out"} by ${d}`;
    case "head-forward":
      return `${a.toFixed(1)}°`;
    case "body-line":
      return level ? "Upright" : `Leaning ${deg > 0 ? "forward" : "back"} by ${d}`;
    case "pelvic-tilt":
      return level ? "Level" : `Tipped ${deg > 0 ? "forward" : "back"} by ${d}`;
    case "shoulder-forward-right":
    case "shoulder-forward-left":
      return level ? "On the line" : `${deg > 0 ? "Ahead of" : "Behind"} the line by ${d}`;
    case "knee-back-right":
    case "knee-back-left":
      return level ? "Straight" : deg > 0 ? `Bends back ${d}` : `Stays bent ${d}`;
  }
}
