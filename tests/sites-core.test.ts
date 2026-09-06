import { describe, expect, it } from "vitest";
import {
  EMPTY_SETTINGS,
  PageContentSchema,
  SectionSchema,
  SiteSettingsSchema,
  readPageContent,
  readSiteSettings,
} from "../src/lib/sites/schema";
import {
  hostToSiteSlug,
  normalizeSiteSlug,
  pagePathFromSegments,
  siteBasePath,
  siteDomainFromEnv,
  siteHref,
} from "../src/lib/sites/slug";

describe("normalizeSiteSlug", () => {
  it("makes an address out of a name and refuses what cannot be one", () => {
    expect(normalizeSiteSlug("Oak Row Farm Co.")).toEqual({ ok: true, slug: "oak-row-farm-co" });
    expect(normalizeSiteSlug("  Hilltop_Farm ")).toEqual({ ok: true, slug: "hilltop-farm" });
    expect(normalizeSiteSlug("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeSiteSlug("ab")).toEqual({ ok: false, reason: "short" });
    expect(normalizeSiteSlug("a".repeat(41))).toEqual({ ok: false, reason: "long" });
    expect(normalizeSiteSlug("www")).toEqual({ ok: false, reason: "reserved" });
    expect(normalizeSiteSlug("mail")).toEqual({ ok: false, reason: "reserved" });
  });
});

describe("hostToSiteSlug", () => {
  it("reads one label under the site domain, ignoring the port", () => {
    expect(hostToSiteSlug("oak-row.yosher.site", "yosher.site")).toBe("oak-row");
    expect(hostToSiteSlug("oak-row.localhost:3000", "localhost")).toBe("oak-row");
    expect(hostToSiteSlug("OAK-ROW.Yosher.Site", "yosher.site")).toBe("oak-row");
  });

  it("is null for the platform, the apex, www, two labels, reserved labels and no domain", () => {
    expect(hostToSiteSlug("yosherapp.com", "yosher.site")).toBeNull();
    expect(hostToSiteSlug("yosher.site", "yosher.site")).toBeNull();
    expect(hostToSiteSlug("www.yosher.site", "yosher.site")).toBeNull();
    expect(hostToSiteSlug("a.b.yosher.site", "yosher.site")).toBeNull();
    expect(hostToSiteSlug("mail.yosher.site", "yosher.site")).toBeNull();
    expect(hostToSiteSlug("oak-row.yosher.site", null)).toBeNull();
    expect(hostToSiteSlug("evilyosher.site", "yosher.site")).toBeNull();
  });
});

describe("site domain and links", () => {
  it("defaults to localhost only in development", () => {
    expect(siteDomainFromEnv({ SITE_DOMAIN: "yosher.site" })).toBe("yosher.site");
    expect(siteDomainFromEnv({ NODE_ENV: "development" })).toBe("localhost");
    expect(siteDomainFromEnv({ NODE_ENV: "production" })).toBeNull();
    expect(siteDomainFromEnv({ SITE_DOMAIN: "  " , NODE_ENV: "production" })).toBeNull();
  });

  it("builds links for each way a site is reached", () => {
    expect(siteBasePath("host", "oak")).toBe("");
    expect(siteHref("host", "oak", "/")).toBe("/");
    expect(siteHref("host", "oak", "/about")).toBe("/about");
    expect(siteHref("path", "oak", "/")).toBe("/sites/oak");
    expect(siteHref("path", "oak", "/about")).toBe("/sites/oak/about");
    expect(siteHref("draft", "oak", "/contact")).toBe("/sites/oak/draft/contact");
    expect(pagePathFromSegments(undefined)).toBe("/");
    expect(pagePathFromSegments(["about", "team"])).toBe("/about/team");
  });
});

describe("the content model", () => {
  it("accepts every section type and fills the defaults", () => {
    const hero = SectionSchema.parse({ type: "hero", headline: "Hay for sale" });
    expect(hero).toEqual({ type: "hero", headline: "Hay for sale", subheadline: "", cta: null, image: null });
    expect(SectionSchema.safeParse({ type: "offer", heading: "x", items: [] }).success).toBe(false);
    expect(SectionSchema.safeParse({ type: "banner", headline: "x" }).success).toBe(false);
    expect(PageContentSchema.safeParse({ sections: new Array(13).fill(hero) }).success).toBe(false);
  });

  it("degrades a malformed row to empty rather than throwing at render", () => {
    expect(readPageContent({ sections: [{ type: "nope" }] })).toEqual({ description: "", seoTitle: "", sections: [] });
    expect(readPageContent(null)).toEqual({ description: "", seoTitle: "", sections: [] });
    expect(readSiteSettings({ phone: 5 })).toEqual(EMPTY_SETTINGS);
  });

  it("checks the email but allows it blank", () => {
    expect(SiteSettingsSchema.safeParse({ email: "" }).success).toBe(true);
    expect(SiteSettingsSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(SiteSettingsSchema.parse({ hoursLines: ["a", "b"] }).hoursLines).toEqual(["a", "b"]);
  });
});

