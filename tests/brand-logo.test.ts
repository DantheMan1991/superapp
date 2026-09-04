import { afterEach, describe, expect, it, vi } from "vitest";
import { isSvg } from "../src/lib/brand/image-sniff";
import { standardLogoSpecs } from "../src/lib/brand/logo-defaults";
import {
  LOGO_LAYOUTS,
  LogoSpecSchema,
  initialsFor,
  normalizeSpec,
  paletteFor,
  type LogoBrief,
  type LogoSpec,
} from "../src/lib/brand/logo-spec";
import { renderLogoSvg } from "../src/lib/brand/logo-svg";
import { rasterizeSvgToPng } from "../src/lib/brand/raster";
import { buildLogoUserTurn, PROPOSE_LOGOS_TOOL } from "../src/modules/marketing/ai/logo-prompt";
import { validateLogoProposal } from "../src/modules/marketing/ai/logo-validate";
import { draftLogoCandidates, industryLabel } from "../src/modules/marketing/logo-generate";

const brief: LogoBrief = {
  name: "Oak Row Farm Co.",
  tagline: "Pasture-raised, delivered Fridays",
  industry: "Homestead farm",
  primaryColor: "#8b1e3f",
  accentColor: null,
  initials: "OR",
};

const base: LogoSpec = {
  layout: "wordmark",
  line1: "Oak Row",
  line2: "",
  initials: "OR",
  weight: "bold",
  textCase: "upper",
  tracking: 0.12,
  mark: "none",
  colors: { text: "#1f2937", mark: "#8b1e3f", markText: "#ffffff" },
  rationale: "",
};

describe("initialsFor", () => {
  it("takes the first letters of the words that carry meaning", () => {
    expect(initialsFor("Oak Row Farm Co.")).toBe("ORF");
    expect(initialsFor("The Corner Bakery")).toBe("CB");
    expect(initialsFor("Hilltop")).toBe("HI");
    expect(initialsFor("A & B Plumbing LLC")).toBe("ABP");
    expect(initialsFor("")).toBe("??");
  });
});

describe("LogoSpecSchema and normalizeSpec", () => {
  it("parses a model-shaped candidate and fills the defaults", () => {
    const parsed = LogoSpecSchema.parse({
      layout: "wordmark",
      line1: " Oak Row ",
      colors: { text: "1F2937", mark: "#8b1e3f", markText: "fff" },
    });
    expect(parsed.line1).toBe("Oak Row");
    expect(parsed.colors).toEqual({ text: "#1f2937", mark: "#8b1e3f", markText: "#ffffff" });
    expect(parsed.initials).toBe("OR");
    expect(parsed.weight).toBe("bold");
  });

  it("refuses what the renderer could not draw", () => {
    expect(LogoSpecSchema.safeParse({ ...base, layout: "poster" }).success).toBe(false);
    expect(LogoSpecSchema.safeParse({ ...base, colors: { ...base.colors, text: "red" } }).success).toBe(false);
    expect(LogoSpecSchema.safeParse({ ...base, tracking: 0.9 }).success).toBe(false);
    expect(LogoSpecSchema.safeParse({ ...base, line1: "" }).success).toBe(false);
  });

  it("makes every spec drawable: a monogram gets a circle, a bare mark layout falls back", () => {
    expect(normalizeSpec({ ...base, layout: "monogram", mark: "none" }).mark).toBe("circle");
    const fell = normalizeSpec({ ...base, layout: "mark-left", mark: "none" });
    expect(fell.layout).toBe("wordmark");
    const stacked = normalizeSpec({ ...base, layout: "mark-above", mark: "bar", line2: "Farm" });
    expect(stacked.layout).toBe("stacked");
    expect(stacked.mark).toBe("bar");
    // A shape beside plain words is a mark-left, whatever it was called.
    expect(normalizeSpec({ ...base, layout: "wordmark", mark: "leaf" }).layout).toBe("mark-left");
    expect(normalizeSpec({ ...base, initials: "abcd" }).initials).toBe("ABC");
  });
});

describe("paletteFor and the standard set", () => {
  it("keeps a readable brand colour for the words and swaps a pale one for the ink", () => {
    expect(paletteFor(brief).text).toBe("#8b1e3f");
    expect(paletteFor({ ...brief, primaryColor: "#ffe066" }).text).toBe("#1f2937");
    expect(paletteFor({ ...brief, primaryColor: null, accentColor: null }).mark).toBe("#1f6f5f");
  });

  it("gives six distinct, valid candidates", () => {
    const set = standardLogoSpecs(brief);
    expect(set).toHaveLength(6);
    const keys = new Set(set.map((s) => `${s.layout}:${s.mark}:${s.textCase}`));
    expect(keys.size).toBe(6);
    for (const spec of set) expect(LogoSpecSchema.safeParse(spec).success).toBe(true);
  });
});

