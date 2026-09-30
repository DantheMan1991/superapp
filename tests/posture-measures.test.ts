import { describe, expect, it } from "vitest";
import type { Point } from "../src/modules/fitness/posture/core/geometry";
import { MEASURE_ORDER, MEASURES, readView, wordsFor, type ViewCapture } from "../src/modules/fitness/posture/core/measures";
import { buildReport, captureFrom, detailsText, noiseWords, reportText } from "../src/modules/fitness/posture/core/report";
import type { View } from "../src/modules/fitness/posture/core/sticker-map";

/**
 * THE MEASURES (docs/modules/posture.md; ADR 0119), on drawn stickers whose
 * angles are known: each sign in the person's own terms, the level frame
 * undoing a crooked phone, two rounds made into one value and a noise, and
 * the report never saying more than its stickers allow.
 */

const DEG = Math.PI / 180;

function capture(view: View, stickers: Record<string, Point>, over: Partial<ViewCapture> = {}): ViewCapture {
  return {
    view,
    round: 1,
    up: { x: 0, y: -1 },
    upFrom: "plumb",
    pxPerMetre: 900,
    width: 1080,
    height: 1920,
    stickers,
    pose: null,
    frames: 10,
    stillPx: 1,
    ...over,
  };
}

/** Turn every point `deg` about the centre, and true up with it: a crooked phone. */
function turned(c: ViewCapture, deg: number): ViewCapture {
  const r = deg * DEG;
  const cx = c.width / 2;
  const cy = c.height / 2;
  const rot = (p: Point): Point => ({
    x: cx + (p.x - cx) * Math.cos(r) - (p.y - cy) * Math.sin(r),
    y: cy + (p.x - cx) * Math.sin(r) + (p.y - cy) * Math.cos(r),
  });
  const up = { x: c.up.x * Math.cos(r) - c.up.y * Math.sin(r), y: c.up.x * Math.sin(r) + c.up.y * Math.cos(r) };
  return { ...c, up, stickers: Object.fromEntries(Object.entries(c.stickers).map(([k, p]) => [k, rot(p)])) };
}

const value = (c: ViewCapture, key: string) => readView(c).find((r) => r.key === key);

const FRONT = {
  breastbone: { x: 540, y: 560 },
  // The person's right is the picture's left, facing the phone.
  "right-shoulder": { x: 400, y: 505 }, // 5 px lower than the left
  "left-shoulder": { x: 680, y: 500 },
  "right-front-hip": { x: 470, y: 1000 },
  "left-front-hip": { x: 610, y: 1000 },
  // Hip-to-ankle lines cross the knees' height at x 470 (right) and 600 (left).
  "right-kneecap": { x: 480, y: 1350 }, // 10 px toward the picture's right: inward, for the right leg
  "left-kneecap": { x: 610, y: 1350 }, // 10 px toward the picture's right: outward, for the left leg
  "right-ankle-front": { x: 470, y: 1700 },
  "left-ankle-front": { x: 590, y: 1700 },
};

describe("from the front", () => {
  const c = capture("front", FRONT);

  it("reads the shoulders' drop with its side and its millimetres", () => {
    const r = value(c, "shoulder-level")!;
    expect(r.deg).toBeCloseTo(Math.atan2(5, 280) / DEG, 6); // right lower: positive
    expect(r.mm).toBeCloseTo((5 / 900) * 1000, 6);
    expect(wordsFor("shoulder-level", r.deg, r.mm)).toBe("Right shoulder lower by 1.0° (6 mm)");
    expect(r.from).toBe("stickers");
  });

  it("reads the same through a phone turned 3° on its tripod", () => {
    for (const key of ["shoulder-level", "knee-in-right", "knee-in-left", "trunk-lean"]) {
      expect(value(turned(c, 3), key)!.deg).toBeCloseTo(value(c, key)!.deg, 6);
    }
  });

  it("calls a knee inward of its hip-to-ankle line turning in, on either leg", () => {
    const right = value(c, "knee-in-right")!;
    const left = value(c, "knee-in-left")!;
    expect(right.deg).toBeGreaterThan(0); // toward the midline
    expect(left.deg).toBeLessThan(0); // away from it
    expect(wordsFor("knee-in-right", right.deg, null)).toMatch(/^Turns in by /);
    expect(wordsFor("knee-in-left", left.deg, null)).toMatch(/^Turns out by /);
  });

  it("reads the trunk shifted to the person's own side", () => {
    // Breastbone at x 540, hips' middle at 540: straight.
    expect(Math.abs(value(c, "trunk-lean")!.deg)).toBeLessThan(1e-9);
    const shifted = capture("front", { ...FRONT, breastbone: { x: 520, y: 560 } });
    // Picture-left from the front is the person's right.
    expect(value(shifted, "trunk-lean")!.deg).toBeGreaterThan(0);
  });

  it("takes nothing it has no stickers for, and falls back to the model only for the shoulders", () => {
    const bare = capture("front", {});
    expect(readView(bare)).toEqual([]);
    const pose = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
    pose[12] = { x: 400, y: 500, visibility: 0.9 };
    pose[11] = { x: 680, y: 500, visibility: 0.9 };
    const model = readView(capture("front", {}, { pose }));
    expect(model.map((r) => r.key)).toEqual(["shoulder-level"]);
    expect(model[0].from).toBe("model");
  });
});

