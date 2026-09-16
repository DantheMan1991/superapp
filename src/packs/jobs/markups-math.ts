/**
 * The geometry of a markup (ADR 0073), pure so `tests/jobs-markups.test.ts`
 * can say what the viewer and the ops both rely on. Every coordinate is a
 * FRACTION of the page — 0 at the left or top edge, 1 at the right or
 * bottom — so a cloud drawn on a phone at 3× lands on the same footing as
 * one drawn on a desk at 1×, and the sheet's PDF is never touched.
 */

import { MARKUP_COLORS, MARKUP_KINDS, MEASURE_POINTS_MAX, type MarkupColor, type MarkupKind, type MeasureKind } from "./vocabulary";

export interface CloudGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ArrowGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface PointGeometry {
  x: number;
  y: number;
}
/** A length, an area or a count: points on the page (ADR 0074). */
export interface PointsGeometry {
  points: PointGeometry[];
}
export type MarkupGeometry = CloudGeometry | ArrowGeometry | PointGeometry | PointsGeometry;

/** The fewest points a measuring kind needs: a length is a line, an area a triangle, a count a tap. */
export const MIN_POINTS: Record<MeasureKind, number> = { length: 2, area: 3, count: 1 };

/** The stored shape of a measurement: points within the page, enough of them, not too many. */
export function parsePoints(kind: MeasureKind, raw: unknown): PointsGeometry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("geometry must be an object");
  const list = (raw as Record<string, unknown>).points;
  if (!Array.isArray(list)) throw new Error("points must be a list");
  if (list.length < MIN_POINTS[kind]) {
    throw new Error(kind === "length" ? "a length needs two points" : kind === "area" ? "an area needs three points" : "a count needs a tap");
  }
  if (list.length > MEASURE_POINTS_MAX) throw new Error(`a measurement has at most ${MEASURE_POINTS_MAX} points`);
  const points = list.map((p, i) => {
    if (typeof p !== "object" || p === null) throw new Error(`point ${i + 1} must be a point`);
    const { x, y } = p as Record<string, unknown>;
    if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) throw new Error(`point ${i + 1} must be numbers`);
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error(`point ${i + 1} must be within the page`);
    return { x, y };
  });
  return { points };
}

/** Smaller than this, as a fraction of the page, is a slip of the finger and not a markup. */
export const MIN_EXTENT = 0.004;

