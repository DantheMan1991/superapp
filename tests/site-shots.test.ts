import { describe, expect, it } from "vitest";
import { homesteadFarmSiteTemplate } from "../src/industries/homestead-farm/site-template";
import { assembleTemplate } from "../src/lib/site-templates/core";
import { generalSiteTemplate } from "../src/lib/site-templates/general";
import type { SiteBrief } from "../src/lib/sites/copy";
import { PageContentSchema, type PageContent } from "../src/lib/sites/schema";
import {
  emptySpotCount,
  GENERIC_SHOTS,
  isStarterPhoto,
  pageSpots,
  parseSpotKey,
  placePhoto,
  shotLine,
  shotNotesFor,
  shotSummary,
  spotKey,
  type Spot,
} from "../src/lib/sites/shots";

const A = "6d4c1a2e-9b3f-4c8d-8e7a-1f2b3c4d5e6f";
const B = "7e5d2b3f-0c4a-4d9e-9f8b-2a3c4d5e6f70";
const C = "8f6e3c40-1d5b-4eaf-a09c-3b4d5e6f7081";

function content(sections: unknown[]): PageContent {
  return PageContentSchema.parse({ description: "", sections });
}

const page = content([
  { type: "hero", headline: "Hello" },
  { type: "offer", heading: "What we sell", items: [{ name: "Beef", image: { id: A, alt: "" } }, { name: "Eggs" }] },
  { type: "about", heading: "Us", body: ["Words."] },
  { type: "columns", heading: "", intro: "", columns: 2, widths: "equal", look: "cards", cards: [{ id: "a00001", heading: "Pickup" }, { id: "a00002", heading: "" }] },
  { type: "image", caption: "" },
  { type: "gallery", items: [] },
  { type: "slideshow", items: [{ image: { id: B, alt: "A barn" }, caption: "" }] },
  { type: "text", heading: "", body: ["Nothing to see."] },
  { type: "cta", headline: "Go", cta: { label: "Contact", href: "/contact" }, style: { background: "photo" } },
]);

