import { z } from "zod";
import type { SiteBrief } from "@/lib/sites/copy";
import { newSection, type PlainSectionType } from "@/lib/sites/pages";
import { PageContentSchema, type PageContent, type Section, type SectionType } from "@/lib/sites/schema";
import { limitFor } from "@/lib/sites/words";

/**
 * The assistant in the editor — the pure half (slice 12). Three jobs, and
 * in every one the model writes WORDS into slots the code chose:
 *
 *   - rewriting one section: the section's text slots go out as a flat
 *     map of path → words with a length for each, and the same keys come
 *     back; photos, icons, links, rules and the look are never sent and
 *     never changed;
 *   - writing a page from a sentence: the model chooses BLOCKS from a short
 *     list of kinds and fills their words; `assemblePageBlocks` turns them
 *     into real sections with the code's defaults for everything else;
 *   - describing a photo: one sentence for someone who cannot see it.
 *
 * Everything that comes back is parsed through the content model before it
 * reaches the editor, and nothing here has a side effect: the owner reads
 * the result and saves it, or does not.
 */
export const ASSISTANT_SYSTEM_PROMPT = `You help a small business with the words on its website. The design is done; you write words into slots the site already has.

How to write:
- Plain, warm, specific. Short sentences. Say what the business does and for whom, the way the owner would say it to a neighbour.
- Use only what you are given. Never invent services, years in business, awards, prices, staff names or places. If you are told little, say less rather than making something up. Do not write "we are passionate" or "solutions".
- Keep each slot within the length you are given, and keep it the kind of thing the slot is for: a headline stays a headline, a button label stays two or three words that say where it leads, a paragraph stays a paragraph.
- American English. No dashes for asides, no exclamation marks, no emoji.`;

/* -- Rewriting one section ------------------------------------------------ */

// The slot walk (`sectionWords`, `applyWords`, `limitFor`) lives in `src/lib/sites/words.ts`
// since slice 15, shared with the site templates; re-exported here for the callers that knew it here.
export { applyWords, limitFor, sectionWords } from "@/lib/sites/words";

export const REWRITE_SECTION_TOOL = {
  name: "rewrite_section",
  description: "New words for the section: the same keys as given, each within its length.",
  input_schema: {
    type: "object" as const,
    properties: {
      words: { type: "object", additionalProperties: { type: "string" } },
    },
    required: ["words"],
  },
};

export const REWRITE_INSTRUCTION_MAX = 200;

function briefLines(brief: SiteBrief): string[] {
  return [
    `Business: ${brief.name}${brief.tagline ? ` (${brief.tagline})` : ""}`,
    `Kind of business: ${brief.industry ?? "not stated; a general small business"}`,
    brief.address ? `Located at: ${brief.address.replace(/\s*\n\s*/g, ", ")}` : "No address is given.",
    brief.hoursLines.length > 0 ? `Hours: ${brief.hoursLines.join("; ")}` : "No hours are given.",
    ...(brief.about.trim() ? [`In the owner's own words: ${brief.about.trim()}`] : []),
  ];
}

export function buildRewriteUserTurn(input: {
  brief: SiteBrief;
  pageTitle: string;
  kind: SectionType;
  words: Record<string, string>;
  instruction: string;
}): string {
  const slots = Object.entries(input.words).map(
    ([path, text]) => `- ${path} (at most ${limitFor(input.kind, path)} characters): ${JSON.stringify(text)}`,
  );
  const ask = input.instruction.trim();
  return [
    ...briefLines(input.brief),
    `Page: ${input.pageTitle}`,
    `Section: ${input.kind}`,
    "",
    "The section's words today, by slot:",
    ...slots,
    "",
    ask ? `What the owner asked for: ${ask}` : "The owner asked for a better version of the same thing: clearer and warmer, saying no more than it says now.",
    "Rewrite every slot, keeping each within its length and each the kind of thing it is.",
  ].join("\n");
}

/* -- Writing a page from a sentence --------------------------------------- */

export const PAGE_BLOCK_KINDS = [
  "hero",
  "text",
  "offer",
  "columns",
  "cta",
  "form",
  "contact",
  "hours",
  "booking",
  "events",
  "map",
  "faq",
] as const;
export type PageBlockKind = (typeof PAGE_BLOCK_KINDS)[number];

