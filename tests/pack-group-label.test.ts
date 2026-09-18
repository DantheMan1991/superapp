import { describe, expect, it } from "vitest";
import { NEUTRAL_PACK_GROUP, packGroupLabel } from "@/lib/packs/group-label";
import { getIndustryProfile } from "@/industries";

/**
 * THE RAIL'S PACK HEADING (ADR 0009's additive install, made visible).
 *
 * The bug this fixes was reported as "the homestead modules show up under the
 * construction menu", and it was one `??` in a server component: the group was
 * captioned with `tenants.industry`, which holds the LAST profile installed, on
 * a client running two. Nothing failed — the rail just lied about which
 * industry a pack belonged to.
 */

const FARM = { name: "Homestead Farm", packs: ["land", "assets", "inventory", "livestock"] };

describe("naming the pack group", () => {
  it("uses the profile's name while it accounts for every pack that is on", () => {
    expect(packGroupLabel(FARM, ["land", "livestock"])).toBe("Homestead Farm");
  });

  it("uses it when the client has all of them", () => {
    expect(packGroupLabel(FARM, FARM.packs)).toBe("Homestead Farm");
  });

  it("goes neutral the moment a pack is from somewhere else", () => {
    expect(packGroupLabel(FARM, ["land", "livestock", "jobs"])).toBe(NEUTRAL_PACK_GROUP);
  });

  it("is neutral for a tenant with no profile", () => {
    expect(packGroupLabel(null, ["jobs"])).toBe(NEUTRAL_PACK_GROUP);
  });

  it("uses the profile's name when nothing is on at all", () => {
    // The group is not rendered in this case; the label must still be sane.
    expect(packGroupLabel(FARM, [])).toBe("Homestead Farm");
  });
});

describe("against the real profiles", () => {
  /**
   * The case the founder was looking at: a farm that also builds. `jobs` is the
   * construction profile's and is not on the homestead list, so neither profile
   * can name the group.
   */
  it("refuses to call a farm-plus-jobs client a Homestead Farm", () => {
    const farm = getIndustryProfile("homestead-farm");
    expect(farm, "the homestead profile should exist").not.toBeNull();
    const on = [...(farm?.packs ?? []), "jobs"];
    expect(packGroupLabel(farm, on)).toBe(NEUTRAL_PACK_GROUP);
  });

  it("still names a client that only has its own profile's packs", () => {
    const construction = getIndustryProfile("construction");
    expect(construction).not.toBeNull();
    expect(packGroupLabel(construction, construction?.packs ?? [])).toBe(
      construction?.name,
    );
  });
});
