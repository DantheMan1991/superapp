/**
 * The arithmetic of a takeoff (ADR 0074), pure so `tests/jobs-takeoff.test.ts`
 * can say what the viewer and the ops both rely on: what a sheet's scale is,
 * how a measurement's fractions of the page become feet, square feet or a
 * count, and what goes onto an estimate line.
 *
 * A scale is PAGE POINTS PER UNIT OF THE WORLD, with the page's size in
 * points kept beside it, because a measurement is stored as fractions of the
 * page (ADR 0073) and fractions of a landscape page are not the same length
 * across as down. With those four numbers the server measures without ever
 * opening the PDF, and the viewer measures the same way.
 */

import type { PointGeometry, PointsGeometry } from "./markups-math";
import { FIGURE_FAMILY, MEASURE_POINTS_MAX, type FigureFamily, type MeasureKind, type ScaleUnit, type TraceFigure } from "./vocabulary";

/** A PDF point is 1/72 of an inch; a metre is 39.3701 of them. */
export const POINTS_PER_INCH = 72;
export const POINTS_PER_METRE = POINTS_PER_INCH / 0.0254;

export interface SheetScale {
  pointsPerUnit: number;
  unit: ScaleUnit;
  pageWidthPt: number;
  pageHeightPt: number;
}

export interface StandardScale {
  key: string;
  label: string;
  unit: ScaleUnit;
  /** Page points per unit of the world when the sheet is printed at its own size. */
  pointsPerUnit: number;
}

/**
 * The scales an architect writes in a title block, as points per foot or
 * metre WHEN THE PDF IS THE SHEET'S OWN SIZE. A half-size plot lies about
 * every one of these, which is what the known-dimension calibration is for.
 */
export const STANDARD_SCALES: readonly StandardScale[] = [
  ...[
    ["1/16", 1 / 16],
    ["1/8", 1 / 8],
    ["3/16", 3 / 16],
    ["1/4", 1 / 4],
    ["3/8", 3 / 8],
    ["1/2", 1 / 2],
    ["3/4", 3 / 4],
    ["1", 1],
    ["1-1/2", 1.5],
    ["3", 3],
  ].map(([frac, inches]) => ({
    key: `arch:${frac}`,
    label: `${frac}" = 1'-0"`,
    unit: "ft" as const,
    pointsPerUnit: (inches as number) * POINTS_PER_INCH,
  })),
  ...[10, 20, 30, 40, 50, 60, 100].map((feet) => ({
    key: `eng:${feet}`,
    label: `1" = ${feet}'`,
    unit: "ft" as const,
    pointsPerUnit: POINTS_PER_INCH / feet,
  })),
  ...[20, 50, 100, 200, 500, 1000].map((ratio) => ({
    key: `metric:${ratio}`,
    label: `1:${ratio}`,
    unit: "m" as const,
    pointsPerUnit: POINTS_PER_METRE / ratio,
  })),
];

export function standardScale(key: string): StandardScale | null {
  return STANDARD_SCALES.find((s) => s.key === key) ?? null;
}

/**
 * The scale from a dimension the drawing states: two points on the page (as
 * fractions) and the length between them in the world. This is the honest
 * calibration — it is right on a half-size plot and on a sheet somebody
 * printed to fit — and the one the guide leads with.
 */
export function scaleFromKnownLength(
  a: PointGeometry,
  b: PointGeometry,
  length: number,
  unit: ScaleUnit,
  pageWidthPt: number,
  pageHeightPt: number,
): SheetScale {
  if (!(length > 0)) throw new Error("the known length must be more than nothing");
  if (!(pageWidthPt > 0) || !(pageHeightPt > 0)) throw new Error("the page's size is needed");
  const points = Math.hypot((b.x - a.x) * pageWidthPt, (b.y - a.y) * pageHeightPt);
  if (!(points > 0.5)) throw new Error("the two points are on top of each other");
  return { pointsPerUnit: points / length, unit, pageWidthPt, pageHeightPt };
}

