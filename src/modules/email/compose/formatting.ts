/**
 * What the composer's toolbar can produce, as data.
 *
 * THIS FILE IS THE REASON COLOURS AND FONTS ARE SAFE TO OFFER AT ALL.
 *
 * `compose/html.ts` used to strip the `style` attribute wholesale, and its
 * header explains why: the write path has no sandbox behind it, so hidden text,
 * white-on-white and `position: fixed` would leave our origin under the user's
 * own From header. Adding a colour picker naively means opening that attribute
 * back up, and then the sanitizer has to *parse CSS* and decide which
 * declarations are hostile — which is the losing side of that problem.
 *
 * Looking at what a mature composer actually offers settles it. Every style
 * feature is a **fixed enumeration**, never free input: a handful of fonts, four
 * named sizes, a palette of swatches, three alignments. So the sanitizer never
 * parses CSS. It matches whole declarations against the set generated from the
 * tables below — the same tables the toolbar builds its menus from.
 *
 * That makes the guarantee structural rather than diligent: **the toolbar can
 * only emit what the sanitizer accepts, because both read this file.** Adding a
 * swatch adds it to both at once, and a declaration nobody put in a table here
 * cannot survive no matter who sends it.
 *
 * Pure, free of `server-only`, shared by a client component and a server one.
 */

export interface FontChoice {
  /** Stable id, used in the DOM and never shown. */
  id: string;
  label: string;
  /** The stack that lands in the message. */
  css: string;
}

/**
 * Web-safe stacks only. A font the recipient does not have falls back to the
 * generic at the end of the stack, so the message stays readable — which is why
 * every stack ends in `sans-serif`, `serif` or `monospace`.
 */
export const FONTS: readonly FontChoice[] = [
  { id: "sans", label: "Sans Serif", css: "Arial, Helvetica, sans-serif" },
  { id: "serif", label: "Serif", css: "'Times New Roman', Times, serif" },
  { id: "mono", label: "Fixed Width", css: "'Courier New', Courier, monospace" },
  { id: "wide", label: "Wide", css: "'Trebuchet MS', Verdana, sans-serif" },
  { id: "narrow", label: "Narrow", css: "'Arial Narrow', Arial, sans-serif" },
  { id: "garamond", label: "Garamond", css: "Garamond, Baskerville, serif" },
  { id: "georgia", label: "Georgia", css: "Georgia, serif" },
  { id: "tahoma", label: "Tahoma", css: "Tahoma, Geneva, sans-serif" },
  { id: "verdana", label: "Verdana", css: "Verdana, Geneva, sans-serif" },
] as const;

export interface SizeChoice {
  id: string;
  label: string;
  /**
   * Relative, never absolute. A message that hardcodes 11px overrides the
   * reader's own text size, which is somebody's accessibility setting rather
   * than a preference to override.
   */
  css: string;
  /**
   * `execCommand("fontSize")` takes 1–7 and nothing else. The browser emits
   * `<font size="n">`, which the sanitizer maps back to the `css` above — see
   * `html.ts`. This is the bridge between a deprecated API and a modern message.
   */
  legacy: number;
}

export const SIZES: readonly SizeChoice[] = [
  { id: "small", label: "Small", css: "0.8em", legacy: 2 },
  { id: "normal", label: "Normal", css: "1em", legacy: 3 },
  { id: "large", label: "Large", css: "1.4em", legacy: 5 },
  { id: "huge", label: "Huge", css: "2em", legacy: 7 },
] as const;

/** Blocks can be aligned; `justify` is deliberately absent (see below). */
export const ALIGNMENTS = ["left", "center", "right"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/**
 * `justify` is not offered. Justified text in an email is rendered by clients
 * that mostly ignore hyphenation, so it produces rivers of whitespace on the
 * narrow columns mail is actually read in, and it is measurably worse for
 * dyslexic readers. One fewer button, nothing lost.
 */

/** How far one indent step moves a block, and how many steps are allowed. */
export const INDENT_STEP_EM = 2.5;
export const MAX_INDENT = 6;

/**
 * The palette.
 *
 * Deliberately a small, legible set rather than a wall of swatches: every extra
 * row is another value the sanitizer must accept, and nobody has ever needed
 * eighty shades to write to a customer. Greys first, then hues at four
 * lightnesses.
 *
 * These are OUR values, chosen for contrast on white, not copied from anywhere.
 */
export const GREYS = [
  "#000000", "#434343", "#666666", "#999999",
  "#b7b7b7", "#d9d9d9", "#efefef", "#ffffff",
] as const;

export const HUES = [
  // dark, mid, light, pale — one column per hue
  ["#5b0f00", "#a61c00", "#cc4125", "#e6b8af"], // red
  ["#7f6000", "#bf9000", "#f1c232", "#ffe599"], // amber
  ["#274e13", "#38761d", "#6aa84f", "#b6d7a8"], // green
  ["#0c343d", "#134f5c", "#45818e", "#a2c4c9"], // teal
  ["#1c4587", "#1155cc", "#3d85c6", "#9fc5e8"], // blue
  ["#20124d", "#351c75", "#674ea7", "#b4a7d6"], // purple
  ["#4c1130", "#741b47", "#a64d79", "#d5a6bd"], // magenta
] as const;

/** Every colour the pickers offer, flattened. Both pickers use the same set. */
export const PALETTE: readonly string[] = [...GREYS, ...HUES.flat()];

/**
 * Normalize a colour to lowercase `#rrggbb`.
 *
 * THIS EXISTS BECAUSE THE BROWSER REWRITES WHAT WE ASKED FOR. `execCommand`
 * is handed `#cc4125` and the DOM comes back holding `rgb(204, 65, 37)` — so a
 * sanitizer comparing strings against the palette would reject every colour the
 * toolbar just applied, and the feature would appear to do nothing.
 *
 * Returns null for anything it cannot read, which is the fail-closed direction:
 * an unparseable colour is dropped rather than passed through.
 */
export function normalizeColor(value: string): string | null {
  const raw = value.trim().toLowerCase();

  const rgb = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.%]+)\s*)?\)$/.exec(raw);
  if (rgb) {
    // A translucent colour is refused rather than flattened. Alpha is how text
    // is made almost-invisible without ever naming a colour that looks wrong,
    // and nothing in the palette produces it.
    if (rgb[4] !== undefined && rgb[4] !== "1" && rgb[4] !== "100%") return null;
    const parts = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n));
    if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    return `#${parts.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(raw);
  if (!hex) return null;
  const body = hex[1];
  // #abc and #aabbcc are the same colour; the palette only lists the long form.
  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
    : `#${body}`;
}

