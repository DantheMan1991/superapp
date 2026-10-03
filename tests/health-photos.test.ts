import { describe, expect, it } from "vitest";
import { mainBackCamera, parseCameraLabel } from "../src/lib/camera-label";
import {
  copyName,
  daysWith,
  fitEdge,
  keptPair,
  nearestDay,
  PHOTO_EDGE,
  PHOTO_LINES,
  PHOTO_NUDGE_DAYS,
  photoDays,
  photoLines,
  photoNudgeDue,
  photosAgo,
  POSES,
  startPair,
  stepDay,
} from "../src/modules/health/core/photos";
import { shiftDay } from "../src/modules/health/core/progress";

/**
 * Progress photos, pure (docs/modules/health.md, H2b): the poses and what the
 * voice says, a photo's size, Today's four-week line, the days to compare and
 * stepping through them, a copy's name, and which camera is the main back
 * lens. Every date is fixed.
 */

const TODAY = "2026-10-03";

describe("the poses and the voice", () => {
  it("are front, side and back, in that order, with a line for each turn and each one taken again", () => {
    expect(POSES).toEqual(["front", "side", "back"]);
    const lines = photoLines();
    expect(lines).toContain(PHOTO_LINES.start);
    expect(lines).toContain(PHOTO_LINES.side);
    expect(lines).toContain(PHOTO_LINES.back);
    expect(lines).toContain(PHOTO_LINES.done);
    for (const pose of POSES) expect(lines).toContain(PHOTO_LINES.again[pose]);
    // Every line fits the recorded voice's limit, and none says anything twice.
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(300);
  });
});

describe("a photo's size", () => {
  it("is held to the longest side Health keeps, its shape kept, and never made bigger", () => {
    expect(fitEdge(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(fitEdge(2160, 3840)).toEqual({ width: 1152, height: PHOTO_EDGE });
    expect(fitEdge(3000, 4000)).toEqual({ width: 1536, height: 2048 });
    expect(fitEdge(720, 1280)).toEqual({ width: 720, height: 1280 });
    expect(fitEdge(0, 1920)).toEqual({ width: 0, height: 0 });
  });
});

describe("Today's line", () => {
  it("comes four weeks after the last photos, never before the first", () => {
    expect(PHOTO_NUDGE_DAYS).toBe(28);
    expect(photoNudgeDue(null, TODAY)).toBe(false);
    expect(photoNudgeDue(shiftDay(TODAY, -27), TODAY)).toBe(false);
    expect(photoNudgeDue(shiftDay(TODAY, -28), TODAY)).toBe(true);
  });

  it("says how long ago, in days, weeks or months", () => {
    expect(photosAgo(TODAY, TODAY)).toBe("today");
    expect(photosAgo(shiftDay(TODAY, -1), TODAY)).toBe("yesterday");
    expect(photosAgo(shiftDay(TODAY, -6), TODAY)).toBe("6 days ago");
    expect(photosAgo(shiftDay(TODAY, -7), TODAY)).toBe("1 week ago");
    expect(photosAgo(shiftDay(TODAY, -28), TODAY)).toBe("4 weeks ago");
    expect(photosAgo(shiftDay(TODAY, -59), TODAY)).toBe("8 weeks ago");
    expect(photosAgo(shiftDay(TODAY, -95), TODAY)).toBe("3 months ago");
  });
});

describe("the days to compare", () => {
  const keys = [
    { day: "2026-09-06", pose: "front" as const },
    { day: "2026-09-06", pose: "side" as const },
    { day: "2026-09-20", pose: "front" as const },
    { day: "2026-09-20", pose: "back" as const },
    { day: TODAY, pose: "front" as const },
    { day: TODAY, pose: "side" as const },
    { day: TODAY, pose: "back" as const },
  ];

  it("are the days with that pose, oldest first; and every day, newest first, with its poses", () => {
    expect(daysWith(keys, "front")).toEqual(["2026-09-06", "2026-09-20", TODAY]);
    expect(daysWith(keys, "side")).toEqual(["2026-09-06", TODAY]);
    expect(photoDays(keys)).toEqual([
      { day: TODAY, poses: ["front", "side", "back"] },
      { day: "2026-09-20", poses: ["front", "back"] },
      { day: "2026-09-06", poses: ["front", "side"] },
    ]);
  });

  it("start on the first and the latest, or one day alone", () => {
    expect(startPair(["2026-09-06", "2026-09-20", TODAY])).toEqual({ left: "2026-09-06", right: TODAY });
    expect(startPair([TODAY])).toEqual({ left: TODAY, right: TODAY });
    expect(startPair([])).toBeNull();
  });

  it("step one day at a time, held at either end, from the nearest day there is", () => {
    const days = ["2026-09-06", "2026-09-20", TODAY];
    expect(stepDay(days, "2026-09-20", -1)).toBe("2026-09-06");
    expect(stepDay(days, "2026-09-20", 1)).toBe(TODAY);
    expect(stepDay(days, "2026-09-06", -1)).toBe("2026-09-06");
    expect(stepDay(days, TODAY, 1)).toBe(TODAY);
    // A day since deleted: from the nearest before it.
    expect(nearestDay(days, "2026-09-25")).toBe("2026-09-20");
    expect(nearestDay(days, "2026-09-01")).toBe("2026-09-06");
    expect(stepDay(days, "2026-09-25", 1)).toBe(TODAY);
  });

  it("keep a picked pair to days there are, the earlier on the left", () => {
    const days = ["2026-09-06", "2026-09-20", TODAY];
    expect(keptPair(days, null)).toEqual({ left: "2026-09-06", right: TODAY });
    expect(keptPair(days, { left: "2026-09-20", right: TODAY })).toEqual({ left: "2026-09-20", right: TODAY });
    expect(keptPair(days, { left: TODAY, right: "2026-09-06" })).toEqual({ left: "2026-09-06", right: TODAY });
    expect(keptPair(days, { left: "2026-09-10", right: "2026-09-30" })).toEqual({ left: "2026-09-06", right: "2026-09-20" });
    expect(keptPair([], { left: TODAY, right: TODAY })).toBeNull();
  });

  it("name a saved copy by pose and day", () => {
    expect(copyName(TODAY, "side")).toBe("yosher-side-2026-10-03.jpg");
  });
});

describe("the main back lens", () => {
  it("is the back camera with the lowest number, so a Samsung's ultrawide is passed over", () => {
    expect(parseCameraLabel("camera2 0, facing back")).toEqual({ index: 0, facing: "back" });
    expect(
      mainBackCamera([
        { deviceId: "front", label: "camera2 1, facing front" },
        { deviceId: "wide", label: "camera2 2, facing back" },
        { deviceId: "main", label: "camera2 0, facing back" },
      ]),
    ).toBe("main");
    expect(mainBackCamera([{ deviceId: "only", label: "Back Camera" }])).toBe("only");
  });

  it("is unknown before the camera is allowed (no names) or on a laptop", () => {
    expect(mainBackCamera([{ deviceId: "a", label: "" }])).toBeNull();
    expect(mainBackCamera([{ deviceId: "a", label: "FaceTime HD Camera" }])).toBeNull();
    expect(mainBackCamera([])).toBeNull();
  });
});
