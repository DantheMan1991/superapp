import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_ARCS_PER_EDGE,
  MIN_EXTENT,
  arrowHead,
  clampFraction,
  cloudArcCount,
  cloudPath,
  markupSentence,
  normaliseBox,
  parseGeometry,
  pinNumbers,
  summariseMarkups,
  type MarkupLike,
} from "../src/packs/jobs/markups-math";
import {
  MARKUP_COLORS,
  MARKUP_COLOR_HEX,
  MARKUP_COLOR_LABELS,
  MARKUP_KINDS,
  MARKUP_KIND_LABELS,
  MARKUP_TEXT_MAX,
  isMarkupColor,
  isMarkupKind,
} from "../src/packs/jobs/vocabulary";

/**
 * The geometry of a markup (ADR 0073), pure: what a shape may be, how a
 * cloud is drawn, how the list reads. The database suites prove the rows.
 */

const SQL = readFileSync("drizzle/0363_job_sheet_markups.sql", "utf8");

describe("the database agrees with the words", () => {
  it("MIRRORS the kind and colour CHECKs, and labels every value", () => {
    const kinds = SQL.match(/job_sheet_markups_kind_valid[^(]*\(([^)]*)\)/);
    const colors = SQL.match(/job_sheet_markups_color_valid[^(]*\(([^)]*)\)/);
    expect(kinds, "kind constraint").not.toBeNull();
    expect(colors, "colour constraint").not.toBeNull();
    const listed = (m: RegExpMatchArray) => [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort();
    expect(listed(kinds!)).toEqual([...MARKUP_KINDS].sort());
    expect(listed(colors!)).toEqual([...MARKUP_COLORS].sort());
    for (const k of MARKUP_KINDS) expect(MARKUP_KIND_LABELS[k].length).toBeGreaterThan(0);
    for (const c of MARKUP_COLORS) {
      expect(MARKUP_COLOR_LABELS[c].length).toBeGreaterThan(0);
      expect(MARKUP_COLOR_HEX[c]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(isMarkupKind("pin")).toBe(true);
    expect(isMarkupKind("scribble")).toBe(false);
    expect(isMarkupColor("black")).toBe(true);
    expect(isMarkupColor("pink")).toBe(false);
  });

  it("MIRRORS the words rule and the bound: a note and a pin carry words, nothing runs past the limit", () => {
    expect(SQL).toMatch(/job_sheet_markups_words_present[^;]*not in \('text', 'pin'\) or length\(btrim/);
    expect(SQL).toMatch(new RegExp(`job_sheet_markups_text_bounded[^;]*<= ${MARKUP_TEXT_MAX}\\)`));
    expect(SQL).toMatch(/job_sheet_markups_geometry_object[^;]*jsonb_typeof/);
  });

  it("was HAND-EDITED to the column-list SET NULL: a punch item cleared from Work leaves the pin, and the key never touches tenant_id", () => {
    expect(SQL).toMatch(/"job_sheet_markups_work_fk"[^;]*ON DELETE SET NULL \("work_item_id"\)/);
    expect(SQL).not.toMatch(/ON DELETE set null ON UPDATE/);
    expect(SQL).toMatch(/"job_sheet_markups_sheet_fk"[^;]*ON DELETE cascade/);
    expect(SQL).toMatch(/"job_sheet_markups_project_fk"[^;]*ON DELETE cascade/);
  });
});

describe("a shape", () => {
  it("is fractions of the page, per kind, with unknown fields dropped", () => {
    expect(parseGeometry("cloud", { x: 0.1, y: 0.2, w: 0.3, h: 0.1, junk: 9 })).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    expect(parseGeometry("arrow", { x1: 0.5, y1: 0.5, x2: 0.6, y2: 0.55 })).toEqual({ x1: 0.5, y1: 0.5, x2: 0.6, y2: 0.55 });
    expect(parseGeometry("text", { x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
    expect(parseGeometry("pin", { x: 0.7, y: 0.7, w: 0.2 })).toEqual({ x: 0.7, y: 0.7 });
  });

  it("refuses what is not a shape, in words", () => {
    expect(() => parseGeometry("cloud", "nope")).toThrow("geometry must be an object");
    expect(() => parseGeometry("cloud", null)).toThrow("geometry must be an object");
    expect(() => parseGeometry("cloud", [0.1, 0.2])).toThrow("geometry must be an object");
    expect(() => parseGeometry("pin", { x: "0.5", y: 0.5 })).toThrow("x must be a number");
    expect(() => parseGeometry("pin", { x: Number.NaN, y: 0.5 })).toThrow("x must be a number");
    expect(() => parseGeometry("pin", { x: 1.2, y: 0.5 })).toThrow("x must be within the page");
    expect(() => parseGeometry("pin", { x: 0.2, y: -0.1 })).toThrow("y must be within the page");
    expect(() => parseGeometry("cloud", { x: 0.1, y: 0.1, w: 0.001, h: 0.2 })).toThrow("a cloud needs some size");
    expect(() => parseGeometry("cloud", { x: 0.9, y: 0.1, w: 0.2, h: 0.2 })).toThrow("a cloud must stay within the page");
    expect(() => parseGeometry("arrow", { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 })).toThrow("an arrow needs some length");
    expect(() => parseGeometry("arrow", { x1: 0.5, y1: 0.5 })).toThrow("x2 must be a number");
  });

  it("normalises a drag from any corner, and clamps a point to the page", () => {
    expect(normaliseBox(0.6, 0.5, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.4 });
    expect(normaliseBox(0.2, 0.1, 0.6, 0.5)).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.4 });
    expect(clampFraction(-0.2)).toBe(0);
    expect(clampFraction(1.7)).toBe(1);
    expect(clampFraction(0.42)).toBe(0.42);
    expect(normaliseBox(0.1, 0.1, 0.1 + 0.2, 0.3)).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    expect(MIN_EXTENT).toBeGreaterThan(0);
    expect(MIN_EXTENT).toBeLessThan(0.05);
  });
});

describe("a cloud", () => {
  it("is the rectangle's outline as arcs, walked clockwise from the top-left, closed", () => {
    const d = cloudPath(10, 20, 100, 50, 10);
    expect(d.startsWith("M 10 20")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    const arcs = d.match(/A [^A]+/g) ?? [];
    expect(arcs).toHaveLength(cloudArcCount(100, 50, 10));
    expect(arcs).toHaveLength(2 * 10 + 2 * 5);
    // Every arc lands on the rectangle's edge, and the walk returns to the start.
    const ends = arcs.map((a) => a.replace(/s*Zs*$/, "").trim().split(" ").slice(-2).map(Number));
    for (const [x, y] of ends) {
      const onEdge = Math.abs(y - 20) < 1e-6 || Math.abs(y - 70) < 1e-6 || Math.abs(x - 10) < 1e-6 || Math.abs(x - 110) < 1e-6;
      expect(onEdge, `${x},${y}`).toBe(true);
    }
    expect(ends[ends.length - 1]).toEqual([10, 20]);
    // Bulging outward on a y-down screen: sweep-flag 1 on a clockwise walk.
    expect(arcs.every((a) => / 0 0 1 /.test(a))).toBe(true);
  });

  it("draws at least one arc per edge however small the box, and never divides by a zero scallop", () => {
    expect(cloudArcCount(2, 2, 10)).toBe(4);
    expect((cloudPath(0, 0, 2, 2, 10).match(/A /g) ?? []).length).toBe(4);
    // A zero scallop asked for a million arcs once and took the test runner down with it: capped per edge.
    expect((cloudPath(0, 0, 10, 10, 0).match(/A /g) ?? []).length).toBe(4 * MAX_ARCS_PER_EDGE);
    expect(cloudArcCount(1000, 1000, 0.001)).toBe(4 * MAX_ARCS_PER_EDGE);
  });
});

describe("an arrow", () => {
  it("has two barbs behind the tip, either side of the line", () => {
    const [ax, ay, bx, by] = arrowHead(0, 50, 100, 50, 12);
    expect(ax).toBeLessThan(100);
    expect(bx).toBeLessThan(100);
    expect(ax).toBeCloseTo(bx, 6);
    expect(Math.min(ay, by)).toBeLessThan(50);
    expect(Math.max(ay, by)).toBeGreaterThan(50);
    expect(ay + by).toBeCloseTo(100, 6);
    expect(Math.hypot(ax - 100, ay - 50)).toBeCloseTo(12, 6);
  });
});

describe("the list", () => {
  const m = (id: string, kind: string, createdAt: string, workItemId: string | null = null, punchDone: boolean | null = null): MarkupLike => ({
    id,
    kind,
    createdAt,
    workItemId,
    punchDone,
  });
  const rows = [
    m("c1", "cloud", "2026-09-15"),
    m("p2", "pin", "2026-09-16", "w2", false),
    m("a1", "arrow", "2026-09-15"),
    m("p1", "pin", "2026-09-15", "w1", true),
    m("p3", "pin", "2026-09-17", null, null),
    m("t1", "text", "2026-09-15"),
    m("x9", "scribble", "2026-09-15"),
  ];

  it("numbers pins in the order they were placed, so pin 3 is pin 3 everywhere", () => {
    expect([...pinNumbers(rows).entries()]).toEqual([
      ["p1", 1],
      ["p2", 2],
      ["p3", 3],
    ]);
  });

  it("summarises by kind, with the pins still open on the punch list counted apart", () => {
    const s = summariseMarkups(rows);
    expect(s).toEqual({ count: 7, byKind: { cloud: 1, arrow: 1, text: 1, pin: 3 }, openPins: 1, settledPins: 2 });
    expect(markupSentence(s)).toBe("1 cloud, 1 arrow, 1 note, 3 pins; 1 pin is still open on the punch list.");
    expect(markupSentence(summariseMarkups([]))).toBe("Nothing drawn on this issue.");
    expect(markupSentence(summariseMarkups([m("c1", "cloud", "2026-09-15"), m("c2", "cloud", "2026-09-15")]))).toBe("2 clouds.");
  });
});
