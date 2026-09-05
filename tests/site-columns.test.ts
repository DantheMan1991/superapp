import { describe, expect, it } from "vitest";
import { CARD_ICONS } from "../src/components/site/card-icons";
import { iconLabel, newSection, sectionSummary, undescribedPhotos } from "../src/lib/sites/pages";
import { CARD_ICON_NAMES, CARDS_MAX, CardSchema, SectionSchema } from "../src/lib/sites/schema";

const ID = "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f";

describe("a card", () => {
  it("is a heading, a few lines, a photo or an icon and a button, any of them blank", () => {
    expect(CardSchema.parse({ id: "abc123" })).toEqual({ id: "abc123", image: null, icon: "", heading: "", body: [], cta: null });
    expect(CardSchema.safeParse({ id: "abc123", icon: "rocket" }).success).toBe(false);
    expect(CardSchema.safeParse({ id: "ABC", heading: "x" }).success).toBe(false);
    const full = CardSchema.parse({ id: "abc123", icon: "leaf", heading: "Grass fed", body: ["On pasture", "all year"], cta: { label: "More", href: "/about" }, image: { id: ID } });
    expect(full.image).toEqual({ id: ID, alt: "" });
    expect(full.body).toHaveLength(2);
  });

  it("names an icon for the list and draws every icon the model allows", () => {
    expect(iconLabel("map-pin")).toBe("Map pin");
    expect(iconLabel("star")).toBe("Star");
    expect(iconLabel("")).toBe("None");
    expect(Object.keys(CARD_ICONS).sort()).toEqual([...CARD_ICON_NAMES].sort());
  });
});

describe("a columns section", () => {
  it("has two to four columns of cards, in panels on a band unless told otherwise", () => {
    const fresh = newSection("columns");
    expect(SectionSchema.safeParse(fresh).success).toBe(true);
    if (fresh.type !== "columns") throw new Error("not columns");
    expect(fresh.cards).toHaveLength(3);
    expect(fresh.columns).toBe(3);
    const summary = sectionSummary(fresh);
    expect(summary.startsWith("Why choose us: Something you do well")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(60);
    expect(summary.endsWith("…")).toBe(true);
    const parsed = SectionSchema.parse({ type: "columns", cards: [{ id: "abc123" }] });
    expect(parsed).toEqual({ type: "columns", heading: "", intro: "", columns: 3, widths: "equal", look: "cards", cards: [{ id: "abc123", image: null, icon: "", heading: "", body: [], cta: null }] });
    expect(SectionSchema.safeParse({ type: "columns", columns: 5 }).success).toBe(false);
    expect(SectionSchema.safeParse({ type: "columns", widths: "wider" }).success).toBe(false);
    expect(SectionSchema.safeParse({ type: "columns", cards: Array.from({ length: CARDS_MAX + 1 }, (_, i) => ({ id: `c${i}0000` })) }).success).toBe(false);
  });

  it("is summarised by its heading and its cards, and counts the photos its cards place", () => {
    const card = (id: string, heading: string, alt?: string) => ({ id, image: alt === undefined ? null : { id: ID, alt }, icon: "", heading, body: [], cta: null });
    expect(sectionSummary({ type: "columns", heading: "", intro: "", columns: 2, widths: "equal", look: "plain", cards: [] })).toBe("no cards yet");
    expect(sectionSummary({ type: "columns", heading: "Services", intro: "", columns: 2, widths: "equal", look: "plain", cards: [card("a00001", ""), card("a00002", "")] })).toBe("Services: 2 cards");
    expect(undescribedPhotos({ type: "columns", heading: "", intro: "", columns: 3, widths: "equal", look: "cards", cards: [card("a00001", "x", ""), card("a00002", "y", "A barn"), card("a00003", "z")] })).toEqual({ total: 2, missing: 1 });
  });
});
