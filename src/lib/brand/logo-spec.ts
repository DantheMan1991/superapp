import { z } from "zod";
import {
  foregroundOn,
  normalizeHexColor,
  readableOnWhite,
  type HexColor,
} from "./core";

/**
 * A generated logo is a SPEC, not a picture — pure, no I/O.
 *
 * The kit draws wordmarks and monograms from a fixed catalogue: a layout, the
 * words, a weight, a case, letter-spacing, an optional simple mark and three
 * colours. The model's whole job is to choose well from that catalogue for
 * one business; the renderer (`logo-svg.ts`) turns the choice into paths
 * from the shipped Noto Sans, so the result is identical on every machine and
 * needs no font installed anywhere. This is the "rules beat AI" shape: the
 * assistant picks, the code draws, and nothing it says can put a script or
 * an unknown font into the file.
 *
 * Honest naming: an "AI logo" here is a wordmark or a monogram. The product
 * copy says so.
 */

export const LOGO_LAYOUTS = [
  /** The name on one line. */
  "wordmark",
  /** Two lines, the second smaller and spaced. */
  "stacked",
  /** Initials inside a mark, no name. */
  "monogram",
  /** Initials in a mark, the name beside it. */
  "mark-left",
  /** A mark above the name. */
  "mark-above",
] as const;
export type LogoLayout = (typeof LOGO_LAYOUTS)[number];

export const LOGO_MARKS = [
  "none",
  "circle",
  "ring",
  "square",
  "rounded",
  "hexagon",
  "diamond",
  "leaf",
  /** A rule under the words, in the mark colour. Wordmark and stacked only. */
  "bar",
] as const;
export type LogoMark = (typeof LOGO_MARKS)[number];

export const LOGO_WEIGHTS = ["regular", "bold"] as const;
export type LogoWeight = (typeof LOGO_WEIGHTS)[number];

export const LOGO_CASES = ["upper", "title"] as const;
export type LogoCase = (typeof LOGO_CASES)[number];

export const LOGO_LINE_MAX = 28;
export const LOGO_TRACKING_MAX = 0.3;

/** Where a mark holds initials, or a bar underlines the words. */
export const MARKS_WITH_INITIALS: ReadonlySet<LogoMark> = new Set([
  "circle",
  "ring",
  "square",
  "rounded",
  "hexagon",
  "diamond",
  "leaf",
]);

export interface LogoSpec {
  layout: LogoLayout;
  line1: string;
  line2: string;
  initials: string;
  weight: LogoWeight;
  textCase: LogoCase;
  /** Letter-spacing in em, 0 … LOGO_TRACKING_MAX. */
  tracking: number;
  mark: LogoMark;
  colors: { text: HexColor; mark: HexColor; markText: HexColor };
  /** One line from whoever proposed it; shown under the candidate. */
  rationale: string;
}

const hex = z
  .string()
  .transform((s, ctx) => {
    const normalized = normalizeHexColor(s);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not a hex colour" });
      return z.NEVER;
    }
    return normalized;
  });

const line = z.string().trim().max(LOGO_LINE_MAX);

/**
 * Parses whatever arrives — from the model or from a client — into a spec.
 * Lenient where a stray field would be harmless (an unknown key, a missing
 * rationale), strict where the renderer would otherwise have to guess (an
 * unknown layout, a non-hex colour, letter-spacing off the scale).
 */
export const LogoSpecSchema = z
  .object({
    layout: z.enum(LOGO_LAYOUTS),
    line1: line.min(1),
    line2: line.default(""),
    initials: z.string().trim().max(3).default(""),
    weight: z.enum(LOGO_WEIGHTS).default("bold"),
    textCase: z.enum(LOGO_CASES).default("title"),
    tracking: z.number().min(0).max(LOGO_TRACKING_MAX).default(0),
    mark: z.enum(LOGO_MARKS).default("none"),
    colors: z.object({ text: hex, mark: hex, markText: hex }),
    rationale: z.string().trim().max(160).default(""),
  })
  .transform((spec) => normalizeSpec(spec));

