import { describe, expect, it } from "vitest";
import { newSection, sectionSummary, SECTION_TYPES } from "../src/lib/sites/pages";
import { completeQuestions, completeQuotes, faqJsonLd, LOGO_SIZES, logoSizeClass } from "../src/lib/sites/proof";
import { EMPTY_SETTINGS, SectionSchema, SiteSettingsSchema, type Section } from "../src/lib/sites/schema";
import { sectionWords } from "../src/lib/sites/words";

describe("testimonials", () => {
  it("start empty, take up to six, and count only quotes with words and a name", () => {
    const fresh = SectionSchema.parse(newSection("quotes")) as Extract<Section, { type: "quotes" }>;
    expect(fresh).toEqual({ type: "quotes", heading: "What customers say", items: [] });
    expect(sectionSummary(fresh)).toBe("What customers say: none filled in yet");
    const items = [
      { quote: "Best beef we have had.", name: "Pat", detail: "Buys a half every fall" },
      { quote: "", name: "Nobody", detail: "" },
      { quote: "Lovely eggs.", name: "  ", detail: "" },
      { quote: "  Great chicken.  ", name: "Sam", detail: "" },
    ];
    expect(completeQuotes(items).map((q) => q.name)).toEqual(["Pat", "Sam"]);
    expect(sectionSummary({ ...fresh, items })).toBe("What customers say: 2 quotes");
    expect(SectionSchema.safeParse({ type: "quotes", items: Array.from({ length: 7 }, () => ({ quote: "x", name: "y" })) }).success).toBe(false);
    expect((SectionSchema.parse({ type: "quotes", items: [{ quote: "x" }] }) as Extract<Section, { type: "quotes" }>).items).toEqual([{ quote: "x", name: "", detail: "" }]);
    expect(Object.keys(sectionWords({ ...fresh, items: [items[0]] }))).toEqual(["heading", "items[0].quote", "items[0].name", "items[0].detail"]);
    expect(SECTION_TYPES.find((s) => s.type === "quotes")?.label).toBe("Testimonials");
  });
});

describe("questions", () => {
  it("start empty, take up to ten, and show only the answered ones", () => {
    const fresh = SectionSchema.parse(newSection("faq")) as Extract<Section, { type: "faq" }>;
    expect(fresh).toEqual({ type: "faq", heading: "Common questions", note: "", items: [] });
    expect(sectionSummary(fresh)).toBe("Common questions: none answered yet");
    const items = [
      { question: "Do you deliver?", answer: "" },
      { question: "How is it packaged?", answer: "Vacuum sealed and frozen." },
      { question: "", answer: "An answer with no question." },
    ];
    expect(completeQuestions(items).map((q) => q.question)).toEqual(["How is it packaged?"]);
    expect(sectionSummary({ ...fresh, items })).toBe("Common questions: 1 answered");
    expect(SectionSchema.safeParse({ type: "faq", items: Array.from({ length: 11 }, () => ({ question: "q", answer: "a" })) }).success).toBe(false);
    expect(SECTION_TYPES.find((s) => s.type === "faq")?.label).toBe("Questions");
  });

  it("are told to search engines as an FAQPage, answered ones only, or not at all", () => {
    expect(faqJsonLd([{ question: "Do you deliver?", answer: "" }])).toBeNull();
    expect(faqJsonLd([])).toBeNull();
    const ld = faqJsonLd([
      { question: "Do you deliver?", answer: "" },
      { question: " How is it packaged? ", answer: "Vacuum sealed and frozen." },
    ]);
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "How is it packaged?", acceptedAnswer: { "@type": "Answer", text: "Vacuum sealed and frozen." } }],
    });
  });
});

describe("the logo's size", () => {
  it("is one of three, medium when unsaid, and each a height with a ceiling on its width", () => {
    expect(LOGO_SIZES).toEqual(["small", "medium", "large"]);
    expect(EMPTY_SETTINGS.logoSize).toBe("medium");
    expect(SiteSettingsSchema.parse({}).logoSize).toBe("medium");
    expect(SiteSettingsSchema.safeParse({ logoSize: "huge" }).success).toBe(false);
    expect(logoSizeClass("small")).toContain("h-8");
    expect(logoSizeClass("medium")).toBe("h-10 max-w-[200px]");
    expect(logoSizeClass("large")).toContain("sm:h-16");
  });
});
