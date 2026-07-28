/**
 * The public site's content knobs — nav, contact details, and every image the
 * marketing pages render.
 *
 * This file exists so that changing the site does not mean reading the site.
 * If you want to swap a photo, add a nav link, publish a phone number or put a
 * face on the About page, it is all here and nowhere else. The page components
 * read from this and never hardcode a path or an address.
 *
 * No secrets and no tenant data — this is all public by definition, and it is
 * imported by client components.
 */

export const SITE = {
  name: "Yosher",
  tagline: "Your business, built right.",
  category: "The outsourced business office",
  /** Used for absolute URLs in the sitemap and OG tags. No trailing slash. */
  url: "https://yosherapp.com",
} as const;

/* ---------------------------------------------------------------------------
 * Contact details.
 *
 * Every field is optional on purpose. A null renders as nothing at all, which
 * is the right behaviour for a business that does not yet publish a phone
 * number or a street address — an empty slot beats a placeholder that a real
 * prospect tries to call.
 * ------------------------------------------------------------------------ */

export interface ContactDetails {
  /** Shown on the Contact page and used as the mailto: fallback. */
  email: string;
  /** E.164 for the tel: link, or null to hide the phone row entirely. */
  phone: { display: string; href: string } | null;
  /** Free text — "Remote, United States", a city, or a full address. */
  location: string | null;
  /** Calendly/Cal.com/etc. Renders a "Book a call" button when set. */
  bookingUrl: string | null;
  /** Plain-language promise shown under the form. Keep it true. */
  responseTime: string;
}

// TODO(founder): replace `email` with the real inbox, and fill in phone /
// location / bookingUrl if and when you want them public. Leave them null
// until then. The address below must also exist as a real mailbox — the
// contact form sets Reply-To, but the From address is CONTACT_FROM.
export const CONTACT: ContactDetails = {
  email: "hello@yosherapp.com",
  phone: null,
  location: null,
  bookingUrl: null,
  responseTime: "We reply to every message within one business day.",
};

/* ---------------------------------------------------------------------------
 * Navigation.
 * ------------------------------------------------------------------------ */

export interface NavLink {
  href: string;
  label: string;
}

export const NAV: readonly NavLink[] = [
  { href: "/about", label: "About" },
  { href: "/health-check", label: "Free health check" },
  { href: "/contact", label: "Contact" },
];

/* ---------------------------------------------------------------------------
 * Images.
 *
 * HOW TO ADD OR SWAP AN IMAGE
 *
 *   1. Put the file in `public/marketing/`.
 *   2. Point the entry below at it and set `width`/`height` to the file's real
 *      pixel dimensions. next/image needs the true intrinsic size to reserve
 *      layout space — wrong numbers mean a stretched image and a layout shift.
 *   3. Write an `alt` that says what the image shows. Decorative? Use "".
 *
 * The files currently in `public/marketing/` are generated placeholders (see
 * `scripts/marketing-placeholders.ts` and the README in that folder). Overwrite
 * one with a real photo at the same filename and dimensions and it just works —
 * no code change needed.
 *
 * Ship images at roughly 2x their largest rendered size. Next optimizes and
 * serves WebP/AVIF automatically, so a large, high-quality source is right;
 * pre-compressing it is not.
 * ------------------------------------------------------------------------ */

export interface SiteImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export const IMAGES = {
  /** Hero. A product screenshot works best here. Renders ~1100px wide, 3:2. */
  hero: {
    src: "/marketing/hero.png",
    alt: "The Yosher dashboard, showing a business's books, invoices and open jobs in one view.",
    width: 2400,
    height: 1600,
  },
  /** About page, top of the story section. Wide crop, 5:3. */
  aboutStory: {
    src: "/marketing/about-story.png",
    alt: "A small business owner reviewing paperwork on a job site.",
    width: 2000,
    height: 1200,
  },
  /** Contact page sidebar. Square-ish, 4:3. Optional — set to null to hide. */
  contactAside: {
    src: "/marketing/contact-aside.png",
    alt: "",
    width: 1200,
    height: 900,
  },
} as const satisfies Record<string, SiteImage>;

/* ---------------------------------------------------------------------------
 * Team.
 *
 * Empty by default, and the About page omits the whole section when it is
 * empty. That is deliberate: an invented bio on a public page is a liability,
 * and a missing section reads as "early" rather than as "fake".
 *
 * To add someone, drop a square headshot (800x800 or larger) in
 * `public/marketing/team/` and add an entry:
 *
 *   {
 *     name: "Jane Doe",
 *     role: "Founder",
 *     bio: "One or two sentences. What they do here, and why they're credible.",
 *     image: {
 *       src: "/marketing/team/jane-doe.jpg",
 *       alt: "Jane Doe",
 *       width: 800,
 *       height: 800,
 *     },
 *   }
 * ------------------------------------------------------------------------ */

export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  /** Square headshot, or null for a monogram tile. */
  image: SiteImage | null;
}

export const TEAM: readonly TeamMember[] = [];