/**
 * Every `property:value` pair the toolbar can produce.
 *
 * Built from the tables above, so it cannot drift from them. The sanitizer keeps
 * a declaration if and only if it is in here.
 */
export const ALLOWED_DECLARATIONS: ReadonlySet<string> = new Set([
  ...FONTS.map((f) => `font-family:${f.css}`),
  ...SIZES.map((s) => `font-size:${s.css}`),
  ...PALETTE.map((c) => `color:${c}`),
  ...PALETTE.map((c) => `background-color:${c}`),
  ...ALIGNMENTS.map((a) => `text-align:${a}`),
  ...Array.from(
    { length: MAX_INDENT },
    (_, i) => `margin-left:${(i + 1) * INDENT_STEP_EM}em`,
  ),
]);

/**
 * Filter a `style` attribute down to declarations the toolbar could have made.
 *
 * Anything unrecognized is DROPPED, not repaired — the whole point is that this
 * function never has to understand CSS, only recognize it. Returns `""` when
 * nothing survives, which the caller turns into no attribute at all.
 */
export function sanitizeStyle(style: string): string {
  const kept: string[] = [];
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim().toLowerCase();
    if (property.length === 0 || value.length === 0) continue;

    // `!important` on an allowed declaration is still an allowed declaration,
    // and stripping it is simpler than deciding what it means in a mail client.
    value = value.replace(/\s*!\s*important$/, "");

    if (property === "color" || property === "background-color") {
      const hex = normalizeColor(value);
      if (hex && ALLOWED_DECLARATIONS.has(`${property}:${hex}`)) {
        kept.push(`${property}:${hex}`);
      }
      continue;
    }

    // Font stacks come back from the DOM with quoting and spacing of the
    // browser's choosing — `"Courier New", courier, monospace` for what we sent
    // as `'Courier New', Courier, monospace`. Compared on a normalized form so
    // the round trip survives.
    if (property === "font-family") {
      const normalized = normalizeFontStack(value);
      const match = FONTS.find((f) => normalizeFontStack(f.css) === normalized);
      if (match) kept.push(`font-family:${match.css}`);
      continue;
    }

    if (ALLOWED_DECLARATIONS.has(`${property}:${value}`)) {
      kept.push(`${property}:${value}`);
    }
  }
  return kept.join(";");
}

/** Quoting and whitespace vary by browser; the list of families does not. */
function normalizeFontStack(stack: string): string {
  return stack
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter((f) => f.length > 0)
    .join(",");
}

/** The `<font size="n">` a browser emits, mapped back to a real declaration. */
export function sizeFromLegacy(legacy: string): SizeChoice | null {
  const n = Number(legacy.trim());
  if (!Number.isFinite(n)) return null;
  // Browsers clamp to 1–7 and so do we; an out-of-range value is somebody
  // else's markup rather than ours.
  return SIZES.find((s) => s.legacy === n) ?? null;
}

/**
 * The `<font face="…">` a browser emits, mapped back to one of our stacks.
 *
 * The bare-name fallback is why no two entries in `FONTS` may lead with the same
 * family: `execCommand("fontName")` round-trips as a bare `Georgia`, and when
 * two stacks both started with it the first one in the table won regardless of
 * which the person picked. There is a test asserting the leads stay distinct.
 */
export function fontFromFace(face: string): FontChoice | null {
  const normalized = normalizeFontStack(face);
  return (
    FONTS.find((f) => normalizeFontStack(f.css) === normalized) ??
    // A bare family name, which is what `execCommand("fontName")` is given.
    FONTS.find((f) => normalizeFontStack(f.css).split(",")[0] === normalized) ??
    null
  );
}
