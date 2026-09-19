import { describe, expect, it } from "vitest";
import {
  companyKey,
  divisionKey,
  hiddenPacks,
  industryKey,
  railContexts,
  resolveContext,
  type CompanyView,
  type DivisionView,
  type ProfileView,
} from "@/lib/packs/rail-context";

/**
 * WHICH SIDE OF THE BUSINESS THE RAIL IS SHOWING (ADR 0090, 0091, 0092).
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

const BOTH: CompanyView[] = [
  { id: "c1", name: "Shrock Premier", industry: "construction" },
  { id: "c2", name: "Hilltop Farm", industry: "homestead-farm" },
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
    const three = [...BOTH, { id: "c3", name: "Oak Row LLC", industry: "construction" }];
    expect(railContexts(three, PROFILES)[0].hint).toBe("Shrock Premier, Oak Row LLC");
  });

  it("carries the packs the industry lists", () => {
    expect(railContexts(BOTH, PROFILES)[0].packs).toEqual(["assets", "inventory", "jobs"]);
  });

  /** Accounting's own picker: the single-company client never learns it exists. */
  it("offers nothing when there is only one side", () => {
    expect(railContexts([BOTH[0]], PROFILES)).toEqual([]);
    expect(
      railContexts(
        [BOTH[0], { id: "c3", name: "Oak Row LLC", industry: "construction" }],
        PROFILES,
      ),
    ).toEqual([]);
  });

  it("offers nothing when nobody has said anything", () => {
    expect(railContexts([{ id: "c1", name: "A", industry: null }], PROFILES, [])).toEqual([]);
  });

  it("ignores a company whose profile no longer exists", () => {
    const gone = [...BOTH, { id: "c3", name: "Old Co", industry: "taxidermy" }];
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
    const premier = [BOTH[0]];
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

describe("a company may say its own tools", () => {
  /**
   * The case ADR 0092 exists for. Shrock Prefab and Shrock Premier are BOTH in
   * construction, and only one of them runs a factory — so the trade cannot be
   * the answer for both, and the one that overrode it cannot share the other's
   * row, because that row is named after the trade.
   */
  const PREFAB: CompanyView = {
    id: "c9",
    name: "Shrock Prefab",
    industry: "construction",
    packs: ["jobs", "production", "inventory"],
  };

  it("splits a company out of its trade once it has overridden it", () => {
    const contexts = railContexts([BOTH[0], PREFAB], PROFILES);
    expect(contexts.map((c) => c.label)).toEqual(["Construction", "Shrock Prefab"]);
    expect(contexts[1].slug).toBe(companyKey("c9"));
  });

  it("carries the packs the company picked, not its trade's", () => {
    const [, prefab] = railContexts([BOTH[0], PREFAB], PROFILES);
    expect(prefab.packs).toEqual(["jobs", "production", "inventory"]);
  });

  /** The label is the company, so the line under it says which trade. */
  it("keeps its line of business as the hint", () => {
    const [, prefab] = railContexts([BOTH[0], PREFAB], PROFILES);
    expect(prefab.hint).toBe("Construction");
  });

  /**
   * THE INFERENCE IS THE DEFAULT AND IT STAYS THAT WAY. Opening the Edit dialog
   * and saving writes `[]`, and `[]` has to mean "ask the profile" — otherwise
   * an unrelated rename would quietly convert every company into an override
   * and freeze its menu against the next pack the profile gains.
   */
  it("leaves a company that has not said where it was", () => {
    const quiet = [{ ...PREFAB, packs: [] }, BOTH[1]];
    const contexts = railContexts(quiet, PROFILES);
    expect(contexts.map((c) => c.label)).toEqual(["Construction", "Homestead Farm"]);
    expect(contexts[0].packs).toEqual(["assets", "inventory", "jobs"]);
  });

  /**
   * A company nobody gave a trade is not a side — until it names its own tools,
   * which is the whole point: Shrock Restoration answers to no profile.
   */
  it("offers a company with tools and no trade, under its own name alone", () => {
    const orphan: CompanyView = {
      id: "c8",
      name: "Shrock Restoration",
      industry: null,
      packs: ["jobs"],
    };
    const [, restoration] = railContexts([BOTH[0], orphan], PROFILES);
    expect(restoration.label).toBe("Shrock Restoration");
    expect(restoration.hint).toBe("");
  });

  it("keys a company by id, so it can never collide with a division", () => {
    const twin: DivisionView = { id: "c9", name: "Cabinet Shop", packs: ["jobs"] };
    const slugs = railContexts([BOTH[0], PREFAB], PROFILES, [twin]).map((c) => c.slug);
    expect(new Set(slugs).size).toBe(3);
  });

  it("hides the packs the company did not pick", () => {
    const contexts = railContexts([BOTH[0], PREFAB], PROFILES);
    const ON = ["land", "assets", "inventory", "production", "jobs"];
    expect(hiddenPacks(companyKey("c9"), ON, contexts)).toEqual(["land", "assets"]);
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