describe("where a photo belongs", () => {
  it("is every spot on the page in page order, each with a shape, a note and what it holds", () => {
    const spots = pageSpots({ path: "/", content: page });
    expect(spots.map((s) => s.key)).toEqual(["0:image", "1:item.0", "1:item.1", "2:image", "3:card.0", "3:card.1", "4:image", "5:append", "6:item.0", "8:background"]);
    expect(spots.map((s) => s.role)).toEqual(["beside", "item", "item", "about", "card", "card", "picture", "set", "set", "backdrop"]);
    expect(spots.map((s) => s.status)).toEqual(["empty", "photo", "empty", "empty", "empty", "empty", "empty", "empty", "photo", "empty"]);
    expect(spots.map((s) => s.label)).toEqual(["Beside the headline", "Beef", "Eggs", "Beside the story", "Pickup", "Card 2", "The photo", "The gallery", "Photo 1", "Behind the section"]);
    expect(spots.map((s) => s.optional)).toEqual([true, false, false, false, true, true, false, false, false, false]);
    expect(spots.map((s) => s.shape)).toEqual(["landscape", "square", "square", "landscape", "landscape", "landscape", "any", "any", "any", "wide"]);
    expect(spots[0].sectionLabel).toBe("Big headline");
    expect(spots[0].heading).toBe("Hello");
    expect(spots[2].note).toBe("Eggs, close and in good light, on a plain background. Square works best on the tile.");
    expect(spots[5].note).toContain("What this card is about: this.");
    expect(spots[8].image).toEqual({ id: B, alt: "A barn" });
    expect(emptySpotCount(page)).toBe(8);
  });

  it("asks for a photo behind a headline that has one, and not for one beside it", () => {
    const hero = content([{ type: "hero", headline: "Hi", style: { background: "photo", photo: { id: A, alt: "" } } }]);
    const spots = pageSpots({ path: "/", content: hero });
    expect(spots.map((s) => [s.key, s.role, s.status, s.optional])).toEqual([["0:background", "cover", "photo", false]]);
    const bare = content([{ type: "hero", headline: "Hi", style: { background: "photo" } }]);
    expect(pageSpots({ path: "/", content: bare }).map((s) => [s.key, s.status])).toEqual([["0:background", "empty"]]);
  });

  it("knows a drawn stand-in from a photo, and says so in one line", () => {
    const spots = pageSpots({ path: "/", content: page }, new Set([A]));
    expect(spots[1].status).toBe("starter");
    expect(shotSummary(spots)).toEqual({ total: 10, photos: 1, starters: 1, empty: 8 });
    expect(shotLine(shotSummary(spots))).toBe("1 of the 10 places for a photo has one: 8 still to take, 1 drawn stand-in to replace.");
    expect(shotLine({ total: 0, photos: 0, starters: 0, empty: 0 })).toBe("The pages have no place for a photo yet. Add a section that takes one.");
    expect(shotLine({ total: 3, photos: 3, starters: 0, empty: 0 })).toBe("Every one of the 3 places for a photo has one.");
    expect(shotLine({ total: 5, photos: 2, starters: 0, empty: 3 })).toBe("2 of the 5 places for a photo have one: 3 still to take.");
    expect(shotLine({ total: 4, photos: 0, starters: 2, empty: 2 })).toBe("0 of the 4 places for a photo have one: 2 still to take, 2 drawn stand-ins to replace.");
    expect(isStarterPhoto("sites/t/photos/starter-hills-ab12.jpg")).toBe(true);
    expect(isStarterPhoto("sites/t/photos/IMG_0412.jpg")).toBe(false);
    expect(isStarterPhoto("sites/t/photos/my-starter-shot.jpg")).toBe(false);
  });

  it("names each spot by a key that reads back, and nothing else does", () => {
    const keys = [
      { section: 0, where: { kind: "image" as const } },
      { section: 3, where: { kind: "background" as const } },
      { section: 2, where: { kind: "append" as const } },
      { section: 1, where: { kind: "item" as const, index: 4 } },
      { section: 11, where: { kind: "card" as const, index: 0 } },
    ];
    expect(keys.map(spotKey)).toEqual(["0:image", "3:background", "2:append", "1:item.4", "11:card.0"]);
    for (const key of keys) expect(parseSpotKey(spotKey(key))).toEqual(key);
    for (const bad of ["", "a:image", "1:items.0", "1:item.", "1:item.x", "100:image", "1:image:2", "1:photo"]) expect(parseSpotKey(bad)).toBeNull();
  });
});

describe("putting a photo in a spot", () => {
  const ref = { id: C, alt: "New" };
  const at = (key: string) => {
    const parsed = parseSpotKey(key);
    if (!parsed) throw new Error(key);
    return parsed;
  };

  it("goes where the key says and leaves the rest of the page as it was", () => {
    const item = placePhoto(page, at("1:item.1"), ref);
    expect(item.ok && item.content.sections[1].type === "offer" && item.content.sections[1].items[1].image).toEqual(ref);
    expect(item.ok && item.content.sections[1].type === "offer" && item.content.sections[1].items[0].image).toEqual({ id: A, alt: "" });
    expect(page.sections[1].type === "offer" && page.sections[1].items[1].image).toBeNull();
    const hero = placePhoto(page, at("0:image"), ref);
    expect(hero.ok && hero.content.sections[0].type === "hero" && hero.content.sections[0].image).toEqual(ref);
    const about = placePhoto(page, at("2:image"), ref);
    expect(about.ok && about.content.sections[2].type === "about" && about.content.sections[2].image).toEqual(ref);
    const card = placePhoto(page, at("3:card.1"), ref);
    expect(card.ok && card.content.sections[3].type === "columns" && card.content.sections[3].cards[1].image).toEqual(ref);
    const picture = placePhoto(page, at("4:image"), ref);
    expect(picture.ok && picture.content.sections[4].type === "image" && picture.content.sections[4].image).toEqual(ref);
    const added = placePhoto(page, at("5:append"), ref);
    expect(added.ok && added.content.sections[5].type === "gallery" && added.content.sections[5].items).toEqual([{ image: ref, caption: "" }]);
    const swapped = placePhoto(page, at("6:item.0"), ref);
    expect(swapped.ok && swapped.content.sections[6].type === "slideshow" && swapped.content.sections[6].items).toEqual([{ image: ref, caption: "" }]);
    const behind = placePhoto(page, at("8:background"), ref);
    expect(behind.ok && behind.content.sections[8].style?.photo).toEqual(ref);
    for (const r of [item, hero, about, card, picture, added, swapped, behind]) expect(r.ok && PageContentSchema.safeParse(r.content).success).toBe(true);
  });

  it("refuses a key the page no longer fits, with the reason", () => {
    const refused = (key: string) => {
      const r = placePhoto(page, at(key), ref);
      return r.ok ? "ok" : r.reason;
    };
    expect(refused("9:image")).toBe("That section is no longer on the page.");
    expect(refused("7:image")).toBe("That section does not take a photo there.");
    expect(refused("1:item.2")).toBe("That item is no longer in the section.");
    expect(refused("6:item.1")).toBe("That photo is no longer in the section.");
    expect(refused("3:card.2")).toBe("That card is no longer in the section.");
    expect(refused("0:background")).toBe("That section no longer has a photo behind it.");
    expect(refused("1:append")).toBe("That section does not take a photo there.");
    expect(refused("0:card.0")).toBe("That section does not take a photo there.");
  });
});

