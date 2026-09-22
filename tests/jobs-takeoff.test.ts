import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGeometry, parsePoints, MIN_POINTS } from "../src/packs/jobs/markups-math";
import {
  POINTS_PER_INCH,
  POINTS_PER_METRE,
  STANDARD_SCALES,
  driftedSince,
  formatMeasure,
  matchingStandard,
  measure,
  measureKindForUnit,
  normaliseUnit,
  pathPoints,
  polygonPoints,
  scaleFromKnownLength,
  scaleFromStandard,
  sheetsBehind,
  standardScale,
  sumMeasurements,
  takeoffUnitFor,
  toThousandths,
  unitAccepts,
  type LineMeasurements,
  type SheetScale,
} from "../src/packs/jobs/takeoff-math";
import { MARKUP_KINDS, MEASURE_KINDS, MEASURE_POINTS_MAX, SCALE_UNITS, isMeasureKind, isScaleUnit } from "../src/packs/jobs/vocabulary";

/**
 * The arithmetic of a takeoff (ADR 0074), pure: the sheet's scale, a
 * measurement's fractions of the page as feet, square feet or a count, and
 * what goes onto an estimate line. The database suites prove the rows.
 */

const SQL = readFileSync("drizzle/0365_job_takeoff.sql", "utf8");
/**
 * The whole-scale rule re-stated with coalesce in 0366: a CHECK that evaluates
 * to NULL passes, so `null > 0` let a scale without a page size through, and
 * the isolation suite said so.
 */
const SQL_WHOLE = readFileSync("drizzle/0366_job_sheets_scale_whole.sql", "utf8");
/** A landscape letter page: 11 by 8.5 inches, in points. */
const LETTER = { w: 792, h: 612 };

