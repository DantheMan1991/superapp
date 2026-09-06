import { defaultConfig } from "@/lib/site-blocks/core";
import type { BlockCatalogEntry } from "@/lib/site-blocks/types";
import type { SiteBrief } from "@/lib/sites/copy";
import { PageContentSchema, type ImageRef, type Section, type SectionType } from "@/lib/sites/schema";
import { applyWords, limitFor, mapWords, sectionWords } from "@/lib/sites/words";
import type { AssembledPage, SiteTemplate, StarterScene, TemplatePicture, TemplateSection } from "./types";

/**
 * From a template to pages — pure (slice 15).
 *
 * `assembleTemplate` applies a template to one business: the conditions
 * (a booking section only while Scheduling is on, a pack's block only when
 * the tenant's packs offer it with every setting chosen for them, hours
 * only when there are hours), the tokens (`{name}`, `{what}`), and the
 * starter pictures when there are any. What comes out is pages the
 * renderer can draw, whichever writer touches the words afterwards.
 *
 * `templateSlots` and `applySiteWords` are the writer's two halves: the
 * slots a template's pages offer, and the words that came back put into
 * them one section at a time, so a bad answer for one section costs that
 * section's starter words being kept and nothing else.
 */
export interface AssembleContext {
  schedulingOn: boolean;
  /** The blocks the tenant's packs offer (`siteBlockCatalog`); a template's block section is kept only when its kind is here. */
  blocks: BlockCatalogEntry[];
  /** The starter pictures made for this site, by scene; none means the slots stay empty. */
  pictures: Partial<Record<StarterScene, ImageRef["id"]>> | null;
}

/** A section's place in a template page, as `TemplatePicture.at` names it. */
export function slotAt(path: string, index: number): string {
  return `${path}#${index}`;
}

function fillTokens(text: string, brief: SiteBrief): string {
  const name = brief.name.trim() || "Our business";
  const what = brief.industry ? brief.industry.toLowerCase() : "local business";
  const tagline = brief.tagline.trim();
  return text.replace(/\{name\}/g, name).replace(/\{what\}/g, what).replace(/\{tagline\}/g, tagline).replace(/\s{2,}/g, " ").trim();
}

/** Whether this section may be on the page, given what the business has. */
function keeps(section: TemplateSection, brief: SiteBrief, ctx: AssembleContext): boolean {
  if (section.needs === "scheduling" && !ctx.schedulingOn) return false;
  if (section.needs === "hours" && brief.hoursLines.length === 0) return false;
  if (section.type === "block") return blockConfigFor(section.kind, ctx.blocks) !== null;
  return true;
}

/** A block's settings from the catalogue's defaults, or null when a choice is still the owner's to make. */
export function blockConfigFor(kind: string, blocks: BlockCatalogEntry[]): Record<string, string | number | boolean> | null {
  const entry = blocks.find((b) => b.kind === kind);
  if (!entry) return null;
  const config = defaultConfig(entry.fields);
  for (const field of entry.fields) {
    if (field.kind === "select" && (config[field.key] === "" || config[field.key] === undefined)) return null;
  }
  return config;
}

function withPicture(section: Section, picture: TemplatePicture, id: string): Section {
  const ref: ImageRef = { id, alt: picture.where === "background" ? "" : picture.alt };
  if (picture.where === "background") {
    const style = { ...(section.style ?? { width: "default", spacing: "default", align: "default", background: "default", photo: null }) };
    return { ...section, style: { ...style, background: "photo", photo: ref } } as Section;
  }
  if (section.type === "hero" || section.type === "about" || section.type === "image") return { ...section, image: ref };
  return section;
}

/** Strip the template-only field before the content model sees the section. */
function plain(section: TemplateSection): Section {
  const rest: TemplateSection = { ...section };
  delete rest.needs;
  return rest as Section;
}

export function assembleTemplate(template: SiteTemplate, brief: SiteBrief, ctx: AssembleContext): AssembledPage[] {
  return template.pages.map((page, navOrder) => {
    const sections: Section[] = [];
    page.sections.forEach((templateSection, index) => {
      if (!keeps(templateSection, brief, ctx)) return;
      let section = plain(templateSection);
      if (section.type === "block") section = { ...section, config: blockConfigFor(section.kind, ctx.blocks) ?? {} };
      section = mapWords(section, (text) => fillTokens(text, brief));
      const picture = template.pictures.find((p) => p.at === slotAt(page.path, index));
      const id = picture ? ctx.pictures?.[picture.scene] : undefined;
      if (picture && id) section = withPicture(section, picture, id);
      sections.push(section);
    });
    return {
      path: page.path,
      title: fillTokens(page.title, brief),
      navOrder,
      inNav: page.inNav,
      // Whatever a template says, what leaves here is valid.
      content: PageContentSchema.parse({ description: fillTokens(page.description, brief), seoTitle: fillTokens(page.seoTitle ?? "", brief), sections }),
    };
  });
}