/** A standard scale as the sheet's, for a page of this size. */
export function scaleFromStandard(key: string, pageWidthPt: number, pageHeightPt: number): SheetScale {
  const std = standardScale(key);
  if (!std) throw new Error(`no such scale: ${key}`);
  if (!(pageWidthPt > 0) || !(pageHeightPt > 0)) throw new Error("the page's size is needed");
  return { pointsPerUnit: std.pointsPerUnit, unit: std.unit, pageWidthPt, pageHeightPt };
}

/** The standard scale a sheet's own scale matches, if it matches one within a hair. */
export function matchingStandard(scale: SheetScale): StandardScale | null {
  return STANDARD_SCALES.find((s) => s.unit === scale.unit && Math.abs(s.pointsPerUnit - scale.pointsPerUnit) / s.pointsPerUnit < 0.002) ?? null;
}

// --------------------------------------------------------------- measuring

export interface Measurement {
  quantity: number;
  /** The world's unit: ft, sq ft, m, m², or each. */
  unit: string;
}

/** The length of a polyline, in page points, from fractions of a page of this size. */
export function pathPoints(points: readonly PointGeometry[], pageWidthPt: number, pageHeightPt: number): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot((points[i].x - points[i - 1].x) * pageWidthPt, (points[i].y - points[i - 1].y) * pageHeightPt);
  }
  return total;
}

/** The area of a polygon, in square page points, by the shoelace — any winding. */
export function polygonPoints(points: readonly PointGeometry[], pageWidthPt: number, pageHeightPt: number): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += a.x * pageWidthPt * (b.y * pageHeightPt) - b.x * pageWidthPt * (a.y * pageHeightPt);
  }
  return Math.abs(twice) / 2;
}

/**
 * What a measurement comes to. A count needs no scale; a length or an area
 * without one is null, and the page says to set the scale first.
 */
export function measure(kind: MeasureKind, geometry: PointsGeometry, scale: SheetScale | null): Measurement | null {
  if (kind === "count") return { quantity: geometry.points.length, unit: "each" };
  if (!scale) return null;
  if (kind === "length") {
    return { quantity: pathPoints(geometry.points, scale.pageWidthPt, scale.pageHeightPt) / scale.pointsPerUnit, unit: scale.unit };
  }
  return {
    quantity: polygonPoints(geometry.points, scale.pageWidthPt, scale.pageHeightPt) / (scale.pointsPerUnit * scale.pointsPerUnit),
    unit: scale.unit === "ft" ? "sq ft" : "m²",
  };
}

/** "24.5 ft", "312 sq ft", "×14" — one decimal for a length, none for an area past a hundred. */
export function formatMeasure(m: Measurement): string {
  if (m.unit === "each") return `×${m.quantity}`;
  const decimals = m.unit === "sq ft" || m.unit === "m²" ? (m.quantity >= 100 ? 0 : 1) : 1;
  return `${m.quantity.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals })} ${m.unit}`;
}

/**
 * The unit an estimate line takes from a measurement, in the words the trade
 * prices by: linear feet, square feet, each, cubic yards; metres, square
 * metres, cubic metres.
 */
export function takeoffUnitFor(kind: FigureFamily, scaleUnit: ScaleUnit | ""): string {
  if (kind === "count") return "ea";
  if (kind === "length") return scaleUnit === "m" ? "m" : "lf";
  if (kind === "volume") return scaleUnit === "m" ? "m3" : "cy";
  return scaleUnit === "m" ? "m2" : "sf";
}

/** A quantity in the line's thousandths, rounded, never negative. */
export function toThousandths(quantity: number): number {
  return Math.max(0, Math.round(quantity * 1000));
}

/**
 * THE LINE'S UNIT MUST BE THE MEASUREMENT'S, OR NOTHING.
 *
 * A push sets a quantity and the line's unit price does the rest, so an area
 * landing on a line priced per linear foot, per square yard or per lump sum
 * is a plausible wrong number that goes out in a proposal — the class this
 * pack refuses on sight. The trade spells one unit several ways (`sf`,
 * `sq ft`, `sq. ft.`, `square feet`), so a unit is reduced to the takeoff's
 * own word first; anything else is refused by name rather than converted,
 * because `sq` is a roofing square to one business and a square yard to the
 * next, and a conversion that guessed would be the same wrong number.
 */
