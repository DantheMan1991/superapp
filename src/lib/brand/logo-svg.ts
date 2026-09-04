import "server-only";
import path from "node:path";
import * as fontkit from "fontkit";
import type { Font } from "fontkit";
import type { LogoMark, LogoSpec, LogoWeight } from "./logo-spec";

/**
 * Draws a `LogoSpec` as SVG — paths only, from the Noto Sans TTFs the PDF
 * renderer already ships. No `<text>` element ever appears in the output, so
 * the file renders identically in a browser, in librsvg on Vercel (which has
 * no fonts installed) and in anything the website will use later.
 *
 * Units: one em of the main line is 100 SVG px. The drawing is laid out in
 * that space and the viewBox is fitted around it with a margin, so a
 * consumer can scale it to any size without knowing what is inside.
 */

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
const fonts = new Map<LogoWeight, Font>();

function fontFor(weight: LogoWeight): Font {
  let font = fonts.get(weight);
  if (!font) {
    const file = weight === "bold" ? "NotoSans-Bold.ttf" : "NotoSans-Regular.ttf";
    // fontkit may return a collection for .ttc; these are single-face TTFs.
    font = fontkit.openSync(path.join(FONT_DIR, file)) as Font;
    fonts.set(weight, font);
  }
  return font;
}

interface LaidText {
  /** Glyph outlines in font units, y up, each with its pen position. */
  glyphs: Array<{ d: string; x: number }>;
  /** Font units. */
  width: number;
  minY: number;
  maxY: number;
  minX: number;
  unitsPerEm: number;
}

function layoutText(text: string, weight: LogoWeight, trackingEm: number): LaidText {
  const font = fontFor(weight);
  const run = font.layout(text);
  const upm = font.unitsPerEm;
  const track = trackingEm * upm;
  const glyphs: LaidText["glyphs"] = [];
  let pen = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions[i];
    const x = pen + pos.xOffset;
    const d = glyph.path.toSVG();
    if (d) {
      glyphs.push({ d, x });
      const box = glyph.bbox;
      minX = Math.min(minX, x + box.minX);
      minY = Math.min(minY, box.minY + pos.yOffset);
      maxY = Math.max(maxY, box.maxY + pos.yOffset);
    }
    pen += pos.xAdvance + track;
  });
  if (glyphs.length === 0) {
    return { glyphs, width: 0, minY: 0, maxY: 0, minX: 0, unitsPerEm: upm };
  }
  return { glyphs, width: pen - track, minX, minY, maxY, unitsPerEm: upm };
}

/** A block of text placed on the canvas: its box in px and the paths. */
interface TextBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  svg: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Lay the text out at `size` px per em with its ink box's top-left at
 * (x, y). Returns the box so the caller can stack and centre blocks.
 */
function textBlock(
  text: string,
  weight: LogoWeight,
  trackingEm: number,
  size: number,
  color: string,
  x: number,
  y: number,
): TextBlock {
  const laid = layoutText(text, weight, trackingEm);
  const s = size / laid.unitsPerEm;
  const width = (laid.width - laid.minX) * s;
  const height = (laid.maxY - laid.minY) * s;
  // Baseline sits at y + maxY*s; the group flips the font's y-up space.
  const baseline = y + laid.maxY * s;
  const paths = laid.glyphs
    .map((g) => `<path transform="translate(${round(g.x - laid.minX)} 0)" d="${g.d}"/>`)
    .join("");
  const svg = `<g fill="${color}" transform="translate(${round(x)} ${round(baseline)}) scale(${round(s)} ${round(-s)})">${paths}</g>`;
  return { x, y, width, height, svg };
}

function markShape(mark: LogoMark, cx: number, cy: number, size: number, color: string): string {
  const r = size / 2;
  switch (mark) {
    case "circle":
      return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${color}"/>`;
    case "ring": {
      const stroke = size * 0.12;
      return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r - stroke / 2)}" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    }
    case "square":
      return `<rect x="${round(cx - r)}" y="${round(cy - r)}" width="${round(size)}" height="${round(size)}" fill="${color}"/>`;
    case "rounded":
      return `<rect x="${round(cx - r)}" y="${round(cy - r)}" width="${round(size)}" height="${round(size)}" rx="${round(size * 0.22)}" fill="${color}"/>`;
    case "hexagon": {
      // Flat-top hexagon inscribed in the circle of radius r.
      const pts = [0, 60, 120, 180, 240, 300].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return `${round(cx + r * Math.cos(a))},${round(cy + r * Math.sin(a))}`;
      });
      return `<polygon points="${pts.join(" ")}" fill="${color}"/>`;
    }
    case "diamond":
      return `<polygon points="${round(cx)},${round(cy - r)} ${round(cx + r)},${round(cy)} ${round(cx)},${round(cy + r)} ${round(cx - r)},${round(cy)}" fill="${color}"/>`;
    case "leaf": {
      // Two quadratic curves: pointed at top-right and bottom-left.
      const x0 = cx - r;
      const y0 = cy - r;
      const x1 = cx + r;
      const y1 = cy + r;
      return `<path d="M${round(x0)} ${round(y1)} Q${round(x0)} ${round(y0)} ${round(x1)} ${round(y0)} Q${round(x1)} ${round(y1)} ${round(x0)} ${round(y1)} Z" fill="${color}"/>`;
    }
    case "bar":
    case "none":
      return "";
  }
}

