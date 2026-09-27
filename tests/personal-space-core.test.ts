import { describe, expect, it } from "vitest";
import {
  PERSONAL_CATEGORY,
  PERSONAL_REFUSALS,
  kindFromOrgMetadata,
  moduleFitsTenant,
  moduleRefusal,
  personalOrgMetadata,
  personalRefusal,
  personalSlug,
  personalSpacesOpen,
} from "../src/lib/personal-space-core";

/**
 * The rules of a personal space (ADR 0111), pure. The database half — the
 * constraints, the trigger, the race with the webhook, the gate — is
 * tests/isolation/personal-space.test.ts and tests/personal-space-db.test.ts.
 */

describe("which tools belong in which kind of workspace", () => {
  it("a personal space runs personal tools and nothing else", () => {
    expect(moduleFitsTenant(PERSONAL_CATEGORY, "personal")).toBe(true);
    for (const category of ["core", "pack", "system"]) {
      expect(moduleFitsTenant(category, "personal")).toBe(false);
    }
  });

  it("a business runs everything except a personal tool", () => {
    expect(moduleFitsTenant(PERSONAL_CATEGORY, "business")).toBe(false);
    for (const category of ["core", "pack", "system"]) {
      expect(moduleFitsTenant(category, "business")).toBe(true);
    }
  });

  it("the console's sentence names the kind of workspace it refused for", () => {
    expect(moduleRefusal("core", "business")).toBeNull();
    expect(moduleRefusal(PERSONAL_CATEGORY, "personal")).toBeNull();
    expect(moduleRefusal("pack", "personal")).toMatch(/personal space/);
    expect(moduleRefusal(PERSONAL_CATEGORY, "business")).toMatch(/business workspace/);
  });
});

describe("what a personal space refuses", () => {
  it("refuses every act on a personal space and none on a business", () => {
    for (const act of Object.keys(PERSONAL_REFUSALS) as (keyof typeof PERSONAL_REFUSALS)[]) {
      expect(personalRefusal({ kind: "personal" }, act)).toBe(PERSONAL_REFUSALS[act]);
      expect(personalRefusal({ kind: "business" }, act)).toBeNull();
    }
  });

  it("support view is refused in so many words", () => {
    expect(personalRefusal({ kind: "personal" }, "support")).toMatch(/never opens/);
  });
});

describe("the mark a personal organization carries in Clerk", () => {
  it("reads back exactly what it writes", () => {
    expect(kindFromOrgMetadata(personalOrgMetadata("user_2abcXYZ"))).toEqual({
      kind: "personal",
      owner: "user_2abcXYZ",
    });
  });

  it("anything that is not exactly the mark is a business", () => {
    const business = { kind: "business", owner: null };
    expect(kindFromOrgMetadata(undefined)).toEqual(business);
    expect(kindFromOrgMetadata(null)).toEqual(business);
    expect(kindFromOrgMetadata({})).toEqual(business);
    expect(kindFromOrgMetadata("personal")).toEqual(business);
    // The kind without an owner, and an owner without the kind.
    expect(kindFromOrgMetadata({ yosherKind: "personal" })).toEqual(business);
    expect(kindFromOrgMetadata({ personalOwner: "user_2abc" })).toEqual(business);
    // An owner that is not a Clerk user id at all.
    expect(kindFromOrgMetadata({ yosherKind: "personal", personalOwner: "" })).toEqual(business);
    expect(
      kindFromOrgMetadata({ yosherKind: "personal", personalOwner: "org_2abc" }),
    ).toEqual(business);
    expect(
      kindFromOrgMetadata({ yosherKind: "personal", personalOwner: "user_2abc; drop" }),
    ).toEqual(business);
    expect(kindFromOrgMetadata({ yosherKind: "Personal", personalOwner: "user_2abc" })).toEqual(
      business,
    );
  });
});

describe("a personal space's slug", () => {
  it("is random, lower-case and carries no name", () => {
    expect(personalSlug("A1B2C3D4")).toBe("personal-a1b2c3d4");
    expect(personalSlug("0f0f0f0f")).toMatch(/^personal-[0-9a-f]{8}$/);
  });
});

describe("who may open one, for now", () => {
  it("superadmins always, everybody else once a personal tool is available", () => {
    expect(personalSpacesOpen({ isSuperAdmin: true, personalToolsAvailable: false })).toBe(true);
    expect(personalSpacesOpen({ isSuperAdmin: false, personalToolsAvailable: false })).toBe(false);
    expect(personalSpacesOpen({ isSuperAdmin: false, personalToolsAvailable: true })).toBe(true);
  });
});
