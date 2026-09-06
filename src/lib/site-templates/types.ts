import type { BrandLook, ButtonShape, FontPairing } from "@/lib/brand/looks";
import type { FooterColumn, PageContent, Section } from "@/lib/sites/schema";

/**
 * A site template — Marketing slice 15,
 * [ADR 0030](../../../docs/decisions/0030-a-site-template-is-data-an-industry-contributes.md).
 *
 * DATA, never components: the pages a business of one kind starts with,
 * each a list of typed sections carrying STARTER WORDS that read on their
 * own, a frame (the header's button, the footer's columns), a look the
 * template suggests, and picture slots the platform fills with its own
 * starter scenes. The core assembles a template against what the tenant
 * has switched on (`core.ts`) and the writer fills every word slot from the
 * brief; an industry contributes its template through `registry.ts`, the
 * one file in the chain that names an industry, and the `general` template
 * is the platform's own.
 *
 * Starter words may carry `{name}`, `{tagline}` and `{what}` (the kind of
 * business, lower case); the assembler fills them, so a template never
 * ships a sentence that is untrue of the business it lands on.
 */
export type Needs =
  /** Only while Scheduling is on: a booking or an events section. */
  | "scheduling"
  /** Only when the site's details carry hours. */
  | "hours";

/** A template's section: a real section, with a condition on its being there. */
export type TemplateSection = Section & { needs?: Needs };

export interface TemplatePage {
  path: string;
  title: string;
  inNav: boolean;
  /** The starter meta description; the writer rewrites it. */
  description: string;
  sections: TemplateSection[];
}

/** The platform's starter scenes (`src/lib/sites/starters.ts`): drawn in the brand's colours, text-free, replaceable. */
export const STARTER_SCENES = ["hills", "furrows", "dawn"] as const;
export type StarterScene = (typeof STARTER_SCENES)[number];

/** Where a starter picture goes: on a section as its photo, or behind it as its background. */
export interface TemplatePicture {
  /** `"<path>#<index>"`, the section's place in the TEMPLATE page. */
  at: string;
  where: "image" | "background";
  scene: StarterScene;
  /** What is in the picture, for people who cannot see it; blank for a background. */
  alt: string;
}

export interface SiteTemplate {
  slug: string;
  name: string;
  /** The industry profile it is for, or null for the general one. */
  industry: string | null;
  description: string;
  /** The look the template suggests, applied to the brand kit only where nobody has chosen. */
  look?: { look?: BrandLook; fontPairing?: FontPairing; buttonShape?: ButtonShape };
  /** The frame every page shares, set on the site at build; the owner's later changes win. */
  frame: {
    headerButton: { label: string; href: string } | null;
    footerColumns: FooterColumn[];
    footerNote: string;
  };
  pages: TemplatePage[];
  pictures: TemplatePicture[];
  /** What the writer is told about this kind of business and this template, one line each. */
  writerNotes: string[];
}

/** A page as it lands in the table: the template's page with its words filled and its conditions applied. */
export interface AssembledPage {
  path: string;
  title: string;
  navOrder: number;
  inNav: boolean;
  content: PageContent;
}
