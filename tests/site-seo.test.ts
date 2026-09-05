import { describe, expect, it } from "vitest";
import {
  iconSizeFrom,
  jsonLdText,
  localBusinessJsonLd,
  pageUrl,
  robotsText,
  siteBaseUrl,
  sitemapXml,
} from "../src/lib/sites/seo";
import { siteRewrite } from "../src/lib/sites/slug";

describe("what a crawler asks a site for", () => {
  it("is rewritten to the site's own routes on a site host, and left to the platform on its own", () => {
    const site = { kind: "site", slug: "oak-row" } as const;
    expect(siteRewrite(site, "/robots.txt")).toBe("/sites/oak-row/robots.txt");
    expect(siteRewrite(site, "/sitemap.xml")).toBe("/sites/oak-row/sitemap.xml");
    expect(siteRewrite(site, "/favicon.ico")).toBe("/sites/oak-row/icon/32");
    expect(siteRewrite(site, "/apple-touch-icon.png")).toBe("/sites/oak-row/icon/180");
    expect(siteRewrite(site, "/icon/512")).toBe("/sites/oak-row/icon/512");
    expect(siteRewrite({ kind: "custom", host: "www.oakrow.example" }, "/robots.txt")).toBe("/domain/www.oakrow.example/robots.txt");
    expect(siteRewrite({ kind: "platform" }, "/robots.txt")).toBeNull();
  });

  it("places the site at the host's root, or under /sites on the platform", () => {
    expect(siteBaseUrl("https://oak-row.yosher.site/", { kind: "site", slug: "oak-row" }, "oak-row")).toBe("https://oak-row.yosher.site");
    expect(siteBaseUrl("https://www.oakrow.example", { kind: "custom", host: "www.oakrow.example" }, "oak-row")).toBe("https://www.oakrow.example");
    expect(siteBaseUrl("https://yosherapp.com", { kind: "platform" }, "oak-row")).toBe("https://yosherapp.com/sites/oak-row");
    expect(pageUrl("https://oak-row.yosher.site", "/")).toBe("https://oak-row.yosher.site/");
    expect(pageUrl("https://oak-row.yosher.site", "/about")).toBe("https://oak-row.yosher.site/about");
  });

  it("writes robots and a sitemap the way the standards read them", () => {
    expect(robotsText("https://oak-row.yosher.site/sitemap.xml")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://oak-row.yosher.site/sitemap.xml\n",
    );
    const xml = sitemapXml([
      { loc: "https://oak-row.yosher.site/", lastmod: "2026-09-05T12:00:00.000Z" },
      { loc: "https://oak-row.yosher.site/about?a=1&b=<2>" },
    ]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml).toContain("<url><loc>https://oak-row.yosher.site/</loc><lastmod>2026-09-05T12:00:00.000Z</lastmod></url>");
    expect(xml).toContain("<loc>https://oak-row.yosher.site/about?a=1&amp;b=&lt;2&gt;</loc>");
    expect(xml.endsWith("</urlset>\n")).toBe(true);
  });

  it("knows the three icon sizes and nothing else", () => {
    expect(iconSizeFrom("32")).toBe(32);
    expect(iconSizeFrom("180")).toBe(180);
    expect(iconSizeFrom("512")).toBe(512);
    expect(iconSizeFrom("64")).toBeNull();
    expect(iconSizeFrom("32.png")).toBeNull();
  });

  it("says what the settings say about the business, and nothing they do not", () => {
    const full = localBusinessJsonLd({
      name: "Oak Row Farm Co.",
      description: "Pasture-raised, delivered Fridays",
      url: "https://www.oakrow.example/",
      phone: "740 555 0101",
      email: "hello@oakrow.example",
      address: "17 N Main St\nMount Vernon, OH 43050",
      pin: { lat: 40.394, lng: -82.485 },
      logoUrl: "https://www.oakrow.example/logo",
      sameAs: ["https://www.facebook.com/oakrowfarm"],
    });
    expect(full).toEqual({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Oak Row Farm Co.",
      url: "https://www.oakrow.example/",
      description: "Pasture-raised, delivered Fridays",
      telephone: "740 555 0101",
      email: "hello@oakrow.example",
      address: "17 N Main St, Mount Vernon, OH 43050",
      geo: { "@type": "GeoCoordinates", latitude: 40.394, longitude: -82.485 },
      logo: "https://www.oakrow.example/logo",
      image: "https://www.oakrow.example/logo",
      sameAs: ["https://www.facebook.com/oakrowfarm"],
    });
    const bare = localBusinessJsonLd({ name: "T", description: "", url: "https://x.example/", phone: "", email: "", address: "  ", pin: null, logoUrl: null, sameAs: [] });
    expect(Object.keys(bare).sort()).toEqual(["@context", "@type", "name", "url"]);
    expect(jsonLdText({ name: "</script><script>alert(1)" })).toBe('{"name":"\\u003c/script>\\u003cscript>alert(1)"}');
  });
});
