import type { ImageRef, PageContent, Section } from "./schema";
import { sectionLabel } from "./pages";

/**
 * The shot list — pure (Marketing slice 18).
 *
 * A page's sections say where a photo can go: behind a headline, beside a
 * story, on each tile of what is offered. Nothing about that is stored:
 * the SPOTS are read from the draft every time, so the list can never
 * disagree with the pages, and a section added in the editor is on the
 * list the moment it is saved. Each spot is filled, holds one of the
 * platform's drawn stand-ins, or is empty, and carries a note on what to
 * take there. The core's notes are true of any business; an industry's
 * template says the same thing in its own terms (`SiteTemplate.shots`,
 * by role, and `TemplatePicture.shot` for the spot a starter scene fills).
 *
 * The one write, `placePhoto`, puts one photo into one spot and returns
 * the new content; the caller saves it the way the editor saves.
 */

/** What a spot is for, which is what decides the note and the shape. */
export type ShotRole =
  /** A photo behind a big headline, with the words over it. */
  | "cover"
  /** Beside the headline. */
  | "beside"
  /** Beside an About section's paragraphs. */
  | "about"
  /** One tile of a What you offer section. */
  | "item"
  /** The top of a card in a Columns section. */
  | "card"
  /** A Photo section. */
  | "picture"
  /** A gallery or slideshow with nothing in it yet. */
  | "set"
  /** Behind any other section whose background is a photo. */
  | "backdrop";

export type ShotShape = "wide" | "landscape" | "square" | "any";

export type SpotStatus = "empty" | "starter" | "photo";

/** Where in a section the photo goes. */
export type SpotWhere =
  | { kind: "image" }
  | { kind: "background" }
  | { kind: "item"; index: number }
  | { kind: "card"; index: number }
  /** A gallery or slideshow: the photo is added at the end. */
  | { kind: "append" };

export interface SpotKey {
  section: number;
  where: SpotWhere;
}

export interface Spot {
  /** `"<section>:<where>"`, what the action is handed back. */
  key: string;
  section: number;
  /** The section's kind as the editor names it, and its heading when it has one. */
  sectionLabel: string;
  heading: string;
  role: ShotRole;
  shape: ShotShape;
  /** What to call the spot on the list: "Behind the headline", an item's name. */
  label: string;
  /** What to take there. */
  note: string;
  /** A hero can be a band and a card can carry an icon: no photo is a fair choice there. */
  optional: boolean;
  status: SpotStatus;
  image: ImageRef | null;
}

export const SHAPE_LABELS: Record<ShotShape, string> = {
  wide: "Wide",
  landscape: "Landscape",
  square: "Square",
  any: "Any shape",
};

export const ROLE_SHAPES: Record<ShotRole, ShotShape> = {
  cover: "wide",
  beside: "landscape",
  about: "landscape",
  item: "square",
  card: "landscape",
  picture: "any",
  set: "any",
  backdrop: "wide",
};

/**
 * The core's notes, true of any business. `{name}` is the item's or the
 * card's own words. An industry says the same in its own terms through
 * its template; these are what a site with no template, or a spot the
 * template did not speak to, reads.
 */
export const GENERIC_SHOTS: Record<ShotRole, string> = {
  cover: "The place itself, taken from a little way back with room above for the words. Early or late in the day reads best.",
  beside: "Something that says what you do at a glance. It sits to the right of the headline on a wide screen.",
  about: "The people behind the business, at work or in front of the place. A visitor wants to see who they are dealing with.",
  item: "{name}, close and in good light, on a plain background. Square works best on the tile.",
  card: "What this card is about: {name}. It sits above the heading, so keep the subject in the middle.",
  picture: "A photo worth a whole row: the place at its best, or the work being done.",
  set: "Several photos of the same kind: the place, the work, the results. They read best when they share a light and a mood.",
  backdrop: "Something that reads as texture behind white words: the ground, a wall, a wide view. It is darkened on the page.",
};

/** The notes a site's template gives, by role, and by the spot a starter scene fills. */
export interface ShotNotes {
  byRole: Partial<Record<ShotRole, string>>;
  /** Keyed `"<path>#<index>|<image|background>"`, with the section kind the template put there. */
  at: Record<string, { type: Section["type"]; note: string }>;
}

export const NO_NOTES: ShotNotes = { byRole: {}, at: {} };

