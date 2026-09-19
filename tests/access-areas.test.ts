import { describe, expect, it } from "vitest";
import { areaForPath, areaKeys, moduleSlugFromPath } from "@/lib/access/areas";
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