describe("renderLogoSvg", () => {
  it("draws every layout as paths only, with a fitted viewBox", () => {
    for (const layout of LOGO_LAYOUTS) {
      const spec = normalizeSpec({ ...base, layout, line2: "Farm Co.", mark: "rounded" });
      const out = renderLogoSvg(spec);
      expect(out.svg.startsWith("<svg xmlns=")).toBe(true);
      expect(out.svg).toContain(`viewBox="0 0 ${out.width} ${out.height}"`);
      expect(out.svg).toContain("<path");
      expect(out.svg).not.toContain("<text");
      expect(out.width).toBeGreaterThan(30);
      expect(out.height).toBeGreaterThan(30);
    }
  });

  it("puts the colours where the spec says", () => {
    const out = renderLogoSvg(normalizeSpec({ ...base, layout: "mark-left", mark: "circle" }));
    expect(out.svg).toContain('fill="#1f2937"'); // the words
    expect(out.svg).toContain('<circle'); // the mark
    expect(out.svg).toContain('fill="#8b1e3f"'); // its colour
    expect(out.svg).toContain('fill="#ffffff"'); // the initials on it
  });

  it("underlines a wordmark with a bar and hollows a ring", () => {
    expect(renderLogoSvg({ ...base, mark: "bar" }).svg).toContain("<rect");
    const ring = renderLogoSvg(normalizeSpec({ ...base, layout: "monogram", mark: "ring" })).svg;
    expect(ring).toContain('fill="none" stroke="#8b1e3f"');
  });

  it("spaced capitals are wider than the same word set tight", () => {
    const tight = renderLogoSvg({ ...base, tracking: 0 }).width;
    const spaced = renderLogoSvg({ ...base, tracking: 0.2 }).width;
    expect(spaced).toBeGreaterThan(tight);
  });
});

describe("rasterizeSvgToPng", () => {
  it("turns a drawn wordmark into a 1200px-wide PNG", async () => {
    const { svg } = renderLogoSvg(base);
    const out = await rasterizeSvgToPng(svg);
    expect(out.width).toBe(1200);
    expect(out.height).toBeGreaterThan(50);
    expect(Array.from(out.png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe("isSvg", () => {
  it("recognises an SVG document however it is prefixed, and nothing else", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(isSvg(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true);
    expect(isSvg(enc('<?xml version="1.0"?>\n<!-- x -->\n<!DOCTYPE svg>\n<svg>'))).toBe(true);
    expect(isSvg(enc("﻿  <svg>"))).toBe(true);
    expect(isSvg(enc("<html><svg></svg></html>"))).toBe(false);
    expect(isSvg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe("the prompt and the validator", () => {
  it("briefs the model with the facts and the kit, not a picture", () => {
    const turn = buildLogoUserTurn(brief);
    expect(turn).toContain("Oak Row Farm Co.");
    expect(turn).toContain("Homestead farm");
    expect(turn).toContain("#8b1e3f");
    expect(turn).toContain("Accent colour: none chosen");
    expect(PROPOSE_LOGOS_TOOL.input_schema.required).toEqual(["candidates"]);
  });

  it("keeps valid candidates, drops bad ones, and never repeats an idea", () => {
    const specs = validateLogoProposal({
      candidates: [
        base,
        { ...base, layout: "monogram", mark: "circle" },
        { ...base, colors: { text: "nope", mark: "#000000", markText: "#ffffff" } },
        base, // the same idea twice
        "garbage",
      ],
    });
    expect(specs).toHaveLength(2);
    expect(validateLogoProposal({ nonsense: true })).toEqual([]);
  });
});

describe("draftLogoCandidates", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("pads what the model returned from the standard set and says the model was used", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const call = vi.fn(async () => ({
      candidates: [{ ...base, layout: "monogram", mark: "hexagon", rationale: "From the model." }],
    }));
    const { candidates, source } = await draftLogoCandidates(brief, { call });
    expect(call).toHaveBeenCalledOnce();
    expect(source).toBe("model");
    expect(candidates).toHaveLength(6);
    expect(candidates[0].spec.rationale).toBe("From the model.");
    expect(candidates.every((c) => c.svg.startsWith("<svg"))).toBe(true);
    expect(new Set(candidates.map((c) => c.key)).size).toBe(6);
  });

  it("falls back to the standard set when the call fails, and when there is no key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    const failed = await draftLogoCandidates(brief, { call: failing });
    expect(failed.source).toBe("standard");
    expect(failed.candidates).toHaveLength(6);

    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const never = vi.fn(async () => ({ candidates: [base] }));
    const keyless = await draftLogoCandidates(brief, { call: never });
    expect(never).not.toHaveBeenCalled();
    expect(keyless.source).toBe("standard");
  });
});

describe("industryLabel", () => {
  it("reads a slug as words and treats general as none", () => {
    expect(industryLabel("homestead-farm")).toBe("Homestead farm");
    expect(industryLabel("general")).toBeNull();
    expect(industryLabel(null)).toBeNull();
  });
});
