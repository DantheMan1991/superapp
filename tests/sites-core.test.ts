import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assembleSite,
  standardSiteCopy,
  type SiteBrief,
} from "../src/lib/sites/copy";
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
import { buildSiteCopyUserTurn } from "../src/modules/marketing/ai/site-copy-prompt";
import { mergeSiteCopy } from "../src/modules/marketing/ai/site-copy-validate";
import { writeSiteCopy } from "../src/modules/marketing/site-generate";

const brief: SiteBrief = {
  name: "Oak Row Farm Co.",
  tagline: "Pasture-raised, delivered Fridays",
  industry: "Homestead farm",
  phone: "740 555 0100",
  email: "hello@oakrow.example",
  address: "17 Main St\nMount Vernon, OH 43050",
  hoursLines: ["Saturday 8 to 12, at the market"],
};

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
    expect(readPageContent({ sections: [{ type: "nope" }] })).toEqual({ description: "", sections: [] });
    expect(readPageContent(null)).toEqual({ description: "", sections: [] });
    expect(readSiteSettings({ phone: 5 })).toEqual(EMPTY_SETTINGS);
  });

  it("checks the email but allows it blank", () => {
    expect(SiteSettingsSchema.safeParse({ email: "" }).success).toBe(true);
    expect(SiteSettingsSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(SiteSettingsSchema.parse({ hoursLines: ["a", "b"] }).hoursLines).toEqual(["a", "b"]);
  });
});

describe("standard copy and assembly", () => {
  it("builds three valid pages in a fixed order, with hours only when there are hours", () => {
    const pages = assembleSite(brief, standardSiteCopy(brief));
    expect(pages.map((p) => p.path)).toEqual(["/", "/about", "/contact"]);
    expect(pages[0].content.sections.map((s) => s.type)).toEqual(["hero", "offer", "about", "cta"]);
    expect(pages[2].content.sections.map((s) => s.type)).toEqual(["contact", "hours", "form"]);
    const noHours = assembleSite({ ...brief, hoursLines: [] }, standardSiteCopy(brief));
    expect(noHours[2].content.sections.map((s) => s.type)).toEqual(["contact", "form"]);
    expect(pages[0].content.description).toContain("Oak Row Farm Co.");
  });

  it("uses the business's own words and never invents facts", () => {
    const copy = standardSiteCopy({ ...brief, tagline: "" });
    expect(copy.hero.headline).toBe("Oak Row Farm Co.");
    expect(copy.about.body[0]).toContain("homestead farm");
    expect(JSON.stringify(copy)).not.toMatch(/years|award/i);
  });
});

describe("the prompt and the merge", () => {
  it("briefs with facts and flags what is missing", () => {
    const turn = buildSiteCopyUserTurn({ ...brief, phone: "", hoursLines: [] });
    expect(turn).toContain("Oak Row Farm Co.");
    expect(turn).toContain("No phone number is given.");
    expect(turn).toContain("No hours are given.");
    expect(turn).toContain("Mount Vernon");
  });

  it("takes the slots the model filled and keeps the standard copy for the rest", () => {
    const fallback = standardSiteCopy(brief);
    const { copy, filled } = mergeSiteCopy(
      { hero: { headline: "Beef you can trust", subheadline: "From our pasture.", ctaLabel: "Order" }, about: { heading: "x", body: [] } },
      fallback,
    );
    expect(filled).toBe(1); // `about` had an empty body and was dropped whole
    expect(copy.hero.headline).toBe("Beef you can trust");
    expect(copy.offer).toEqual(fallback.offer);
    expect(mergeSiteCopy("garbage", fallback)).toEqual({ copy: fallback, filled: 0 });
  });
});

describe("writeSiteCopy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says model when the model wrote anything, standard when it failed or there is no key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const call = vi.fn(async () => ({ description: "A farm in Mount Vernon selling beef." }));
    const wrote = await writeSiteCopy(brief, { call });
    expect(wrote.source).toBe("model");
    expect(wrote.copy.description).toBe("A farm in Mount Vernon selling beef.");
    const failed = await writeSiteCopy(brief, { call: async () => { throw new Error("boom"); } });
    expect(failed.source).toBe("standard");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const never = vi.fn(async () => ({}));
    expect((await writeSiteCopy(brief, { call: never })).source).toBe("standard");
    expect(never).not.toHaveBeenCalled();
  });
});