const UNIT_WORDS: Record<string, string> = {
  lf: "lf",
  "lin ft": "lf",
  linft: "lf",
  lnft: "lf",
  ft: "lf",
  feet: "lf",
  foot: "lf",
  "linear feet": "lf",
  "linear foot": "lf",
  "lineal feet": "lf",
  sf: "sf",
  sqft: "sf",
  "sq ft": "sf",
  "square feet": "sf",
  "square foot": "sf",
  ea: "ea",
  each: "ea",
  m: "m",
  lm: "m",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  m2: "m2",
  "m²": "m2",
  sqm: "m2",
  "sq m": "m2",
  "square metres": "m2",
  "square meters": "m2",
  cy: "cy",
  "cu yd": "cy",
  cuyd: "cy",
  yd3: "cy",
  "cubic yard": "cy",
  "cubic yards": "cy",
  m3: "m3",
  "m³": "m3",
  "cu m": "m3",
  cum: "m3",
  "cubic metre": "m3",
  "cubic metres": "m3",
  "cubic meter": "m3",
  "cubic meters": "m3",
};

/** A unit as the trade writes it, reduced to the takeoff's word for it when it is one of those — else itself, lower-cased and trimmed. */
export function normaliseUnit(unit: string): string {
  const reduced = unit.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return UNIT_WORDS[reduced] ?? reduced;
}

/** Whether a line in this unit can take a quantity in the takeoff's unit: blank adopts it, the same word however spelled keeps it, anything else refuses. */
export function unitAccepts(lineUnit: string, takeoffUnit: string): boolean {
  const line = normaliseUnit(lineUnit);
  return line === "" || line === normaliseUnit(takeoffUnit);
}

/**
 * THE ESTIMATE A PUSH FROM THIS SHEET AIMS AT: the one the sheet's traces
 * already feed — the last link drawn wins — else the only one there is, else
 * the first. A sheet feeds one estimate at a time in practice, and the first
 * of a list was the wrong one whenever the job had two.
 */
export function estimateFedBy(links: readonly { estimateId: string }[], open: readonly { id: string }[]): string | null {
  for (let i = links.length - 1; i >= 0; i -= 1) {
    if (open.some((e) => e.id === links[i].estimateId)) return links[i].estimateId;
  }
  return open[0]?.id ?? null;
}

/**
 * Whether a measurement has moved on from what IT pushed: its quantity now
 * against the quantity it contributed to the line — its own, never the
 * line's total, or two measurements pushed together would both read as
 * drifted the moment after. Half a percent of slack, five thousandths on
 * anything smaller than one. The scale set again is what moves it.
 */
export function driftedSince(pushedThousandths: number | null, now: Measurement | null): boolean {
  if (pushedThousandths === null || now === null) return false;
  return Math.abs(toThousandths(now.quantity) - pushedThousandths) > Math.max(5, pushedThousandths * 0.005);
}

/**
 * How a drawing measures a line priced in this unit: an area for `sf` or
 * `m2`, a length for `lf` or `m`, a count for `ea`, a volume for `cy` or
 * `m3` (an area with a depth typed on it, ADR 0110). "ask" for a blank unit —
 * the line takes the measurement's — and null for a unit no drawing yields
 * (`ls`, `sy`, `hr`), which the ruler says rather than guesses at.
 */
export function measureKindForUnit(unit: string): FigureFamily | "ask" | null {
  const u = normaliseUnit(unit);
  if (u === "") return "ask";
  if (u === "sf" || u === "m2") return "area";
  if (u === "lf" || u === "m") return "length";
  if (u === "ea") return "count";
  if (u === "cy" || u === "m3") return "volume";
  return null;
}

// ------------------------------------------ the figures a trace yields (ADR 0110)

/** A pitch as it was said: `6:12` to one trade, `26.6°` to another. Either is kept as typed. */
export type Pitch = { rise: number } | { degrees: number };

