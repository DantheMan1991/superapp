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

/**
 * A question the business adds to its enquiry form. `id` is made once and
 * never changes, so a renamed question keeps its answers' key; the label is
 * what the visitor reads and what the answer is filed under.
 */
export const FORM_FIELDS_MAX = 6;
export const FormFieldKindSchema = z.enum(["text", "long", "choice", "yesno"]);
export type FormFieldKind = z.infer<typeof FormFieldKindSchema>;
export const FormFieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{4,12}$/),
  label: short(80).min(1),
  kind: FormFieldKindSchema,
  required: z.boolean().default(false),
  /** For `choice`: the options, in order. Ignored by the other kinds. */
  options: z.array(short(60).min(1)).max(12).default([]),
});
export type FormField = z.infer<typeof FormFieldSchema>;

/**
 * A photo placed in a section: the library row it points at, and what it
 * shows for people who cannot see it. The library holds the pixels; the
 * section holds the meaning, so one photo can be placed twice with
 * different words. A row that no longer exists renders as no photo.
 */
export const ImageRefSchema = z.object({
  id: z.string().uuid(),
  alt: short(160).default(""),
});
export type ImageRef = z.infer<typeof ImageRefSchema>;

/** Photos a gallery holds. A page is not an album. */
export const GALLERY_ITEMS_MAX = 12;

/**
 * The icons a card may carry: chosen to suit any trade (a core module
 * speaks no industry), drawn by the renderer from lucide. The empty string
 * is "no icon".
 */
export const CARD_ICON_NAMES = [
  "award",
  "calendar",
  "check",
  "clock",
  "credit-card",
  "gift",
  "hammer",
  "heart",
  "home",
  "leaf",
  "mail",
  "map-pin",
  "package",
  "phone",
  "shield-check",
  "shopping-bag",
  "sparkles",
  "star",
  "sun",
  "tag",
  "thumbs-up",
  "truck",
  "users",
  "wrench",
] as const;
export type CardIconName = (typeof CARD_ICON_NAMES)[number];

/** Cards a Columns section holds: four rows of three is a long page already. */
export const CARDS_MAX = 12;

/**
 * One card in a Columns section: a photo or an icon on top, a heading, a
 * few lines and a button, any of them blank. `id` is made once in the
 * editor so a dragged card keeps its place in React's eyes.
 */
export const CardSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{4,12}$/),
  image: ImageRefSchema.nullable().default(null),
  icon: z
    .string()
    .refine((v) => v === "" || (CARD_ICON_NAMES as readonly string[]).includes(v), "not an icon")
    .default(""),
  heading: short(80).default(""),
  body: paragraphs(4, 400),
  cta: CtaSchema.nullable().default(null),
});
export type Card = z.infer<typeof CardSchema>;

export const SectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hero"),
    headline: short(120).min(1),
    subheadline: short(240).default(""),
    cta: CtaSchema.nullable().default(null),
    /** Beside the headline, on the right. */
    image: ImageRefSchema.nullable().default(null),
  }),
  z.object({
    type: z.literal("about"),
    heading: short(80).min(1),
    body: paragraphs(6, 800),
    /** Beside the paragraphs. */
    image: ImageRefSchema.nullable().default(null),
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
    /** The business's own questions, asked between the phone and the message. */
    fields: z.array(FormFieldSchema).max(FORM_FIELDS_MAX).default([]),
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
  z.object({
    type: z.literal("image"),
    image: ImageRefSchema.nullable().default(null),
    caption: short(240).default(""),
    /** `inset` sits in the text column; `wide` spans the page. */
    layout: z.enum(["inset", "wide"]).default("inset"),
  }),
  z.object({
    type: z.literal("gallery"),
    heading: short(80).default(""),
    items: z
      .array(z.object({ image: ImageRefSchema, caption: short(120).default("") }))
      .max(GALLERY_ITEMS_MAX)
      .default([]),
    /** Photos per row on a wide screen; a phone always shows two. */
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
  }),
  z.object({
    type: z.literal("slideshow"),
    heading: short(80).default(""),
    items: z
      .array(z.object({ image: ImageRefSchema, caption: short(120).default("") }))
      .max(GALLERY_ITEMS_MAX)
      .default([]),
    /** Seconds between photos; 0 moves only when a visitor presses an arrow. */
    seconds: z.number().int().min(0).max(30).default(6),
    layout: z.enum(["inset", "wide"]).default("wide"),
  }),
  z.object({
    type: z.literal("columns"),
    heading: short(80).default(""),
    intro: short(300).default(""),
    /** Per row on a wide screen; a phone stacks them. */
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    /** Read only with two columns: which side is wider. */
    widths: z.enum(["equal", "wide-left", "wide-right"]).default("equal"),
    /** `cards` puts each in a white panel on a tinted band; `plain` stacks them on the page. */
    look: z.enum(["cards", "plain"]).default("cards"),
    cards: z.array(CardSchema).max(CARDS_MAX).default([]),
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
