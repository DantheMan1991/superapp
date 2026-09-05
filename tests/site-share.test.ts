import { describe, expect, it } from "vitest";
import { shareFacts, shareKey, siteBaseUrlFor } from "../src/lib/sites/seo";
import { PREVIOUS_SLUGS_MAX, siteRewrite, withPreviousSlug } from "../src/lib/sites/slug";

const site = {
  slug: "oak-row",
  customHost: null,
  title: "Oak Row Farm Co.",
  brand: { tagline: "Pasture-raised, delivered Fridays", primaryColor: "#8b1e3f", logo: { pathname: "brand/t/logos/a.png" } },
};

describe("where a site lives, absolutely", () => {
  it("is the connected domain first, the free address on a host, the platform path otherwise", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://yosherapp.com", SITE_DOMAIN: "yosher.site" };
    expect(siteBaseUrlFor(site, "host", env)).toBe("https://oak-row.yosher.site");
    expect(siteBaseUrlFor(site, "path", env)).toBe("https://yosherapp.com/sites/oak-row");
    expect(siteBaseUrlFor({ ...site, customHost: "www.oakrow.example" }, "path", env)).toBe("https://www.oakrow.example");
    expect(siteBaseUrlFor(site, "host", { NEXT_PUBLIC_APP_URL: "http://localhost:3000", NODE_ENV: "development" })).toBe(
      "http://oak-row.localhost:3000",
    );
    expect(siteBaseUrlFor(site, "host", { NEXT_PUBLIC_APP_URL: "https://yosherapp.com" })).toBe("https://yosherapp.com/sites/oak-row");
  });
});

describe("a page's share image", () => {
  it("says the site over its tagline on the home page, and the page over the site elsewhere", () => {
    const home = shareFacts(site, { path: "/", title: "Home" }, "https://oak-row.yosher.site");
    expect(home).toEqual({
      title: "Oak Row Farm Co.",
      subtitle: "Pasture-raised, delivered Fridays",
      host: "oak-row.yosher.site",
      colour: "#8b1e3f",
      logoPathname: "brand/t/logos/a.png",
    });
    const about = shareFacts(site, { path: "/about", title: "About" }, "https://oak-row.yosher.site/");
    expect(about.title).toBe("About");
    expect(about.subtitle).toBe("Oak Row Farm Co.");
    expect(about.host).toBe("oak-row.yosher.site");
    expect(shareFacts({ ...site, brand: { ...site.brand, primaryColor: null, logo: null } }, { path: "/", title: "Home" }, "x")).toMatchObject({
      colour: "#1f2937",
      logoPathname: null,
    });
  });

  it("is named by its ingredients, so a retitled page or a new colour is a new picture", () => {
    const home = shareFacts(site, { path: "/", title: "Home" }, "https://oak-row.yosher.site");
    const key = shareKey(home);
    expect(key).toMatch(/^[0-9a-f]{8}$/);
    expect(shareKey({ ...home })).toBe(key);
    expect(shareKey({ ...home, title: "Oak Row Farm" })).not.toBe(key);
    expect(shareKey({ ...home, colour: "#000000" })).not.toBe(key);
    expect(shareKey({ ...home, logoPathname: null })).not.toBe(key);
    expect(siteRewrite({ kind: "site", slug: "oak-row" }, `/share/${key}`)).toBe(`/sites/oak-row/share/${key}`);
    expect(siteRewrite({ kind: "site", slug: "oak-row" }, "/share")).toBe("/hosted/oak-row/share");
  });
});

describe("an address a site used to have", () => {
  it("is kept newest first, never the current one, never twice, and not past the cap", () => {
    expect(withPreviousSlug([], "old-farm", "new-farm")).toEqual(["old-farm"]);
    expect(withPreviousSlug(["older-farm"], "old-farm", "new-farm")).toEqual(["old-farm", "older-farm"]);
    // Going back to an address you had: it is simply yours again, not a previous one.
    expect(withPreviousSlug(["new-farm", "older-farm"], "old-farm", "new-farm")).toEqual(["old-farm", "older-farm"]);
    expect(withPreviousSlug(["old-farm"], "old-farm", "new-farm")).toEqual(["old-farm"]);
    const many = Array.from({ length: PREVIOUS_SLUGS_MAX }, (_, i) => `s${i}`);
    const kept = withPreviousSlug(many, "latest", "next");
    expect(kept).toHaveLength(PREVIOUS_SLUGS_MAX);
    expect(kept[0]).toBe("latest");
    expect(kept).not.toContain(`s${PREVIOUS_SLUGS_MAX - 1}`);
  });
});
