import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  fitLogo,
  foregroundOn,
  normalizeHexColor,
  readableOnWhite,
  resolveBrand,
  type BrandKitFields,
} from "../src/lib/brand/core";
import { sniffImage } from "../src/lib/brand/image-sniff";

const empty: BrandKitFields = {
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

describe("normalizeHexColor", () => {
  it("accepts the shapes people type and stores one of them", () => {
    expect(normalizeHexColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHexColor("aabbcc")).toBe("#aabbcc");
    expect(normalizeHexColor("  #abc ")).toBe("#aabbcc");
    expect(normalizeHexColor("fff")).toBe("#ffffff");
  });

  it("refuses everything else", () => {
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("#abcd")).toBeNull();
    expect(normalizeHexColor("#gggggg")).toBeNull();
    expect(normalizeHexColor("rgb(1,2,3)")).toBeNull();
    expect(normalizeHexColor("#aabbccdd")).toBeNull();
  });
});

describe("contrast", () => {
  it("matches the WCAG reference points", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #777777 on white is the textbook 4.48:1.
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("keeps a readable brand colour for text and swaps a pale one", () => {
    expect(readableOnWhite("#1f6f5f", "#111827")).toBe("#1f6f5f");
    expect(readableOnWhite("#ffe066", "#111827")).toBe("#111827");
  });

  it("picks the foreground that reads on the colour", () => {
    expect(foregroundOn("#1f6f5f")).toBe("#ffffff");
    expect(foregroundOn("#ffe066")).toBe("#111827");
  });
});

describe("resolveBrand", () => {
  it("falls back to the tenant name and platform defaults when nothing is set", () => {
    const brand = resolveBrand({ tenantName: "Hilltop", business: null, company: null });
    expect(brand.displayName).toBe("Hilltop");
    expect(brand.tagline).toBe("");
    expect(brand.primaryColor).toBeNull();
    expect(brand.logo).toBeNull();
    expect(brand.sources).toEqual({ displayName: "tenant", logo: "none" });
  });

  it("resolves field by field: a company that only renames itself keeps the shared logo", () => {
    const business: BrandKitFields = {
      ...empty,
      displayName: "Hilltop Farm",
      tagline: "Grass-fed since 1998",
      primaryColor: "#1f6f5f",
      logoPathname: "brand/t/logos/hilltop.png",
      logoMimeType: "image/png",
      logoWidth: 400,
      logoHeight: 120,
    };
    const company: BrandKitFields = { ...empty, displayName: "Oak Row Meats" };
    const brand = resolveBrand({ tenantName: "Hilltop", business, company });
    expect(brand.displayName).toBe("Oak Row Meats");
    expect(brand.tagline).toBe("Grass-fed since 1998");
    expect(brand.primaryColor).toBe("#1f6f5f");
    expect(brand.logo?.pathname).toBe("brand/t/logos/hilltop.png");
    expect(brand.sources).toEqual({ displayName: "company", logo: "business" });
  });

  it("a company's own logo wins over the shared one", () => {
    const business: BrandKitFields = {
      ...empty,
      logoPathname: "brand/t/logos/shared.png",
      logoMimeType: "image/png",
      logoWidth: 10,
      logoHeight: 10,
    };
    const company: BrandKitFields = {
      ...empty,
      logoPathname: "brand/t/logos/own.jpg",
      logoMimeType: "image/jpeg",
      logoWidth: 20,
      logoHeight: 5,
    };
    const brand = resolveBrand({ tenantName: "T", business, company });
    expect(brand.logo).toEqual({
      pathname: "brand/t/logos/own.jpg",
      mimeType: "image/jpeg",
      width: 20,
      height: 5,
    });
    expect(brand.sources.logo).toBe("company");
  });
});

describe("fitLogo", () => {
  it("scales a wide logo to the box width and keeps its aspect", () => {
    expect(fitLogo({ width: 400, height: 100 }, { width: 160, height: 56 })).toEqual({
      width: 160,
      height: 40,
    });
  });

  it("scales a tall logo to the box height", () => {
    expect(fitLogo({ width: 100, height: 200 }, { width: 160, height: 56 })).toEqual({
      width: 28,
      height: 56,
    });
  });

  it("never scales up and survives a zero-sized input", () => {
    expect(fitLogo({ width: 40, height: 20 }, { width: 160, height: 56 })).toEqual({
      width: 40,
      height: 20,
    });
    expect(fitLogo({ width: 0, height: 0 }, { width: 160, height: 56 })).toEqual({
      width: 0,
      height: 0,
    });
  });
});

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  b.set([width >>> 24, (width >> 16) & 255, (width >> 8) & 255, width & 255], 16);
  b.set([height >>> 24, (height >> 16) & 255, (height >> 8) & 255, height & 255], 20);
  return b;
}

function jpeg(width: number, height: number, opts: { progressive?: boolean; padding?: boolean } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  // APP0 segment with a 16-byte body, the way every camera JPEG starts.
  parts.push(0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0));
  if (opts.padding) parts.push(0xff, 0xff);
  // DHT — in the C0–CF range and NOT a frame header; must be skipped.
  parts.push(0xff, 0xc4, 0x00, 0x03, 0x00);
  parts.push(0xff, opts.progressive ? 0xc2 : 0xc0, 0x00, 0x0b, 0x08);
  parts.push((height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255);
  parts.push(0x01, 0x01, 0x11, 0x00);
  return new Uint8Array(parts);
}

describe("sniffImage", () => {
  it("reads a PNG's IHDR", () => {
    expect(sniffImage(png(640, 200))).toEqual({ mimeType: "image/png", width: 640, height: 200 });
  });

  it("reads a baseline and a progressive JPEG, skipping DHT and padding", () => {
    expect(sniffImage(jpeg(1200, 300))).toEqual({ mimeType: "image/jpeg", width: 1200, height: 300 });
    expect(sniffImage(jpeg(800, 800, { progressive: true, padding: true }))).toEqual({
      mimeType: "image/jpeg",
      width: 800,
      height: 800,
    });
  });

  it("refuses anything that is not one of the two, however it is labelled", () => {
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]))).toBeNull(); // GIF
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull(); // truncated JPEG
    expect(sniffImage(png(0, 10))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
});