describe("from the sides", () => {
  // Facing the picture's right: the right side to the phone.
  const RIGHT = {
    neck: { x: 500, y: 700 },
    "right-ear": { x: 560, y: 640 },
    "right-shoulder": { x: 520, y: 720 },
    "right-front-hip": { x: 560, y: 1000 },
    "right-back-hip": { x: 420, y: 980 },
    "right-hip-side": { x: 500, y: 1050 },
    "right-knee-side": { x: 490, y: 1380 },
    "right-ankle-side": { x: 505, y: 1700 },
  };
  const mirror = (s: Record<string, Point>) =>
    Object.fromEntries(Object.entries(s).map(([k, p]) => [k.replace(/^right-/, "left-"), { x: 1080 - p.x, y: p.y }]));
  const right = capture("right", RIGHT);
  const left = capture("left", mirror(RIGHT));

  it("reads the head over the shoulders the same from either side", () => {
    expect(value(right, "head-forward")!.deg).toBeCloseTo(45, 6);
    expect(value(left, "head-forward")!.deg).toBeCloseTo(45, 6);
  });

  it("reads the body line forward from either side", () => {
    const r = value(right, "body-line")!.deg;
    expect(r).toBeCloseTo(Math.atan2(15, 980) / DEG, 6);
    expect(value(left, "body-line")!.deg).toBeCloseTo(r, 6);
    expect(wordsFor("body-line", r, null)).toBe("Leaning forward by 0.9°");
  });

  it("reads a front hip bone below the back dimple as the pelvis tipped forward", () => {
    const r = value(right, "pelvic-tilt")!.deg;
    expect(r).toBeCloseTo(Math.atan2(20, 140) / DEG, 6);
    expect(wordsFor("pelvic-tilt", r, null)).toBe("Tipped forward by 8.1°");
    expect(value(left, "pelvic-tilt")!.deg).toBeCloseTo(r, 6);
  });

  it("reads a knee behind its hip-to-ankle line as bending back, from either side", () => {
    const r = value(right, "knee-back-right")!;
    expect(r.deg).toBeGreaterThan(0);
    expect(value(left, "knee-back-left")!.deg).toBeCloseTo(r.deg, 6);
    expect(wordsFor("knee-back-right", r.deg, null)).toMatch(/^Bends back /);
  });

  it("stays put when the phone is turned", () => {
    for (const key of ["head-forward", "body-line", "pelvic-tilt", "shoulder-forward-right", "knee-back-right"]) {
      expect(value(turned(right, -2.5), key)!.deg).toBeCloseTo(value(right, key)!.deg, 6);
    }
  });
});

describe("from the back", () => {
  it("needs the scale for the dimples, and reads them in millimetres", () => {
    const s = {
      "right-shoulder": { x: 680, y: 500 },
      "left-shoulder": { x: 400, y: 500 },
      "right-back-hip": { x: 590, y: 990 },
      "left-back-hip": { x: 490, y: 981 },
      neck: { x: 540, y: 470 },
    };
    const withScale = readView(capture("back", s));
    const dimples = withScale.find((r) => r.key === "back-hip-level")!;
    expect(dimples.mm).toBeCloseTo((9 / 900) * 1000, 6); // right 9 px lower: 10 mm
    expect(wordsFor("back-hip-level", dimples.deg, dimples.mm)).toBe("Right dimple lower by 10 mm");
    expect(readView(capture("back", s, { pxPerMetre: null })).some((r) => r.key === "back-hip-level")).toBe(false);
  });
});