const BLOCK_HINTS: Record<PageBlockKind, string> = {
  hero: "a big headline (heading), one line under it (lines[0]) and a button (button) leading to the contact page",
  text: "a heading and one to four paragraphs (lines)",
  offer: "a heading and three to eight items, each a name of three words or fewer and a one-sentence blurb",
  columns: "a heading, a line under it (lines[0]) and two to six cards (items), each a heading (name) and a sentence or two (blurb)",
  cta: "a closing line (heading) and a button (button) leading to the contact page",
  form: "the enquiry form: a heading, a line under it (lines[0]) and the button's word (button)",
  contact: "the business's phone, email and address, from its details: only a heading and a line (lines[0])",
  hours: "the business's hours, from its details: only a heading and a line (lines[0])",
  booking: "book a time on the business's calendar: only a heading and a line (lines[0])",
  events: "upcoming events from the business's calendar: only a heading and a line (lines[0])",
  map: "a map of the business's address: only a heading and a line (lines[0])",
  faq: "questions and answers: a heading and two to eight items, each a question (name) as a customer asks it and its answer (blurb); only questions the brief lets you answer",
};

export const DRAFT_PAGE_TOOL = {
  name: "write_page",
  description: "The page as blocks, in order, each with its words.",
  input_schema: {
    type: "object" as const,
    properties: {
      description: { type: "string", maxLength: 200 },
      blocks: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...PAGE_BLOCK_KINDS] },
            heading: { type: "string", maxLength: 120 },
            lines: { type: "array", maxItems: 6, items: { type: "string", maxLength: 800 } },
            items: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                properties: { name: { type: "string", maxLength: 60 }, blurb: { type: "string", maxLength: 240 } },
                required: ["name", "blurb"],
              },
            },
            button: { type: "string", maxLength: 40 },
          },
          required: ["kind"],
        },
      },
    },
    required: ["description", "blocks"],
  },
};

export const PAGE_SENTENCE_MAX = 400;

export function buildDraftUserTurn(input: {
  brief: SiteBrief;
  pageTitle: string;
  otherPages: string[];
  sentence: string;
  schedulingOn: boolean;
}): string {
  const kinds = PAGE_BLOCK_KINDS.filter((k) => input.schedulingOn || (k !== "booking" && k !== "events"));
  return [
    ...briefLines(input.brief),
    `The page to write: "${input.pageTitle}".`,
    input.otherPages.length > 0 ? `The site's other pages: ${input.otherPages.join(", ")}. Do not repeat what belongs on them.` : "This is the site's only page.",
    "",
    `What the owner wants on it: ${input.sentence.trim()}`,
    "",
    "Choose the blocks, in order, from these kinds:",
    ...kinds.map((k) => `- ${k}: ${BLOCK_HINTS[k]}`),
    "Use two to six blocks. Start with a hero unless the page is a plain article. Use contact, hours, booking, events and map at most once each and only when the page is about reaching or visiting the business. End with a cta when the page should lead somewhere.",
    "Write the meta description too: one or two sentences, under 160 characters, naming the business and what the page is about.",
  ].join("\n");
}

function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/** Words the model wrote are cut to size, never refused: a long line is still a line. */
const clipped = (max: number) => z.string().transform((s) => cut(s.trim(), max));

const BlockSchema = z.object({
  kind: z.string(),
  heading: clipped(120).default(""),
  lines: z
    .array(clipped(800))
    .default([])
    .transform((a) => a.slice(0, 6)),
  items: z
    .array(z.object({ name: clipped(60), blurb: clipped(240).default("") }))
    .default([])
    .transform((a) => a.slice(0, 8)),
  button: clipped(40).default(""),
});
const DraftSchema = z.object({
  description: clipped(200).default(""),
  blocks: z
    .array(BlockSchema)
    .min(1)
    .transform((a) => a.slice(0, 12)),
});

const ONCE: ReadonlyArray<PageBlockKind> = ["contact", "hours", "booking", "events", "map", "form", "faq"];

type Of<K extends PlainSectionType> = Extract<Section, { type: K }>;

/** A fresh section of one kind, typed as that kind so its words can be set. */
function fresh<K extends PlainSectionType>(type: K): Of<K> {
  return newSection(type) as Of<K>;
}