describe("the database agrees with the words", () => {
  it("MIRRORS the widened kind CHECK, the scale CHECKs and the column-list SET NULL to the estimate line", () => {
    const kinds = SQL.match(/job_sheet_markups_kind_valid" CHECK \([^)]*\(([^)]*)\)/);
    expect(kinds, "kind constraint").not.toBeNull();
    expect([...kinds![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort()).toEqual([...MARKUP_KINDS].sort());
    expect(SQL).toMatch(/job_sheets_scale_positive[^;]*is null or[^;]*> 0/);
    expect(SQL).toMatch(/job_sheets_scale_unit_valid[^;]*in \('', 'ft', 'm'\)/);
    expect(SQL_WHOLE).toMatch(/DROP CONSTRAINT "job_sheets_scale_whole"/);
    expect(SQL_WHOLE).toMatch(/job_sheets_scale_whole" CHECK [^;]*coalesce\("job_sheets"\."page_width_pt", 0\) > 0 and coalesce\("job_sheets"\."page_height_pt", 0\) > 0/);
    expect(SQL).toMatch(/"job_sheet_markups_line_fk"[^;]*REFERENCES "public"\."job_estimate_lines"\("tenant_id","id"\) ON DELETE SET NULL \("estimate_line_id"\)/);
    expect(SQL).not.toMatch(/ON DELETE set null ON UPDATE/);
    expect(SQL).toMatch(/DROP CONSTRAINT "job_sheet_markups_kind_valid"/);
  });

  it("names the measuring kinds and the scale units the way the CHECKs do", () => {
    expect(MEASURE_KINDS).toEqual(["length", "area", "count"]);
    for (const k of MEASURE_KINDS) expect(MARKUP_KINDS).toContain(k);
    expect(isMeasureKind("area")).toBe(true);
    expect(isMeasureKind("cloud")).toBe(false);
    expect(SCALE_UNITS).toEqual(["ft", "m"]);
    expect(isScaleUnit("ft")).toBe(true);
    expect(isScaleUnit("")).toBe(false);
    expect(MEASURE_POINTS_MAX).toBe(500);
  });
});

describe("the standard scales", () => {
  it("are page points per foot or metre when the sheet is its own size", () => {
    expect(standardScale("arch:1/4")?.pointsPerUnit).toBeCloseTo(18, 9); // a quarter inch of paper is a foot: 72 / 4
    expect(standardScale("arch:1/8")?.pointsPerUnit).toBeCloseTo(9, 9);
    expect(standardScale("arch:1")?.pointsPerUnit).toBeCloseTo(72, 9);
    expect(standardScale("eng:20")?.pointsPerUnit).toBeCloseTo(3.6, 9); // an inch is twenty feet
    expect(standardScale("metric:100")?.pointsPerUnit).toBeCloseTo(POINTS_PER_METRE / 100, 9);
    expect(standardScale("metric:100")?.unit).toBe("m");
    expect(standardScale("arch:1/4")?.label).toBe('1/4" = 1\'-0"');
    expect(standardScale("nope")).toBeNull();
    expect(POINTS_PER_INCH).toBe(72);
    expect(POINTS_PER_METRE).toBeCloseTo(2834.6457, 3);
    expect(new Set(STANDARD_SCALES.map((s) => s.key)).size).toBe(STANDARD_SCALES.length);
  });

  it("recognise a sheet's own scale when it matches one within a hair", () => {
    const scale = scaleFromStandard("arch:1/4", LETTER.w, LETTER.h);
    expect(matchingStandard(scale)?.key).toBe("arch:1/4");
    expect(matchingStandard({ ...scale, pointsPerUnit: 18.02 })?.key).toBe("arch:1/4");
    expect(matchingStandard({ ...scale, pointsPerUnit: 18.5 })).toBeNull();
    expect(() => scaleFromStandard("nope", LETTER.w, LETTER.h)).toThrow("no such scale");
    expect(() => scaleFromStandard("arch:1/4", 0, LETTER.h)).toThrow("the page's size is needed");
  });
});

describe("a known dimension", () => {
  it("gives the scale from two points and what the drawing says lies between them", () => {
    // Two points a quarter of the page apart across a landscape letter page: 198 points; the drawing says 11 feet.
    const scale = scaleFromKnownLength({ x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }, 11, "ft", LETTER.w, LETTER.h);
    expect(scale.pointsPerUnit).toBeCloseTo(18, 9);
    expect(scale.unit).toBe("ft");
    expect(matchingStandard(scale)?.key).toBe("arch:1/4");
    // Down the page the fractions are of the height, not the width.
    const down = scaleFromKnownLength({ x: 0.5, y: 0.25 }, { x: 0.5, y: 0.5 }, 8.5, "ft", LETTER.w, LETTER.h);
    expect(down.pointsPerUnit).toBeCloseTo(18, 9);
  });

  it("refuses nothing, a point on itself and a page with no size", () => {
    expect(() => scaleFromKnownLength({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, 0, "ft", LETTER.w, LETTER.h)).toThrow("more than nothing");
    expect(() => scaleFromKnownLength({ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.1 }, 10, "ft", LETTER.w, LETTER.h)).toThrow("on top of each other");
    expect(() => scaleFromKnownLength({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, 10, "ft", 0, 0)).toThrow("the page's size is needed");
  });
});

describe("a measurement", () => {
  const quarter: SheetScale = { pointsPerUnit: 18, unit: "ft", pageWidthPt: LETTER.w, pageHeightPt: LETTER.h };

  it("is points within the page, enough of them for its kind, and not too many", () => {
    expect(parsePoints("length", { points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }] }).points).toHaveLength(2);
    expect(parseGeometry("area", { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] })).toEqual({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] });
    expect(parseGeometry("count", { points: [{ x: 0.5, y: 0.5, extra: 1 }] })).toEqual({ points: [{ x: 0.5, y: 0.5 }] });
    expect(() => parsePoints("length", { points: [{ x: 0.1, y: 0.1 }] })).toThrow("a length needs two points");
    expect(() => parsePoints("area", { points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }] })).toThrow("an area needs three points");
    expect(() => parsePoints("count", { points: [] })).toThrow("a count needs a tap");
    expect(() => parsePoints("count", { points: "no" })).toThrow("points must be a list");
    expect(() => parsePoints("count", { points: [{ x: 1.5, y: 0 }] })).toThrow("point 1 must be within the page");
    expect(() => parsePoints("count", { points: [{ x: "0.5", y: 0 }] })).toThrow("point 1 must be numbers");
    expect(() => parsePoints("count", { points: Array.from({ length: 501 }, () => ({ x: 0.5, y: 0.5 })) })).toThrow("at most 500 points");
    expect(MIN_POINTS).toEqual({ length: 2, area: 3, count: 1 });
  });

  it("reads a length along a wall, corner by corner, through the sheet's scale", () => {
    // Across a quarter of the width (198 pt) then down a quarter of the height (153 pt): 351 pt at 18 pt/ft is 19.5 ft.
    const walls = { points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.25 }, { x: 0.5, y: 0.5 }] };
    expect(pathPoints(walls.points, LETTER.w, LETTER.h)).toBeCloseTo(351, 9);
    expect(measure("length", walls, quarter)).toEqual({ quantity: 19.5, unit: "ft" });
    expect(measure("length", walls, null)).toBeNull();
    expect(measure("length", walls, { ...quarter, unit: "m", pointsPerUnit: 100 })).toEqual({ quantity: 3.51, unit: "m" });
  });

  it("reads an area around a room by the shoelace, either way round", () => {
    // A rectangle 198 pt by 153 pt: 30,294 sq pt; at 18 pt/ft that is 11 by 8.5 feet, 93.5 sq ft.
    const room = { points: [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0.25 }, { x: 0.5, y: 0.5 }, { x: 0.25, y: 0.5 }] };
    expect(polygonPoints(room.points, LETTER.w, LETTER.h)).toBeCloseTo(30294, 6);
    expect(measure("area", room, quarter)?.quantity).toBeCloseTo(93.5, 9);
    expect(measure("area", room, quarter)?.unit).toBe("sq ft");
    expect(measure("area", { points: [...room.points].reverse() }, quarter)?.quantity).toBeCloseTo(93.5, 9);
    expect(measure("area", room, { ...quarter, unit: "m" })?.unit).toBe("m²");
    expect(measure("area", room, null)).toBeNull();
    // A triangle is half the rectangle.
    expect(measure("area", { points: room.points.slice(0, 3) }, quarter)?.quantity).toBeCloseTo(46.75, 9);
  });

  it("counts taps and needs no scale", () => {
    const taps = { points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.3, y: 0.1 }] };
    expect(measure("count", taps, null)).toEqual({ quantity: 3, unit: "each" });
    expect(measure("count", taps, quarter)).toEqual({ quantity: 3, unit: "each" });
  });

  it("reads the way the trade says it: one decimal on a length, none on a big area, a cross on a count", () => {
    expect(formatMeasure({ quantity: 24.456, unit: "ft" })).toBe("24.5 ft");
    expect(formatMeasure({ quantity: 312.4, unit: "sq ft" })).toBe("312 sq ft");
    expect(formatMeasure({ quantity: 93.5, unit: "sq ft" })).toBe("93.5 sq ft");
    expect(formatMeasure({ quantity: 1234.56, unit: "m²" })).toBe("1,235 m²");
    expect(formatMeasure({ quantity: 14, unit: "each" })).toBe("×14");
  });
});