describe("the report", () => {
  const round = (n: number, dy: number) =>
    capture("front", { ...FRONT, "right-shoulder": { x: 400, y: 500 + dy } }, { round: n });

  it("averages the rounds, keeps their gap, and says whether it is noise", () => {
    const report = buildReport([round(1, 5), round(2, 7)]);
    const shoulders = report.measures.find((m) => m.key === "shoulder-level")!;
    expect(shoulders.rounds).toHaveLength(2);
    expect(shoulders.deg).toBeCloseTo((Math.atan2(5, 280) + Math.atan2(7, 280)) / 2 / DEG, 6);
    expect(shoulders.spread).toBeCloseTo((Math.atan2(7, 280) - Math.atan2(5, 280)) / DEG, 6);
    expect(shoulders.unsteady).toBe(false);
    expect(noiseWords(shoulders)).toMatch(/^Your two rounds agreed within 0\.4°\. A change of more than 3\.6° between checks would be real\.$/);
    const wild = buildReport([round(1, 0), round(2, 40)]).measures.find((m) => m.key === "shoulder-level")!;
    expect(wild.unsteady).toBe(true);
  });

  it("says why each measure it could not take is missing", () => {
    const report = buildReport([capture("front", FRONT)]);
    const why = Object.fromEntries(report.missing.map((m) => [m.key, m.why]));
    expect(why["head-forward"]).toBe("The right side or left side view was not captured.");
    expect(why["back-hip-level"]).toBe("The back view was not captured.");
    expect(report.measures.map((m) => m.key)).toContain("knee-in-right");
    expect(report.vertical).toBe("plumb");
  });

  it("says where vertical came from, the weakest of any view", () => {
    expect(buildReport([capture("front", FRONT), capture("front", FRONT, { upFrom: "sensor" })]).vertical).toBe("sensor");
    expect(buildReport([capture("front", FRONT, { upFrom: "sensor" }), capture("front", FRONT, { upFrom: "none" })]).vertical).toBe("picture");
  });

  it("drops a reliable measure to trend-only when the model's points stood in", () => {
    const pose = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
    pose[12] = { x: 400, y: 505, visibility: 0.9 };
    pose[11] = { x: 680, y: 500, visibility: 0.9 };
    const m = buildReport([capture("front", {}, { pose })]).measures.find((x) => x.key === "shoulder-level")!;
    expect(m.tier).toBe("trend");
    expect(m.from).toBe("model");
  });

  it("lists every measure it knows, reliable first, each with the words it needs", () => {
    expect(MEASURE_ORDER).toHaveLength(Object.keys(MEASURES).length);
    const tiers = MEASURE_ORDER.map((k) => MEASURES[k].tier);
    expect(tiers.indexOf("trend")).toBeGreaterThan(tiers.lastIndexOf("reliable"));
    for (const k of MEASURE_ORDER) expect(MEASURES[k].needs.length).toBeGreaterThan(10);
  });

  it("never uses a word that diagnoses (ADR 0119)", () => {
    const words = JSON.stringify(MEASURES).toLowerCase();
    for (const banned of ["normal", "abnormal", "kyphosis", "lordosis", "scoliosis", "syndrome", "risk", "diagnos", "injury", "misalign", "imbalance"]) {
      expect(words).not.toContain(banned);
    }
  });

  it("writes numbers and words only, for sending on", () => {
    const text = reportText(buildReport([round(1, 5), round(2, 7)]), new Date("2026-10-01T09:00:00Z"), ["No plumb line."]);
    expect(text).toContain("Posture check, 2026-10-01");
    expect(text).toContain("vertical from the plumb line");
    expect(text).toContain("Shoulder level: Right shoulder lower by");
    expect(text).toContain("Along the way:\nNo plumb line.");
    expect(text).toContain("Not a medical assessment.");
  });

  it("gives each hold's numbers for tuning, naming the stickers it did not find", () => {
    const text = detailsText([capture("front", FRONT)], () => ["right-shoulder", "neck"]);
    expect(text).toContain("round 1 front · 1/2 stickers · missing neck · 10 frames · still 1.0 px · up plumb");
    expect(text).toContain("900 px/m");
  });
});

describe("a hold, down to one place per sticker", () => {
  it("takes each sticker's median and drops one seen in under half the frames", () => {
    const frame = (x: number, extra = false) => ({
      found: [
        { id: "right-shoulder", blob: { centre: { x, y: 500 } } },
        ...(extra ? [{ id: "neck", blob: { centre: { x: 1, y: 1 } } }] : []),
      ],
    });
    const c = captureFrom({
      view: "front",
      round: 1,
      frames: [frame(400), frame(401, true), frame(402), frame(403)],
      poses: [],
      up: { x: 0, y: -1 },
      upFrom: "plumb",
      pxPerMetre: 900,
      width: 1080,
      height: 1920,
      stillPx: 0.5,
    });
    expect(c.stickers["right-shoulder"]).toEqual({ x: 401.5, y: 500 });
    expect(c.stickers.neck).toBeUndefined();
    expect(c.frames).toBe(4);
  });
});
