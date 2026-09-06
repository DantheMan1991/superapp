import type { PageSlots } from "@/lib/site-templates/core";
import type { SiteBrief } from "@/lib/sites/copy";

/**
 * The prompt half of writing a site — pure (slice 1, rebuilt on the
 * templates in slice 15). The writer is handed every WORD SLOT the
 * template's pages hold, with what each says today and how long it may
 * be, and writes the same slots back for this business; `applySiteWords`
 * puts them in one section at a time. It never chooses a page, a section,
 * a layout, a colour or a picture, and it never sees a file.
 */
export const SITE_COPY_SYSTEM_PROMPT = `You write the words for a small business's website. The site is already designed: its pages, its sections and every slot for words are fixed. You are shown each slot with the starter words it holds and the most characters it may take, and you write the same slots for this business.

How to write:
- Plain, warm, specific. Short sentences. Say what the business does and for whom, the way the owner would say it to a neighbor.
- Use only what the brief gives you. Never invent services, years in business, awards, prices, staff names or places. If the brief is thin, keep the starter's meaning and make it true of this business rather than adding anything.
- Every slot stays the kind of thing it is: a headline stays a headline under ten words, a button label stays two or three words that say where it leads, a paragraph stays a paragraph, a list item's name stays three words or fewer.
- Keep each slot within its length. Write every slot you are given; leave nothing out and add nothing.
- A page's description is one or two sentences under 160 characters that name the business, what it offers and, when the brief gives one, the town or area, because that is how people search.
- A page's seoTitle is its title tag, under 60 characters: what the page offers, the town when the brief gives one, then a vertical bar and the business name. The home page's says what the business sells; every other page's starts with what that page is for.
- American English. No dashes for asides, no exclamation marks, no emoji.`;

export const WRITE_SITE_TOOL = {
  name: "write_site",
  description: "Every page's description and every section's words, by slot.",
  input_schema: {
    type: "object" as const,
    properties: {
      pages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            description: { type: "string", maxLength: 200 },
            seoTitle: { type: "string", maxLength: 70 },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", minimum: 0 },
                  words: { type: "object", additionalProperties: { type: "string" } },
                },
                required: ["index", "words"],
              },
            },
          },
          required: ["path", "description", "seoTitle", "sections"],
        },
      },
    },
    required: ["pages"],
  },
};

function briefLines(brief: SiteBrief): string[] {
  return [
    `Business name: ${brief.name}`,
    brief.tagline ? `Tagline: ${brief.tagline}` : "Tagline: none",
    `Kind of business: ${brief.industry ?? "not stated; a general small business"}`,
    brief.phone ? "The site will show a phone number." : "No phone number is given.",
    brief.email ? "The site will show an email address." : "No email address is given.",
    brief.address ? `Located at: ${brief.address.replace(/\s*\n\s*/g, ", ")}` : "No address is given.",
    brief.hoursLines.length > 0 ? `Hours: ${brief.hoursLines.join("; ")}` : "No hours are given.",
    ...(brief.about.trim() ? [`In the owner's own words: ${brief.about.trim()}`, "Those words are the best source you have: name what they name, in their terms."] : []),
  ];
}

export function buildSiteCopyUserTurn(brief: SiteBrief, notes: string[], pages: PageSlots[]): string {
  const lines = [...briefLines(brief), ""];
  if (notes.length > 0) lines.push("About this kind of business and this site:", ...notes.map((n) => `- ${n}`), "");
  lines.push("The pages and their slots. Each slot shows its most characters and its starter words.");
  for (const page of pages) {
    lines.push("", `Page ${page.path} ("${page.title}")`, `- description (at most 160 characters): ${JSON.stringify(page.description)}`, `- seoTitle (at most 60 characters): ${JSON.stringify(page.seoTitle)}`);
    for (const section of page.sections) {
      const slots = Object.entries(section.words);
      if (slots.length === 0) continue;
      lines.push(`- section ${section.index} (${section.kind}):`);
      for (const [path, text] of slots) lines.push(`    ${path} (at most ${section.limits[path]}): ${JSON.stringify(text)}`);
    }
  }
  lines.push("", "Write every page's description and every section's slots now, with the same paths.");
  return lines.join("\n");
}