describe("the takeoff", () => {
  it("puts a measurement on a line in the unit the trade prices by, in thousandths, never negative", () => {
    expect(takeoffUnitFor("length", "ft")).toBe("lf");
    expect(takeoffUnitFor("length", "m")).toBe("m");
    expect(takeoffUnitFor("area", "ft")).toBe("sf");
    expect(takeoffUnitFor("area", "m")).toBe("m2");
    expect(takeoffUnitFor("count", "")).toBe("ea");
    expect(toThousandths(93.5)).toBe(93_500);
    expect(toThousandths(19.4999)).toBe(19_500);
    expect(toThousandths(-1)).toBe(0);
  });

  it("adds up measurements of one kind and refuses a floor and a wall together, or a length nobody has scaled", () => {
    const sum = sumMeasurements([
      { kind: "area", measurement: { quantity: 93.5, unit: "sq ft" } },
      { kind: "area", measurement: { quantity: 6.5, unit: "sq ft" } },
    ]);
    expect(sum).toEqual({ kind: "area", total: { quantity: 100, unit: "sq ft" } });
    expect(() => sumMeasurements([])).toThrow("nothing to push");
    expect(() =>
      sumMeasurements([
        { kind: "area", measurement: { quantity: 93.5, unit: "sq ft" } },
        { kind: "length", measurement: { quantity: 20, unit: "ft" } },
      ]),
    ).toThrow("cannot go onto one line together");
    expect(() => sumMeasurements([{ kind: "length", measurement: null }])).toThrow("set the sheet's scale");
    expect(() =>
      sumMeasurements([
        { kind: "length", measurement: { quantity: 1, unit: "ft" } },
        { kind: "length", measurement: { quantity: 1, unit: "m" } },
      ]),
    ).toThrow("different units");
  });

  it("takes a line whose unit is the measurement's however it is spelled, and refuses another unit by name rather than converting it", () => {
    expect(["sf", "SF", "sq ft", "sq. ft.", "Square feet", "sqft"].map(normaliseUnit)).toEqual(["sf", "sf", "sf", "sf", "sf", "sf"]);
    expect(["lf", "lin. ft.", "ft", "linear feet"].map(normaliseUnit)).toEqual(["lf", "lf", "lf", "lf"]);
    expect(["ea", "Each", "m", "m²", "sq m", "sy", "cy", "ls", " "].map(normaliseUnit)).toEqual(["ea", "ea", "m", "m2", "m2", "sy", "cy", "ls", ""]);
    expect(unitAccepts("", "sf")).toBe(true);
    expect(unitAccepts("  ", "lf")).toBe(true);
    expect(unitAccepts("sq. ft.", "sf")).toBe(true);
    expect(unitAccepts("Each", "ea")).toBe(true);
    expect(unitAccepts("lf", "sf")).toBe(false);
    expect(unitAccepts("ft", "sf")).toBe(false);
    /** The same family is still refused: `sq` is a roofing square to one business and a square yard to the next, and a conversion that guessed would be the same wrong number. */
    expect(unitAccepts("sy", "sf")).toBe(false);
    expect(unitAccepts("sq", "sf")).toBe(false);
    expect(unitAccepts("m2", "sf")).toBe(false);
    expect(unitAccepts("ls", "ea")).toBe(false);
  });

  it("says how a drawing measures a line from its unit — an area, a length or a count — asks on a blank one and refuses a lump sum (ADR 0109)", () => {
    expect(["sf", "sq. ft.", "m2", "Square feet"].map(measureKindForUnit)).toEqual(["area", "area", "area", "area"]);
    expect(["lf", "ft", "m", "lin. ft."].map(measureKindForUnit)).toEqual(["length", "length", "length", "length"]);
    expect(["ea", "Each"].map(measureKindForUnit)).toEqual(["count", "count"]);
    expect(["", "  "].map(measureKindForUnit)).toEqual(["ask", "ask"]);
    /** A lump sum, concrete by the yard, carpet by the square yard: no drawing yields these, and the ruler says so rather than guessing. */
    expect(["ls", "cy", "sy", "hr"].map(measureKindForUnit)).toEqual([null, null, null, null]);
    expect(sheetsBehind({ sheets: [{ sheetNumber: "A-101" }, { sheetNumber: "A-102" }] } as unknown as Pick<LineMeasurements, "sheets">)).toBe("A-101, A-102");
  });

  it("says a measurement has drifted from what IT pushed, never from the line's total", () => {
    expect(driftedSince(93_500, { quantity: 93.5, unit: "sq ft" })).toBe(false);
    expect(driftedSince(93_500, { quantity: 93.504, unit: "sq ft" })).toBe(false);
    expect(driftedSince(93_500, { quantity: 94.1, unit: "sq ft" })).toBe(true);
    /** The bug this guards: every measurement in a push stored the line's TOTAL, so its own 59 sq ft read as drifted from 111 the moment after. */
    expect(driftedSince(111_198, { quantity: 59.026, unit: "sq ft" })).toBe(true);
    expect(driftedSince(59_026, { quantity: 59.026, unit: "sq ft" })).toBe(false);
    expect(driftedSince(null, { quantity: 59, unit: "sq ft" })).toBe(false);
    expect(driftedSince(59_000, null)).toBe(false);
    /** Five thousandths of slack under one unit, half a percent above it. */
    expect(driftedSince(500, { quantity: 0.504, unit: "ft" })).toBe(false);
    expect(driftedSince(500, { quantity: 0.506, unit: "ft" })).toBe(true);
    expect(driftedSince(3_000, { quantity: 3.006, unit: "each" })).toBe(false);
    expect(driftedSince(3_000, { quantity: 3.02, unit: "each" })).toBe(true);
  });
});
