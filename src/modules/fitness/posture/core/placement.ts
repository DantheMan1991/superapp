import { levelFrame, toLevel, type Point } from "./geometry";
import type { MeasureKey, ViewCapture } from "./measures";
import { stickerById, stickersIn, VIEWS, type View } from "./sticker-map";
import { predict } from "./stickers";
import { torsoLength } from "./views";

/**
 * WHERE A STICKER WENT, AGAINST LAST TIME (docs/modules/posture.md, slice 3b).
 * Pure.
 *
 * Sticker placement is the largest error a check has (ADR 0119), and nobody
 * has studied self-placed stickers. A sticker's place is read against the
 * body the pose model found: how far it sits from where its bone's landmark
 * says it should, in the level frame, in torso lengths. The same body standing
 * differently moves the sticker and the landmark together, so that offset
 * stays; a sticker put on in a different spot moves it. Two checks' offsets,
 * view by view, give how far a sticker moved on the skin.
 *
 * The pose model's points are centimetres off the bones and wander a little
 * between sessions, so only a slip of two or three centimetres shows. That is
 * what `SLIPPED_MM` and `LISTED_MM` are for: the first is loud enough to stop
 * a check (the founder's call, 2026-09-30), the second only listed in a report.
 */

/** A sticker this far from last time's place is named during the check, and the person asked to fix it. */
export const SLIPPED_MM = 30;
/** A sticker this far from the compared check's place is listed in the report. */
export const LISTED_MM = 20;
/** A torso, shoulder to hip, when there is no scale to say (an adult's, roughly). */
const TORSO_MM = 480;

export type Place = {
  view: View;
  /** From where the landmark says the sticker belongs, in torso lengths: x to true right, y to true up. */
  offset: Point;
  /** Millimetres per torso length in this capture, from the plumb line's scale; null without one. */
  mmPerTorso: number | null;
};

/** Every sticker's place in each view, from the first round of each view; keyed `view:stickerId`. */
export function placesOf(captures: readonly ViewCapture[]): Record<string, Place> {
  const out: Record<string, Place> = {};
  for (const view of VIEWS) {
    const c = captures.filter((x) => x.view === view).sort((a, b) => a.round - b.round)[0];
    if (!c?.pose) continue;
    const frame = levelFrame(c.up);
    const torso = torsoLength(c.pose);
    if (!(torso > 0)) continue;
    // Facing: the right side to the phone faces the picture's right (core/measures.ts).
    const facing = view === "right" ? 1 : view === "left" ? -1 : 0;
    const mmPerTorso = c.pxPerMetre ? (torso / c.pxPerMetre) * 1000 : null;
    for (const p of predict(stickersIn(view), view, c.pose, frame, facing)) {
      const at = c.stickers[p.sticker.id];
      if (!at) continue;
      const a = toLevel(frame, at);
      const e = toLevel(frame, p.at);
      out[`${view}:${p.sticker.id}`] = { view, offset: { x: (a.x - e.x) / torso, y: (a.y - e.y) / torso }, mmPerTorso };
    }
  }
  return out;
}

export type Shift = {
  id: string;
  name: string;
  view: View;
  /** How far it moved, millimetres (about, when neither check had a scale). */
  mm: number;
  approximate: boolean;
  /** Which way, in the person's own terms: "3.1 cm higher". */
  words: string;
};

function sideways(view: View, dx: number): string {
  // True right is the picture's right. Facing the phone, that is the person's left.
  switch (view) {
    case "front":
      return dx > 0 ? "toward your left" : "toward your right";
    case "back":
      return dx > 0 ? "toward your right" : "toward your left";
    case "right":
      return dx > 0 ? "further forward" : "further back";
    case "left":
      return dx > 0 ? "further back" : "further forward";
  }
}

function cm(mm: number): string {
  return `${(mm / 10).toFixed(1)} cm`;
}

/**
 * How far each sticker moved from one check to another, largest first: the
 * first view (front, right, back, left) both checks read it in. Only stickers
 * both checks found.
 */
export function shiftsBetween(now: Record<string, Place>, then: Record<string, Place>): Shift[] {
  const out: Shift[] = [];
  const seen = new Set<string>();
  for (const view of VIEWS) {
    for (const key of Object.keys(now)) {
      if (!key.startsWith(`${view}:`)) continue;
      const id = key.slice(view.length + 1);
      if (seen.has(id) || !then[key]) continue;
      seen.add(id);
      const a = now[key];
      const b = then[key];
      const scale = a.mmPerTorso ?? b.mmPerTorso;
      const perTorso = scale ?? TORSO_MM;
      const dx = (a.offset.x - b.offset.x) * perTorso;
      const dy = (a.offset.y - b.offset.y) * perTorso;
      const mm = Math.hypot(dx, dy);
      const way = Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? "higher" : "lower") : sideways(view, dx);
      out.push({
        id,
        name: stickerById(id)?.name ?? id,
        view,
        mm,
        approximate: scale === null,
        words: `${scale === null ? "about " : ""}${cm(mm)} ${way}`,
      });
    }
  }
  return out.sort((a, b) => b.mm - a.mm);
}

/** The stickers each measure is read from (core/measures.ts `readView`). */
export const MEASURE_STICKERS: Record<MeasureKey, readonly string[]> = {
  "shoulder-level": ["right-shoulder", "left-shoulder"],
  "front-hip-level": ["right-front-hip", "left-front-hip"],
  "back-hip-level": ["right-back-hip", "left-back-hip"],
  "head-tilt": [],
  "trunk-lean": ["breastbone", "right-front-hip", "left-front-hip", "neck", "right-back-hip", "left-back-hip"],
  "knee-in-right": ["right-front-hip", "right-kneecap", "right-ankle-front"],
  "knee-in-left": ["left-front-hip", "left-kneecap", "left-ankle-front"],
  "head-forward": ["neck", "right-ear", "left-ear"],
  "body-line": ["right-shoulder", "left-shoulder", "right-ankle-side", "left-ankle-side"],
  "pelvic-tilt": ["right-front-hip", "left-front-hip", "right-back-hip", "left-back-hip"],
  "shoulder-forward-right": ["right-ear", "right-shoulder", "right-hip-side"],
  "shoulder-forward-left": ["left-ear", "left-shoulder", "left-hip-side"],
  "knee-back-right": ["right-hip-side", "right-knee-side", "right-ankle-side"],
  "knee-back-left": ["left-hip-side", "left-knee-side", "left-ankle-side"],
};

/** The moved stickers a measure is read from. */
export function movedFor(key: MeasureKey, shifts: readonly Shift[], atLeastMm = LISTED_MM): Shift[] {
  const uses = new Set(MEASURE_STICKERS[key]);
  return shifts.filter((s) => s.mm >= atLeastMm && uses.has(s.id));
}
