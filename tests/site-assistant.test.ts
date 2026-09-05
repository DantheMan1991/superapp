import { describe, expect, it } from "vitest";
import {
  AltTextSchema,
  applyWords,
  assemblePageBlocks,
  buildDraftUserTurn,
  buildRewriteUserTurn,
  limitFor,
  PAGE_BLOCK_KINDS,
  sectionWords,
} from "../src/modules/marketing/ai/assistant-prompt";
import type { SiteBrief } from "../src/lib/sites/copy";
import { SectionSchema } from "../src/lib/sites/schema";

const brief: SiteBrief = {
  name: "Oak Row Farm",
  tagline: "Pasture-raised, delivered Fridays",
  industry: "a farm",
  phone: "740 555 0101",
  email: "hello@oakrow.example",
  address: "17 N Main St\nMount Vernon, OH 43050",
  hoursLines: ["Saturday 8 to 12"],
};

describe("rewriting one section", () => {
  it("sends the words and only the words, by slot, with a length for each", () => {
    const hero = SectionSchema.parse({ type: "hero", headline: "Hay for sale", subheadline: "By the bale", cta: { label: "Call us", href: "/contact" } });
    expect(sectionWords(hero)).toEqual({ headline: "Hay for sale", subheadline: "By the bale", "cta.label": "Call us" });
    // No button, no label to rewrite; the photo and the look are never words.
    const plain = SectionSchema.parse({ type: "hero", headline: "Hi", cta: null, image: { id: "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f", alt: "A barn" }, style: { width: "full", spacing: "airy", align: "center", background: "dark", photo: null } });
    expect(sectionWords(plain)).toEqual({ headline: "Hi", subheadline: "" });
    const columns = SectionSchema.parse({
      type: "columns",
      heading: "Why us",
      intro: "Three reasons",
      cards: [
        { id: "card01", heading: "Fresh", body: ["Cut this week.", "Never frozen."], cta: { label: "See", href: "/about" }, icon: "leaf" },
        { id: "card02", heading: "Local", body: [] },
      ],
    });
    expect(Object.keys(sectionWords(columns))).toEqual([
      "heading",
      "intro",
      "cards[0].heading",
      "cards[1].heading",
      "cards[0].body[0]",
      "cards[0].body[1]",
      "cards[0].cta.label",
    ]);
    expect(limitFor("hours", "note")).toBe(200);
    expect(limitFor("columns", "cards[0].body[1]")).toBe(400);
    expect(limitFor("gallery", "items[2].caption")).toBe(120);
    expect(limitFor("hero", "headline")).toBe(120);
    const turn = buildRewriteUserTurn({ brief, pageTitle: "Home", kind: "hero", words: sectionWords(hero), instruction: " shorter " });
    expect(turn).toContain("Business: Oak Row Farm (Pasture-raised, delivered Fridays)");
    expect(turn).toContain('- headline (at most 120 characters): "Hay for sale"');
    expect(turn).toContain("What the owner asked for: shorter");
    expect(buildRewriteUserTurn({ brief, pageTitle: "Home", kind: "hero", words: {}, instruction: "" })).toContain("clearer and warmer");
  });

  it("puts new words back into their slots and nothing else, cutting what is too long", () => {
    const hero = SectionSchema.parse({
      type: "hero",
      headline: "Hay for sale",
      cta: { label: "Call us", href: "/contact" },
      image: { id: "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f", alt: "A barn" },
    });
    const next = applyWords(hero, { headline: "Hay, cut this week", "cta.label": "Get in touch", "cta.href": "javascript:alert(1)", image: "gone", nothing: "x" });
    expect(next).toMatchObject({ headline: "Hay, cut this week", cta: { label: "Get in touch", href: "/contact" }, image: { id: "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f", alt: "A barn" } });
    const long = applyWords(hero, { headline: "x".repeat(500) });
    expect(long?.type === "hero" && long.headline.length).toBe(120);
    // A slot emptied where the model must say something is refused by the content model.
    expect(applyWords(hero, { headline: "" })).toBeNull();
    expect(applyWords(hero, { headline: 42 })).toMatchObject({ headline: "Hay for sale" });
  });
});

