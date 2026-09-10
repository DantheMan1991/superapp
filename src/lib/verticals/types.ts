import type { LucideIcon } from "lucide-react";

/**
 * A VERTICAL is one industry we sell to, and the marketing page that sells to
 * it — "Yosher Homestead" for homestead farms, and whatever comes after.
 *
 * The shape here is the whole point of the design: a vertical is DATA, one file
 * per industry, assembled by one renderer
 * (`src/app/(marketing)/for/[vertical]/page.tsx`). Adding an industry is a data
 * file and a registry line, never a second site to keep current. That is the
 * same bargain the platform makes everywhere else — packs, industry profiles,
 * tenant site templates — applied to our own front door.
 *
 * **Not to be confused with `src/lib/site-templates/`**, which builds a
 * CLIENT's website for their industry. This builds OURS, about that industry.
 *
 * WHY IT IS SEPARATE FROM THE UMBRELLA COPY. `src/lib/site.ts` is the front
 * door and stays industry-neutral on purpose (docs/modules/public-site.md): a
 * trade noun in core marketing is the same mistake as a trade noun in
 * `src/modules/`. A vertical is the layer where trade nouns BELONG — paddocks,
 * cut sheets, the honour-system farm store — so they live here and nowhere
 * else.
 *
 * ROUTING, TODAY AND LATER. Every vertical is served at `/for/<slug>` on the
 * platform host. Putting one on its own domain later is a routing change in
 * `classifyHost`/`platformHostsFromEnv` (`src/lib/sites/slug.ts`) plus a
 * rewrite in `src/proxy.ts` — the content model does not move. Nothing here
 * assumes which address it was reached at.
 */

/** A place a button goes. Plain strings so a vertical can point anywhere. */
export interface VerticalLink {
  label: string;
  /** A path on this site (`/health-check`) or an in-page anchor (`#what-it-does`). */
  href: string;
}

/** The opening. Rendered full-bleed with the brand wash, never banded. */
export interface HeroSection {
  kind: "hero";
  /** The sub-brand, small, above the headline. */
  eyebrow: string;
  heading: string;
  body: string;
  primary: VerticalLink;
  secondary: VerticalLink | null;
  /** The small print under the buttons — "No signup, no card". Null renders nothing. */
  note: string | null;
}

/** What is wrong today, in the reader's own words. No solutions here. */
export interface ProblemsSection {
  kind: "problems";
  eyebrow: string;
  heading: string;
  body: string | null;
  items: readonly { title: string; body: string }[];
}

/** The grid of what the software actually does, in this industry's nouns. */
export interface CapabilitiesSection {
  kind: "capabilities";
  /** Anchor target, so a hero button can point at it. Optional. */
  id?: string;
  eyebrow: string;
  heading: string;
  body: string | null;
  items: readonly { icon: LucideIcon; title: string; body: string }[];
}

/**
 * One thing, told properly. The section that has to carry the page: a
 * narrative a generic tool cannot tell, with the steps beside it.
 *
 * Everything a spotlight claims must be BUILT. A page that describes a
 * roadmap as a feature is the fastest way to lose the first client who
 * signs up because of it.
 */
export interface SpotlightSection {
  kind: "spotlight";
  eyebrow: string;
  heading: string;
  body: string;
  /** The numbered walk-through, in order. */
  points: readonly { title: string; body: string }[];
  /** A short closing claim under the walk-through, or null. */
  footnote: string | null;
}

/** How it starts. Numbered, three or four, never more. */
export interface StepsSection {
  kind: "steps";
  eyebrow: string;
  heading: string;
  body: string | null;
  items: readonly { icon: LucideIcon; title: string; body: string }[];
}

/**
 * The objections, answered.
 *
 * Field names are `question`/`answer` on purpose: that is what
 * `faqJsonLd` (`src/lib/sites/proof.ts`) takes, so the structured data for
 * this page comes from the same one implementation the tenant sites use.
 */
export interface FaqSection {
  kind: "faq";
  eyebrow: string;
  heading: string;
  items: readonly { question: string; answer: string }[];
}

/** The close. */
export interface CtaSection {
  kind: "cta";
  heading: string;
  body: string;
  primary: VerticalLink;
  secondary: VerticalLink | null;
}

export type VerticalSection =
  | HeroSection
  | ProblemsSection
  | CapabilitiesSection
  | SpotlightSection
  | StepsSection
  | FaqSection
  | CtaSection;

export interface Vertical {
  /** The URL label: `/for/<slug>`. Kept short and readable — `homestead`. */
  slug: string;
  /** The sub-brand, as it is written everywhere. "Yosher Homestead". */
  name: string;
  /**
   * The industry profile this sells, by `src/industries` slug, or null when
   * we are testing demand for an industry no profile has been built for yet.
   *
   * A non-null value MUST name a profile in `industryRegistry` —
   * `tests/verticals.test.ts` enforces it. The link is what keeps the page's
   * promises and the packs a signup actually installs from drifting apart.
   */
  industry: string | null;
  /** One line. The card on `/for`, and the `og:description` fallback. */
  summary: string;
  /** How this vertical shows up in the list of industries we serve. */
  card: { icon: LucideIcon; heading: string; body: string };
  seo: { title: string; description: string };
  sections: readonly VerticalSection[];
}