/** A roof steeper than this is a wall, and the factor past it runs away. */
export const PITCH_DEGREES_MAX = 85;

/**
 * WHAT THE TRADE TYPES ONTO A TRACE so it yields more than one number. Kept
 * as typed, in the unit typed, because "9 ft" and "4 in" are what the
 * estimator said and what the working should read back.
 */
export interface TraceFigures {
  /** A wall's height on a length: the wall it stands is length × height. */
  height?: { value: number; unit: "ft" | "m" };
  /** A roof's pitch on a plan area, as the trade says it — rise per 12, or degrees: the roof is the plan × the slope's factor (`pitchFactorOf`). */
  pitch?: Pitch;
  /** A depth on an area, in inches or millimetres: the volume it fills. */
  depth?: { value: number; unit: "in" | "mm" };
  /** Openings taken out of an area: rings of points, fractions of the page, three or more each. */
  deducts?: PointGeometry[][];
}

/** At most this many openings out of one area; a room has fewer. */
export const DEDUCTS_MAX = 50;

function positive(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function ring(raw: unknown): PointGeometry[] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > MEASURE_POINTS_MAX) return null;
  const out: PointGeometry[] = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null) return null;
    const { x, y } = p as Record<string, unknown>;
    if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    out.push({ x, y });
  }
  return out;
}

/**
 * The figures a trace carries, read TOLERANTLY: a part that is not what it
 * should be is dropped, never guessed at, so a row written by a later version
 * of this file still reads. The same reader runs on both sides.
 */
export function parseFigures(raw: unknown): TraceFigures {
  const out: TraceFigures = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  const h = r.height;
  if (typeof h === "object" && h !== null) {
    const { value, unit } = h as Record<string, unknown>;
    const v = positive(value);
    if (v !== null && (unit === "ft" || unit === "m")) out.height = { value: v, unit };
  }
  const p = r.pitch;
  if (typeof p === "object" && p !== null) {
    const { rise, degrees } = p as Record<string, unknown>;
    if (typeof rise === "number" && Number.isFinite(rise) && rise >= 0 && rise <= 48) out.pitch = { rise };
    else if (typeof degrees === "number" && Number.isFinite(degrees) && degrees >= 0 && degrees <= PITCH_DEGREES_MAX) out.pitch = { degrees };
  }
  const d = r.depth;
  if (typeof d === "object" && d !== null) {
    const { value, unit } = d as Record<string, unknown>;
    const v = positive(value);
    if (v !== null && (unit === "in" || unit === "mm")) out.depth = { value: v, unit };
  }
  if (Array.isArray(r.deducts)) {
    const rings = r.deducts.map(ring).filter((x): x is PointGeometry[] => x !== null).slice(0, DEDUCTS_MAX);
    if (rings.length > 0) out.deducts = rings;
  }
  return out;
}

/** Whether a trace carries any figure at all — what decides if the row has a second line to read. */
export function hasFigures(f: TraceFigures): boolean {
  return f.height !== undefined || f.pitch !== undefined || f.depth !== undefined || (f.deducts?.length ?? 0) > 0;
}

/** A figure a trace yields, worked out under the sheet's scale, with its working in words. */
export interface Yield {
  figure: TraceFigure;
  measurement: Measurement;
  /** How it was worked out — "412 sq ft less 21 sq ft opening", "248 ft × 9 ft", "1,240 sq ft plan at 6:12", "391 sq ft × 4 in" — blank for the trace's own figure. */
  working: string;
}

const FT_PER_M = 1 / 0.3048;

/** A height in the sheet's unit. */
function heightIn(h: { value: number; unit: "ft" | "m" }, unit: ScaleUnit): number {
  if (h.unit === unit) return h.value;
  return unit === "ft" ? h.value * FT_PER_M : h.value / FT_PER_M;
}

/** A depth in the sheet's unit. */
function depthIn(d: { value: number; unit: "in" | "mm" }, unit: ScaleUnit): number {
  if (unit === "ft") return d.unit === "in" ? d.value / 12 : d.value / 304.8;
  return d.unit === "mm" ? d.value / 1000 : d.value * 0.0254;
}