/** Blocks into real sections, the code's defaults for everything the model did not write; null when nothing usable came back. */
export function assemblePageBlocks(raw: unknown, opts: { schedulingOn: boolean }): PageContent | null {
  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  const sections: Section[] = [];
  let cardId = 0;
  const used = new Set<PageBlockKind>();
  for (const block of parsed.data.blocks) {
    if (!(PAGE_BLOCK_KINDS as readonly string[]).includes(block.kind)) continue;
    const kind = block.kind as PageBlockKind;
    if (ONCE.includes(kind) && used.has(kind)) continue;
    if ((kind === "booking" || kind === "events") && !opts.schedulingOn) continue;
    used.add(kind);
    const heading = cut(block.heading, 80);
    const line = block.lines[0] ?? "";
    const paragraphs = block.lines.filter((l) => l.length > 0);
    switch (kind) {
      case "hero":
        sections.push({
          ...fresh("hero"),
          headline: cut(block.heading, 120) || "Welcome",
          subheadline: cut(line, 240),
          cta: block.button ? { label: block.button, href: "/contact" } : null,
        });
        break;
      case "text":
        if (paragraphs.length === 0 && !heading) break;
        sections.push({ ...fresh("text"), heading, body: paragraphs.slice(0, 8) });
        break;
      case "offer": {
        const items = block.items.filter((i) => i.name).slice(0, 8);
        if (items.length === 0) break;
        sections.push({ ...fresh("offer"), heading: heading || "What we offer", items });
        break;
      }
      case "columns": {
        const items = block.items.filter((i) => i.name).slice(0, 12);
        if (items.length === 0) break;
        sections.push({
          ...fresh("columns"),
          heading,
          intro: cut(line, 300),
          columns: items.length === 2 || items.length === 4 ? (items.length as 2 | 4) : 3,
          cards: items.map((item) => ({
            id: `card${String(cardId++).padStart(2, "0")}`,
            image: null,
            icon: "check",
            heading: cut(item.name, 80),
            body: item.blurb ? [cut(item.blurb, 400)] : [],
            cta: null,
          })),
        });
        break;
      }
      case "cta":
        sections.push({
          ...fresh("cta"),
          headline: cut(block.heading, 120) || "Get in touch",
          cta: { label: block.button || "Get in touch", href: "/contact" },
        });
        break;
      case "form":
        sections.push({ ...fresh("form"), heading: heading || "Send us a message", note: cut(line, 300), buttonLabel: block.button || "Send" });
        break;
      case "contact":
        sections.push({ ...fresh("contact"), heading: heading || "Get in touch", note: cut(line, 300) });
        break;
      case "hours":
        sections.push({ ...fresh("hours"), heading: heading || "Hours", note: cut(line, 200) });
        break;
      case "booking":
        sections.push({ ...fresh("booking"), heading: heading || "Book a time", note: cut(line, 300) });
        break;
      case "events":
        sections.push({ ...fresh("events"), heading: heading || "What's on", note: cut(line, 300) });
        break;
      case "map":
        sections.push({ ...fresh("map"), heading: heading || "Find us", note: cut(line, 300) });
        break;
      case "faq": {
        const items = block.items.filter((i) => i.name && i.blurb).slice(0, 10);
        if (items.length === 0) break;
        sections.push({ ...fresh("faq"), heading: heading || "Common questions", note: cut(line, 300), items: items.map((i) => ({ question: cut(i.name, 120), answer: cut(i.blurb, 600) })) });
        break;
      }
    }
    if (sections.length >= 12) break;
  }
  if (sections.length === 0) return null;
  const content = PageContentSchema.safeParse({ description: parsed.data.description, sections });
  return content.success ? content.data : null;
}

/* -- Describing a photo --------------------------------------------------- */

export const DESCRIBE_PHOTO_TOOL = {
  name: "describe_photo",
  description: "One plain sentence saying what is in the photo, for someone who cannot see it.",
  input_schema: {
    type: "object" as const,
    properties: { description: { type: "string", maxLength: 160 } },
    required: ["description"],
  },
};

export const DESCRIBE_PHOTO_PROMPT =
  "Describe this photo in one plain sentence of at most 160 characters, for someone who cannot see it: what is in the picture, not what it means or how it feels. Do not begin with 'Image of' or 'Photo of'. American English, no exclamation marks.";

export const AltTextSchema = z.object({
  description: z
    .string()
    .trim()
    .transform((s) => s.replace(/^(image|photo|picture) of\s+/i, "").replace(/\s+/g, " ").slice(0, 160).trim())
    .pipe(z.string().min(1)),
});
