import { describe, expect, it } from "vitest";
import {
  bodyLimitFor,
  cropBox,
  cropOverlay,
  dayHeading,
  defaultShapeFor,
  groupByDay,
  isPostShape,
  isPostStatus,
  POST_SHAPES,
  postDay,
  postTitle,
  readyToSchedule,
  roundToStep,
  SHAPE_RATIO,
} from "../src/lib/social/posts";

/**
 * The pure half of a post (slice S1). `cropBox` gets the most attention here
 * because it is the one function whose output reaches `sharp.extract()`, which
 * throws on a box that leaves the picture — so "inside the source, always" is
 * a property rather than an example.
 */

describe("cropBox", () => {
  // What the library actually holds: `PHOTO_MAX_EDGE` on the long side.
  const landscape = { width: 1600, height: 1067 };
  const portraitSource = { width: 1067, height: 1600 };

  it("cuts the largest square a landscape photo holds", () => {
    const box = cropBox(landscape, "square", { x: 0.5, y: 0.5 });
    expect(box.width).toBe(1067);
    expect(box.height).toBe(1067);
    // Centred: the same margin either side.
    expect(box.left).toBe(Math.round((1600 - 1067) / 2));
    expect(box.top).toBe(0);
  });

  it("cuts a tall box from the same landscape photo, limited by its height", () => {
    const box = cropBox(landscape, "portrait", { x: 0.5, y: 0.5 });
    expect(box.height).toBe(1067);
    expect(box.width).toBe(Math.round(1067 * SHAPE_RATIO.portrait));
  });

  it("cuts a wide strip limited by the photo's WIDTH when the ratio is wider than the source", () => {
    // 1.91 is wider than 1600/1067 ≈ 1.50, so width is the binding edge.
    const box = cropBox(landscape, "wide", { x: 0.5, y: 0.5 });
    expect(box.width).toBe(1600);
    expect(box.height).toBe(Math.round(1600 / SHAPE_RATIO.wide));
  });

  it("never leaves the picture, for any shape, focus or source", () => {
    const sources = [landscape, portraitSource, { width: 800, height: 800 }, { width: 3, height: 97 }];
    const focuses = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: -4, y: 9 },
      { x: Number.NaN, y: Number.NaN },
    ];
    for (const source of sources) {
      for (const shape of POST_SHAPES) {
        for (const focus of focuses) {
          const box = cropBox(source, shape, focus);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.top).toBeGreaterThanOrEqual(0);
          expect(box.width).toBeGreaterThan(0);
          expect(box.height).toBeGreaterThan(0);
          expect(box.left + box.width).toBeLessThanOrEqual(source.width);
          expect(box.top + box.height).toBeLessThanOrEqual(source.height);
        }
      }
    }
  });

  it("slides the box towards the focus and stops at the edge", () => {
    const left = cropBox(landscape, "square", { x: 0, y: 0.5 });
    expect(left.left).toBe(0);
    const right = cropBox(landscape, "square", { x: 1, y: 0.5 });
    expect(right.left).toBe(1600 - 1067);
    const middle = cropBox(landscape, "square", { x: 0.5, y: 0.5 });
    expect(middle.left).toBeGreaterThan(left.left);
    expect(middle.left).toBeLessThan(right.left);
  });

  it("keeps the asked-for ratio to within a pixel of rounding", () => {
    for (const shape of POST_SHAPES) {
      const box = cropBox(landscape, shape, { x: 0.5, y: 0.5 });
      expect(box.width / box.height).toBeCloseTo(SHAPE_RATIO[shape], 1);
    }
  });

  it("survives a source smaller than one pixel of nonsense", () => {
    const box = cropBox({ width: 0, height: 0 }, "square", { x: 0.5, y: 0.5 });
    expect(box).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });
});

describe("cropOverlay", () => {
  it("is the same box in percentages, so the preview and the JPEG agree", () => {
    const source = { width: 1600, height: 1067 };
    const box = cropBox(source, "square", { x: 0.5, y: 0.5 });
    const overlay = cropOverlay(source, "square", { x: 0.5, y: 0.5 });
    expect(overlay.width).toBe(`${(100 * box.width) / 1600}%`);
    expect(overlay.top).toBe(`${(100 * box.top) / 1067}%`);
  });
});

describe("bodyLimitFor", () => {
  it("holds the writer to the NETWORK's limit where it is tighter than ours", () => {
    expect(bodyLimitFor("x")).toBe(280);
    expect(bodyLimitFor("pinterest")).toBe(500);
    expect(bodyLimitFor("instagram")).toBe(2200);
    expect(bodyLimitFor("linkedin")).toBe(3000);
  });

  it("holds it to OURS where the network is more generous", () => {
    expect(bodyLimitFor("facebook")).toBe(5000);
    expect(bodyLimitFor("other")).toBe(5000);
  });
});

