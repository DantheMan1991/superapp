import { describe, expect, it } from "vitest";
import {
  SECTION_TYPES,
  moveItem,
  newSection,
  normalizePagePath,
  paragraphsToText,
  sectionSummary,
  textToParagraphs,
  versionIdsToPrune,
} from "../src/lib/sites/pages";
import { PageContentSchema, SectionSchema } from "../src/lib/sites/schema";

describe("the section catalogue", () => {
  it("offers every kind the model knows, and a fresh one of each is valid", () => {
    const kinds = SECTION_TYPES.map((s) => s.type).sort();
    expect(kinds).toEqual(["about", "contact", "cta", "form", "hero", "hours", "offer", "text"]);
    for (const { type } of SECTION_TYPES) {
      expect(SectionSchema.safeParse(newSection(type)).success).toBe(true);
    }
  });

  it("summarises a section in one short line", () => {
    expect(sectionSummary(newSection("hero"))).toBe("A headline for this page");
    expect(sectionSummary({ type: "offer", heading: "What we raise", items: [{ name: "Beef", blurb: "" }, { name: "Pork", blurb: "" }] })).toBe("What we raise: Beef, Pork");
    expect(sectionSummary({ type: "text", heading: "", body: ["Second line first."] })).toBe("Second line first.");
    const long = sectionSummary({ type: "cta", headline: "x".repeat(80), cta: { label: "a", href: "/" } });
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("normalizePagePath", () => {
  it("turns a title into an address and keeps a good one", () => {
    expect(normalizePagePath("About Us")).toEqual({ ok: true, path: "/about-us" });
    expect(normalizePagePath("/Our Team/")).toEqual({ ok: true, path: "/our-team" });
    expect(normalizePagePath("services/hay")).toEqual({ ok: true, path: "/services/hay" });
    expect(normalizePagePath("/services")).toEqual({ ok: true, path: "/services" });
  });

  it("refuses the home address, the platform's paths and nothing", () => {
    expect(normalizePagePath("/")).toEqual({ ok: false, reason: "home" });
    expect(normalizePagePath("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizePagePath("/draft")).toEqual({ ok: false, reason: "reserved" });
    expect(normalizePagePath("logo")).toEqual({ ok: false, reason: "reserved" });
  });
});

describe("paragraphs and moves", () => {
  it("splits on blank lines and keeps single breaks inside a paragraph", () => {
    expect(textToParagraphs("One\nstill one\n\nTwo\n\n\n  Three  ")).toEqual(["One\nstill one", "Two", "Three"]);
    expect(paragraphsToText(["A", "B"])).toBe("A\n\nB");
    expect(textToParagraphs("a\n\nb\n\nc", 2)).toEqual(["a", "b"]);
  });

  it("moves an item and ignores an impossible move", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("keeps the newest versions and names the rest for pruning", () => {
    const at = (n: number) => new Date(2026, 8, 4, 12, n);
    const versions = [
      { id: "old", createdAt: at(1) },
      { id: "mid", createdAt: at(2) },
      { id: "new", createdAt: at(3) },
    ];
    expect(versionIdsToPrune(versions, 2)).toEqual(["old"]);
    expect(versionIdsToPrune(versions, 5)).toEqual([]);
  });
});

describe("what the editor may save", () => {
  it("is exactly what the renderer draws", () => {
    const content = {
      description: "",
      sections: [newSection("hero"), newSection("offer"), newSection("contact")],
    };
    expect(PageContentSchema.safeParse(content).success).toBe(true);
    expect(PageContentSchema.safeParse({ ...content, sections: [{ type: "offer", heading: "x", items: [] }] }).success).toBe(false);
  });
});