/**
 * The rules that make every spec drawable, applied once so the validator and
 * the renderer cannot disagree:
 *
 * - a layout that needs initials gets them from the words when none were given;
 * - a mark layout with no mark becomes the plain layout it would have drawn;
 * - a monogram with no mark gets a circle — initials floating alone read as a
 *   typo, not a logo;
 * - `bar` belongs under words only;
 * - initials are always upper-case, at most three letters.
 */
export function normalizeSpec(spec: LogoSpec): LogoSpec {
  let { layout, mark } = spec;
  const initials = (spec.initials || initialsFor(`${spec.line1} ${spec.line2}`))
    .toUpperCase()
    .slice(0, 3);
  if (layout === "monogram" && !MARKS_WITH_INITIALS.has(mark)) mark = "circle";
  if ((layout === "mark-left" || layout === "mark-above") && !MARKS_WITH_INITIALS.has(mark)) {
    layout = spec.line2 ? "stacked" : "wordmark";
    mark = mark === "bar" ? "bar" : "none";
  }
  if ((layout === "wordmark" || layout === "stacked") && mark !== "none" && mark !== "bar") {
    // A shape with nothing in it beside the words is a mark-left in disguise.
    layout = "mark-left";
  }
  return { ...spec, layout, mark, initials };
}

/**
 * "Oak Row Farm Co." → "OR", "Hilltop" → "HI", "The Corner Bakery" → "CB".
 * Up to three, from the words that carry meaning; a one-word name gives its
 * first two letters, which reads better than a lone capital.
 */
export function initialsFor(name: string): string {
  const STOP = new Set(["the", "and", "of", "&", "co", "co.", "llc", "inc", "inc.", "ltd", "ltd."]);
  const words = name
    .split(/[\s\-_/]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !STOP.has(w.toLowerCase()));
  const letters = words
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").charAt(0))
    .filter(Boolean)
    .slice(0, 3);
  if (letters.length >= 2) return letters.join("").toUpperCase();
  const single = (words[0] ?? name).replace(/[^\p{L}\p{N}]/gu, "");
  return single.slice(0, 2).toUpperCase() || "??";
}

/** One drawn candidate, as the screen receives it. */
export interface LogoCandidate {
  key: string;
  spec: LogoSpec;
  svg: string;
  width: number;
  height: number;
}

/** What the brief gives the proposer: the facts, never the file. */
export interface LogoBrief {
  name: string;
  tagline: string;
  /** The industry profile's display name, or null for a general business. */
  industry: string | null;
  primaryColor: HexColor | null;
  accentColor: HexColor | null;
  initials: string;
}

/**
 * A palette for a business that has not chosen colours yet. Every one of
 * these reads on white as text (≥ 4.5:1), so a candidate that uses one for
 * the words is legible without a fallback.
 */
export const DEFAULT_LOGO_PALETTE: readonly HexColor[] = [
  "#1f6f5f", // green
  "#8b1e3f", // wine
  "#1e3a8a", // navy
  "#b45309", // amber
  "#374151", // slate
  "#0f766e", // teal
  "#7c2d12", // rust
  "#4c1d95", // violet
];

export const LOGO_INK: HexColor = "#1f2937";

/** The colours a candidate starts from, given what the kit already holds. */
export function paletteFor(brief: LogoBrief): {
  text: HexColor;
  mark: HexColor;
  markText: HexColor;
} {
  const mark = brief.accentColor ?? brief.primaryColor ?? DEFAULT_LOGO_PALETTE[0];
  const text = brief.primaryColor
    ? readableOnWhite(brief.primaryColor, LOGO_INK)
    : LOGO_INK;
  return { text, mark, markText: foregroundOn(mark) };
}
