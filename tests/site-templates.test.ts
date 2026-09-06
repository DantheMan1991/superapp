import { afterEach, describe, expect, it, vi } from "vitest";
import { homesteadFarmSiteTemplate } from "../src/industries/homestead-farm/site-template";
import type { BlockCatalogEntry } from "../src/lib/site-blocks/types";
import { applySiteWords, assembleTemplate, attachPictures, blockConfigFor, scenesFor, slotAt, templateSlots } from "../src/lib/site-templates/core";
import { generalSiteTemplate } from "../src/lib/site-templates/general";
import { SITE_TEMPLATES } from "../src/lib/site-templates/registry";
import { templateFor } from "../src/lib/site-templates/resolve";
import { STARTER_SCENES } from "../src/lib/site-templates/types";
import type { SiteBrief } from "../src/lib/sites/copy";
import { PAGE_SECTIONS_MAX, PageContentSchema, SiteSettingsSchema } from "../src/lib/sites/schema";
import { mix, starterSceneSvg } from "../src/lib/sites/starters";
import { buildSiteCopyUserTurn } from "../src/modules/marketing/ai/site-copy-prompt";
import { writeSite } from "../src/modules/marketing/site-generate";

const brief: SiteBrief = {
  name: "Oak Row Farm Co.",
  tagline: "Pasture-raised, delivered Fridays",
  industry: "Homestead farm",
  phone: "740 555 0100",
  email: "hello@oakrow.example",
  address: "17 Main St\nMount Vernon, OH 43050",
  hoursLines: ["Saturday 8 to 12, at the market"],
};

const CHANNEL = "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f";
const prices = (channels: Array<{ value: string; label: string }>): BlockCatalogEntry => ({
  kind: "retail.prices",
  pack: "retail",
  label: "Price list",
  hint: "",
  fields: [
    { key: "channel", label: "Prices from", kind: "select", options: channels, default: channels.length === 1 ? channels[0].value : "" },
    { key: "soldOut", label: "When something has run out", kind: "select", options: [{ value: "mark", label: "Mark" }], default: "mark" },
  ],
});
const nothing = { schedulingOn: false, blocks: [], pictures: null };

describe("the templates on offer", () => {
  it("has a general one and one per industry that brings one, and picks by the tenant's industry", () => {
    expect(SITE_TEMPLATES.map((t) => t.slug)).toEqual(["general", "homestead-farm"]);
    expect(templateFor("homestead-farm").slug).toBe("homestead-farm");
    expect(templateFor("general").slug).toBe("general");
    expect(templateFor(null).slug).toBe("general");
    expect(templateFor("plumbing").slug).toBe("general");
  });

  it("every template's pages are valid content, within the page ceiling, with a frame the settings take", () => {
    for (const template of SITE_TEMPLATES) {
      const pages = assembleTemplate(template, brief, { schedulingOn: true, blocks: [prices([{ value: CHANNEL, label: "Market" }])], pictures: null });
      expect(pages.length).toBe(template.pages.length);
      for (const page of pages) {
        expect(PageContentSchema.safeParse(page.content).success).toBe(true);
        expect(page.content.sections.length).toBeLessThanOrEqual(PAGE_SECTIONS_MAX);
        expect(page.content.description.length).toBeLessThanOrEqual(200);
      }
      expect(SiteSettingsSchema.safeParse({ ...template.frame }).success).toBe(true);
      expect(pages.map((p) => p.navOrder)).toEqual(pages.map((_, i) => i));
      expect(JSON.stringify(pages)).not.toContain("{name}");
    }
  });
});

describe("the general template", () => {
  it("is the three pages every site used to start with, hours only when there are hours", () => {
    const pages = assembleTemplate(generalSiteTemplate, brief, nothing);
    expect(pages.map((p) => p.path)).toEqual(["/", "/about", "/contact"]);
    expect(pages[0].content.sections.map((s) => s.type)).toEqual(["hero", "offer", "about", "cta"]);
    expect(pages[2].content.sections.map((s) => s.type)).toEqual(["contact", "hours", "form"]);
    const noHours = assembleTemplate(generalSiteTemplate, { ...brief, hoursLines: [] }, nothing);
    expect(noHours[2].content.sections.map((s) => s.type)).toEqual(["contact", "form"]);
    const hero = pages[0].content.sections[0];
    expect(hero.type === "hero" && hero.headline).toBe("Oak Row Farm Co.");
    expect(hero.type === "hero" && hero.subheadline).toBe("Pasture-raised, delivered Fridays");
    expect(pages[0].content.description).toContain("Oak Row Farm Co. is a homestead farm");
    expect(JSON.stringify(pages)).not.toMatch(/years|award/i);
  });
});