describe("defaultShapeFor", () => {
  it("opens each network on the shape it actually shows", () => {
    expect(defaultShapeFor("tiktok")).toBe("story");
    expect(defaultShapeFor("instagram")).toBe("portrait");
    expect(defaultShapeFor("x")).toBe("wide");
    expect(defaultShapeFor("facebook")).toBe("square");
  });
});

describe("postTitle", () => {
  it("is the first words, tidied of line breaks", () => {
    expect(postTitle({ body: "Market day\n  this Saturday", network: "facebook" })).toBe(
      "Market day this Saturday",
    );
  });

  it("cuts a long one and says so", () => {
    const long = postTitle({ body: "x".repeat(200), network: "facebook" });
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("names the network when nothing is written, so the row is not blank", () => {
    expect(postTitle({ body: "   ", network: "instagram" })).toBe(
      "Instagram post, nothing written yet",
    );
  });
});

describe("postDay", () => {
  it("is the day in the BUSINESS's zone, not the reader's", () => {
    // 03:30 UTC on the 5th is still the 4th in Kentucky.
    const at = new Date("2026-09-05T03:30:00Z");
    expect(postDay(at, "America/New_York")).toBe("2026-09-04");
    expect(postDay(at, "UTC")).toBe("2026-09-05");
  });

  it("is null for a post with no date, which is what a draft is", () => {
    expect(postDay(null, "UTC")).toBeNull();
  });

  it("falls back to UTC rather than throwing on a zone nobody recognises", () => {
    expect(postDay(new Date("2026-09-05T12:00:00Z"), "Mars/Olympus")).toBe("2026-09-05");
  });
});

describe("groupByDay", () => {
  const rows = [
    { id: "a", day: "2026-09-05" },
    { id: "b", day: null },
    { id: "c", day: "2026-09-04" },
    { id: "d", day: "2026-09-05" },
  ];

  it("puts the dateless first, then the days in order", () => {
    const groups = groupByDay(rows, (r) => r.day);
    expect(groups.map((g) => g.day)).toEqual([null, "2026-09-04", "2026-09-05"]);
    expect(groups[2].items.map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("omits the dateless group entirely when there is none", () => {
    const groups = groupByDay(rows.filter((r) => r.day !== null), (r) => r.day);
    expect(groups.map((g) => g.day)).toEqual(["2026-09-04", "2026-09-05"]);
  });

  it("has nothing to group when there is nothing", () => {
    expect(groupByDay([], () => null)).toEqual([]);
  });
});

describe("dayHeading", () => {
  it("says the words a person would", () => {
    expect(dayHeading("2026-09-05", "2026-09-05")).toBe("Today");
    expect(dayHeading("2026-09-06", "2026-09-05")).toBe("Tomorrow");
    expect(dayHeading("2026-09-04", "2026-09-05")).toBe("Yesterday");
    expect(dayHeading(null, "2026-09-05")).toBe("No date yet");
  });

  it("writes a further-off day out in full", () => {
    expect(dayHeading("2026-09-12", "2026-09-05")).toBe("Saturday, September 12");
  });

  it("holds across a month boundary, where date arithmetic usually goes wrong", () => {
    expect(dayHeading("2026-10-01", "2026-09-30")).toBe("Tomorrow");
    expect(dayHeading("2026-09-30", "2026-10-01")).toBe("Yesterday");
  });
});

describe("roundToStep", () => {
  it("rounds to the ten minutes the sweep can actually keep", () => {
    expect(roundToStep(new Date("2026-09-05T10:07:00Z")).toISOString()).toBe(
      "2026-09-05T10:10:00.000Z",
    );
    expect(roundToStep(new Date("2026-09-05T10:04:59Z")).toISOString()).toBe(
      "2026-09-05T10:00:00.000Z",
    );
  });

  it("leaves a time that is already on the step alone", () => {
    const on = new Date("2026-09-05T10:20:00Z");
    expect(roundToStep(on).getTime()).toBe(on.getTime());
  });
});

describe("readyToSchedule", () => {
  it("wants words, not whitespace", () => {
    expect(readyToSchedule({ body: "Market day" })).toBe(true);
    expect(readyToSchedule({ body: "   \n " })).toBe(false);
    expect(readyToSchedule({ body: "" })).toBe(false);
  });
});

describe("the stored-word guards", () => {
  it("refuse a word nobody registered, because a row can be edited by hand", () => {
    expect(isPostShape("square")).toBe(true);
    expect(isPostShape("panorama")).toBe(false);
    expect(isPostStatus("scheduled")).toBe(true);
    expect(isPostStatus("idea")).toBe(false);
  });
});