export function formatHeight(h: { value: number; unit: "ft" | "m" }): string {
  return `${h.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${h.unit}`;
}

export function formatDepth(d: { value: number; unit: "in" | "mm" }): string {
  return `${d.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${d.unit}`;
}

/** The factor a roof's plan area grows by at this pitch: √(1 + (rise/12)²). 6:12 is 1.118. */
export function pitchFactor(rise: number): number {
  return Math.sqrt(1 + (rise / 12) ** 2);
}

/** The same factor for a pitch however it was said: a slope of θ degrees grows the plan by 1/cos θ — 45° is √2, as 12:12 is. */
export function pitchFactorOf(pitch: Pitch): number {
  return "rise" in pitch ? pitchFactor(pitch.rise) : 1 / Math.cos((pitch.degrees * Math.PI) / 180);
}

/** `6:12` or `30°`, as it was typed. */
export function formatPitch(pitch: Pitch): string {
  return "rise" in pitch ? `${pitch.rise}:12` : `${pitch.degrees}°`;
}

/** A pitch of nothing is a flat area, which yields no roof. */
export function isFlat(pitch: Pitch): boolean {
  return ("rise" in pitch ? pitch.rise : pitch.degrees) <= 0;
}

/**
 * EVERYTHING A TRACE YIELDS, each with its working. A count yields its count;
 * a length its length and — with a height — the wall it stands; an area its
 * NET area (the openings taken out), the run around it, and — with a pitch or
 * a depth — the roof it pitches to and the volume it fills. Nothing is stored:
 * every one is worked out when read, through the scale, so a scale set again
 * corrects all of them at once. An empty list while the sheet lacks the scale
 * a length or an area needs.
 */
export function yieldsOf(kind: MeasureKind, geometry: PointsGeometry, figures: TraceFigures, scale: SheetScale | null): Yield[] {
  const points = geometry.points;
  if (kind === "count") return [{ figure: "count", measurement: { quantity: points.length, unit: "each" }, working: "" }];
  if (!scale) return [];
  const { pageWidthPt: W, pageHeightPt: H, pointsPerUnit: ppu, unit } = scale;
  const areaUnit = unit === "ft" ? "sq ft" : "m²";
  if (kind === "length") {
    const length = pathPoints(points, W, H) / ppu;
    const out: Yield[] = [{ figure: "length", measurement: { quantity: length, unit }, working: "" }];
    if (figures.height) {
      const h = heightIn(figures.height, unit);
      out.push({
        figure: "wall",
        measurement: { quantity: length * h, unit: areaUnit },
        working: `${formatMeasure({ quantity: length, unit })} × ${formatHeight(figures.height)}`,
      });
    }
    return out;
  }
  const gross = polygonPoints(points, W, H) / (ppu * ppu);
  const openings = figures.deducts ?? [];
  const taken = openings.reduce((sum, r) => sum + polygonPoints(r, W, H) / (ppu * ppu), 0);
  const net = Math.max(0, gross - taken);
  const out: Yield[] = [
    {
      figure: "area",
      measurement: { quantity: net, unit: areaUnit },
      working:
        openings.length > 0
          ? `${formatMeasure({ quantity: gross, unit: areaUnit })} less ${formatMeasure({ quantity: taken, unit: areaUnit })} in ${openings.length} ${openings.length === 1 ? "opening" : "openings"}`
          : "",
    },
    {
      figure: "perimeter",
      measurement: { quantity: pathPoints([...points, points[0]], W, H) / ppu, unit },
      working: "around it",
    },
  ];
  if (figures.pitch && !isFlat(figures.pitch)) {
    out.push({
      figure: "roof",
      measurement: { quantity: net * pitchFactorOf(figures.pitch), unit: areaUnit },
      working: `${formatMeasure({ quantity: net, unit: areaUnit })} of plan at ${formatPitch(figures.pitch)}`,
    });
  }
  if (figures.depth) {
    const deep = net * depthIn(figures.depth, unit);
    out.push({
      figure: "volume",
      measurement: unit === "ft" ? { quantity: deep / 27, unit: "cy" } : { quantity: deep, unit: "m³" },
      working: `${formatMeasure({ quantity: net, unit: areaUnit })} × ${formatDepth(figures.depth)}`,
    });
  }
  return out;
}

