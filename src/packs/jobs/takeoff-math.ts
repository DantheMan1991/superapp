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
import type { MeasureKind, ScaleUnit } from "./vocabulary";

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
 * prices by: linear feet, square feet, each; metres and square metres.
 */
export function takeoffUnitFor(kind: MeasureKind, scaleUnit: ScaleUnit | ""): string {
  if (kind === "count") return "ea";
  if (kind === "length") return scaleUnit === "m" ? "m" : "lf";
  return scaleUnit === "m" ? "m2" : "sf";
}

/** A quantity in the line's thousandths, rounded, never negative. */
export function toThousandths(quantity: number): number {
  return Math.max(0, Math.round(quantity * 1000));
}

/**
 * Several measurements onto one line: they must be the same kind of thing.
 * Two rooms' floors add up; a floor and a wall length do not.
 */
export function sumMeasurements(rows: readonly { kind: MeasureKind; measurement: Measurement | null }[]): { kind: MeasureKind; total: Measurement } {
  if (rows.length === 0) throw new Error("nothing to push");
  const kind = rows[0].kind;
  let quantity = 0;
  let unit: string | null = null;
  for (const r of rows) {
    if (r.kind !== kind) throw new Error("a length, an area and a count cannot go onto one line together");
    if (!r.measurement) throw new Error("set the sheet's scale before pushing a length or an area");
    if (unit !== null && r.measurement.unit !== unit) throw new Error("these were measured in different units");
    unit = r.measurement.unit;
    quantity += r.measurement.quantity;
  }
  return { kind, total: { quantity, unit: unit ?? "each" } };
}