describe("what to take there", () => {
  const brief: SiteBrief = {
    name: "Oak Row Farm Co.",
    tagline: "Pasture-raised, delivered Fridays",
    industry: "Homestead farm",
    phone: "",
    email: "",
    address: "17 Main St\nMount Vernon, OH 43050",
    hoursLines: [],
    about: "",
  };

  it("is the template's own words by spot and by role, and the core's where the template is silent", () => {
    const notes = shotNotesFor(homesteadFarmSiteTemplate);
    expect(Object.keys(notes.at)).toEqual(["/#0|background", "/visit#0|background", "/about#0|image"]);
    expect(notes.at["/about#0|image"].type).toBe("about");
    const pages = assembleTemplate(homesteadFarmSiteTemplate, brief, { schedulingOn: false, blocks: [], pictures: { hills: A, dawn: B, furrows: C } });
    const starters = new Set([A, B, C]);
    const home = pageSpots(pages[0], starters, notes);
    expect(home[0].key).toBe("0:background");
    expect(home[0].status).toBe("starter");
    expect(home[0].note).toBe(homesteadFarmSiteTemplate.pictures[0].shot);
    const item = home.find((s) => s.role === "item") as Spot;
    expect(item.note.startsWith(`${item.label} as the customer gets it`)).toBe(true);
    const about = pageSpots(pages.find((p) => p.path === "/about") as (typeof pages)[number], starters, notes);
    expect(about[0].note).toBe(homesteadFarmSiteTemplate.pictures[2].shot);
    // A section the owner moved: the spot note no longer matches its place, and the role's note stands instead.
    const moved = pageSpots({ path: "/about", content: content([{ type: "text", heading: "x", body: ["y"] }, ...pages.find((p) => p.path === "/about")!.content.sections]) }, starters, notes);
    expect(moved.find((s) => s.role === "about")?.note).toBe(homesteadFarmSiteTemplate.shots?.about);
  });

  it("is the core's neutral note on a site with no template words, and the core speaks no industry", () => {
    expect(generalSiteTemplate.shots).toBeUndefined();
    const notes = shotNotesFor(generalSiteTemplate);
    expect(notes).toEqual({ byRole: {}, at: {} });
    const spots = pageSpots({ path: "/", content: page }, new Set(), notes);
    expect(spots[3].note).toBe(GENERIC_SHOTS.about);
    expect(Object.values(GENERIC_SHOTS).join(" ")).not.toMatch(/farm|pasture|herd|animal|barn|crop|harvest/i);
    expect(Object.values(GENERIC_SHOTS).join(" ")).not.toMatch(/—/);
  });
});
