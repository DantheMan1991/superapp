import { describe, expect, it } from "vitest";
import {
  dayKeys,
  localDayOf,
  summarizeViews,
  ViewBeaconSchema,
  visitStorageKey,
} from "../src/lib/sites/views-core";

describe("the view beacon's shape", () => {
  it("takes a site, a path and whether this is the browser's first view today", () => {
    expect(ViewBeaconSchema.parse({ site: " oak-row-farm ", path: "/about", first: true })).toEqual({
      site: "oak-row-farm",
      path: "/about",
      first: true,
    });
    expect(ViewBeaconSchema.parse({ site: "x" })).toEqual({ site: "x", path: "/", first: false });
    expect(ViewBeaconSchema.safeParse({ site: "" }).success).toBe(false);
    expect(ViewBeaconSchema.safeParse({ site: "x", path: "p".repeat(201) }).success).toBe(false);
  });

  it("keys the browser's own note by site and calendar day", () => {
    expect(visitStorageKey("oak-row-farm", "2026-09-04")).toBe("yosher-site-visit:oak-row-farm:2026-09-04");
    expect(localDayOf(new Date(2026, 8, 4, 23, 59))).toBe("2026-09-04");
    expect(localDayOf(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});

describe("a month of views", () => {
  it("lists the window's days oldest first, across a month boundary", () => {
    expect(dayKeys("2026-09-02", 4)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(dayKeys("2026-09-04", 1)).toEqual(["2026-09-04"]);
  });

  it("fills quiet days with zeros, sums pages, and ignores rows outside the window", () => {
    const summary = summarizeViews(
      [
        { day: "2026-09-04", path: "/", views: 5, visitors: 3 },
        { day: "2026-09-04", path: "/contact", views: 2, visitors: 0 },
        { day: "2026-09-02", path: "/", views: 1, visitors: 1 },
        { day: "2026-08-01", path: "/", views: 99, visitors: 99 },
      ],
      "2026-09-04",
      3,
    );
    expect(summary.days).toEqual([
      { day: "2026-09-02", views: 1, visitors: 1 },
      { day: "2026-09-03", views: 0, visitors: 0 },
      { day: "2026-09-04", views: 7, visitors: 3 },
    ]);
    expect(summary.pages).toEqual([
      { path: "/", views: 6, visitors: 4 },
      { path: "/contact", views: 2, visitors: 0 },
    ]);
    expect(summary.totals).toEqual({ views: 8, visitors: 4 });
  });

  it("is empty but well-formed with nothing counted", () => {
    const summary = summarizeViews([], "2026-09-04", 30);
    expect(summary.days).toHaveLength(30);
    expect(summary.days[29].day).toBe("2026-09-04");
    expect(summary.pages).toEqual([]);
    expect(summary.totals).toEqual({ views: 0, visitors: 0 });
  });
});
