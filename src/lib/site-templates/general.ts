import type { SiteTemplate } from "./types";

/**
 * The general template: what a business with no industry profile starts
 * with, and what every site started with before slice 15. Three pages in
 * a fixed order, words true of any small business, no pictures and no
 * opinion about the look. The writer fills every slot from the brief.
 */
export const generalSiteTemplate: SiteTemplate = {
  slug: "general",
  name: "General business",
  industry: null,
  description: "A home page, an about page and a contact page, for any small business.",
  frame: { headerButton: null, footerColumns: [], footerNote: "" },
  pages: [
    {
      path: "/",
      title: "Home",
      inNav: true,
      description: "{name} is a {what}. Find out what we do, where we are and how to reach us.",
      sections: [
        {
          type: "hero",
          eyebrow: "",
          headline: "{name}",
          subheadline: "{tagline}",
          cta: { label: "Get in touch", href: "/contact" },
          secondary: null,
          image: null,
        },
        {
          type: "offer",
          heading: "What we do",
          items: [
            { name: "What we offer", blurb: "The products and services people come to us for.", image: null },
            { name: "How we work", blurb: "Straightforward, on time and as agreed.", image: null },
            { name: "Where to find us", blurb: "Details and hours are on the contact page.", image: null },
          ],
        },
        {
          type: "about",
          heading: "About {name}",
          body: ["{name} is a {what}. We keep things simple: do the work well, say what it costs, and be easy to reach."],
          image: null,
        },
        { type: "cta", headline: "Ready when you are.", cta: { label: "Contact us", href: "/contact" } },
      ],
    },
    {
      path: "/about",
      title: "About",
      inNav: true,
      description: "About {name}, a {what}.",
      sections: [
        {
          type: "text",
          heading: "About {name}",
          body: [
            "{name} is a {what}.",
            "This page is where the story goes: who is behind the business, how it started and what it stands for. Edit it to say so in your own words.",
          ],
        },
      ],
    },
    {
      path: "/contact",
      title: "Contact",
      inNav: true,
      description: "How to reach {name}: phone, email, hours and where to find us.",
      sections: [
        { type: "contact", heading: "Get in touch", note: "Call, email or come and see us. We answer as quickly as we can." },
        { type: "hours", heading: "Hours", note: "", needs: "hours" },
        // Fixed words, not the writer's: the form is the same on every site and the owner edits it like any section.
        { type: "form", heading: "Send us a message", note: "", buttonLabel: "Send", askPhone: true, thanks: "Thanks. We'll be in touch.", fields: [] },
      ],
    },
  ],
  pictures: [],
  writerNotes: [
    "A general small business: say what it does and for whom, from the brief alone.",
    "The headline is under ten words and is not the business name on its own unless the name says what the business does.",
    "Both buttons on the home page lead to the contact page, so their labels must say so.",
  ],
};
