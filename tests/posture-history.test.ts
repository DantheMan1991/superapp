import { describe, expect, it } from "vitest";
import { postureCheckDocSchema, toCheckDoc } from "../src/modules/fitness/posture/core/check-doc";
import {
  changeWords,
  compare,
  firstOf,
  historyCsv,
  noiseFor,
  OWN_NOISE_AFTER,
  previousOf,
  summarize,
  trend,
  trends,
  type CheckSummary,
  type MeasurePoint,
} from "../src/modules/fitness/posture/core/history";
import { MEASURES, type MeasureKey, type ViewCapture } from "../src/modules/fitness/posture/core/measures";

/**
 * A PERSON'S CHECKS OVER TIME (docs/modules/posture.md, slice 3; ADRs 0119 and
 * 0120): the noise a change must beat (the published floor, the person's own
 * only when bigger), a change in the measure's own words, and never better or
 * worse; and the one document a phone sends the account, which has no place
 * for anything but numbers and words.
 */

function check(id: string, takenAt: string, measures: Partial<Record<MeasureKey, Partial<MeasurePoint>>>): CheckSummary {
  const full: Partial<Record<MeasureKey, MeasurePoint>> = {};
  for (const [key, m] of Object.entries(measures) as [MeasureKey, Partial<MeasurePoint>][]) {
    full[key] = { value: 0, unit: MEASURES[key].unit, words: "w", tier: MEASURES[key].tier, rounds: [], ...m };
  }
  return { id, takenAt, localDay: takenAt.slice(0, 10), views: 4, rounds: 2, vertical: "plumb", measures: full };
}

describe("the noise a change must beat", () => {
  it("is the published figure until there are enough checks to say otherwise", () => {
    const history = [check("a", "2026-10-01T07:00:00Z", { "shoulder-level": { value: 1, rounds: [1, 3] } })];
    const n = noiseFor("shoulder-level", history);
    expect(n.used).toBe(MEASURES["shoulder-level"].mdc);
    expect(n.from).toBe("published");
    expect(n.own?.checks).toBe(1);
  });

  it("becomes the person's own once three checks show it bigger", () => {
    // Rounds 4° apart every time: SEM = 4 / √2, so 1.96 × √2 × SEM = 7.84°, more than the published 3.6°.
    const history = ["a", "b", "c"].map((id, i) =>
      check(id, `2026-10-0${i + 1}T07:00:00Z`, { "shoulder-level": { value: 1, rounds: [3, -1] } }),
    );
    const n = noiseFor("shoulder-level", history);
    expect(n.own?.checks).toBe(OWN_NOISE_AFTER);
    expect(n.own?.mdc).toBeCloseTo(7.84, 6);
    expect(n.used).toBeCloseTo(7.84, 6);
    expect(n.from).toBe("yours");
  });

  it("never drops below the published figure: rounds minutes apart cannot speak for another day", () => {
    const steady = ["a", "b", "c", "d"].map((id, i) =>
      check(id, `2026-10-0${i + 1}T07:00:00Z`, { "shoulder-level": { value: 1, rounds: [1.1, 1] } }),
    );
    const n = noiseFor("shoulder-level", steady);
    expect(n.own!.mdc).toBeLessThan(1);
    expect(n.used).toBe(MEASURES["shoulder-level"].mdc);
    expect(n.from).toBe("published");
  });
});

describe("a change between two checks", () => {
  const history = [
    check("first", "2026-10-01T07:00:00Z", { "head-forward": { value: 47.1 }, "shoulder-level": { value: 2.0 } }),
    check("second", "2026-10-15T07:00:00Z", { "head-forward": { value: 50.0 }, "shoulder-level": { value: 1.5 } }),
    check("third", "2026-10-29T07:00:00Z", { "head-forward": { value: 52.7 }, "shoulder-level": { value: 1.2 } }),
  ];

  it("is later minus earlier, and real only past the noise", () => {
    const [first, , third] = history;
    const head = compare("head-forward", third, first, history)!;
    expect(head.change).toBeCloseTo(5.6, 6);
    expect(head.beyond).toBe(true); // more than 5°
    expect(head.words).toBe("5.6° higher");
    const shoulders = compare("shoulder-level", third, first, history)!;
    expect(shoulders.beyond).toBe(false); // 0.8° against 3.6°
    expect(shoulders.words).toBe("Left side 0.8° lower than before");
  });

  it("is said in each measure's own terms, never as better or worse", () => {
    expect(changeWords("shoulder-level", 1.2, "deg")).toBe("Right side 1.2° lower than before");
    expect(changeWords("back-hip-level", -12, "mm")).toBe("Left side 12 mm lower than before");
    expect(changeWords("head-tilt", -2, "deg")).toBe("Tilted 2.0° more to your left");
    expect(changeWords("knee-in-right", 1.5, "deg")).toBe("1.5° more inward");
    expect(changeWords("body-line", -1, "deg")).toBe("1.0° more back");
    expect(changeWords("pelvic-tilt", 3, "deg")).toBe("Tipped 3.0° more forward");
    expect(changeWords("shoulder-forward-left", 2, "deg")).toBe("2.0° further ahead of the line");
    expect(changeWords("knee-back-left", -2, "deg")).toBe("Bends back 2.0° less");
    expect(changeWords("trunk-lean", 0.01, "deg")).toBe("No change");
    const every = (Object.keys(MEASURES) as MeasureKey[]).flatMap((k) => [changeWords(k, 3, MEASURES[k].unit), changeWords(k, -3, MEASURES[k].unit)]);
    for (const banned of ["better", "worse", "improv", "normal", "good", "bad", "risk"]) {
      expect(every.join(" ").toLowerCase()).not.toContain(banned);
    }
  });

  it("is only ever made with an earlier check, and the one just before is the default", () => {
    expect(previousOf("third", history)?.id).toBe("second");
    expect(previousOf("first", history)).toBeNull();
    expect(firstOf(history)?.id).toBe("first");
    expect(compare("head-forward", history[0], history[2], history)?.change).toBeCloseTo(-5.6, 6);
  });

  it("is not made between checks that lack the measure or read it in different units", () => {
    const a = check("a", "2026-10-01T07:00:00Z", { "back-hip-level": { value: 4, unit: "mm" } });
    const b = check("b", "2026-10-02T07:00:00Z", { "back-hip-level": { value: 1, unit: "deg" } });
    expect(compare("back-hip-level", b, a, [a, b])).toBeNull();
    expect(compare("head-forward", b, a, [a, b])).toBeNull();
  });
});