/** Initials centred in a mark, sized to the number of letters. */
function initialsInMark(spec: LogoSpec, cx: number, cy: number, size: number): string {
  const letters = spec.initials;
  if (!letters) return "";
  // The ring is hollow, so its letters take the mark colour rather than the
  // colour meant for text ON a filled mark.
  const color = spec.mark === "ring" ? spec.colors.mark : spec.colors.markText;
  // Three letters at 0.36 read small inside a ring, whose stroke eats into
  // the space; 0.42 fills it without touching the edge.
  const fontSize = size * (letters.length <= 1 ? 0.62 : letters.length === 2 ? 0.52 : 0.42);
  const probe = textBlock(letters, "bold", 0.02, fontSize, color, 0, 0);
  return textBlock(
    letters,
    "bold",
    0.02,
    fontSize,
    color,
    cx - probe.width / 2,
    cy - probe.height / 2,
  ).svg;
}

export interface RenderedLogo {
  svg: string;
  width: number;
  height: number;
}

const MARGIN = 16;

function cased(text: string, spec: LogoSpec): string {
  return spec.textCase === "upper" ? text.toUpperCase() : text;
}

/**
 * The spec as an SVG document with a fitted viewBox and explicit width and
 * height (rasterisers and `<img>` need them). Transparent background.
 */
export function renderLogoSvg(spec: LogoSpec): RenderedLogo {
  const parts: string[] = [];
  let width = 0;
  let height = 0;
  const line1 = cased(spec.line1, spec);
  const line2 = cased(spec.line2, spec);
  const { text: textColor, mark: markColor } = spec.colors;

  switch (spec.layout) {
    case "wordmark": {
      const t = textBlock(line1, spec.weight, spec.tracking, 100, textColor, MARGIN, MARGIN);
      parts.push(t.svg);
      width = t.width + MARGIN * 2;
      height = t.height + MARGIN * 2;
      if (spec.mark === "bar") {
        const barY = t.y + t.height + 14;
        parts.push(`<rect x="${round(t.x)}" y="${round(barY)}" width="${round(t.width)}" height="8" rx="4" fill="${markColor}"/>`);
        height = barY + 8 + MARGIN;
      }
      break;
    }
    case "stacked": {
      const t1 = textBlock(line1, spec.weight, spec.tracking, 100, textColor, MARGIN, MARGIN);
      // The second line is smaller and, if the first line was not already
      // spaced, spaced — a stacked lockup needs the lines to read as two
      // things, and size alone does not do that.
      const t2 = line2
        ? textBlock(line2, "regular", Math.max(spec.tracking, 0.16), 48, textColor, MARGIN, t1.y + t1.height + 18)
        : null;
      const w = Math.max(t1.width, t2?.width ?? 0);
      const centre = (b: TextBlock) => `<g transform="translate(${round((w - b.width) / 2)} 0)">${b.svg}</g>`;
      parts.push(centre(t1));
      if (t2) parts.push(centre(t2));
      width = w + MARGIN * 2;
      height = (t2 ? t2.y + t2.height : t1.y + t1.height) + MARGIN;
      if (spec.mark === "bar") {
        const barY = height - MARGIN + 14;
        parts.push(`<rect x="${MARGIN}" y="${round(barY)}" width="${round(w)}" height="8" rx="4" fill="${markColor}"/>`);
        height = barY + 8 + MARGIN;
      }
      break;
    }
    case "monogram": {
      const size = 160;
      const cx = MARGIN + size / 2;
      const cy = MARGIN + size / 2;
      parts.push(markShape(spec.mark, cx, cy, size, markColor));
      parts.push(initialsInMark(spec, cx, cy, size));
      width = size + MARGIN * 2;
      height = size + MARGIN * 2;
      break;
    }
    case "mark-left": {
      const size = 120;
      const gap = 26;
      const t1 = textBlock(line1, spec.weight, spec.tracking, 80, textColor, MARGIN + size + gap, 0);
      const t2 = line2
        ? textBlock(line2, "regular", Math.max(spec.tracking, 0.1), 36, textColor, MARGIN + size + gap, 0)
        : null;
      const textHeight = t1.height + (t2 ? 12 + t2.height : 0);
      const cy = MARGIN + Math.max(size, textHeight) / 2;
      const top = cy - textHeight / 2;
      const b1 = textBlock(line1, spec.weight, spec.tracking, 80, textColor, MARGIN + size + gap, top);
      parts.push(markShape(spec.mark, MARGIN + size / 2, cy, size, markColor));
      parts.push(initialsInMark(spec, MARGIN + size / 2, cy, size));
      parts.push(b1.svg);
      if (t2) {
        parts.push(textBlock(line2, "regular", Math.max(spec.tracking, 0.1), 36, textColor, MARGIN + size + gap, top + t1.height + 12).svg);
      }
      width = MARGIN + size + gap + Math.max(t1.width, t2?.width ?? 0) + MARGIN;
      height = MARGIN * 2 + Math.max(size, textHeight);
      break;
    }
    case "mark-above": {
      const size = 120;
      const t1 = textBlock(line1, spec.weight, spec.tracking, 80, textColor, 0, MARGIN + size + 20);
      const w = Math.max(size, t1.width);
      const cx = MARGIN + w / 2;
      parts.push(markShape(spec.mark, cx, MARGIN + size / 2, size, markColor));
      parts.push(initialsInMark(spec, cx, MARGIN + size / 2, size));
      parts.push(`<g transform="translate(${round(MARGIN + (w - t1.width) / 2)} 0)">${t1.svg}</g>`);
      width = w + MARGIN * 2;
      height = t1.y + t1.height + MARGIN;
      break;
    }
  }

  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    parts.filter(Boolean).join("") +
    `</svg>`;
  return { svg, width: w, height: h };
}
