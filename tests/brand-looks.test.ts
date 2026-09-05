import { describe, expect, it } from "vitest";
import { resolveBrand, type BrandKitFields } from "../src/lib/brand/core";
import {
  BRAND_LOOKS,
  BUTTON_SHAPE_SPECS,
  BUTTON_SHAPES,
  FONT_PAIRING_SPECS,
  FONT_PAIRINGS,
  isBrandLook,
  isButtonShape,
  isFontPairing,
  LOOK_SPECS,
  lookRadiusVars,
  resolveLook,
} from "../src/lib/brand/looks";

const base: BrandKitFields = {
  displayName: "",
  tagline: "",
  primaryColor: "",
  accentColor: "",
  logoPathname: null,
  logoMimeType: "",
  logoWidth: 0,
  logoHeight: 0,
  look: "",
  fontPairing: "",
  buttonShape: "",
};

describe("a look", () => {
  it("is a preset from three short lists, and every look's defaults are on them", () => {
    expect(Object.keys(LOOK_SPECS).sort()).toEqual([...BRAND_LOOKS].sort());
    expect(Object.keys(FONT_PAIRING_SPECS).sort()).toEqual([...FONT_PAIRINGS].sort());
    expect(Object.keys(BUTTON_SHAPE_SPECS).sort()).toEqual([...BUTTON_SHAPES].sort());
    for (const look of BRAND_LOOKS) {
      expect(FONT_PAIRINGS).toContain(LOOK_SPECS[look].fontPairing);
      expect(BUTTON_SHAPES).toContain(LOOK_SPECS[look].buttonShape);
    }
    expect(isBrandLook("modern")).toBe(true);
    expect(isBrandLook("neon")).toBe(false);
    expect(isFontPairing("elegant")).toBe(true);
    expect(isFontPairing("comic")).toBe(false);
    expect(isButtonShape("square")).toBe(true);
    expect(isButtonShape("")).toBe(false);
  });

  it("is modern, as every site started, when nobody has chosen", () => {
    expect(resolveLook({ look: null, fontPairing: null, buttonShape: null })).toEqual({
      look: "modern",
      fontPairing: "clean",
      buttonShape: "pill",
      radius: "1rem",
      fieldRadius: "0.5rem",
      buttonRadius: "9999px",
    });
  });

  it("lets the owner's own fonts and buttons win over the look's", () => {
    const resolved = resolveLook({ look: "classic", fontPairing: "bold", buttonShape: null });
    expect(resolved).toMatchObject({ look: "classic", fontPairing: "bold", buttonShape: "square", buttonRadius: "0.125rem" });
    expect(resolveLook({ look: "warm", fontPairing: null, buttonShape: "pill" })).toMatchObject({
      fontPairing: "warm",
      buttonShape: "pill",
      buttonRadius: "9999px",
      radius: "1.5rem",
    });
    expect(lookRadiusVars(resolved)).toEqual({
      "--site-radius": "0.375rem",
      "--site-radius-field": "0.25rem",
      "--site-radius-button": "0.125rem",
    });
  });

  it("resolves through the kits like a colour: the company's word, else the business's, else nobody's", () => {
    expect(resolveBrand({ tenantName: "T", business: null, company: null })).toMatchObject({
      look: null,
      fontPairing: null,
      buttonShape: null,
    });
    const business: BrandKitFields = { ...base, look: "warm", buttonShape: "square" };
    const company: BrandKitFields = { ...base, fontPairing: "bold" };
    expect(resolveBrand({ tenantName: "T", business, company })).toMatchObject({
      look: "warm",
      fontPairing: "bold",
      buttonShape: "square",
    });
    // A value outside the lists (the CHECK refuses it; a guard keeps the type honest) reads as nobody's.
    expect(resolveBrand({ tenantName: "T", business: { ...base, look: "neon" }, company: null }).look).toBeNull();
  });
});
