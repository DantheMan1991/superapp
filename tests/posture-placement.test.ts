import { describe, expect, it } from "vitest";
import { levelFrame, type Point } from "../src/modules/fitness/posture/core/geometry";
import type { ViewCapture } from "../src/modules/fitness/posture/core/measures";
import { LISTED_MM, movedFor, placesOf, shiftsBetween, SLIPPED_MM } from "../src/modules/fitness/posture/core/placement";
import { stickersIn } from "../src/modules/fitness/posture/core/sticker-map";
import { predict } from "../src/modules/fitness/posture/core/stickers";
import type { PosePoint } from "../src/modules/fitness/posture/core/views";

/**
 * WHERE A STICKER WENT, AGAINST LAST TIME (docs/modules/posture.md, slice 3b):
 * on a drawn body, a sticker put on 3 cm higher reads as 3 cm higher, and the
 * same body standing somewhere else, or a crooked phone, reads as no move.
 */

// A person facing the phone, 500 px from shoulders to hips, 900 px a metre.
const POSE: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
const at = (i: number, x: number, y: number) => (POSE[i] = { x, y, visibility: 1 });
at(0, 540, 320);
at(7, 560, 300);
at(8, 520, 300);
at(11, 680, 500);
at(12, 400, 500);
at(23, 610, 1000);
at(24, 470, 1000);
at(25, 600, 1350);
at(26, 480, 1350);
at(27, 590, 1700);
at(28, 470, 1700);

/** Every front sticker exactly where the body's landmarks say it belongs. */
function onTheBones(): Record<string, Point> {
  const predictions = predict(stickersIn("front"), "front", POSE, levelFrame({ x: 0, y: -1 }), 0);
  return Object.fromEntries(predictions.map((p) => [p.sticker.id, p.at]));
}

function capture(stickers: Record<string, Point>, over: Partial<ViewCapture> = {}): ViewCapture {
  return {
    view: "front",
    round: 1,
    up: { x: 0, y: -1 },
    upFrom: "plumb",
    pxPerMetre: 900,
    width: 1080,
    height: 1920,
    stickers,
    pose: POSE,
    frames: 12,
    stillPx: 1,
    ...over,
  };
}

/** The whole picture moved and turned: the same body, standing elsewhere, or a phone a little crooked. */
function moved(c: ViewCapture, dx: number, dy: number, deg: number): ViewCapture {
  const r = (deg * Math.PI) / 180;
  const f = (p: Point): Point => ({
    x: 540 + (p.x - 540) * Math.cos(r) - (p.y - 1000) * Math.sin(r) + dx,
    y: 1000 + (p.x - 540) * Math.sin(r) + (p.y - 1000) * Math.cos(r) + dy,
  });
  return {
    ...c,
    // True up turns with the picture.
    up: { x: Math.sin(r), y: -Math.cos(r) },
    pose: c.pose!.map((p) => ({ ...f(p), visibility: p.visibility })),
    stickers: Object.fromEntries(Object.entries(c.stickers).map(([id, p]) => [id, f(p)])),
  };
}

describe("where a sticker sat, against last time", () => {
  const last = capture(onTheBones());

  it("reads a sticker put on higher as higher, in centimeters", () => {
    const now = onTheBones();
    now["right-kneecap"] = { x: now["right-kneecap"].x, y: now["right-kneecap"].y - 30 };
    const shifts = shiftsBetween(placesOf([capture(now)]), placesOf([last]));
    // 30 px of a 500 px torso, at 900 px a metre: 500 px is 555.6 mm, so 33.3 mm.
    expect(shifts[0].id).toBe("right-kneecap");
    expect(shifts[0].mm).toBeCloseTo((30 / 900) * 1000, 6);
    expect(shifts[0].words).toBe("3.3 cm higher");
    expect(shifts[0].mm).toBeGreaterThan(SLIPPED_MM);
    expect(shifts.slice(1).every((s) => s.mm < 0.001)).toBe(true);
  });

  it("says sideways in the person's own terms", () => {
    const now = onTheBones();
    // Facing the phone, the picture's right is the person's left.
    now["left-shoulder"] = { x: now["left-shoulder"].x + 25, y: now["left-shoulder"].y };
    const [s] = shiftsBetween(placesOf([capture(now)]), placesOf([last]));
    expect(s.words).toBe("2.8 cm toward your left");
  });

  it("reads the same body standing elsewhere, or a crooked phone, as no move at all", () => {
    const now = moved(capture(onTheBones()), 60, -25, 2);
    const shifts = shiftsBetween(placesOf([now]), placesOf([last]));
    expect(shifts.length).toBeGreaterThan(5);
    expect(Math.max(...shifts.map((s) => s.mm))).toBeLessThan(0.5);
  });

  it("says about, when neither check had a scale", () => {
    const now = onTheBones();
    now["right-kneecap"] = { x: now["right-kneecap"].x, y: now["right-kneecap"].y + 30 };
    const [s] = shiftsBetween(placesOf([capture(now, { pxPerMetre: null })]), placesOf([capture(onTheBones(), { pxPerMetre: null })]));
    expect(s.approximate).toBe(true);
    expect(s.words).toMatch(/^about \d+\.\d cm lower$/);
  });

  it("names the measures a moved sticker is read from, and only past the listed distance", () => {
    const now = onTheBones();
    now["right-kneecap"] = { x: now["right-kneecap"].x, y: now["right-kneecap"].y - 30 };
    const shifts = shiftsBetween(placesOf([capture(now)]), placesOf([last]));
    expect(movedFor("knee-in-right", shifts).map((s) => s.id)).toEqual(["right-kneecap"]);
    expect(movedFor("knee-in-left", shifts)).toEqual([]);
    expect(movedFor("knee-in-right", shifts, 40)).toEqual([]);
    expect(LISTED_MM).toBeLessThan(SLIPPED_MM);
  });

  it("compares nothing that only one check read", () => {
    const now = onTheBones();
    delete now["right-kneecap"];
    expect(shiftsBetween(placesOf([capture(now)]), placesOf([last])).some((s) => s.id === "right-kneecap")).toBe(false);
    expect(placesOf([capture(onTheBones(), { pose: null })])).toEqual({});
  });
});