/** The pictures a template asks for, so the caller makes only those. */
export function scenesFor(template: SiteTemplate): StarterScene[] {
  return [...new Set(template.pictures.map((p) => p.scene))];
}

/**
 * Pages that already exist, with the starter pictures put into their
 * template slots: the second pass of a build, once the pictures have ids.
 * Sections are matched by their place in the ASSEMBLED page, so this runs
 * on the pages `assembleTemplate` made with no pictures, before any edit.
 */
export function attachPictures(
  template: SiteTemplate,
  brief: SiteBrief,
  ctx: Omit<AssembleContext, "pictures">,
  pages: AssembledPage[],
  pictures: Partial<Record<StarterScene, string>>,
): AssembledPage[] {
  const withPictures = assembleTemplate(template, brief, { ...ctx, pictures });
  return pages.map((page) => {
    const twin = withPictures.find((p) => p.path === page.path);
    if (!twin || twin.content.sections.length !== page.content.sections.length) return page;
    const sections = page.content.sections.map((section, i) => {
      const source = twin.content.sections[i];
      if (source.type !== section.type) return section;
      const image = "image" in source && source.image ? { image: source.image } : {};
      const style = source.style?.background === "photo" && source.style.photo ? { style: source.style } : {};
      return { ...section, ...image, ...style } as Section;
    });
    return { ...page, content: PageContentSchema.parse({ ...page.content, sections }) };
  });
}

/* -- The writer's two halves ---------------------------------------------- */

export interface PageSlots {
  path: string;
  title: string;
  description: string;
  seoTitle: string;
  sections: Array<{ index: number; kind: SectionType; words: Record<string, string>; limits: Record<string, number> }>;
}

/** Every word slot on every page, with what it holds now and how long it may be. */
export function templateSlots(pages: AssembledPage[]): PageSlots[] {
  return pages.map((page) => ({
    path: page.path,
    title: page.title,
    description: page.content.description,
    seoTitle: page.content.seoTitle,
    sections: page.content.sections.map((section, index) => {
      // A question's blank answer is the owner's to write, never the writer's to guess.
      const words = Object.fromEntries(Object.entries(sectionWords(section)).filter(([path, text]) => !(section.type === "faq" && /.answer$/.test(path) && text === "")));
      const limits = Object.fromEntries(Object.keys(words).map((path) => [path, limitFor(section.type, path)]));
      return { index, kind: section.type, words, limits };
    }),
  }));
}

export const DESCRIPTION_MAX = 160;
export const SEO_TITLE_MAX = 70;

/**
 * The writer's answer put into the pages, one section at a time. The
 * answer's shape is `{ pages: [{ path, description, sections: [{ index,
 * words }] }] }`; anything else about it is ignored, and a section whose
 * words the content model refuses keeps its starter words. Returns how many
 * sections and descriptions took the writer's words.
 */
export function applySiteWords(pages: AssembledPage[], raw: unknown): { pages: AssembledPage[]; filled: number } {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { pages?: unknown }).pages)) return { pages, filled: 0 };
  const answers = (raw as { pages: unknown[] }).pages;
  let filled = 0;
  const next = pages.map((page) => {
    const answer = answers.find((a) => a && typeof a === "object" && (a as { path?: unknown }).path === page.path) as
      | { description?: unknown; seoTitle?: unknown; sections?: unknown }
      | undefined;
    if (!answer) return page;
    let description = page.content.description;
    if (typeof answer.description === "string" && answer.description.trim()) {
      description = answer.description.trim().slice(0, DESCRIPTION_MAX);
      filled += 1;
    }
    let seoTitle = page.content.seoTitle;
    if (typeof answer.seoTitle === "string" && answer.seoTitle.trim()) {
      seoTitle = answer.seoTitle.trim().slice(0, SEO_TITLE_MAX);
      filled += 1;
    }
    const sections = page.content.sections.map((section, index) => {
      const given = Array.isArray(answer.sections)
        ? (answer.sections.find((s) => s && typeof s === "object" && (s as { index?: unknown }).index === index) as { words?: unknown } | undefined)
        : undefined;
      if (!given || !given.words || typeof given.words !== "object") return section;
      const applied = applyWords(section, given.words as Record<string, unknown>);
      if (!applied) return section;
      filled += 1;
      return applied;
    });
    return { ...page, content: PageContentSchema.parse({ description, seoTitle, sections }) };
  });
  return { pages: next, filled };
}