function fraction(raw: Record<string, unknown>, key: string): number {
  const v = raw[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${key} must be a number`);
  if (v < 0 || v > 1) throw new Error(`${key} must be within the page`);
  return v;
}

/**
 * The stored shape for a kind, checked and normalised: a cloud dragged from
 * its bottom-right corner comes out with a positive width and height, and
 * every number is within the page. Throws a plain Error the ops turn into
 * `INVALID_VALUE` and the viewer never lets happen.
 */
export function parseGeometry(kind: MarkupKind, raw: unknown): MarkupGeometry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("geometry must be an object");
  const r = raw as Record<string, unknown>;
  switch (kind) {
    case "cloud": {
      const x = fraction(r, "x");
      const y = fraction(r, "y");
      const w = fraction(r, "w");
      const h = fraction(r, "h");
      if (w < MIN_EXTENT || h < MIN_EXTENT) throw new Error("a cloud needs some size");
      if (x + w > 1 || y + h > 1) throw new Error("a cloud must stay within the page");
      return { x, y, w, h };
    }
    case "arrow": {
      const x1 = fraction(r, "x1");
      const y1 = fraction(r, "y1");
      const x2 = fraction(r, "x2");
      const y2 = fraction(r, "y2");
      if (Math.hypot(x2 - x1, y2 - y1) < MIN_EXTENT) throw new Error("an arrow needs some length");
      return { x1, y1, x2, y2 };
    }
    case "text":
    case "pin":
      return { x: fraction(r, "x"), y: fraction(r, "y") };
    case "length":
    case "area":
    case "count":
      return parsePoints(kind, raw);
  }
}

/** A drag from any corner to any other, as the cloud it means, to a millionth of the page — a fraction stored as JSON wants no float dust. */
export function normaliseBox(ax: number, ay: number, bx: number, by: number): CloudGeometry {
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x: round6(x), y: round6(y), w: round6(Math.abs(bx - ax)), h: round6(Math.abs(by - ay)) };
}

export function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

export function clampFraction(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * A revision cloud: the rectangle's outline drawn as arcs that bulge
 * outward, the way every drafter has drawn one since drafting tape. The
 * path is in the caller's units (page points on the sheet's SVG), walked
 * clockwise from the top-left corner, `scallop` units per arc.
 */
export function cloudPath(x: number, y: number, w: number, h: number, scallop: number): string {
  const parts: string[] = [`M ${fmt(x)} ${fmt(y)}`];
  const edges: Array<[number, number, number, number]> = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h],
    [x, y + h, x, y],
  ];
  for (const [ax, ay, bx, by] of edges) {
    const length = Math.hypot(bx - ax, by - ay);
    const n = arcsAlong(length, scallop);
    const r = (length / n) * 0.6;
    for (let i = 1; i <= n; i++) {
      const px = ax + ((bx - ax) * i) / n;
      const py = ay + ((by - ay) * i) / n;
      // sweep-flag 1 is clockwise on a y-down screen, which for a clockwise walk bulges OUTWARD.
      parts.push(`A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(px)} ${fmt(py)}`);
    }
  }
  parts.push("Z");
  return parts.join(" ");
}

/** At most this many arcs on one edge: a zero scallop is a request for a rectangle, not for a million arcs. */
export const MAX_ARCS_PER_EDGE = 400;

function arcsAlong(length: number, scallop: number): number {
  if (!(scallop > 0)) return MAX_ARCS_PER_EDGE;
  return Math.min(MAX_ARCS_PER_EDGE, Math.max(1, Math.round(length / scallop)));
}

/** How many arcs `cloudPath` draws for a box, so a test can count them. */
export function cloudArcCount(w: number, h: number, scallop: number): number {
  return 2 * arcsAlong(w, scallop) + 2 * arcsAlong(h, scallop);
}

/**
 * The two barbs of an arrowhead at the tip (x2, y2), `size` units long, as
 * the points of a polygon with the tip. In the caller's units.
 */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): [number, number, number, number] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    x2 - size * Math.cos(angle - spread),
    y2 - size * Math.sin(angle - spread),
    x2 - size * Math.cos(angle + spread),
    y2 - size * Math.sin(angle + spread),
  ];
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

// --------------------------------------------------------------- the list

export interface MarkupLike {
  id: string;
  kind: string;
  createdAt: string;
  workItemId: string | null;
  punchDone: boolean | null;
}

export interface MarkupSummary {
  count: number;
  byKind: Record<MarkupKind, number>;
  /** Pins that raised a punch item still open. */
  openPins: number;
  /** Pins whose punch item is done, or that never raised one. */
  settledPins: number;
}

export function summariseMarkups(markups: readonly MarkupLike[]): MarkupSummary {
  const byKind = Object.fromEntries(MARKUP_KINDS.map((k) => [k, 0])) as Record<MarkupKind, number>;
  let openPins = 0;
  let settledPins = 0;
  for (const m of markups) {
    if ((MARKUP_KINDS as readonly string[]).includes(m.kind)) byKind[m.kind as MarkupKind] += 1;
    if (m.kind === "pin") {
      if (m.workItemId && m.punchDone === false) openPins += 1;
      else settledPins += 1;
    }
  }
  return { count: markups.length, byKind, openPins, settledPins };
}

/**
 * Pins are numbered in the order they were made, per sheet, so "pin 3" means
 * the same thing on the drawing, in the list and on the site.
 */
export function pinNumbers(markups: readonly MarkupLike[]): Map<string, number> {
  const pins = markups.filter((m) => m.kind === "pin").sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  return new Map(pins.map((p, i) => [p.id, i + 1]));
}

/** The kinds as the sentence says them, one and many. A length was once "a pin" here, found by driving. */
const KIND_WORDS: Record<MarkupKind, [string, string]> = {
  cloud: ["cloud", "clouds"],
  arrow: ["arrow", "arrows"],
  text: ["note", "notes"],
  pin: ["pin", "pins"],
  length: ["length", "lengths"],
  area: ["area", "areas"],
  count: ["count", "counts"],
};

/** One sentence for the sheet's page. */
export function markupSentence(summary: MarkupSummary): string {
  if (summary.count === 0) return "Nothing drawn on this issue.";
  const parts: string[] = [];
  for (const k of MARKUP_KINDS) {
    const n = summary.byKind[k];
    if (n > 0) parts.push(`${n} ${n === 1 ? KIND_WORDS[k][0] : KIND_WORDS[k][1]}`);
  }
  const pins = summary.openPins > 0 ? `; ${summary.openPins} ${summary.openPins === 1 ? "pin is" : "pins are"} still open on the punch list` : "";
  return `${parts.join(", ")}${pins}.`;
}

export function isKnownColor(v: string): v is MarkupColor {
  return (MARKUP_COLORS as readonly string[]).includes(v);
}
