import { LM, type View } from "./sticker-map";
import { toLevel, type LevelFrame, type Point } from "./geometry";

/**
 * WHICH WAY THE PERSON FACES, AND WHETHER ALL OF THEM IS IN THE PICTURE
 * (docs/modules/posture.md, "The views"). Pure over the pose model's points,
 * in picture pixels.
 *
 * The camera is the REAR one, so its picture is not mirrored: facing the
 * phone, a person's left shoulder is on the picture's right. Turning to their
 * own left from there shows the phone their RIGHT side, and their nose then
 * points to the picture's right.
 */

export type PosePoint = Point & { visibility: number };

/** A point the model is sure enough of to use. */
export function seen(p: PosePoint | undefined, min = 0.5): p is PosePoint {
  return !!p && p.visibility >= min && Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Shoulder midpoint to hip midpoint, in pixels: the unit a sticker's offset is in. */
export function torsoLength(points: readonly PosePoint[]): number {
  const ls = points[LM.leftShoulder];
  const rs = points[LM.rightShoulder];
  const lh = points[LM.leftHip];
  const rh = points[LM.rightHip];
  if (!ls || !rs || !lh || !rh) return Number.NaN;
  const s = midpoint(ls, rs);
  const h = midpoint(lh, rh);
  return Math.hypot(s.x - h.x, s.y - h.y);
}

export type ViewGuess = { view: View | null; confidence: number; facing: 1 | -1 | 0 };

/**
 * The view, from how wide the shoulders look against the torso, whether the
 * face is seen, and which shoulder is on which side of the picture.
 * `facing` is the way the nose points in a side view (+1 the picture's right).
 */
export function viewOf(points: readonly PosePoint[], frame: LevelFrame): ViewGuess {
  const ls = points[LM.leftShoulder];
  const rs = points[LM.rightShoulder];
  const torso = torsoLength(points);
  if (!ls || !rs || !(torso > 0)) return { view: null, confidence: 0, facing: 0 };
  const L = toLevel(frame, ls);
  const R = toLevel(frame, rs);
  const span = Math.abs(L.x - R.x) / torso;
  const nose = points[LM.nose];
  const le = points[LM.leftEar];
  const re = points[LM.rightEar];
  const faceSeen =
    (nose?.visibility ?? 0) >= 0.5 && ((points[LM.leftEye]?.visibility ?? 0) >= 0.5 || (points[LM.rightEye]?.visibility ?? 0) >= 0.5);

  if (span >= 0.45) {
    // Facing the phone, the person's left shoulder is on the picture's right.
    // When that and the face disagree (a model that swapped left and right
    // from behind), the face decides, with less confidence.
    const leftOnRight = L.x > R.x;
    if (faceSeen === leftOnRight) return { view: faceSeen ? "front" : "back", confidence: Math.min(1, span), facing: 0 };
    return { view: faceSeen ? "front" : "back", confidence: 0.5, facing: 0 };
  }
  if (span <= 0.3 && nose && (le || re)) {
    const ears = [le, re].filter((e): e is PosePoint => seen(e, 0.3));
    if (ears.length === 0) return { view: null, confidence: 0, facing: 0 };
    const ear = { x: ears.reduce((s, e) => s + e.x, 0) / ears.length, y: ears.reduce((s, e) => s + e.y, 0) / ears.length };
    const n = toLevel(frame, nose);
    const e = toLevel(frame, ear);
    const facing: 1 | -1 = n.x >= e.x ? 1 : -1;
    // Nose to the picture's right: the person's right side faces the phone.
    return { view: facing === 1 ? "right" : "left", confidence: Math.min(1, (0.3 - span) / 0.2 + 0.5), facing };
  }
  return { view: null, confidence: 0, facing: 0 };
}

export type Framing = {
  /** Everything from the top of the head to the toes is in the picture, with room to spare. */
  whole: boolean;
  /** The person's height as a share of the picture's height. */
  fill: number;
  /** The body's centre across the picture, 0 (left edge) to 1. */
  centre: number;
  advice: FramingAdvice | null;
};

export type FramingAdvice = "step-back" | "step-closer" | "move-picture-left" | "move-picture-right" | "no-feet" | "no-head";

/**
 * Whether the whole body is in the picture, and if not what would fix it.
 * The top of the head is not a pose point: it is taken as far above the nose
 * as the nose is above the shoulders' midpoint, which errs high.
 */
export function framingOf(
  points: readonly PosePoint[],
  size: { width: number; height: number },
  opts: { margin: number; minFill: number; maxFill: number },
): Framing {
  const ls = points[LM.leftShoulder];
  const rs = points[LM.rightShoulder];
  const nose = points[LM.nose];
  const feet = [LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex]
    .map((i) => points[i])
    .filter((p): p is PosePoint => seen(p, 0.3));
  const all = points.filter((p) => seen(p, 0.3));
  if (!ls || !rs || !nose || all.length === 0) {
    return { whole: false, fill: 0, centre: 0.5, advice: null };
  }
  const shoulders = midpoint(ls, rs);
  const headTop = nose.y - Math.max(0, shoulders.y - nose.y);
  const bottom = feet.length > 0 ? Math.max(...feet.map((p) => p.y)) : Math.max(...all.map((p) => p.y));
  const xs = all.map((p) => p.x);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const fill = (bottom - headTop) / size.height;
  const centre = (left + right) / 2 / size.width;
  const m = opts.margin;
  const headIn = headTop >= m * size.height;
  const feetIn = feet.length >= 2 && bottom <= (1 - m) * size.height;
  const sidesIn = left >= m * size.width && right <= (1 - m) * size.width;
  let advice: FramingAdvice | null = null;
  if (!headIn && !feetIn) advice = "step-back";
  else if (!feetIn) advice = "no-feet";
  else if (!headIn) advice = "no-head";
  else if (!sidesIn) advice = centre < 0.5 ? "move-picture-right" : "move-picture-left";
  else if (fill > opts.maxFill) advice = "step-back";
  else if (fill < opts.minFill) advice = "step-closer";
  return { whole: headIn && feetIn && sidesIn, fill, centre, advice };
}

/**
 * Picture-left or picture-right, in the person's own words for the view they
 * are in: facing the phone, the picture's right is their left.
 */
export function towardPersonSide(direction: "picture-left" | "picture-right", view: View): "left" | "right" | "forward" | "back" {
  const right = direction === "picture-right";
  switch (view) {
    case "front":
      return right ? "left" : "right";
    case "back":
      return right ? "right" : "left";
    case "right":
      // Right side to the phone, nose to the picture's right.
      return right ? "forward" : "back";
    case "left":
      return right ? "back" : "forward";
  }
}

/** Mean of the pose points over frames, and how still the person was (median movement, pixels). */
export function stillness(history: readonly (readonly PosePoint[])[], indices: readonly number[]): number {
  if (history.length < 2) return Number.POSITIVE_INFINITY;
  const moves: number[] = [];
  for (let f = 1; f < history.length; f++) {
    for (const i of indices) {
      const a = history[f - 1][i];
      const b = history[f][i];
      if (seen(a, 0.3) && seen(b, 0.3)) moves.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  if (moves.length === 0) return Number.POSITIVE_INFINITY;
  moves.sort((x, y) => x - y);
  return moves[moves.length >> 1];
}