/** A template's notes, read from its data alone; it never has to import this module's types to give them. */
export function shotNotesFor(template: {
  pages: Array<{ path: string; sections: Array<{ type: Section["type"] }> }>;
  pictures: Array<{ at: string; where: "image" | "background"; shot?: string }>;
  shots?: Partial<Record<ShotRole, string>>;
}): ShotNotes {
  const at: ShotNotes["at"] = {};
  for (const picture of template.pictures) {
    if (!picture.shot) continue;
    const [path, index] = picture.at.split("#");
    const type = template.pages.find((p) => p.path === path)?.sections[Number(index)]?.type;
    if (!type) continue;
    at[`${picture.at}|${picture.where}`] = { type, note: picture.shot };
  }
  return { byRole: { ...(template.shots ?? {}) }, at };
}

export function spotKey(key: SpotKey): string {
  const w = key.where;
  const where = w.kind === "item" || w.kind === "card" ? `${w.kind}.${w.index}` : w.kind;
  return `${key.section}:${where}`;
}

/** The key back into parts, or null for anything that is not one. */
export function parseSpotKey(raw: string): SpotKey | null {
  const m = /^(\d{1,2}):(image|background|append|item\.(\d{1,2})|card\.(\d{1,2}))$/.exec(raw);
  if (!m) return null;
  const section = Number(m[1]);
  if (m[2] === "image" || m[2] === "background" || m[2] === "append") return { section, where: { kind: m[2] } };
  if (m[3] !== undefined) return { section, where: { kind: "item", index: Number(m[3]) } };
  return { section, where: { kind: "card", index: Number(m[4]) } };
}

function fill(note: string, name: string): string {
  return note.replace(/\{name\}/g, name.trim() || "this");
}

function statusOf(image: ImageRef | null, starters: ReadonlySet<string>): SpotStatus {
  if (!image) return "empty";
  return starters.has(image.id) ? "starter" : "photo";
}

function headingOf(section: Section): string {
  if (section.type === "hero") return section.headline;
  if ("heading" in section && typeof section.heading === "string") return section.heading;
  return "";
}

/**
 * Every spot on one page, in page order. A hero with a photo behind it
 * does not also ask for one beside the headline; a gallery with photos
 * lists them and asks for no more, since the editor adds to it.
 */
export function pageSpots(
  page: { path: string; content: Pick<PageContent, "sections"> },
  starters: ReadonlySet<string> = new Set(),
  notes: ShotNotes = NO_NOTES,
): Spot[] {
  const spots: Spot[] = [];
  page.content.sections.forEach((section, index) => {
    const base = { section: index, sectionLabel: sectionLabel(section.type), heading: headingOf(section) };
    const push = (where: SpotWhere, role: ShotRole, label: string, name: string, image: ImageRef | null, optional = false) => {
      const atKey = `${page.path}#${index}|${where.kind === "background" ? "background" : "image"}`;
      const fromAt = notes.at[atKey];
      const note = (fromAt && fromAt.type === section.type ? fromAt.note : null) ?? notes.byRole[role] ?? GENERIC_SHOTS[role];
      spots.push({
        ...base,
        key: spotKey({ section: index, where }),
        role,
        shape: ROLE_SHAPES[role],
        label,
        note: fill(note, name),
        optional,
        status: statusOf(image, starters),
        image,
      });
    };
    const style = "style" in section ? section.style : undefined;
    const photoBehind = style?.background === "photo";
    if (section.type === "hero") {
      if (photoBehind) push({ kind: "background" }, "cover", "Behind the headline", "", style?.photo ?? null);
      else push({ kind: "image" }, "beside", "Beside the headline", "", section.image, true);
    } else if (photoBehind) {
      push({ kind: "background" }, "backdrop", "Behind the section", "", style?.photo ?? null);
    }
    switch (section.type) {
      case "about":
        push({ kind: "image" }, "about", "Beside the story", "", section.image);
        break;
      case "offer":
        section.items.forEach((item, i) => push({ kind: "item", index: i }, "item", item.name || `Item ${i + 1}`, item.name, item.image));
        break;
      case "columns":
        section.cards.forEach((card, i) =>
          push({ kind: "card", index: i }, "card", card.heading || `Card ${i + 1}`, card.heading, card.image, true),
        );
        break;
      case "image":
        push({ kind: "image" }, "picture", "The photo", "", section.image);
        break;
      case "gallery":
      case "slideshow":
        if (section.items.length === 0) {
          push({ kind: "append" }, "set", section.type === "gallery" ? "The gallery" : "The slideshow", "", null);
        } else {
          section.items.forEach((item, i) => push({ kind: "item", index: i }, "set", `Photo ${i + 1}`, "", item.image));
        }
        break;
      default:
        break;
    }
  });
  return spots;
}

