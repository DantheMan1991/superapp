import { describe, expect, it } from "vitest";
import {
  hiddenPacks,
  railContexts,
  resolveContext,
  type ProfileView,
} from "@/lib/packs/rail-context";

/**
 * WHICH SIDE OF THE BUSINESS THE RAIL IS SHOWING (ADR 0090).
 *
 * Every assertion here is about being wrong in the SAFE direction. This is a
 * view preference with nothing behind it — no query, no policy — so its only
 * way of doing harm is hiding a row somebody needed, and each of these pins one
 * of the paths that could.
 */

const PROFILES: ProfileView[] = [
  { slug: "construction", name: "Construction", packs: ["assets", "inventory", "jobs"] },
  {
    slug: "homestead-farm",
    name: "Homestead Farm",
    packs: ["land", "assets", "inventory", "livestock", "crops", "production", "retail"],
  },
  { slug: "agency", name: "Agency", packs: ["professional-services"] },
];

const BOTH = [
  { name: "Shrock Premier", industry: "construction" },
  { name: "Hilltop Farm", industry: "homestead-farm" },
];

describe("the sides on offer", () => {
  it("is one per industry the companies name", () => {
    expect(railContexts(BOTH, PROFILES)).toEqual([
      { slug: "construction", label: "Construction", companies: ["Shrock Premier"] },
      { slug: "homestead-farm", label: "Homestead Farm", companies: ["Hilltop Farm"] },
    ]);
  });

  it("gathers every company working in the same industry", () => {
    const three = [...BOTH, { name: "Oak Row LLC", industry: "construction" }];
    expect(railContexts(three, PROFILES)[0].companies).toEqual(["Shrock Premier", "Oak Row LLC"]);
  });

  /** Accounting's own picker: the single-company client never learns it exists. */
  it("offers nothing when there is only one industry", () => {
    expect(railContexts([BOTH[0]], PROFILES)).toEqual([]);
    expect(
      railContexts([BOTH[0], { name: "Oak Row LLC", industry: "construction" }], PROFILES),
    ).toEqual([]);
  });

  it("offers nothing when no company has said what it does", () => {
    expect(railContexts([{ name: "A", industry: null }, { name: "B", industry: null }], PROFILES)).toEqual([]);
  });

  it("ignores a company whose profile no longer exists", () => {
    const gone = [...BOTH, { name: "Old Co", industry: "taxidermy" }];
    expect(railContexts(gone, PROFILES).map((c) => c.slug)).toEqual([
      "construction",
      "homestead-farm",
    ]);
  });

  /** One industry plus an unassigned company is still not a choice. */
  it("does not count an unassigned company as a side", () => {
    expect(
      railContexts([BOTH[0], { name: "Holding Co", industry: null }], PROFILES),
    ).toEqual([]);
  });
});

describe("what a side puts away", () => {
  const contexts = railContexts(BOTH, PROFILES);
  const ON = ["land", "assets", "inventory", "livestock", "production", "retail", "jobs"];

  it("hides the packs the industry does not list", () => {
    expect(hiddenPacks("construction", ON, contexts, PROFILES)).toEqual([
      "land",
      "livestock",
      "production",
      "retail",
    ]);
  });

  it("keeps the ones it shares", () => {
    const hidden = hiddenPacks("homestead-farm", ON, contexts, PROFILES);
    expect(hidden).toEqual(["jobs"]);
    expect(hidden).not.toContain("assets");
    expect(hidden).not.toContain("inventory");
  });

  it("hides nothing with no side chosen", () => {
    expect(hiddenPacks(null, ON, contexts, PROFILES)).toEqual([]);
  });

  it("hides nothing for a side that is not on offer", () => {
    expect(hiddenPacks("agency", ON, contexts, PROFILES)).toEqual([]);
    expect(hiddenPacks("taxidermy", ON, contexts, PROFILES)).toEqual([]);
  });

  it("hides nothing when there was no choice in the first place", () => {
    expect(hiddenPacks("construction", ON, [], PROFILES)).toEqual([]);
  });
});

describe("the stored choice", () => {
  const contexts = railContexts(BOTH, PROFILES);

  it("is kept while it is still on offer", () => {
    expect(resolveContext("construction", contexts)).toBe("construction");
  });

  it("is dropped once it is not", () => {
    expect(resolveContext("agency", contexts)).toBeNull();
    expect(resolveContext("construction", [])).toBeNull();
  });

  it("is nothing when there is none", () => {
    expect(resolveContext(undefined, contexts)).toBeNull();
    expect(resolveContext("", contexts)).toBeNull();
  });
});
