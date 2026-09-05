/**
 * The look of the business — pure, Layer 0, beside the colours.
 *
 * A LOOK is a preset, never a stylesheet: one of three feels, each of which
 * picks a font pairing, a button shape and how soft the corners are. An
 * owner may then set the fonts or the buttons on their own; `''` on the row
 * (null here) means "as the look says", the same word `default` means on a
 * section's style. Every value is one of a short list, so a consumer never
 * meets a font file, a CSS string or a pixel it did not choose itself.
 *
 * The pairings are curated on purpose (ADR 0024): each is two families the
 * platform bundles, chosen to read well together on a phone at the sizes
 * the renderer uses. The website is the first consumer; the documents keep
 * their own type for now (`src/lib/pdf/fonts`).
 */
export const BRAND_LOOKS = ["modern", "warm", "classic"] as const;
export type BrandLook = (typeof BRAND_LOOKS)[number];

export const FONT_PAIRINGS = ["clean", "warm", "classic", "bold", "friendly", "elegant"] as const;
export type FontPairing = (typeof FONT_PAIRINGS)[number];

export const BUTTON_SHAPES = ["pill", "rounded", "square"] as const;
export type ButtonShape = (typeof BUTTON_SHAPES)[number];

export function isBrandLook(value: string): value is BrandLook {
  return (BRAND_LOOKS as readonly string[]).includes(value);
}
export function isFontPairing(value: string): value is FontPairing {
  return (FONT_PAIRINGS as readonly string[]).includes(value);
}
export function isButtonShape(value: string): value is ButtonShape {
  return (BUTTON_SHAPES as readonly string[]).includes(value);
}

export interface FontPairingSpec {
  name: string;
  /** The families, for the caption under the name. */
  heading: string;
  body: string;
  /** One line on where it suits. */
  note: string;
}

export const FONT_PAIRING_SPECS: Record<FontPairing, FontPairingSpec> = {
  clean: {
    name: "Clean",
    heading: "Geist",
    body: "Geist",
    note: "The platform's own sans, as every site starts.",
  },
  warm: {
    name: "Warm",
    heading: "Lora",
    body: "Nunito",
    note: "A soft serif over a rounded sans. Farms, food, families.",
  },
  classic: {
    name: "Classic",
    heading: "Playfair Display",
    body: "Source Serif",
    note: "Serifs throughout. Established, traditional, considered.",
  },
  bold: {
    name: "Bold",
    heading: "Oswald",
    body: "Source Sans",
    note: "A condensed heading with weight to it. Trades, crews, gear.",
  },
  friendly: {
    name: "Friendly",
    heading: "Poppins",
    body: "Nunito",
    note: "Round and open. Clinics, classes, anything for children.",
  },
  elegant: {
    name: "Elegant",
    heading: "Cormorant Garamond",
    body: "Montserrat",
    note: "A fine serif over a quiet sans. Boutiques, studios, events.",
  },
};

export interface ButtonShapeSpec {
  name: string;
  /** The corner radius, as CSS. */
  radius: string;
}

export const BUTTON_SHAPE_SPECS: Record<ButtonShape, ButtonShapeSpec> = {
  pill: { name: "Pill", radius: "9999px" },
  rounded: { name: "Rounded", radius: "0.625rem" },
  square: { name: "Square", radius: "0.125rem" },
};

export interface LookSpec {
  name: string;
  note: string;
  fontPairing: FontPairing;
  buttonShape: ButtonShape;
  /** Photos, cards and panels. */
  radius: string;
  /** The form's boxes. */
  fieldRadius: string;
}

/** What each look means when the owner says nothing more. `modern` is how every site started. */
export const LOOK_SPECS: Record<BrandLook, LookSpec> = {
  modern: {
    name: "Modern",
    note: "Clean type, pill buttons, soft corners.",
    fontPairing: "clean",
    buttonShape: "pill",
    radius: "1rem",
    fieldRadius: "0.5rem",
  },
  warm: {
    name: "Warm",
    note: "A serif for headings, rounded buttons, softer corners.",
    fontPairing: "warm",
    buttonShape: "rounded",
    radius: "1.5rem",
    fieldRadius: "0.75rem",
  },
  classic: {
    name: "Classic",
    note: "Serifs throughout, squared buttons, straight corners.",
    fontPairing: "classic",
    buttonShape: "square",
    radius: "0.375rem",
    fieldRadius: "0.25rem",
  },
};

export interface ResolvedLook {
  look: BrandLook;
  fontPairing: FontPairing;
  buttonShape: ButtonShape;
  radius: string;
  fieldRadius: string;
  buttonRadius: string;
}

/** The look's defaults under the owner's own choices; nothing chosen is `modern`. */
export function resolveLook(brand: {
  look: BrandLook | null;
  fontPairing: FontPairing | null;
  buttonShape: ButtonShape | null;
}): ResolvedLook {
  const look = brand.look ?? "modern";
  const spec = LOOK_SPECS[look];
  const buttonShape = brand.buttonShape ?? spec.buttonShape;
  return {
    look,
    fontPairing: brand.fontPairing ?? spec.fontPairing,
    buttonShape,
    radius: spec.radius,
    fieldRadius: spec.fieldRadius,
    buttonRadius: BUTTON_SHAPE_SPECS[buttonShape].radius,
  };
}

/** The corners, as the CSS variables the site's classes read. The fonts are the renderer's (they need the bundled files). */
export function lookRadiusVars(resolved: ResolvedLook): Record<string, string> {
  return {
    "--site-radius": resolved.radius,
    "--site-radius-field": resolved.fieldRadius,
    "--site-radius-button": resolved.buttonRadius,
  };
}
