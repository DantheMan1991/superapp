import { PageContentSchema, type PageContent, type Section } from "./schema";

/**
 * From a brief to a site — pure.
 *
 * `SiteCopy` is what a writer (the assistant, or the standard text below)
 * produces: words only. `assembleSite` turns those words into the three
 * pages every site starts with, in a fixed order of sections, and validates
 * the result — so whichever writer produced the words, what lands in the
 * table is a `PageContent` the renderer can draw.
 */

/** What the writer is told. Facts, never files. */
export interface SiteBrief {
  name: string;
  tagline: string;
  /** The industry profile's readable name, or null for a general business. */
  industry: string | null;
  phone: string;
  email: string;
  address: string;
  hoursLines: string[];
}

export interface SiteCopy {
  /** The meta description for the home page, ≤ 160 characters. */
  description: string;
  hero: { headline: string; subheadline: string; ctaLabel: string };
  offer: { heading: string; items: Array<{ name: string; blurb: string }> };
  about: { heading: string; body: string[] };
  closing: { headline: string; ctaLabel: string };
  aboutPage: { heading: string; body: string[] };
  contactPage: { heading: string; note: string };
  hoursHeading: string;
}

export interface AssembledPage {
  path: string;
  title: string;
  navOrder: number;
  inNav: boolean;
  content: PageContent;
}

/**
 * Plain, honest copy that needs no assistant: the business's own words
 * (name, tagline, industry) set into sentences that are true of any small
 * business. It is what an owner sees when there is no key or the call
 * failed, and it is the padding when the assistant leaves something blank.
 */
export function standardSiteCopy(brief: SiteBrief): SiteCopy {
  const name = brief.name.trim() || "Our business";
  const what = brief.industry ? brief.industry.toLowerCase() : "local business";
  const tagline = brief.tagline.trim();
  return {
    description: tagline
      ? `${name}. ${tagline}`
      : `${name} is a ${what}. Find out what we do, where we are and how to reach us.`,
    hero: {
      headline: tagline || name,
      subheadline: tagline
        ? `${name} is a ${what}. Here is what we do and how to reach us.`
        : `A ${what}, and what we can do for you.`,
      ctaLabel: "Get in touch",
    },
    offer: {
      heading: "What we do",
      items: [
        { name: "What we offer", blurb: "The products and services people come to us for." },
        { name: "How we work", blurb: "Straightforward, on time and as agreed." },
        { name: "Where to find us", blurb: "Details and hours are on the contact page." },
      ],
    },
    about: {
      heading: `About ${name}`,
      body: [
        `${name} is a ${what}. We keep things simple: do the work well, say what it costs, and be easy to reach.`,
      ],
    },
    closing: { headline: "Ready when you are.", ctaLabel: "Contact us" },
    aboutPage: {
      heading: `About ${name}`,
      body: [
        `${name} is a ${what}.`,
        "This page is where the story goes: who is behind the business, how it started and what it stands for. Edit it to say so in your own words.",
      ],
    },
    contactPage: {
      heading: "Get in touch",
      note: "Call, email or come and see us. We answer as quickly as we can.",
    },
    hoursHeading: "Hours",
  };
}

const CONTACT_PATH = "/contact";

/**
 * Three pages, fixed order. The contact and hours sections carry no
 * details of their own — they read the site's settings at render time, so a
 * changed phone number changes every page that shows it.
 */
export function assembleSite(brief: SiteBrief, copy: SiteCopy): AssembledPage[] {
  const hasOffer = copy.offer.items.length > 0;
  const home: Section[] = [
    {
      type: "hero",
      headline: copy.hero.headline,
      subheadline: copy.hero.subheadline,
      cta: { label: copy.hero.ctaLabel || "Get in touch", href: CONTACT_PATH },
    },
    ...(hasOffer
      ? [{ type: "offer" as const, heading: copy.offer.heading, items: copy.offer.items }]
      : []),
    { type: "about", heading: copy.about.heading, body: copy.about.body },
    {
      type: "cta",
      headline: copy.closing.headline,
      cta: { label: copy.closing.ctaLabel || "Contact us", href: CONTACT_PATH },
    },
  ];
  const about: Section[] = [
    { type: "text", heading: copy.aboutPage.heading, body: copy.aboutPage.body },
  ];
  const contact: Section[] = [
    { type: "contact", heading: copy.contactPage.heading, note: copy.contactPage.note },
    ...(brief.hoursLines.length > 0
      ? [{ type: "hours" as const, heading: copy.hoursHeading || "Hours", note: "" }]
      : []),
    // Fixed words, not the model's: the form is the same on every site and
    // the owner edits it like any section.
    { type: "form", heading: "Send us a message", note: "", buttonLabel: "Send", askPhone: true, thanks: "Thanks. We'll be in touch.", fields: [] },
  ];
  const pages: AssembledPage[] = [
    { path: "/", title: "Home", navOrder: 0, inNav: true, content: { description: copy.description, sections: home } },
    { path: "/about", title: "About", navOrder: 1, inNav: true, content: { description: "", sections: about } },
    { path: CONTACT_PATH, title: "Contact", navOrder: 2, inNav: true, content: { description: "", sections: contact } },
  ];
  // Whatever wrote the words, the pages that leave here are valid.
  return pages.map((p) => ({ ...p, content: PageContentSchema.parse(p.content) }));
}