/** One figure of a trace, or null when the trace does not yield it. */
export function yieldFor(kind: MeasureKind, geometry: PointsGeometry, figures: TraceFigures, scale: SheetScale | null, figure: TraceFigure): Yield | null {
  return yieldsOf(kind, geometry, figures, scale).find((y) => y.figure === figure) ?? null;
}

/** The family a figure belongs to: a perimeter is a length, a wall and a roof are areas, a volume is its own. */
export function familyOf(figure: TraceFigure): FigureFamily {
  return FIGURE_FAMILY[figure];
}

/** Why a trace cannot yield this figure, in words — for the refusal that names it. */
export function whyNoYield(kind: MeasureKind, figure: TraceFigure, figures: TraceFigures, scale: SheetScale | null): string {
  if (kind !== "count" && !scale) return "its sheet has no scale yet";
  if (figure === "wall") return kind === "length" ? "it has no height typed on it" : "only a length stands a wall";
  if (figure === "roof") return kind === "area" ? "it has no pitch typed on it" : "only an area pitches to a roof";
  if (figure === "volume") return kind === "area" ? (figures.depth ? "" : "it has no depth typed on it") : "only an area fills a volume";
  if (figure === "perimeter") return kind === "area" ? "" : "only an area has a run around it";
  return `it is ${kind === "count" ? "a count" : kind === "area" ? "an area" : "a length"}, not ${figure === "count" ? "a count" : figure === "area" ? "an area" : "a length"}`;
}

// ------------------------------------------------ what stands behind a line

/** One figure of one trace standing behind a line (ADR 0110). */
export interface TracePick {
  markupId: string;
  figure: TraceFigure;
}

/** The measurements standing behind one estimate line on one sheet (ADR 0109). */
export interface SheetShare {
  sheetId: string;
  sheetNumber: string;
  setName: string;
  /** False on a superseded issue: the trace is on a sheet the job no longer builds from. */
  isCurrent: boolean;
  traces: number;
  /** What these measurements pushed, added up. */
  shareThousandths: number;
  /** What they come to now — null while the sheet lacks its scale. */
  nowThousandths: number | null;
  /** Whether any of them has moved on from what it pushed. */
  drifted: boolean;
  /** The traces themselves, each by the figure that stands behind the line, so a push from another sheet can keep them. */
  picks: TracePick[];
}

/** Everything standing behind one estimate line, by sheet (ADR 0109). */
export interface LineMeasurements {
  lineId: string;
  kind: FigureFamily;
  /** The unit the trade prices the line by, from the kind: lf, sf, ea; m, m2. */
  unit: string;
  traces: number;
  shareThousandths: number;
  nowThousandths: number | null;
  drifted: boolean;
  sheets: SheetShare[];
}

/** "A-101, A-102" — the sheets behind a line, in the business's reading order. */
export function sheetsBehind(line: Pick<LineMeasurements, "sheets">): string {
  return line.sheets.map((s) => s.sheetNumber).join(", ");
}

/**
 * Several measurements onto one line: they must be the same kind of thing.
 * Two rooms' floors add up; a floor and a wall length do not.
 */
export function sumMeasurements(rows: readonly { kind: FigureFamily; measurement: Measurement | null }[]): { kind: FigureFamily; total: Measurement } {
  if (rows.length === 0) throw new Error("nothing to push");
  const kind = rows[0].kind;
  let quantity = 0;
  let unit: string | null = null;
  for (const r of rows) {
    if (r.kind !== kind) throw new Error("a length, an area, a count and a volume cannot go onto one line together");
    if (!r.measurement) throw new Error("set the sheet's scale before pushing a length or an area");
    if (unit !== null && r.measurement.unit !== unit) throw new Error("these were measured in different units");
    unit = r.measurement.unit;
    quantity += r.measurement.quantity;
  }
  return { kind, total: { quantity, unit: unit ?? "each" } };
}
