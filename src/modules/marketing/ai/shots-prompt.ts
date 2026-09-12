import type { SiteBrief } from "@/lib/sites/copy";
import type { Spot } from "@/lib/sites/shots";
import { SHAPE_LABELS } from "@/lib/sites/shots";

/**
 * WHAT TO PHOTOGRAPH, written for one page (slice 19).
 *
 * The core's standing notes are true of any business and therefore say
 * nothing about this one — "Something that says what you do at a glance" is
 * not a shot anybody can go and take. What makes a note actionable is the
 * subject, and the subject depends on what the business SELLS, which the page
 * cannot work out for itself.
 *
 * **THE CASE THAT FORCED THIS.** A farm's own site wants its pasture in the
 * hero and its cuts on the shop tiles. A site selling SOFTWARE TO FARMS wants
 * the pasture in the hero too — it is the reader's world — and a screenshot of
 * the herd screen on the feature card beside it. Same words on the page, two
 * completely different shot lists, and only something reading the business's
 * own description can tell them apart. So the model is told about both kinds
 * of picture and told to choose per spot.
 */

const ROLE_IN_WORDS: Record<Spot["role"], string> = {
  cover: "a full-width picture with the headline sitting ON it, so the subject must sit low or to one side and leave quiet space for words",
  beside: "a picture beside the headline on a wide screen, read at about half the page",
  about: "a picture beside the story paragraphs — who is behind this, or where it happens",
  item: "a small square tile for one thing being sold",
  card: "a picture above a card's heading, read small; one clear subject, centred",
  picture: "a picture given a whole row to itself, so it can carry some weight",
  set: "one of several that will be seen together, so they should share a light and a mood",
  backdrop: "texture behind white words, darkened on the page; nothing with a subject that would fight the text",
};

export const WRITE_SHOTS_TOOL = {
  name: "write_shots",
  description:
    "Say what picture to take or make for each spot on this page. One entry per key you were given, and no keys you were not.",
  input_schema: {
    type: "object",
    properties: {
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "The spot's key, exactly as given." },
            note: {
              type: "string",
              description:
                "One or two plain sentences saying what to point the camera at, or what to capture on screen. Concrete enough to act on without asking anything.",
            },
          },
          required: ["key", "note"],
        },
      },
    },
    required: ["shots"],
  },
} as const;

export const WRITE_SHOTS_PROMPT = `You are writing a shot list for one page of a small business's website.

For every spot you are given, say what picture belongs there. You are writing for whoever is going to go and get that picture — usually the owner, with a phone, between jobs.

WHAT MAKES A NOTE USEFUL

- Name the SUBJECT. "A wide view of the pasture with the cattle grazing and open sky above them" is a note. "Something that shows what you do" is not.
- Say where and when it helps: the light, the time of day, how far back to stand, what to leave room for.
- One or two sentences. No preamble, no "consider", no lists.
- Write it as an instruction to a person, not a description of a stock photo.

A PICTURE IS NOT ALWAYS A PHOTOGRAPH

Read what this business actually sells before you decide what each spot wants.

- A business that sells a PLACE, a PRODUCT or ITS OWN WORK wants photographs of that: the farm, the cuts of meat, the finished job, the people.
- A business that sells SOFTWARE, A SERVICE or EXPERTISE to an industry usually wants both. The big picture at the top belongs to the READER's world — the farm, the workshop, the shop floor — because that is who they are and what they came for. The small pictures next to specific features usually want a SCREENSHOT of the thing being described, because that is the proof. Say which, and for a screenshot say what should be on the screen and roughly what the data should look like.
- When a spot is about a named feature or a step, ask what would convince somebody it is real, and ask for that.

A SCREENSHOT MUST BE OF A SCREEN THAT EXISTS

When you ask for a screenshot you are sending somebody to go and find that screen. You will be given THE TOOLS THIS PRODUCT SHIPS, each with a line about what it holds. Every screenshot you describe must be of one of those, and must show only what that line supports.

If the page makes a claim no tool on the list covers, do NOT invent the screen. Either ask for the nearest screen that does exist and say what it shows, or ask for a photograph instead. A note that sends somebody hunting for a report nobody built is worse than a plain photograph of the work.

Do not name a screen, a view, a report or a button unless the list supports it.

STAY INSIDE WHAT YOU WERE TOLD

Everything you say must be something this business plausibly has. Use the words on the page and the business's own description. Do not invent a location, a product, a person, an award or a number. If a spot's subject is genuinely unclear, ask for the most ordinary honest thing — the place, the work being done, the thing itself.

RESPECT THE SPOT

Each spot tells you its shape and how it is read. A cover has words over it and needs quiet space. A card is read small and needs one subject. A backdrop must not compete with text. Say so in the note where it changes what to take.

Answer with one entry per key you were given, using the keys exactly as written.`;

/** Everything the model needs for one page: the business, the page, and every spot on it. */
export function buildShotsUserTurn(input: {
  brief: SiteBrief;
  pageTitle: string;
  pagePath: string;
  pageDescription: string;
  spots: Spot[];
  /**
   * The tools the product ships — the bound on any screenshot. Empty when the
   * caller has none to give, and the prompt then has nothing to point at, so
   * the model is told to keep to photographs.
   */
  catalogue?: Array<{ name: string; description: string }>;
}): string {
  const { brief } = input;
  const business = [
    `Name: ${brief.name || "(not given)"}`,
    brief.tagline ? `Tagline: ${brief.tagline}` : "",
    brief.industry ? `Kind of business: ${brief.industry}` : "",
    brief.address ? `Where: ${brief.address.replace(/\r?\n/g, ", ")}` : "",
    // The owner's own words about the business are the single strongest
    // signal for whether a spot wants a photograph or a screenshot.
    brief.about ? `What they say about themselves:\n${brief.about}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const spots = input.spots
    .map((spot) => {
      const lines = [
        `- key: ${spot.key}`,
        `  where it sits: ${spot.sectionLabel}${spot.label ? ` — ${spot.label}` : ""}`,
        spot.heading ? `  the words near it: ${spot.heading}` : "",
        `  how it is read: ${ROLE_IN_WORDS[spot.role]}`,
        `  shape: ${SHAPE_LABELS[spot.shape]}`,
        spot.optional ? "  optional: a picture is not required here" : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n");

  const catalogue = (input.catalogue ?? [])
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  return `THE TOOLS THIS PRODUCT SHIPS
${catalogue || "(none given — ask for photographs, not screenshots)"}

THE BUSINESS
${business}

THE PAGE
${input.pageTitle} (${input.pagePath})
${input.pageDescription || "(no description)"}

THE SPOTS
${spots}`;
}
