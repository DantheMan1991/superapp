import { describe, expect, it } from "vitest";
import {
  areaForPath,
  areaKeys,
  deniedAreaPaths,
  moduleSlugFromPath,
} from "@/lib/access/areas";
import { reaches } from "@/lib/access/can";
import { featureRegistry } from "@/lib/features";
import type { AreaDefinition } from "@/modules/types";

/**
 * WHICH PART OF A TOOL A PAGE BELONGS TO (ADR 0095).
 *
 * This decides what a gate refuses, so its two failure directions are not
 * equally bad. Claiming a path that belongs to no area would 404 a screen
 * nobody chose to hide — visible, and reported within the hour. MISSING a path
 * leaves a screen open that an owner believed they had taken away, and nobody
 * finds out. The prefix tests below are about the second kind.
 */

const AREAS: AreaDefinition[] = [
  { key: "reports", name: "Reports" },
  { key: "trial-balance", name: "Trial balance" },
  { key: "sales", name: "Sales" },
];

describe("the tool a path is in", () => {
  it("is the third segment", () => {
    expect(moduleSlugFromPath("/dashboard/m/accounting/reports")).toBe("accounting");
    expect(moduleSlugFromPath("/dashboard/m/jobs")).toBe("jobs");
  });

  it("is nothing outside the module tree", () => {
    expect(moduleSlugFromPath("/dashboard/team")).toBeNull();
    expect(moduleSlugFromPath("/dashboard/m/")).toBeNull();
    expect(moduleSlugFromPath("")).toBeNull();
  });
});

describe("the area a path is in", () => {
  it("is the segment under the tool", () => {
    expect(areaForPath("/dashboard/m/accounting/reports", AREAS)).toBe("accounting:reports");
  });

  it("covers everything deeper", () => {
    expect(areaForPath("/dashboard/m/accounting/reports/pnl", AREAS)).toBe(
      "accounting:reports",
    );
    expect(areaForPath("/dashboard/m/accounting/reports/pnl/export", AREAS)).toBe(
      "accounting:reports",
    );
  });

  /** The tool's own front door, which is never an area and never taken away. */
  it("is NOTHING for the tool's index page", () => {
    expect(areaForPath("/dashboard/m/accounting", AREAS)).toBeNull();
    expect(areaForPath("/dashboard/m/accounting/", AREAS)).toBeNull();
  });

  it("is nothing for a segment nobody declared", () => {
    expect(areaForPath("/dashboard/m/accounting/something-new", AREAS)).toBeNull();
  });

  it("is nothing for a tool with no areas at all", () => {
    expect(areaForPath("/dashboard/m/assets/anything", undefined)).toBeNull();
    expect(areaForPath("/dashboard/m/assets/anything", [])).toBeNull();
  });

  /**
   * **THE BUG EVERY NAIVE `startsWith` HAS.** `report` must not claim
   * `reports`, and `trial` must not claim `trial-balance` — a prefix has to end
   * on a segment boundary or one area silently swallows its neighbours.
   */
  it("matches on segment boundaries, not characters", () => {
    const tricky: AreaDefinition[] = [{ key: "report", name: "Report" }];
    expect(areaForPath("/dashboard/m/accounting/reports", tricky)).toBeNull();
    expect(areaForPath("/dashboard/m/accounting/report", tricky)).toBe("accounting:report");
    expect(areaForPath("/dashboard/m/accounting/report/x", tricky)).toBe("accounting:report");
  });

  it("gives a nested area the path, not the broader one", () => {
    const nested: AreaDefinition[] = [
      { key: "reports", name: "Reports" },
      { key: "tax", name: "Tax reports", paths: ["reports/tax"] },
    ];
    expect(areaForPath("/dashboard/m/accounting/reports/x", nested)).toBe(
      "accounting:reports",
    );
    expect(areaForPath("/dashboard/m/accounting/reports/tax", nested)).toBe(
      "accounting:tax",
    );
  });

  it("honours an explicit path list over the key", () => {
    const aliased: AreaDefinition[] = [
      { key: "books", name: "Books", paths: ["journal", "trial-balance"] },
    ];
    expect(areaForPath("/dashboard/m/accounting/journal", aliased)).toBe("accounting:books");
    expect(areaForPath("/dashboard/m/accounting/trial-balance", aliased)).toBe(
      "accounting:books",
    );
    expect(areaForPath("/dashboard/m/accounting/books", aliased)).toBeNull();
  });
});

