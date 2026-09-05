import type { CSSProperties } from "react";
import type { SectionStyle, SectionType } from "./schema";

/**
 * Resolving a section's layout and look — pure.
 *
 * Every choice an owner makes is a PRESET, never a pixel: a width is one
 * of three columns, spacing one of three amounts, a background one of five
 * kinds. `default` on any of them means "as this kind of section is
 * designed", which `SECTION_DEFAULTS` spells out, so a page saved before
 * the presets existed reads exactly as it did. The renderer turns the
 * resolved values into classes and a tone, and the tone is what keeps the
 * words readable on a dark band or a photo.
 */
export type Background = "none" | "tint" | "brand" | "dark" | "photo";
export type Width = "text" | "page" | "full";
export type Spacing = "tight" | "normal" | "airy";
export type Align = "left" | "center";

export interface SectionDefaults {
  background: Background;
  width: Width;
  spacing: Spacing;
}

/** What each kind looks like when the owner has said nothing. */
export const SECTION_DEFAULTS: Record<SectionType, SectionDefaults> = {
  hero: { background: "none", width: "page", spacing: "normal" },
  offer: { background: "tint", width: "page", spacing: "normal" },
  about: { background: "none", width: "text", spacing: "normal" },
  text: { background: "none", width: "text", spacing: "normal" },
  cta: { background: "brand", width: "page", spacing: "tight" },
  contact: { background: "none", width: "text", spacing: "normal" },
  hours: { background: "none", width: "text", spacing: "normal" },
  form: { background: "none", width: "text", spacing: "normal" },
  booking: { background: "none", width: "text", spacing: "normal" },
  image: { background: "none", width: "text", spacing: "tight" },
  gallery: { background: "none", width: "page", spacing: "normal" },
  slideshow: { background: "none", width: "page", spacing: "tight" },
  columns: { background: "tint", width: "page", spacing: "normal" },
};

export interface ResolvedStyle {
  background: Background;
  width: Width;
  spacing: Spacing;
  align: Align;
  /** White words: a dark band or a photo. The brand band has its own foreground. */
  onDark: boolean;
}

/**
 * The owner's choices over the kind's defaults, with the renderer's own
 * adjustments last (an about section with a photo needs the page column;
 * plain columns have no band).
 */
export function resolveStyle(
  type: SectionType,
  style: SectionStyle | undefined,
  adjust: Partial<SectionDefaults> = {},
): ResolvedStyle {
  const base = { ...SECTION_DEFAULTS[type], ...adjust };
  const pick = <T extends string>(chosen: T | "default" | undefined, fallback: T): T =>
    chosen === undefined || chosen === "default" ? fallback : chosen;
  const background = pick<Background>(style?.background, base.background);
  return {
    background,
    width: pick<Width>(style?.width, base.width),
    spacing: pick<Spacing>(style?.spacing, base.spacing),
    align: pick<Align>(style?.align, "left"),
    onDark: background === "dark" || background === "photo",
  };
}

export function widthClass(width: Width): string {
  switch (width) {
    case "text":
      return "mx-auto max-w-3xl px-6";
    case "page":
      return "mx-auto max-w-5xl px-6";
    case "full":
      return "mx-auto max-w-7xl px-6";
  }
}

export function spacingClass(spacing: Spacing): string {
  switch (spacing) {
    case "tight":
      return "py-8";
    case "normal":
      return "py-14";
    case "airy":
      return "py-24";
  }
}

/** The hero has its own scale: it is the first thing on the page. */
export function heroHeightClass(height: "compact" | "standard" | "tall" | undefined): string {
  switch (height ?? "standard") {
    case "compact":
      return "py-10 sm:py-14";
    case "standard":
      return "py-16 sm:py-24";
    case "tall":
      return "py-24 sm:py-40";
  }
}

/** The outer band. `photo` is drawn by the renderer over this base. */
export function backgroundClass(background: Background): { className: string; style?: CSSProperties } {
  switch (background) {
    case "none":
      return { className: "" };
    case "tint":
      return { className: "border-t border-neutral-100 bg-neutral-50" };
    case "brand":
      return { className: "", style: { backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" } };
    case "dark":
      return { className: "bg-neutral-900 text-white" };
    case "photo":
      return { className: "relative bg-neutral-900 text-white" };
  }
}

/**
 * The words on a background: a colour for headings and links, and classes
 * for body and quieter text. Light backgrounds use the brand colour for
 * headings; a dark band or a photo uses white; the brand band uses its own
 * foreground and lets quieter text fade instead of changing colour.
 */
export interface Tone {
  heading: string;
  body: string;
  muted: string;
  faint: string;
  /** A button on this background: the brand colour, or white when the brand colour is the background. */
  button: CSSProperties;
}

export const LIGHT_TONE: Tone = {
  heading: "var(--site-primary)",
  body: "text-neutral-700",
  muted: "text-neutral-600",
  faint: "text-neutral-500",
  button: { backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" },
};

export function toneFor(background: Background): Tone {
  switch (background) {
    case "dark":
    case "photo":
      return {
        heading: "#ffffff",
        body: "text-neutral-100",
        muted: "text-neutral-200",
        faint: "text-neutral-300",
        button: { backgroundColor: "#ffffff", color: "#171717" },
      };
    case "brand":
      return {
        heading: "var(--site-primary-fg)",
        body: "",
        muted: "opacity-85",
        faint: "opacity-70",
        button: { backgroundColor: "#ffffff", color: "#171717" },
      };
    default:
      return LIGHT_TONE;
  }
}
