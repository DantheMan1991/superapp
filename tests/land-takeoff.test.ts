import { describe, expect, it } from "vitest";
import {
  POST_SPACING_KEY,
  WIRE_COUNT_KEY,
  driftOf,
  lineCost,
  takeoffFor,
  totalsOf,
  type TakeoffFeature,
  type TakeoffTotal,
} from "../src/packs/land/core/takeoff";
import { haversineM, type FeatureGeometry } from "../src/packs/land/core/geo";
import { fromMetres } from "../src/packs/land/core/length";

/**
 * The takeoff — the pure half of land slice 2b.4.
 *
 * The tests that matter are the ones where a plausible implementation is
 * quietly WRONG:
 *
 *   - a post count that DEFAULTS a missing spacing, producing a number nobody
 *     chose that somebody then orders from
 *   - spans counted instead of posts, which is short by exactly one every time
 *     and looks right until the last post has nothing to nail to
 *   - a total that mixes units, adding feet of wire to a count of gates
 *   - a drift that recomputes the saved figure, which defeats the whole reason
 *     for saving one
 */

const A: [number, number] = [-82.48, 40.4];
const B: [number, number] = [-82.47526, 40.4];

/** A straight run, 1,318 ft at the pilot farm's latitude. */
const RUN: FeatureGeometry = { type: "LineString", coordinates: [A, B] };
const RUN_FT = fromMetres(haversineM(A, B), "foot");

const feature = (
  over: Partial<TakeoffFeature> & { id: string },
): TakeoffFeature => ({
  name: "",
  kind: "fence",
  geometry: RUN,
  attributes: {},
  ...over,
});

describe("what a fence takes", () => {
  it("counts posts as spans PLUS ONE, because both ends need one", () => {
    const { lines } = takeoffFor(
      [feature({ id: "f1", attributes: { [POST_SPACING_KEY]: 8 } })],
      "foot",
    );
    const posts = lines.find((l) => l.material === "post");
    expect(posts).toBeDefined();
    expect(posts?.quantity).toBe(Math.floor(RUN_FT / 8) + 1);
    expect(posts?.unit).toBe("each");
  });

  it("multiplies wire by the strands, not by one", () => {
    const { lines } = takeoffFor(
      [feature({ id: "f1", attributes: { [WIRE_COUNT_KEY]: 3 } })],
      "foot",
    );
    const wire = lines.find((l) => l.material === "wire");
    expect(wire?.quantity).toBeCloseTo(Math.round(RUN_FT * 3 * 100) / 100, 1);
    expect(wire?.unit).toBe("ft");
  });

  it("also counts the fence itself, so a plan totals its footage", () => {
    const { lines } = takeoffFor([feature({ id: "f1" })], "foot");
    const run = lines.find((l) => l.material === "fence");
    expect(run?.quantity).toBeCloseTo(Math.round(RUN_FT * 100) / 100, 1);
  });

  it("reads a number somebody typed as text", () => {
    // A form sends "8"; a paste sends 8. Both are a spacing.
    const { lines, notes } = takeoffFor(
      [feature({ id: "f1", attributes: { [POST_SPACING_KEY]: " 8 " } })],
      "foot",
    );
    // The wire count is still missing, so there is still a note about THAT —
    // just not about the spacing, which was given as text and read as a number.
    expect(notes.some((n) => n.message.includes(POST_SPACING_KEY))).toBe(false);
    expect(lines.find((l) => l.material === "post")?.quantity).toBe(
      Math.floor(RUN_FT / 8) + 1,
    );
  });
});

describe("what it refuses to invent", () => {
  it("NEVER defaults a missing spacing — it says so instead", () => {
    // The one that matters. A post count off a default nobody chose is a
    // made-up number wearing a decimal point, and it would be ordered from.
    const { lines, notes } = takeoffFor([feature({ id: "f1", name: "North" })], "foot");
    expect(lines.some((l) => l.material === "post")).toBe(false);
    expect(notes.some((n) => n.message.includes(POST_SPACING_KEY))).toBe(true);
    expect(notes[0].featureName).toBe("North");
  });

  it("says the same about a missing strand count", () => {
    const { lines, notes } = takeoffFor(
      [feature({ id: "f1", attributes: { [POST_SPACING_KEY]: 8 } })],
      "foot",
    );
    expect(lines.some((l) => l.material === "wire")).toBe(false);
    expect(notes.some((n) => n.message.includes(WIRE_COUNT_KEY))).toBe(true);
  });

  it("ignores a spacing that is not a usable number", () => {
    for (const bad of ["", "  ", "eight", 0, -8, true]) {
      const { notes } = takeoffFor(
        [
          feature({
            id: "f1",
            attributes: { [POST_SPACING_KEY]: bad as string | number | boolean },
          }),
        ],
        "foot",
      );
      expect(notes.some((n) => n.message.includes(POST_SPACING_KEY))).toBe(true);
    }
  });

  it("counts nothing off a feature nobody has drawn", () => {
    const { lines, notes } = takeoffFor(
      [feature({ id: "f1", name: "South", geometry: null })],
      "foot",
    );
    expect(lines).toEqual([]);
    expect(notes[0].message).toMatch(/not been drawn/);
  });
});