describe("the homestead farm template", () => {
  it("is five pages in the order a buyer looks, with the pack and calendar sections only where the tenant has them", () => {
    const full = assembleTemplate(homesteadFarmSiteTemplate, brief, { schedulingOn: true, blocks: [prices([{ value: CHANNEL, label: "Market" }])], pictures: null });
    expect(full.map((p) => p.path)).toEqual(["/", "/shop", "/visit", "/about", "/contact"]);
    expect(full[0].content.sections.map((s) => s.type)).toEqual(["hero", "offer", "columns", "block", "events", "cta"]);
    expect(full[2].content.sections.map((s) => s.type)).toEqual(["hero", "text", "booking", "hours", "map"]);
    const block = full[0].content.sections[3];
    expect(block.type === "block" && block.config).toEqual({ channel: CHANNEL, soldOut: "mark" });
    const bare = assembleTemplate(homesteadFarmSiteTemplate, { ...brief, hoursLines: [] }, nothing);
    expect(bare[0].content.sections.map((s) => s.type)).toEqual(["hero", "offer", "columns", "cta"]);
    expect(bare[2].content.sections.map((s) => s.type)).toEqual(["hero", "text", "map"]);
    // Two channels and nobody chose: the block waits for the owner rather than guessing.
    const twoChannels = assembleTemplate(homesteadFarmSiteTemplate, brief, { ...nothing, blocks: [prices([{ value: CHANNEL, label: "A" }, { value: "b", label: "B" }])] });
    expect(twoChannels[0].content.sections.map((s) => s.type)).toEqual(["hero", "offer", "columns", "cta"]);
    expect(blockConfigFor("retail.prices", [])).toBeNull();
    expect(homesteadFarmSiteTemplate.frame.headerButton).toEqual({ label: "Order now", href: "/shop" });
    expect(homesteadFarmSiteTemplate.look).toEqual({ look: "warm", fontPairing: "warm", buttonShape: "rounded" });
  });

  it("puts the business's name into its starter words and asks for three starter scenes", () => {
    const pages = assembleTemplate(homesteadFarmSiteTemplate, brief, nothing);
    const hero = pages[0].content.sections[0];
    expect(hero.type === "hero" && hero.headline).toBe("Pasture-raised meat and eggs from Oak Row Farm Co.");
    expect(pages[3].content.sections[0].type === "text" && (pages[3].content.sections[0] as { body: string[] }).body[0]).toContain("Oak Row Farm Co. is a working homestead farm");
    expect(scenesFor(homesteadFarmSiteTemplate)).toEqual(["hills", "dawn", "furrows"]);
    expect(homesteadFarmSiteTemplate.pictures.map((p) => p.at)).toEqual([slotAt("/", 0), slotAt("/visit", 0), slotAt("/about", 2)]);
  });

  it("takes the starter pictures into the slots that asked for them, on the pages already assembled", () => {
    const ctx = { schedulingOn: false, blocks: [] };
    const pages = assembleTemplate(homesteadFarmSiteTemplate, brief, { ...ctx, pictures: null });
    const hills = "11111111-1111-4111-8111-111111111111";
    const furrows = "22222222-2222-4222-8222-222222222222";
    const withPictures = attachPictures(homesteadFarmSiteTemplate, brief, ctx, pages, { hills, furrows });
    const hero = withPictures[0].content.sections[0];
    expect(hero.style?.background).toBe("photo");
    expect(hero.style?.photo).toEqual({ id: hills, alt: "" });
    const visitHero = withPictures[2].content.sections[0];
    // The dawn scene was not made: the visit hero keeps a photo background with no photo, which draws as the plain band.
    expect(visitHero.style?.photo).toBeNull();
    const image = withPictures[3].content.sections[2];
    expect(image.type === "image" && image.image).toEqual({ id: furrows, alt: "Rows in a field under a wide sky" });
    // Nothing else moved.
    expect(withPictures[1]).toEqual(pages[1]);
  });
});

