import { RESERVED_PAGE_PATHS } from "./slug";
import type { Section, SectionType } from "./schema";

/**
 * What the editor needs that is not I/O: the section catalogue with its
 * words, a fresh section of each kind, one-line summaries for the list, the
 * page-path rules, paragraph splitting, list moves and history pruning.
 * Pure, and shared by the client editor and the server actions.
 */

export const SECTION_TYPES: ReadonlyArray<{
  type: SectionType;
  label: string;
  hint: string;
}> = [
  { type: "hero", label: "Big headline", hint: "The first thing on a page: a headline, a line under it and a button." },
  { type: "offer", label: "What you offer", hint: "A grid of three to eight things, each with a name and a line." },
  { type: "about", label: "About", hint: "A heading and a few paragraphs." },
  { type: "text", label: "Text", hint: "Paragraphs, with or without a heading." },
  { type: "cta", label: "Call to action", hint: "A band in your color with one line and a button." },
  { type: "contact", label: "Contact details", hint: "Your phone, email and address, from the site's details." },
  { type: "hours", label: "Hours", hint: "Your hours, from the site's details." },
  { type: "form", label: "Enquiry form", hint: "Name, email, phone and a message. Each one lands in your workspace as a contact and a follow-up, and is emailed to you." },
  { type: "image", label: "Photo", hint: "One photo from your site's library, with a caption if you like." },
];

export function sectionLabel(type: SectionType): string {
  return SECTION_TYPES.find((s) => s.type === type)?.label ?? type;
}

/** A section with enough in it to draw, ready to be edited. */
export function newSection(type: SectionType): Section {
  switch (type) {
    case "hero":
      return { type, headline: "A headline for this page", subheadline: "", cta: { label: "Get in touch", href: "/contact" }, image: null };
    case "offer":
      return { type, heading: "What we offer", items: [{ name: "Something we do", blurb: "" }] };
    case "about":
      return { type, heading: "About us", body: ["A paragraph about the business."], image: null };
    case "text":
      return { type, heading: "", body: ["A paragraph."] };
    case "cta":
      return { type, headline: "Ready when you are.", cta: { label: "Contact us", href: "/contact" } };
    case "contact":
      return { type, heading: "Get in touch", note: "" };
    case "hours":
      return { type, heading: "Hours", note: "" };
    case "form":
      return { type, heading: "Send us a message", note: "", buttonLabel: "Send", askPhone: true, thanks: "Thanks. We'll be in touch.", fields: [] };
    case "image":
      return { type, image: null, caption: "", layout: "inset" };
  }
}

/** The line the editor's list shows under a section's label. */
export function sectionSummary(section: Section): string {
  let text = "";
  switch (section.type) {
    case "hero":
    case "cta":
      text = section.headline;
      break;
    case "offer":
      text = `${section.heading}: ${section.items.map((i) => i.name).join(", ")}`;
      break;
    case "about":
    case "text":
      text = section.heading || section.body[0] || "";
      break;
    case "contact":
    case "hours":
    case "form":
      text = section.heading;
      break;
    case "image":
      text = section.caption || (section.image ? "A photo" : "No photo chosen yet");
      break;
  }
  text = text.trim();
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
}

export type PagePathCheck =
  | { ok: true; path: string }
  | { ok: false; reason: "empty" | "shape" | "reserved" | "home" };

/**
 * "About Us" → `/about-us`; "/Our Team/" → `/our-team`. The home page's
 * path is `/` and is never given to another page.
 */
export function normalizePagePath(input: string): PagePathCheck {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/(^-+|-+$)/g, "")
    .replace(/\/-+|-+\//g, "/")
    .replace(/^\/|\/$/g, "");
  if (cleaned === "") return { ok: false, reason: input.trim() === "/" ? "home" : "empty" };
  const path = `/${cleaned}`;
  if (!/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)$/.test(path)) return { ok: false, reason: "shape" };
  if (RESERVED_PAGE_PATHS.has(path)) return { ok: false, reason: "reserved" };
  return { ok: true, path };
}

export function pagePathReasonMessage(reason: Exclude<PagePathCheck, { ok: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "Give the page an address, like /services.";
    case "shape":
      return "Use letters, numbers and hyphens, with a slash between parts.";
    case "reserved":
      return "That address is set aside. Choose another.";
    case "home":
      return "The home page already has that address.";
  }
}

/** Blank lines separate paragraphs; single line breaks are kept inside one. */
export function textToParagraphs(text: string, max = 8): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function paragraphsToText(paragraphs: string[]): string {
  return paragraphs.join("\n\n");
}

/** A list with one item moved, for drag-to-reorder and the arrow buttons. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export const PAGE_VERSIONS_KEEP = 30;

/** The ids to delete so that only the newest `keep` remain. */
export function versionIdsToPrune(
  versions: ReadonlyArray<{ id: string; createdAt: Date }>,
  keep = PAGE_VERSIONS_KEEP,
): string[] {
  return [...versions]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(keep)
    .map((v) => v.id);
}
