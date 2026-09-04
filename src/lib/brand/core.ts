/**
 * The brand kit, resolved — pure. No database, no React, no I/O.
 *
 * Two jobs: turn the rows (`brand_kits`) into the one answer a consumer wants
 * ("what does this company look like?"), and do the colour arithmetic every
 * consumer would otherwise reinvent. Both are table-testable.
 */

/** `#rrggbb`, lowercase. What `brand_kits.primary_color` stores. */
export type HexColor = `#${string}`;

export interface BrandLogo {
  pathname: string;
  mimeType: string;
  width: number;
  height: number;
}

/** The subset of a `brand_kits` row the resolver reads. */
export interface BrandKitFields {
  displayName: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  logoPathname: string | null;
  logoMimeType: string;
  logoWidth: number;
  logoHeight: number;
}

export interface ResolvedBrand {
  /** Never empty: falls back to the tenant's name. */
  displayName: string;
  /** Empty when nobody has written one. */
  tagline: string;
  /** Null when nobody has chosen one; consumers keep their own default. */
  primaryColor: HexColor | null;
  accentColor: HexColor | null;
  logo: BrandLogo | null;
  /**
   * Where each answer came from, for the screen that explains it: a company
   * kit that only set a trading name still shows the shared logo, and the
   * owner should be able to see that this is why.
   */
  sources: {
    displayName: "company" | "business" | "tenant";
    logo: "company" | "business" | "none";
  };
}

/** Uploads the kit accepts. PNG and JPEG are what the PDF renderer draws. */
export const BRAND_LOGO_MIME_TYPES = ["image/png", "image/jpeg"] as const;
/** 2MB: a logo, not a photograph. */
export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const BRAND_DISPLAY_NAME_MAX = 80;
export const BRAND_TAGLINE_MAX = 140;

export function isBrandLogoMimeType(mime: string): boolean {
  return (BRAND_LOGO_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * `#abc`, `abc`, `#AABBCC`, `  aabbcc ` → `#aabbcc`. Anything else → null.
 * Also the only place the stored shape is defined; the CHECK on the table
 * repeats it so a row written any other way is refused.
 */
export function normalizeHexColor(input: string): HexColor | null {
  const raw = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  return null;
}

function channel(hex: HexColor, at: number): number {
  return parseInt(hex.slice(at, at + 2), 16) / 255;
}

/** WCAG relative luminance of an sRGB colour, 0 (black) … 1 (white). */
export function relativeLuminance(hex: HexColor): number {
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const r = lin(channel(hex, 1));
  const g = lin(channel(hex, 3));
  const b = lin(channel(hex, 5));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 … 21. Order of arguments does not matter. */
export function contrastRatio(a: HexColor, b: HexColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** What the WCAG large-text minimum asks of a brand colour used as text. */
const READABLE_TEXT_CONTRAST = 3;

/**
 * The brand colour if it is readable as text on white, else the fallback. A
 * pale yellow is a fine rule colour and an invisible heading; the invoice
 * uses this for the heading and the raw colour for its rules.
 */
export function readableOnWhite(hex: HexColor, fallback: HexColor): HexColor {
  return contrastRatio(hex, "#ffffff") >= READABLE_TEXT_CONTRAST
    ? hex
    : fallback;
}

/** Black or white, whichever reads better ON the colour. */
export function foregroundOn(hex: HexColor): HexColor {
  return contrastRatio(hex, "#111827") >= contrastRatio(hex, "#ffffff")
    ? "#111827"
    : "#ffffff";
}

function asHex(stored: string): HexColor | null {
  return stored === "" ? null : (stored as HexColor);
}

function logoOf(kit: BrandKitFields | null): BrandLogo | null {
  if (!kit || !kit.logoPathname) return null;
  return {
    pathname: kit.logoPathname,
    mimeType: kit.logoMimeType,
    width: kit.logoWidth,
    height: kit.logoHeight,
  };
}

/**
 * Field by field: the company's kit where it says something, else the
 * business-wide kit, else the platform default. A company that only wants a
 * different trading name should not lose the shared logo for saying so.
 */
export function resolveBrand(input: {
  tenantName: string;
  business: BrandKitFields | null;
  company: BrandKitFields | null;
}): ResolvedBrand {
  const { business, company } = input;
  const pick = (get: (k: BrandKitFields) => string): string =>
    (company && get(company)) || (business && get(business)) || "";

  const displayName = pick((k) => k.displayName);
  const companyLogo = logoOf(company);
  const businessLogo = logoOf(business);

  return {
    displayName: displayName || input.tenantName,
    tagline: pick((k) => k.tagline),
    primaryColor: asHex(pick((k) => k.primaryColor)),
    accentColor: asHex(pick((k) => k.accentColor)),
    logo: companyLogo ?? businessLogo,
    sources: {
      displayName: company?.displayName
        ? "company"
        : business?.displayName
          ? "business"
          : "tenant",
      logo: companyLogo ? "company" : businessLogo ? "business" : "none",
    },
  };
}

/**
 * Fit a logo into a box without distorting it. Points for the PDF, pixels
 * for a screen — the arithmetic does not care. A logo smaller than the box
 * is NOT scaled up: a 40px mark blown up to 160 looks worse than a small one.
 */
export function fitLogo(
  logo: { width: number; height: number },
  box: { width: number; height: number },
): { width: number; height: number } {
  if (logo.width <= 0 || logo.height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(
    1,
    box.width / logo.width,
    box.height / logo.height,
  );
  return {
    width: Math.round(logo.width * scale * 100) / 100,
    height: Math.round(logo.height * scale * 100) / 100,
  };
}