describe("kinds the pack has never heard of", () => {
  it("counts a tenant's own POINT kind as one of the thing", () => {
    // `trough` is a farm profile's word and the pack refuses to know it
    // (ADR 0004). It still has to appear on the list you order from.
    const { lines } = takeoffFor(
      [
        feature({
          id: "t1",
          kind: "trough",
          geometry: { type: "Point", coordinates: A },
        }),
      ],
      "foot",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ material: "trough", quantity: 1, unit: "each" });
  });

  it("counts a tenant's own LINE kind as its length", () => {
    const { lines } = takeoffFor(
      [feature({ id: "w1", kind: "windbreak" })],
      "foot",
    );
    expect(lines[0]).toMatchObject({ material: "windbreak", unit: "ft" });
    expect(lines[0].quantity).toBeCloseTo(Math.round(RUN_FT * 100) / 100, 1);
  });

  it("counts NOTHING off an area, because there is no material in an acre", () => {
    const { lines } = takeoffFor(
      [
        feature({
          id: "a1",
          kind: "woods",
          geometry: {
            type: "Polygon",
            coordinates: [[A, B, [-82.47526, 40.404], A]],
          },
        }),
      ],
      "foot",
    );
    expect(lines).toEqual([]);
  });

  it("gives a waterline its length and no posts", () => {
    const { lines } = takeoffFor([feature({ id: "p1", kind: "waterline" })], "foot");
    expect(lines.map((l) => l.material)).toEqual(["waterline"]);
  });
});

describe("units", () => {
  it("reports lengths in the tenant's own unit, because that is what they buy in", () => {
    const asFeet = takeoffFor([feature({ id: "f1" })], "foot");
    const asMetres = takeoffFor([feature({ id: "f1" })], "metre");
    expect(asFeet.lines[0].unit).toBe("ft");
    expect(asMetres.lines[0].unit).toBe("m");
    expect(asFeet.lines[0].quantity).toBeGreaterThan(asMetres.lines[0].quantity);
  });

  it("reads the spacing in that same unit", () => {
    // 8 on a screen labelled metres is 8 metres, not 8 feet. Getting this wrong
    // would give a metric farm three times the posts it needs.
    const metric = takeoffFor(
      [feature({ id: "f1", attributes: { [POST_SPACING_KEY]: 8 } })],
      "metre",
    );
    const metres = fromMetres(haversineM(A, B), "metre");
    expect(metric.lines.find((l) => l.material === "post")?.quantity).toBe(
      Math.floor(metres / 8) + 1,
    );
  });
});

describe("totals", () => {
  it("adds up by material, keeping units apart", () => {
    const { lines } = takeoffFor(
      [
        feature({ id: "f1", attributes: { [WIRE_COUNT_KEY]: 3 } }),
        feature({ id: "f2", attributes: { [WIRE_COUNT_KEY]: 3 } }),
        feature({ id: "g1", kind: "gate", geometry: { type: "Point", coordinates: A } }),
      ],
      "foot",
    );
    const totals = totalsOf(lines);
    const wire = totals.find((t) => t.material === "wire");
    const gate = totals.find((t) => t.material === "gate");
    expect(wire?.quantity).toBeCloseTo(Math.round(RUN_FT * 3 * 100) / 100 * 2, 0);
    expect(gate).toMatchObject({ quantity: 1, unit: "each" });
    // Feet of wire and a count of gates must never land on the same line.
    expect(new Set(totals.map((t) => t.unit)).size).toBeGreaterThan(1);
  });

  it("keeps the same material apart when the units differ", () => {
    const totals = totalsOf([
      { material: "x", label: "X", quantity: 2, unit: "each", sourceFeatureId: null, sourceName: "" },
      { material: "x", label: "X", quantity: 5, unit: "ft", sourceFeatureId: null, sourceName: "" },
    ]);
    expect(totals).toHaveLength(2);
  });
});

describe("drift — what you ordered against what the drawing says now", () => {
  const saved: TakeoffTotal[] = [
    { material: "wire", label: "Wire", quantity: 1240, unit: "ft" },
    { material: "post", label: "Posts", quantity: 156, unit: "each" },
  ];

  it("reports what MOVED and stays quiet about what did not", () => {
    // A list where every line reads "no change" is a list nobody scans for the
    // one that did.
    const now: TakeoffTotal[] = [
      { material: "wire", label: "Wire", quantity: 1310, unit: "ft" },
      { material: "post", label: "Posts", quantity: 156, unit: "each" },
    ];
    const drift = driftOf(saved, now);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      material: "wire",
      saved: 1240,
      now: 1310,
      difference: 70,
    });
  });

  it("never rewrites the saved figure — that is the point of saving one", () => {
    const now: TakeoffTotal[] = [
      { material: "wire", label: "Wire", quantity: 1310, unit: "ft" },
    ];
    expect(driftOf(saved, now).find((d) => d.material === "wire")?.saved).toBe(
      1240,
    );
  });

  it("shows a material that has appeared, and one that has gone", () => {
    const now: TakeoffTotal[] = [
      { material: "wire", label: "Wire", quantity: 1240, unit: "ft" },
      { material: "gate", label: "Gate", quantity: 2, unit: "each" },
    ];
    const drift = driftOf(saved, now);
    expect(drift.find((d) => d.material === "gate")).toMatchObject({
      saved: 0,
      now: 2,
    });
    expect(drift.find((d) => d.material === "post")).toMatchObject({
      saved: 156,
      now: 0,
    });
  });

  it("is empty when nothing has moved", () => {
    expect(driftOf(saved, saved)).toEqual([]);
  });
});

describe("cost", () => {
  it("multiplies out, and stays null when nobody typed a price", () => {
    expect(lineCost(156, 4.25)).toBe(663);
    expect(lineCost(156, null)).toBeNull();
    expect(lineCost(156, Number.NaN)).toBeNull();
  });
});
