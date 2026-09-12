import { describe, expect, it } from "vitest";
import {
  canEverConnect,
  channelDisplay,
  channelTitle,
  footerHasLink,
  footerLinkFor,
  normalizeHandle,
  profileUrlFor,
} from "../src/lib/social/channels";
import { BUSINESS_BRAND_KEY, chooseBrand, listBrands } from "../src/lib/social/brands";

/**
 * The pure half of a social channel (slice S0, ADR 0047) — the rules the
 * screen, the action and the unique index all have to agree on.
 */

describe("normalizeHandle", () => {
  it("strips the @, the spaces and the case, because the index is a plain one", () => {
    expect(normalizeHandle("@OakRowFarm")).toBe("oakrowfarm");
    expect(normalizeHandle("  oak row farm ")).toBe("oakrowfarm");
    expect(normalizeHandle("@@doubled")).toBe("doubled");
  });

  it("is idempotent, so an edit that changes nothing else changes nothing", () => {
    const once = normalizeHandle("@Oak_Row.Farm");
    expect(normalizeHandle(once)).toBe(once);
  });

  it("gives back an empty string for a handle that was only decoration", () => {
    expect(normalizeHandle("@")).toBe("");
    expect(normalizeHandle("   ")).toBe("");
  });
});

describe("profileUrlFor", () => {
  it("guesses the address from the handle for every network that has a shape", () => {
    expect(profileUrlFor("facebook", "@OakRowFarm")).toBe("https://www.facebook.com/oakrowfarm");
    expect(profileUrlFor("instagram", "oakrowfarm")).toBe("https://www.instagram.com/oakrowfarm");
    expect(profileUrlFor("x", "oakrow")).toBe("https://x.com/oakrow");
    expect(profileUrlFor("youtube", "oakrow")).toBe("https://www.youtube.com/@oakrow");
    expect(profileUrlFor("tiktok", "oakrow")).toBe("https://www.tiktok.com/@oakrow");
    expect(profileUrlFor("linkedin", "oak-row")).toBe("https://www.linkedin.com/company/oak-row");
  });

  it("guesses nothing for `other`, which is why that form asks for the link", () => {
    expect(profileUrlFor("other", "oakrow")).toBe("");
  });

  it("guesses nothing from an empty handle", () => {
    expect(profileUrlFor("facebook", "  @ ")).toBe("");
  });
});

describe("channelDisplay and channelTitle", () => {
  it("shows the handle for a known network and the owner's own words for `other`", () => {
    expect(channelDisplay({ network: "facebook", handle: "oakrowfarm", label: "" })).toBe(
      "@oakrowfarm",
    );
    expect(channelDisplay({ network: "other", handle: "oakrow", label: "Our Substack" })).toBe(
      "Our Substack",
    );
  });

  it("names the network first, which is how a list row is scanned", () => {
    expect(channelTitle({ network: "instagram", handle: "oakrowfarm", label: "" })).toBe(
      "Instagram · @oakrowfarm",
    );
  });
});

describe("canEverConnect", () => {
  it("says `other` never can, so the form can say so before somebody relies on it", () => {
    expect(canEverConnect("other")).toBe(false);
    expect(canEverConnect("facebook")).toBe(true);
    expect(canEverConnect("pinterest")).toBe(true);
  });
});

describe("footerLinkFor", () => {
  it("makes a mark from the stored address", () => {
    expect(
      footerLinkFor({
        network: "facebook",
        handle: "oakrowfarm",
        label: "",
        profileUrl: "https://www.facebook.com/oakrowfarm",
      }),
    ).toEqual({ network: "facebook", url: "https://www.facebook.com/oakrowfarm", label: "" });
  });

  it("falls back to the guess when no address was stored", () => {
    expect(
      footerLinkFor({ network: "instagram", handle: "oakrowfarm", label: "", profileUrl: "" })?.url,
    ).toBe("https://www.instagram.com/oakrowfarm");
  });

  it("carries the label only for `other`, and cuts it to the footer's own shorter cap", () => {
    const mark = footerLinkFor({
      network: "other",
      handle: "oakrow",
      label: "A name that is a great deal longer than thirty characters",
      profileUrl: "https://oakrow.substack.com",
    });
    expect(mark?.label).toHaveLength(30);
    expect(
      footerLinkFor({
        network: "facebook",
        handle: "oakrowfarm",
        label: "ignored",
        profileUrl: "https://www.facebook.com/oakrowfarm",
      })?.label,
    ).toBe("");
  });

  it("makes nothing when there is no address to link to", () => {
    expect(footerLinkFor({ network: "other", handle: "oakrow", label: "X", profileUrl: "" })).toBeNull();
  });
});