/** How many spots on a page hold nothing, for the editor's line; no starters, no notes needed. */
export function emptySpotCount(content: Pick<PageContent, "sections">): number {
  return pageSpots({ path: "", content }).filter((s) => s.status === "empty").length;
}

export interface ShotSummary {
  total: number;
  photos: number;
  starters: number;
  empty: number;
}

export function shotSummary(spots: readonly Spot[]): ShotSummary {
  return {
    total: spots.length,
    photos: spots.filter((s) => s.status === "photo").length,
    starters: spots.filter((s) => s.status === "starter").length,
    empty: spots.filter((s) => s.status === "empty").length,
  };
}

/** The line at the top of the list and on the Website screen. */
export function shotLine(summary: ShotSummary): string {
  if (summary.total === 0) return "The pages have no place for a photo yet. Add a section that takes one.";
  const places = `${summary.total} place${summary.total === 1 ? "" : "s"}`;
  if (summary.photos === summary.total) return `Every one of the ${places} for a photo has one.`;
  const parts: string[] = [];
  if (summary.empty > 0) parts.push(`${summary.empty} still to take`);
  if (summary.starters > 0) parts.push(`${summary.starters} drawn stand-in${summary.starters === 1 ? "" : "s"} to replace`);
  return `${summary.photos} of the ${places} for a photo ${summary.photos === 1 ? "has" : "have"} one: ${parts.join(", ")}.`;
}

/** Which photos in the library are the platform's drawn stand-ins, by the name their file carries. */
export const STARTER_PREFIX = "starter-";

export function isStarterPhoto(pathname: string): boolean {
  const file = pathname.slice(pathname.lastIndexOf("/") + 1);
  return file.startsWith(STARTER_PREFIX);
}

export type PlaceResult = { ok: true; content: PageContent } | { ok: false; reason: string };

/**
 * One photo into one spot. The content comes back new; the spot must be
 * one the page has NOW, since the page may have changed since the list
 * was read, and a key that no longer fits is refused rather than guessed.
 */
export function placePhoto(content: PageContent, key: SpotKey, ref: ImageRef): PlaceResult {
  const section = content.sections[key.section];
  if (!section) return { ok: false, reason: "That section is no longer on the page." };
  const w = key.where;
  let next: Section;
  if (w.kind === "background") {
    if (!("style" in section) || section.style?.background !== "photo") return { ok: false, reason: "That section no longer has a photo behind it." };
    next = { ...section, style: { ...section.style, photo: ref } } as Section;
  } else if (w.kind === "image") {
    if (section.type !== "hero" && section.type !== "about" && section.type !== "image") return { ok: false, reason: "That section does not take a photo there." };
    next = { ...section, image: ref };
  } else if (w.kind === "item") {
    if (section.type === "offer") {
      if (!section.items[w.index]) return { ok: false, reason: "That item is no longer in the section." };
      next = { ...section, items: section.items.map((item, i) => (i === w.index ? { ...item, image: ref } : item)) };
    } else if (section.type === "gallery" || section.type === "slideshow") {
      if (!section.items[w.index]) return { ok: false, reason: "That photo is no longer in the section." };
      next = { ...section, items: section.items.map((item, i) => (i === w.index ? { ...item, image: ref } : item)) };
    } else return { ok: false, reason: "That section does not take a photo there." };
  } else if (w.kind === "card") {
    if (section.type !== "columns") return { ok: false, reason: "That section does not take a photo there." };
    if (!section.cards[w.index]) return { ok: false, reason: "That card is no longer in the section." };
    next = { ...section, cards: section.cards.map((card, i) => (i === w.index ? { ...card, image: ref } : card)) };
  } else {
    if (section.type !== "gallery" && section.type !== "slideshow") return { ok: false, reason: "That section does not take a photo there." };
    next = { ...section, items: [...section.items, { image: ref, caption: "" }] };
  }
  return { ok: true, content: { ...content, sections: content.sections.map((s, i) => (i === key.section ? next : s)) } };
}