describe("a measure across the checks", () => {
  it("needs two checks, and holds the latest against the first", () => {
    const one = [check("a", "2026-10-01T07:00:00Z", { "body-line": { value: 1 } })];
    expect(trend("body-line", one)).toBeNull();
    const three = [
      check("c", "2026-10-29T07:00:00Z", { "body-line": { value: 5.5, words: "Leaning forward by 5.5°" } }),
      check("a", "2026-10-01T07:00:00Z", { "body-line": { value: 1 } }),
      check("b", "2026-10-15T07:00:00Z", { "body-line": { value: 2 } }),
    ];
    const t = trend("body-line", three)!;
    expect(t.points.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(t.change).toBeCloseTo(4.5, 6);
    expect(t.beyond).toBe(true); // more than 2.9°
    expect(t.latestWords).toBe("Leaning forward by 5.5°");
    expect(trends(three).map((x) => x.key)).toEqual(["body-line"]);
  });
});

describe("the numbers as a spreadsheet", () => {
  it("is one row per check and measure, oldest first, with each round", () => {
    const csv = historyCsv([
      check("b", "2026-10-15T07:00:00Z", { "shoulder-level": { value: 1.234, rounds: [1.2, 1.268], words: "Right shoulder lower by 1.2°" } }),
      check("a", "2026-10-01T07:00:00Z", { "back-hip-level": { value: 12.4, unit: "mm", rounds: [12, 13], words: 'Left dimple lower by 12 mm, "about"' } }),
    ]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("taken_at,day,measure,value,unit,round_1,round_2,tier,words");
    expect(lines[1]).toBe('2026-10-01T07:00:00Z,2026-10-01,Low back dimples,12,mm,12,13,trend only,"Left dimple lower by 12 mm, ""about"""');
    expect(lines[2]).toBe("2026-10-15T07:00:00Z,2026-10-15,Shoulder level,1.23,degrees,1.2,1.27,reliable,Right shoulder lower by 1.2°");
  });
});

const FRONT: ViewCapture = {
  view: "front",
  round: 1,
  up: { x: 0, y: -1 },
  upFrom: "plumb",
  pxPerMetre: 900,
  width: 1080,
  height: 1920,
  stickers: { "right-shoulder": { x: 400, y: 505 }, "left-shoulder": { x: 680, y: 500 } },
  pose: null,
  frames: 12,
  stillPx: Number.NaN,
};

describe("what a phone sends the account", () => {
  const doc = toCheckDoc({ id: "0b7f3c2e-4a51-4d0e-9a1b-6c2d8e9f0a13", at: "2026-10-01T07:00:00.000Z", captures: [FRONT], notes: ["No plumb line."] });

  it("is numbers and words, and a NaN goes as nothing", () => {
    expect(doc.captures[0].stillPx).toBeNull();
    expect(postureCheckDocSchema.safeParse(doc).success).toBe(true);
  });

  it("has no place for anything else: an extra field anywhere is refused, not dropped", () => {
    expect(postureCheckDocSchema.safeParse({ ...doc, photo: "data:image/jpeg;base64,AAAA" }).success).toBe(false);
    expect(postureCheckDocSchema.safeParse({ ...doc, captures: [{ ...doc.captures[0], frame: [1, 2, 3] }] }).success).toBe(false);
    expect(
      postureCheckDocSchema.safeParse({ ...doc, captures: [{ ...doc.captures[0], stickers: { "not-a-sticker": { x: 1, y: 2 } } }] }).success,
    ).toBe(false);
    expect(postureCheckDocSchema.safeParse({ ...doc, captures: [{ ...doc.captures[0], up: { x: 0, y: -2 } }] }).success).toBe(false);
    expect(postureCheckDocSchema.safeParse({ ...doc, captures: [{ ...doc.captures[0], width: Number.POSITIVE_INFINITY }] }).success).toBe(false);
  });

  it("summarizes the same as the report reads it", () => {
    const s = summarize({ id: doc.id, takenAt: doc.takenAt, localDay: doc.localDay, captures: [FRONT] });
    expect(s.measures["shoulder-level"]?.words).toBe("Right shoulder lower by 1.0° (6 mm)");
    expect(s.measures["shoulder-level"]?.unit).toBe("deg");
    expect(s.views).toBe(1);
  });
});
