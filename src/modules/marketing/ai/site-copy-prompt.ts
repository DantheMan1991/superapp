import type { SiteBrief } from "@/lib/sites/copy";

/**
 * The prompt half of writing a site — pure. The assistant writes WORDS for
 * a fixed set of slots; `assembleSite` puts them into pages. It never
 * chooses a layout, a colour or a page, and it never sees a file.
 */

export const SITE_COPY_SYSTEM_PROMPT = `You write the words for a small business's first website. The site has a fixed shape: a home page (a headline and a line under it, a short list of what the business offers, a short "about", and a closing line with a button), an "about" page, and a contact page. You fill in the words; the design is done.

How to write:
- Plain, warm, specific. Short sentences. Say what the business does and for whom, the way the owner would say it to a neighbour.
- Use only what the brief gives you. Never invent services, years in business, awards, prices, staff names or places. If the brief is thin, say less rather than making something up. Do not write "we are passionate" or "solutions".
- The headline is under ten words and is not the business name on its own unless the name says what the business does. The line under it is one sentence.
- The offer list has three to six items, each a name of three words or fewer and a blurb of one sentence. Draw them from the kind of business; for a farm that might be "Pasture-raised beef", for a plumber "Water heaters". Keep them general when you are unsure.
- The "about" on the home page is one or two short paragraphs. The about PAGE is two or three, and may say plainly that the owner should add the story in their own words if the brief gives you nothing to tell.
- Both buttons on the home page lead to the CONTACT page, so their labels must say so: "Get in touch", "Contact us", "Come and see us". Never a label that promises a different page.
- The meta description is one or two sentences, under 160 characters, naming the business and what it does.
- American English. No dashes for asides, no exclamation marks, no emoji.`;

export const WRITE_SITE_COPY_TOOL = {
  name: "write_site_copy",
  description: "The words for every slot of the business's first website.",
  input_schema: {
    type: "object" as const,
    properties: {
      description: { type: "string", maxLength: 200 },
      hero: {
        type: "object",
        properties: {
          headline: { type: "string", maxLength: 120 },
          subheadline: { type: "string", maxLength: 240 },
          ctaLabel: { type: "string", maxLength: 40 },
        },
        required: ["headline", "subheadline", "ctaLabel"],
      },
      offer: {
        type: "object",
        properties: {
          heading: { type: "string", maxLength: 80 },
          items: {
            type: "array",
            minItems: 3,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                name: { type: "string", maxLength: 60 },
                blurb: { type: "string", maxLength: 240 },
              },
              required: ["name", "blurb"],
            },
          },
        },
        required: ["heading", "items"],
      },
      about: {
        type: "object",
        properties: {
          heading: { type: "string", maxLength: 80 },
          body: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", maxLength: 800 } },
        },
        required: ["heading", "body"],
      },
      closing: {
        type: "object",
        properties: {
          headline: { type: "string", maxLength: 120 },
          ctaLabel: { type: "string", maxLength: 40 },
        },
        required: ["headline", "ctaLabel"],
      },
      aboutPage: {
        type: "object",
        properties: {
          heading: { type: "string", maxLength: 80 },
          body: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", maxLength: 800 } },
        },
        required: ["heading", "body"],
      },
      contactPage: {
        type: "object",
        properties: {
          heading: { type: "string", maxLength: 80 },
          note: { type: "string", maxLength: 300 },
        },
        required: ["heading", "note"],
      },
      hoursHeading: { type: "string", maxLength: 80 },
    },
    required: [
      "description",
      "hero",
      "offer",
      "about",
      "closing",
      "aboutPage",
      "contactPage",
      "hoursHeading",
    ],
  },
};

export function buildSiteCopyUserTurn(brief: SiteBrief): string {
  const lines = [
    `Business name: ${brief.name}`,
    brief.tagline ? `Tagline: ${brief.tagline}` : "Tagline: none",
    `Kind of business: ${brief.industry ?? "not stated; a general small business"}`,
    brief.phone ? "The site will show a phone number." : "No phone number is given.",
    brief.email ? "The site will show an email address." : "No email address is given.",
    brief.address ? `Located at: ${brief.address.replace(/\s*\n\s*/g, ", ")}` : "No address is given.",
    brief.hoursLines.length > 0
      ? `Hours: ${brief.hoursLines.join("; ")}`
      : "No hours are given.",
    "",
    "Write the site now.",
  ];
  return lines.join("\n");
}
