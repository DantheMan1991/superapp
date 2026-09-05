import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { imageSrc } from "../src/components/site/site-page";
import { sitePhotoPathPrefix, isTenantBlobPath } from "../src/lib/blob";
import { altNudge, newSection, sectionSummary, undescribedPhotos, undescribedPhotosOnPage } from "../src/lib/sites/pages";
import { PHOTO_MAX_EDGE, PhotoError, preparePhoto } from "../src/lib/sites/photo";
import { ImageRefSchema, SectionSchema } from "../src/lib/sites/schema";
import { classifyHost, RESERVED_PAGE_PATHS, siteRewrite } from "../src/lib/sites/slug";
import { secondsLabel, slideLabel, SLIDESHOW_SECONDS, SWIPE_THRESHOLD, swipeDirection, wrapIndex } from "../src/lib/sites/slides";

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

describe("a gallery", () => {
  it("holds up to twelve photos with captions, three to a row unless told otherwise", () => {
    const fresh = newSection("gallery");
    expect(SectionSchema.safeParse(fresh).success).toBe(true);
    expect(fresh).toEqual({ type: "gallery", heading: "Photos", items: [], columns: 3 });
    const parsed = SectionSchema.parse({ type: "gallery", items: [{ image: { id: ID } }], columns: 4 });
    expect(parsed).toEqual({ type: "gallery", heading: "", items: [{ image: { id: ID, alt: "" }, caption: "" }], columns: 4 });
    expect(SectionSchema.safeParse({ type: "gallery", columns: 5 }).success).toBe(false);
    const item = { image: { id: ID, alt: "" }, caption: "" };
    expect(SectionSchema.safeParse({ type: "gallery", items: Array.from({ length: 13 }, () => item) }).success).toBe(false);
  });

  it("is summarised by its heading and how many photos it holds", () => {
    const item = { image: { id: ID, alt: "" }, caption: "" };
    expect(sectionSummary(newSection("gallery"))).toBe("Photos: no photos yet");
    expect(sectionSummary({ type: "gallery", heading: "", items: [item], columns: 3 })).toBe("1 photo");
    expect(sectionSummary({ type: "gallery", heading: "The farm", items: [item, item, item], columns: 2 })).toBe("The farm: 3 photos");
  });
});

describe("a slideshow", () => {
  const item = { image: { id: ID, alt: "" }, caption: "" };

  it("is photos shown one at a time, full width, moving on every six seconds unless told otherwise", () => {
    const fresh = newSection("slideshow");
    expect(SectionSchema.safeParse(fresh).success).toBe(true);
    expect(fresh).toEqual({ type: "slideshow", heading: "", items: [], seconds: 6, layout: "wide" });
    expect(SectionSchema.parse({ type: "slideshow", seconds: 0, items: [{ image: { id: ID } }] })).toEqual({
      type: "slideshow",
      heading: "",
      items: [item],
      seconds: 0,
      layout: "wide",
    });
    expect(SectionSchema.safeParse({ type: "slideshow", seconds: 31 }).success).toBe(false);
    expect(SectionSchema.safeParse({ type: "slideshow", seconds: 2.5 }).success).toBe(false);
    expect(SectionSchema.safeParse({ type: "slideshow", items: Array.from({ length: 13 }, () => item) }).success).toBe(false);
    expect(sectionSummary({ type: "slideshow", heading: "On the farm", items: [item, item], seconds: 6, layout: "wide" })).toBe("On the farm: 2 photos");
    expect(sectionSummary(newSection("slideshow"))).toBe("no photos yet");
  });

  it("wraps around at either end and names each photo and each pace", () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(4, 3)).toBe(1);
    expect(wrapIndex(0, 0)).toBe(0);
    expect(slideLabel(1, 5)).toBe("Photo 2 of 5");
    expect([...SLIDESHOW_SECONDS]).toEqual([0, 4, 6, 10]);
    expect(secondsLabel(0)).toBe("Only when pressed");
    expect(secondsLabel(6)).toBe("Every 6 seconds");
  });
});

describe("a swipe", () => {
  it("reads a sideways drag as next or previous and leaves a scroll alone", () => {
    expect(swipeDirection(-80, 5)).toBe(1);
    expect(swipeDirection(80, -5)).toBe(-1);
    expect(swipeDirection(-SWIPE_THRESHOLD, 0)).toBe(1);
    expect(swipeDirection(-20, 0)).toBe(0);
    expect(swipeDirection(-80, 90)).toBe(0);
    expect(swipeDirection(0, 0)).toBe(0);
    expect(swipeDirection(-80, 0, 100)).toBe(0);
  });
});

describe("photos without a description", () => {
  const described = { id: ID, alt: "The barn" };
  const blank = { id: ID, alt: "   " };

  it("counts every placed photo, in every kind of section that places one", () => {
    expect(undescribedPhotos({ type: "hero", headline: "x", subheadline: "", cta: null, image: null })).toEqual({ total: 0, missing: 0 });
    expect(undescribedPhotos({ type: "hero", headline: "x", subheadline: "", cta: null, image: blank })).toEqual({ total: 1, missing: 1 });
    expect(undescribedPhotos({ type: "about", heading: "x", body: [], image: described })).toEqual({ total: 1, missing: 0 });
    expect(undescribedPhotos({ type: "image", image: blank, caption: "", layout: "inset" })).toEqual({ total: 1, missing: 1 });
    expect(undescribedPhotos({ type: "gallery", heading: "", columns: 3, items: [{ image: blank, caption: "" }, { image: described, caption: "" }, { image: blank, caption: "" }] })).toEqual({ total: 3, missing: 2 });
    expect(undescribedPhotos({ type: "slideshow", heading: "", seconds: 6, layout: "wide", items: [{ image: described, caption: "" }] })).toEqual({ total: 1, missing: 0 });
    expect(undescribedPhotos({ type: "text", heading: "", body: ["x"] })).toEqual({ total: 0, missing: 0 });
  });

  it("adds a page up and says it in one line, or nothing when every photo has its words", () => {
    const page = {
      sections: [
        { type: "hero" as const, headline: "x", subheadline: "", cta: null, image: blank },
        { type: "gallery" as const, heading: "", columns: 3 as const, items: [{ image: described, caption: "" }, { image: blank, caption: "" }] },
      ],
    };
    expect(undescribedPhotosOnPage(page)).toEqual({ total: 3, missing: 2 });
    expect(altNudge({ total: 3, missing: 2 })).toBe("2 of 3 photos have no description.");
    expect(altNudge({ total: 2, missing: 2 })).toBe("2 photos have no description.");
    expect(altNudge({ total: 1, missing: 1 })).toBe("The photo has no description.");
    expect(altNudge({ total: 4, missing: 0 })).toBeNull();
    expect(altNudge({ total: 0, missing: 0 })).toBeNull();
  });
});