describe("writing a page from a sentence", () => {
  it("offers the block kinds, minus the calendar ones when Scheduling is off", () => {
    const on = buildDraftUserTurn({ brief, pageTitle: "Tours", otherPages: ["Home", "Contact"], sentence: "Our farm tours", schedulingOn: true });
    expect(on).toContain('The page to write: "Tours".');
    expect(on).toContain("The site's other pages: Home, Contact.");
    expect(on).toContain("- booking:");
    const off = buildDraftUserTurn({ brief, pageTitle: "Tours", otherPages: [], sentence: "Our farm tours", schedulingOn: false });
    expect(off).not.toContain("- booking:");
    expect(off).not.toContain("- events:");
    expect(off).toContain("This is the site's only page.");
    expect(PAGE_BLOCK_KINDS).toContain("map");
  });

  it("turns blocks into real sections with the code's defaults, and drops what cannot stand", () => {
    const content = assemblePageBlocks(
      {
        description: "Farm tours at Oak Row.",
        blocks: [
          { kind: "hero", heading: "Come and see the farm", lines: ["Free tours on Saturdays."], button: "Book a visit" },
          { kind: "text", heading: "What a visit is like", lines: ["We walk the pastures.", "Then the barn."] },
          { kind: "offer", heading: "On the tour", items: [{ name: "The pastures", blurb: "Where the cattle graze." }, { name: "The barn", blurb: "" }] },
          { kind: "columns", heading: "Three things", items: [{ name: "Bring boots", blurb: "It is a farm." }, { name: "Kids welcome", blurb: "" }] },
          { kind: "offer", heading: "Empty", items: [] },
          { kind: "booking", heading: "Book a tour" },
          { kind: "map", heading: "Where we are", lines: ["Off the county road."] },
          { kind: "map", heading: "Again" },
          { kind: "cta", heading: "Ready?", button: "" },
        ],
      },
      { schedulingOn: false },
    );
    expect(content).not.toBeNull();
    expect(content?.description).toBe("Farm tours at Oak Row.");
    expect(content?.sections.map((s) => s.type)).toEqual(["hero", "text", "offer", "columns", "map", "cta"]);
    const hero = content?.sections[0];
    expect(hero?.type === "hero" && hero).toMatchObject({ headline: "Come and see the farm", subheadline: "Free tours on Saturdays.", cta: { label: "Book a visit", href: "/contact" }, image: null });
    const columns = content?.sections[3];
    expect(columns?.type === "columns" && columns.columns).toBe(2);
    expect(columns?.type === "columns" && columns.cards.map((c) => c.id)).toEqual(["card00", "card01"]);
    const cta = content?.sections[5];
    expect(cta?.type === "cta" && cta.cta).toEqual({ label: "Get in touch", href: "/contact" });
    expect(assemblePageBlocks({ description: "x", blocks: [{ kind: "offer", items: [] }] }, { schedulingOn: true })).toBeNull();
    expect(assemblePageBlocks({ blocks: "no" }, { schedulingOn: true })).toBeNull();
    expect(assemblePageBlocks(null, { schedulingOn: true })).toBeNull();
    const withBooking = assemblePageBlocks({ description: "", blocks: [{ kind: "booking", heading: "Book" }] }, { schedulingOn: true });
    expect(withBooking?.sections[0]?.type).toBe("booking");
  });
});

describe("describing a photo", () => {
  it("takes one sentence, trims the 'image of', and refuses nothing at all", () => {
    expect(AltTextSchema.parse({ description: "Photo of  a red barn beside a gravel road " }).description).toBe("a red barn beside a gravel road");
    expect(AltTextSchema.parse({ description: "x".repeat(300) }).description).toHaveLength(160);
    expect(AltTextSchema.safeParse({ description: "  " }).success).toBe(false);
    expect(AltTextSchema.safeParse({}).success).toBe(false);
  });
});