describe("the writer's slots and words", () => {
  const pages = assembleTemplate(generalSiteTemplate, brief, nothing);

  it("lists every slot with its starter words and its length, and briefs with the facts and the notes", () => {
    const slots = templateSlots(pages);
    expect(slots.map((p) => p.path)).toEqual(["/", "/about", "/contact"]);
    expect(slots[0].sections[0]).toMatchObject({ index: 0, kind: "hero", words: { headline: "Oak Row Farm Co.", "cta.label": "Get in touch" }, limits: { headline: 120, "cta.label": 40 } });
    const turn = buildSiteCopyUserTurn({ ...brief, phone: "", hoursLines: [] }, ["Farm notes."], slots);
    expect(turn).toContain("Oak Row Farm Co.");
    expect(turn).toContain("No phone number is given.");
    expect(turn).toContain("Mount Vernon");
    expect(turn).toContain("- Farm notes.");
    expect(turn).toContain('Page / ("Home")');
    expect(turn).toContain("headline (at most 120)");
  });

  it("puts the words back one section at a time, keeps the starter for a section it got wrong, and counts what it filled", () => {
    const { pages: written, filled } = applySiteWords(pages, {
      pages: [
        {
          path: "/",
          description: "Grass-fed beef in Mount Vernon, delivered Fridays by Oak Row Farm.",
          sections: [
            { index: 0, words: { headline: "Beef you can trust", "cta.label": "Get in touch", "cta.href": "javascript:x" } },
            { index: 1, words: { heading: "" } },
          ],
        },
        { path: "/nowhere", description: "ignored", sections: [] },
      ],
    });
    expect(filled).toBe(2);
    const hero = written[0].content.sections[0];
    expect(hero.type === "hero" && hero.headline).toBe("Beef you can trust");
    expect(hero.type === "hero" && hero.cta?.href).toBe("/contact");
    expect(written[0].content.description).toBe("Grass-fed beef in Mount Vernon, delivered Fridays by Oak Row Farm.");
    expect(written[0].content.sections[1]).toEqual(pages[0].content.sections[1]);
    expect(written[1]).toEqual(pages[1]);
    expect(applySiteWords(pages, "garbage")).toEqual({ pages, filled: 0 });
    expect(applySiteWords(pages, { pages: [{ path: "/", description: "x".repeat(300), sections: [] }] }).pages[0].content.description).toHaveLength(160);
  });
});

describe("writeSite", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says model when the model wrote anything, standard when it failed or there is no key", async () => {
    const pages = assembleTemplate(generalSiteTemplate, brief, nothing);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const call = vi.fn(async () => ({ pages: [{ path: "/", description: "A farm in Mount Vernon selling beef.", sections: [] }] }));
    const wrote = await writeSite(generalSiteTemplate, brief, pages, { call });
    expect(wrote.source).toBe("model");
    expect(wrote.pages[0].content.description).toBe("A farm in Mount Vernon selling beef.");
    expect(call).toHaveBeenCalledWith(brief, generalSiteTemplate.writerNotes, pages);
    const failed = await writeSite(generalSiteTemplate, brief, pages, { call: async () => { throw new Error("boom"); } });
    expect(failed).toEqual({ pages, source: "standard" });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const never = vi.fn(async () => ({}));
    expect((await writeSite(generalSiteTemplate, brief, pages, { call: never })).source).toBe("standard");
    expect(never).not.toHaveBeenCalled();
  });
});

describe("the starter scenes", () => {
  it("draws every scene as an SVG in the brand's colours, and mixes a colour toward white or black", () => {
    for (const scene of STARTER_SCENES) {
      const svg = starterSceneSvg(scene, { primary: "#6b2d2d", accent: "#d8a038" });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain('width="1600"');
      // The brand's colours are in the picture: another brand draws another picture.
      expect(svg).not.toBe(starterSceneSvg(scene, { primary: "#1f6f5f", accent: "#e0b040" }));
      expect(svg).not.toMatch(/<text/);
    }
    expect(mix("#000000", 0.5)).toBe("#808080");
    expect(mix("#ffffff", -0.5)).toBe("#808080");
    expect(mix("#6b2d2d", 0)).toBe("#6b2d2d");
    expect(mix("nope", 0.5)).toBe("#dddddd");
  });
});