describe("a wildcard segment", () => {
  /**
   * **THE GAP THE FOUNDER FOUND BY OPENING THE SCREEN.** A job's real features
   * are tabs on a job, not top-level pages: estimating lives at
   * `/dashboard/m/jobs/<the job>/estimates`. An area that could only name the
   * first segment offered Setup, Cost codes and WIP — everything the pack has
   * except the work.
   */
  const JOB: AreaDefinition[] = [
    { key: "estimates", name: "Estimates", paths: ["*/estimates"] },
    { key: "warranty", name: "Warranty", paths: ["warranty", "*/warranty"] },
    { key: "wip", name: "Work in progress" },
  ];

  it("matches a tab under a record's id", () => {
    expect(areaForPath("/dashboard/m/jobs/abc-123/estimates", JOB)).toBe("jobs:estimates");
    expect(areaForPath("/dashboard/m/jobs/00000000-0000/estimates/2", JOB)).toBe(
      "jobs:estimates",
    );
  });

  it("does NOT match the same word at the top level", () => {
    expect(areaForPath("/dashboard/m/jobs/estimates", JOB)).toBeNull();
  });

  it("lets one area own both the cross-job list and the tab on one job", () => {
    expect(areaForPath("/dashboard/m/jobs/warranty", JOB)).toBe("jobs:warranty");
    expect(areaForPath("/dashboard/m/jobs/abc-123/warranty", JOB)).toBe("jobs:warranty");
  });

  /** The record's own page is not a tab, so it is never taken away. */
  it("leaves the record's own page alone", () => {
    expect(areaForPath("/dashboard/m/jobs/abc-123", JOB)).toBeNull();
  });

  /**
   * ONE SEGMENT, NOT MANY. A greedy wildcard would let this claim paths it
   * never named, and an area that owns more than it says is how a screen
   * disappears for a reason nobody can find.
   */
  it("spans exactly one segment", () => {
    expect(areaForPath("/dashboard/m/jobs/a/b/estimates", JOB)).toBeNull();
  });

  it("still refuses a partial segment", () => {
    expect(areaForPath("/dashboard/m/jobs/abc/estimatesx", JOB)).toBeNull();
  });
});

describe("every tool's declared areas", () => {
  /**
   * **EACH AREA MUST BE REACHABLE**, which is the whole point of declaring it:
   * a key nothing routes to is a tick box that takes nothing away, and the
   * owner who ticked it believes otherwise.
   */
  it("produce a key that resolves back to themselves", () => {
    for (const [slug, feature] of Object.entries(featureRegistry)) {
      for (const area of feature.areas ?? []) {
        for (const path of area.paths ?? [area.key]) {
          expect(
            areaForPath(`/dashboard/m/${slug}/${path}`, feature.areas),
            `${slug}:${area.key} does not claim its own path ${path}`,
          ).toBe(`${slug}:${area.key}`);
        }
      }
    }
  });

  it("have unique keys within a tool", () => {
    for (const [slug, feature] of Object.entries(featureRegistry)) {
      const keys = (feature.areas ?? []).map((a) => a.key);
      expect(new Set(keys).size, `${slug} has a duplicate area key`).toBe(keys.length);
    }
  });

  it("are closed by denying the whole tool", () => {
    for (const [slug, feature] of Object.entries(featureRegistry)) {
      for (const key of areaKeys(slug, feature.areas)) {
        expect(reaches([slug], key), `${key} survives denying ${slug}`).toBe(false);
      }
    }
  });
});

describe("the patterns handed to the client", () => {
  const JOB: AreaDefinition[] = [
    { key: "estimates", name: "Estimates", paths: ["*/estimates"] },
    { key: "wip", name: "Work in progress" },
  ];
  const areasFor = (slug: string) => (slug === "jobs" ? JOB : undefined);

  it("turns an area key into a route pattern", () => {
    expect(deniedAreaPaths(["jobs:estimates"], areasFor)).toEqual([
      "/dashboard/m/jobs/*/estimates",
    ]);
    expect(deniedAreaPaths(["jobs:wip"], areasFor)).toEqual(["/dashboard/m/jobs/wip"]);
  });

  /** A whole tool is already gone from the rail; its strip never renders. */
  it("leaves whole-tool denials out", () => {
    expect(deniedAreaPaths(["jobs"], areasFor)).toEqual([]);
  });

  it("ignores a key no area answers to", () => {
    expect(deniedAreaPaths(["jobs:retired-last-year"], areasFor)).toEqual([]);
    expect(deniedAreaPaths(["nosuchtool:x"], areasFor)).toEqual([]);
  });

  /**
   * **THE JOIN, ASSERTED.** The server produces these and the client matches a
   * real URL against them. A pattern that never matched would leave a tab in
   * the strip while its page refused — the failure that makes the whole screen
   * worthless — and nothing else in the suite covers both halves at once.
   */
  it("match the URLs the job tab strip actually links to", () => {
    const [pattern] = deniedAreaPaths(["jobs:estimates"], areasFor);
    const href = "/dashboard/m/jobs/9f1c2b7e-1111-2222-3333-444455556666/estimates";
    const segments = href.split("/");
    const parts = pattern.split("/");
    expect(parts.length).toBeLessThanOrEqual(segments.length);
    expect(parts.every((p, i) => p === "*" || p === segments[i])).toBe(true);
  });
});