describe("footerHasLink", () => {
  const links = [
    { network: "facebook" as const, url: "https://www.facebook.com/oakrowfarm/" },
    { network: "instagram" as const, url: "https://www.instagram.com/oakrowfarm" },
  ];

  it("ignores a trailing slash and the case, so one account is one mark", () => {
    expect(
      footerHasLink(links, { network: "facebook", url: "https://WWW.Facebook.com/OakRowFarm" }),
    ).toBe(true);
  });

  it("holds the network as well as the address", () => {
    expect(
      footerHasLink(links, { network: "pinterest", url: "https://www.facebook.com/oakrowfarm" }),
    ).toBe(false);
  });

  it("says no when the mark is not there", () => {
    expect(footerHasLink(links, { network: "x", url: "https://x.com/oakrow" })).toBe(false);
  });
});

describe("listBrands", () => {
  const one = [{ id: "s1", title: "Hilltop Farm", slug: "hilltop" }];
  const two = [...one, { id: "s2", title: "", slug: "hilltop-store" }];

  it("offers the business alone when there is no website", () => {
    expect(listBrands([], "Hilltop", false)).toEqual([
      { key: BUSINESS_BRAND_KEY, name: "Hilltop", siteId: null },
    ]);
  });

  it("offers only the site when there is exactly one and nothing is shared", () => {
    expect(listBrands(one, "Hilltop", false)).toEqual([
      { key: "s1", name: "Hilltop Farm", siteId: "s1" },
    ]);
  });

  it("offers the business beside several sites, so a shared account has a home", () => {
    const brands = listBrands(two, "Hilltop", false);
    expect(brands.map((b) => b.key)).toEqual(["s1", "s2", BUSINESS_BRAND_KEY]);
    // A site with no title of its own is known by its address.
    expect(brands[1].name).toBe("hilltop-store");
  });

  it("KEEPS the business reachable when one site exists but business accounts already do", () => {
    // The trap this rule exists for: accounts added before there was a
    // website would otherwise vanish from the screen the day one is built.
    const brands = listBrands(one, "Hilltop", true);
    expect(brands.map((b) => b.key)).toEqual(["s1", BUSINESS_BRAND_KEY]);
  });
});

describe("chooseBrand", () => {
  const brands = [
    { key: "s1", name: "Farm", siteId: "s1" },
    { key: "s2", name: "Store", siteId: "s2" },
    { key: BUSINESS_BRAND_KEY, name: "Hilltop", siteId: null },
  ];

  it("opens the only brand without asking, whatever a stale bookmark says", () => {
    const only = [brands[0]];
    expect(chooseBrand(only, "s2").brand?.key).toBe("s1");
    expect(chooseBrand(only, undefined).showList).toBe(false);
  });

  it("opens the brand that was asked for", () => {
    expect(chooseBrand(brands, "s2").brand?.key).toBe("s2");
    expect(chooseBrand(brands, BUSINESS_BRAND_KEY).brand?.siteId).toBeNull();
  });

  it("draws the list when several exist and none was named, or the name is nobody's", () => {
    expect(chooseBrand(brands, undefined)).toEqual({ brand: null, showList: true });
    expect(chooseBrand(brands, "not-a-brand")).toEqual({ brand: null, showList: true });
  });

  it("has nothing to show and nothing to list when there are no brands at all", () => {
    expect(chooseBrand([], undefined)).toEqual({ brand: null, showList: false });
  });
});
