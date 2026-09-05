import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { imageSrc } from "../src/components/site/site-page";
import { sitePhotoPathPrefix, isTenantBlobPath } from "../src/lib/blob";
import { newSection, sectionSummary } from "../src/lib/sites/pages";
import { PHOTO_MAX_EDGE, PhotoError, preparePhoto } from "../src/lib/sites/photo";
import { ImageRefSchema, SectionSchema } from "../src/lib/sites/schema";
import { classifyHost, RESERVED_PAGE_PATHS, siteRewrite } from "../src/lib/sites/slug";

const opts = { siteDomain: "yosher.site", platformHosts: ["localhost", "127.0.0.1", "yosherapp.com"] };
const ID = "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f";

describe("a photo in a section", () => {
  it("is a library id and words for people who cannot see it", () => {
    expect(ImageRefSchema.parse({ id: ID })).toEqual({ id: ID, alt: "" });
    expect(ImageRefSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    const hero = SectionSchema.parse({ type: "hero", headline: "Hello" });
    expect(hero.type === "hero" && hero.image).toBeNull();
    const about = SectionSchema.parse({ type: "about", heading: "Us", image: { id: ID, alt: "The barn" } });
    expect(about.type === "about" && about.image?.alt).toBe("The barn");
    const photo = SectionSchema.parse({ type: "image", image: { id: ID } });
    expect(photo).toEqual({ type: "image", image: { id: ID, alt: "" }, caption: "", layout: "inset" });
    expect(SectionSchema.safeParse({ type: "image", layout: "huge" }).success).toBe(false);
  });

  it("is in the catalogue, fresh and empty, and summarised by its caption", () => {
    const fresh = newSection("image");
    expect(SectionSchema.safeParse(fresh).success).toBe(true);
    expect(sectionSummary(fresh)).toBe("No photo chosen yet");
    expect(sectionSummary({ type: "image", image: { id: ID, alt: "" }, caption: "", layout: "wide" })).toBe("A photo");
    expect(sectionSummary({ type: "image", image: { id: ID, alt: "" }, caption: "The herd in May", layout: "wide" })).toBe("The herd in May");
  });
});

describe("where a photo is addressed", () => {
  it("depends on how the page was reached", () => {
    expect(imageSrc("host", "oak-row", ID)).toBe(`/images/${ID}`);
    expect(imageSrc("path", "oak-row", ID)).toBe(`/sites/oak-row/images/${ID}`);
    expect(imageSrc("draft", "oak-row", ID)).toBe(`/api/marketing/sites/images/${ID}`);
  });

  it("is a reserved page path, so a page can never shadow it", () => {
    expect(RESERVED_PAGE_PATHS.has("/images")).toBe(true);
  });

  it("lives under the tenant's own blob prefix", () => {
    const tenant = "11111111-2222-3333-4444-555555555555";
    expect(sitePhotoPathPrefix(tenant)).toBe(`sites/${tenant}/photos/`);
    expect(isTenantBlobPath(tenant, `${sitePhotoPathPrefix(tenant)}barn.jpg`)).toBe(true);
    expect(isTenantBlobPath(tenant, `sites/other/photos/barn.jpg`)).toBe(false);
  });
});

describe("the proxy's rewrite", () => {
  const site = classifyHost("oak-row.yosher.site", opts);
  const custom = classifyHost("www.oakrowfarm.com", opts);

  it("leaves the platform's own hosts and paths alone", () => {
    expect(siteRewrite(classifyHost("yosherapp.com", opts), "/dashboard")).toBeNull();
    expect(siteRewrite(site, "/_next/static/x.js")).toBeNull();
    expect(siteRewrite(site, "/api/sites/view")).toBeNull();
  });

  it("sends pages to the hosted route and assets to the site's own routes", () => {
    expect(siteRewrite(site, "/")).toBe("/hosted/oak-row");
    expect(siteRewrite(site, "/about")).toBe("/hosted/oak-row/about");
    expect(siteRewrite(site, "/logo")).toBe("/sites/oak-row/logo");
    expect(siteRewrite(site, `/images/${ID}`)).toBe(`/sites/oak-row/images/${ID}`);
    expect(siteRewrite(custom, "/")).toBe("/domain/www.oakrowfarm.com");
    expect(siteRewrite(custom, "/contact")).toBe("/domain/www.oakrowfarm.com/contact");
    expect(siteRewrite(custom, "/logo")).toBe("/domain/www.oakrowfarm.com/logo");
    expect(siteRewrite(custom, `/images/${ID}`)).toBe(`/domain/www.oakrowfarm.com/images/${ID}`);
  });
});

describe("preparing a photo", () => {
  it("shrinks a big JPEG to the long edge and keeps its shape", async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#336699" } })
      .jpeg()
      .toBuffer();
    const out = await preparePhoto(new Uint8Array(big));
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.width).toBe(PHOTO_MAX_EDGE);
    expect(out.height).toBe(1067);
    expect(out.bytes.byteLength).toBeGreaterThan(0);
  });

  it("keeps a transparent PNG as a PNG and never enlarges", async () => {
    const small = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const out = await preparePhoto(new Uint8Array(small));
    expect(out.mimeType).toBe("image/png");
    expect([out.width, out.height]).toEqual([400, 300]);
  });

  it("bakes the orientation in and strips every tag", async () => {
    const sideways = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#123456" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);
    const out = await preparePhoto(new Uint8Array(sideways));
    expect([out.width, out.height]).toEqual([600, 800]);
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it("refuses what is not a photo", async () => {
    await expect(preparePhoto(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).rejects.toBeInstanceOf(PhotoError);
    await expect(preparePhoto(new TextEncoder().encode("hello"))).rejects.toBeInstanceOf(PhotoError);
  });
});
