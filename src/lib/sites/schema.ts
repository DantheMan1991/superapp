import { z } from "zod";

/**
 * The website's content model — pure, Zod, no I/O.
 *
 * A page is a description and a list of typed sections. Every string is
 * bounded, every section is one of a fixed set, and nothing here is markup:
 * the renderer decides how a section looks, and an owner (or the assistant)
 * decides only what it says. That is what keeps a public page safe to render
 * from what a tenant typed, and what a future editor edits.
 */

const short = (max: number) => z.string().trim().max(max);
const paragraphs = (max: number, each: number) =>
  z.array(z.string().trim().max(each)).max(max).default([]);

export const CtaSchema = z.object({
  label: short(40).min(1),
  /** An in-site path (`/contact`), a `mailto:`/`tel:` or an https URL. */
  href: short(200).min(1),
});

export const SectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hero"),
    headline: short(120).min(1),
    subheadline: short(240).default(""),
    cta: CtaSchema.nullable().default(null),
  }),
  z.object({
    type: z.literal("about"),
    heading: short(80).min(1),
    body: paragraphs(6, 800),
  }),
  z.object({
    type: z.literal("offer"),
    heading: short(80).min(1),
    items: z
      .array(z.object({ name: short(60).min(1), blurb: short(240).default("") }))
      .min(1)
      .max(8),
  }),
  z.object({
    type: z.literal("hours"),
    heading: short(80).min(1),
    note: short(200).default(""),
  }),
  z.object({
    type: z.literal("contact"),
    heading: short(80).min(1),
    note: short(300).default(""),
  }),
  /**
   * The enquiry form: name, email, phone (optional) and a message, fixed.
   * What a visitor types lands in the workspace through `receiveSiteEnquiry`;
   * the section carries only the words around the form.
   */
  z.object({
    type: z.literal("form"),
    heading: short(80).min(1),
    note: short(300).default(""),
    /** The button; blank reads "Send". */
    buttonLabel: short(40).default(""),
    askPhone: z.boolean().default(true),
    /** Replaces the form once a message is sent; blank reads a standard thank-you. */
    thanks: short(240).default(""),
  }),
  z.object({
    type: z.literal("text"),
    heading: short(80).default(""),
    body: paragraphs(8, 800),
  }),
  z.object({
    type: z.literal("cta"),
    headline: short(120).min(1),
    cta: CtaSchema,
  }),
]);
export type Section = z.infer<typeof SectionSchema>;
export type SectionType = Section["type"];

export const PAGE_SECTIONS_MAX = 12;

export const PageContentSchema = z.object({
  /** The meta description; empty falls back to the site's tagline. */
  description: short(200).default(""),
  sections: z.array(SectionSchema).max(PAGE_SECTIONS_MAX).default([]),
});
export type PageContent = z.infer<typeof PageContentSchema>;

export const EMPTY_PAGE: PageContent = { description: "", sections: [] };

/**
 * What the contact and hours sections read live. Everything optional and
 * empty by default: a section with nothing to show renders nothing rather
 * than a placeholder a customer might try to call.
 */
export const SiteSettingsSchema = z.object({
  phone: short(40).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(120)]).default(""),
  /** Free text, line breaks kept: "17 Main St\nMount Vernon, OH 43050". */
  address: short(240).default(""),
  /** One line each: "Saturday 8–12, at the market". */
  hoursLines: z.array(short(80)).max(7).default([]),
});
export type SiteSettings = z.infer<typeof SiteSettingsSchema>;

export const EMPTY_SETTINGS: SiteSettings = {
  phone: "",
  email: "",
  address: "",
  hoursLines: [],
};

/** Parse what a row holds; a malformed blob degrades to empty rather than throwing at render. */
export function readPageContent(raw: unknown): PageContent {
  const parsed = PageContentSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_PAGE;
}

export function readSiteSettings(raw: unknown): SiteSettings {
  const parsed = SiteSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_SETTINGS;
}

/** A page as the renderer and the screen see it. */
export interface SitePageView {
  path: string;
  title: string;
  inNav: boolean;
  navOrder: number;
  content: PageContent;
}
