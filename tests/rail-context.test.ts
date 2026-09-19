import { describe, expect, it } from "vitest";
import {
  divisionKey,
  hiddenPacks,
  industryKey,
  railContexts,
  resolveContext,
  type DivisionView,
  type ProfileView,
} from "@/lib/packs/rail-context";

/**
 * WHICH SIDE OF THE BUSINESS THE RAIL IS SHOWING (ADR 0090, 0091).
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

/** The founder's own: three divisions on ONE company's books. */
const SHROCK: DivisionView[] = [
  { id: "d1", name: "Cabinet Shop", packs: ["jobs", "inventory", "production"] },
  { id: "d2", name: "Excavation", packs: ["jobs", "assets", "inventory"] },
  { id: "d3", name: "Construction", packs: ["jobs", "assets", "inventory"] },
];

describe("the sides on offer", () => {
  it("is one per industry the companies name", () => {
    const contexts = railContexts(BOTH, PROFILES);
    expect(contexts.map((c) => c.label)).toEqual(["Construction", "Homestead Farm"]);
    expect(contexts[0].slug).toBe(industryKey("construction"));
  });

  it("gathers every company working in the same industry", () => {
    const three = [...BOTH, { name: "Oak Row LLC", industry: "construction" }];
    expect(railContexts(three, PROFILES)[0].companies).toEqual(["Shrock Premier", "Oak Row LLC"]);
  });

  it("carries the packs the industry lists", () => {
    expect(railContexts(BOTH, PROFILES)[0].packs).toEqual(["assets", "inventory", "jobs"]);
  });

  /** Accounting's own picker: the single-company client never learns it exists. */
  it("offers nothing when there is only one side", () => {
    expect(railContexts([BOTH[0]], PROFILES)).toEqual([]);
    expect(
      railContexts([BOTH[0], { name: "Oak Row LLC", industry: "construction" }], PROFILES),
    ).toEqual([]);
  });

  it("offers nothing when nobody has said anything", () => {
    expect(railContexts([{ name: "A", industry: null }], PROFILES, [])).toEqual([]);
  });

  it("ignores a company whose profile no longer exists", () => {
    const gone = [...BOTH, { name: "Old Co", industry: "taxidermy" }];
    expect(railContexts(gone, PROFILES).map((c) => c.label)).toEqual([
      "Construction",
      "Homestead Farm",
    ]);
  });
});

describe("a division is a side of its own", () => {
  /**
   * The case this slice exists for: ONE company, one set of books, three
   * divisions that need different tools. No industry can express it — there is
   * no cabinet-shop profile and there will never be one.
   */
  it("offers a division even when every company is in the same industry", () => {
    const premier = [{ name: "Shrock Premier", industry: "construction" }];
    const contexts = railContexts(premier, PROFILES, SHROCK);
    expect(contexts.map((c) => c.label)).toEqual([
      "Construction",
      "Cabinet Shop",
      "Excavation",
      "Construction",
    ]);
  });

  it("carries the packs the division picked, not an industry's", () => {
    const contexts = railContexts(BOTH, PROFILES, SHROCK);
    const shop = contexts.find((c) => c.slug === divisionKey("d1"));
    expect(shop?.packs).toEqual(["jobs", "inventory", "production"]);
  });

  it("leaves out a division that has not picked any", () => {
    const quiet = [...SHROCK, { id: "d4", name: "Service", packs: [] }];
    expect(railContexts(BOTH, PROFILES, quiet).map((c) => c.label)).not.toContain("Service");
  });

  it("keys a division by id, so two divisions may share a name", () => {
    const twins: DivisionView[] = [
      { id: "d1", name: "Shop", packs: ["jobs"] },
      { id: "d2", name: "Shop", packs: ["inventory"] },
    ];
    const slugs = railContexts([], PROFILES, twins).map((c) => c.slug);
    expect(new Set(slugs).size).toBe(2);
  });
});

describe("what a side puts away", () => {
  const contexts = railContexts(BOTH, PROFILES, SHROCK);
  const ON = ["land", "assets", "inventory", "livestock", "production", "retail", "jobs"];

  it("hides the packs an industry does not list", () => {
    expect(hiddenPacks(industryKey("construction"), ON, contexts)).toEqual([
      "land",
      "livestock",
      "production",
      "retail",
    ]);
  });

  it("hides the packs a division did not pick", () => {
    expect(hiddenPacks(divisionKey("d1"), ON, contexts)).toEqual([
      "land",
      "assets",
      "livestock",
      "retail",
    ]);
  });

  it("hides nothing with no side chosen", () => {
    expect(hiddenPacks(null, ON, contexts)).toEqual([]);
  });

  it("hides nothing for a side that is not on offer", () => {
    expect(hiddenPacks(industryKey("agency"), ON, contexts)).toEqual([]);
    expect(hiddenPacks(divisionKey("gone"), ON, contexts)).toEqual([]);
    expect(hiddenPacks("construction", ON, contexts)).toEqual([]);
  });

  it("hides nothing when there was no choice in the first place", () => {
    expect(hiddenPacks(industryKey("construction"), ON, [])).toEqual([]);
  });
});

describe("the stored choice", () => {
  const contexts = railContexts(BOTH, PROFILES, SHROCK);

  it("is kept while it is still on offer", () => {
    expect(resolveContext(divisionKey("d1"), contexts)).toBe(divisionKey("d1"));
  });

  it("is dropped once it is not — a deleted division falls back to everything", () => {
    expect(resolveContext(divisionKey("gone"), contexts)).toBeNull();
    expect(resolveContext(industryKey("agency"), contexts)).toBeNull();
    expect(resolveContext(industryKey("construction"), [])).toBeNull();
  });

  /** The unprefixed values ADR 0090 wrote. They read as "everything" now. */
  it("drops a value written before the kinds were prefixed", () => {
    expect(resolveContext("construction", contexts)).toBeNull();
  });

  it("is nothing when there is none", () => {
    expect(resolveContext(undefined, contexts)).toBeNull();
    expect(resolveContext("", contexts)).toBeNull();
  });
});
