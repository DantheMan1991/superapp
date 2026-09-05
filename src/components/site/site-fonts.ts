import {
  Cormorant_Garamond,
  Lora,
  Montserrat,
  Nunito,
  Oswald,
  Playfair_Display,
  Poppins,
  Source_Sans_3,
  Source_Serif_4,
} from "next/font/google";
import type { FontPairing } from "@/lib/brand/looks";

/**
 * The bundled families behind the font pairings (ADR 0024). `next/font`
 * fetches each at build time and serves it with the page from the
 * platform's own origin, so a visitor's browser never asks a third party
 * for a font and nothing an owner chooses is ever a file or a stylesheet.
 * `preload: false` on every one: a page uses two of the nine, and the
 * browser fetches those when it meets them. Poppins is the one family here
 * without a variable axis, so it names its weights.
 */
const lora = Lora({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-site-lora" });
const nunito = Nunito({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-site-nunito" });
const playfair = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-site-playfair",
});
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-site-source-serif",
});
const oswald = Oswald({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-site-oswald" });
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-site-source-sans",
});
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  preload: false,
  variable: "--font-site-poppins",
});
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-site-cormorant",
});
const montserrat = Montserrat({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-site-montserrat",
});

export interface SiteFonts {
  /** The classes that define the families' variables; put on the root. */
  className: string;
  /** CSS `font-family` values for the headings and the rest. */
  heading: string;
  body: string;
}

/** The platform's own sans, which the root layout already provides. */
const GEIST = "var(--font-geist-sans)";

const PAIRS: Record<FontPairing, SiteFonts> = {
  clean: { className: "", heading: GEIST, body: GEIST },
  warm: {
    className: `${lora.variable} ${nunito.variable}`,
    heading: "var(--font-site-lora)",
    body: "var(--font-site-nunito)",
  },
  classic: {
    className: `${playfair.variable} ${sourceSerif.variable}`,
    heading: "var(--font-site-playfair)",
    body: "var(--font-site-source-serif)",
  },
  bold: {
    className: `${oswald.variable} ${sourceSans.variable}`,
    heading: "var(--font-site-oswald)",
    body: "var(--font-site-source-sans)",
  },
  friendly: {
    className: `${poppins.variable} ${nunito.variable}`,
    heading: "var(--font-site-poppins)",
    body: "var(--font-site-nunito)",
  },
  elegant: {
    className: `${cormorant.variable} ${montserrat.variable}`,
    heading: "var(--font-site-cormorant)",
    body: "var(--font-site-montserrat)",
  },
};

export function siteFonts(pairing: FontPairing): SiteFonts {
  return PAIRS[pairing];
}
