import { describe, expect, it } from "vitest";
import { newSection, undescribedPhotos } from "../src/lib/sites/pages";
import { DEFAULT_SECTION_STYLE, SectionSchema, SectionStyleSchema } from "../src/lib/sites/schema";
import {
  backgroundClass,
  heroHeightClass,
  LIGHT_TONE,
  resolveStyle,
  SECTION_DEFAULTS,
  spacingClass,
  toneFor,
  widthClass,
} from "../src/lib/sites/style";

const ID = "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f";

describe("a section's style", () => {
  it("is every choice at its default until the owner says otherwise, on any kind", () => {
    expect(SectionStyleSchema.parse({})).toEqual(DEFAULT_SECTION_STYLE);
    expect(SectionStyleSchema.safeParse({ background: "stripes" }).success).toBe(false);
    const hero = SectionSchema.parse({ type: "hero", headline: "Hi", style: { background: "photo", photo: { id: ID } } });
    expect(hero.type === "hero" && hero.style?.background).toBe("photo");
    expect(hero.type === "hero" && hero.style?.photo).toEqual({ id: ID, alt: "" });
    // A page saved before the presets existed still parses, and reads as designed.
    const old = SectionSchema.parse({ type: "cta", headline: "Go", cta: { label: "Now", href: "/contact" } });
    expect(old.style).toBeUndefined();
    expect(resolveStyle("cta", old.style)).toEqual({ background: "brand", width: "page", spacing: "tight", align: "left", onDark: false });
    for (const { type } of [{ type: "hero" as const }, { type: "columns" as const }, { type: "form" as const }]) {
      expect(SectionSchema.safeParse({ ...newSection(type), style: { width: "full", spacing: "airy", align: "center", background: "dark" } }).success).toBe(true);
    }
  });

  it("resolves the owner's choices over the kind's defaults, and the renderer's adjustment over both", () => {
    expect(resolveStyle("offer", undefined).background).toBe("tint");
    expect(resolveStyle("offer", { ...DEFAULT_SECTION_STYLE, background: "none" }).background).toBe("none");
    expect(resolveStyle("about", undefined, { width: "page" }).width).toBe("page");
    expect(resolveStyle("about", { ...DEFAULT_SECTION_STYLE, width: "text" }, { width: "page" }).width).toBe("text");
    expect(resolveStyle("text", { ...DEFAULT_SECTION_STYLE, background: "dark" }).onDark).toBe(true);
    expect(resolveStyle("text", { ...DEFAULT_SECTION_STYLE, background: "brand" }).onDark).toBe(false);
    expect(resolveStyle("text", { ...DEFAULT_SECTION_STYLE, align: "center" }).align).toBe("center");
    expect(Object.keys(SECTION_DEFAULTS).sort()).toEqual(["about", "columns", "contact", "cta", "form", "gallery", "hero", "hours", "image", "offer", "slideshow", "text"]);
  });

  it("turns presets into columns, room and bands, never a pixel", () => {
    expect(widthClass("text")).toContain("max-w-3xl");
    expect(widthClass("page")).toContain("max-w-5xl");
    expect(widthClass("full")).toContain("max-w-7xl");
    expect(spacingClass("tight")).toBe("py-8");
    expect(spacingClass("airy")).toBe("py-24");
    expect(heroHeightClass(undefined)).toBe("py-16 sm:py-24");
    expect(heroHeightClass("tall")).toContain("sm:py-40");
    expect(backgroundClass("tint").className).toContain("bg-neutral-50");
    expect(backgroundClass("brand").style).toEqual({ backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" });
    expect(backgroundClass("photo").className).toContain("relative");
  });

  it("keeps the words readable on every background", () => {
    expect(toneFor("none")).toBe(LIGHT_TONE);
    expect(toneFor("tint")).toBe(LIGHT_TONE);
    expect(toneFor("dark").heading).toBe("#ffffff");
    expect(toneFor("photo").button.backgroundColor).toBe("#ffffff");
    expect(toneFor("brand").heading).toBe("var(--site-primary-fg)");
    expect(toneFor("brand").button.backgroundColor).toBe("#ffffff");
  });

  it("does not count a background photo as one that needs a description", () => {
    const hero = SectionSchema.parse({ type: "hero", headline: "Hi", style: { background: "photo", photo: { id: ID } } });
    expect(undescribedPhotos(hero)).toEqual({ total: 0, missing: 0 });
  });
});
