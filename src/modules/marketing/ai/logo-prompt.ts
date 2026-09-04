import {
  DEFAULT_LOGO_PALETTE,
  LOGO_CASES,
  LOGO_LAYOUTS,
  LOGO_LINE_MAX,
  LOGO_MARKS,
  LOGO_TRACKING_MAX,
  LOGO_WEIGHTS,
  type LogoBrief,
} from "@/lib/brand/logo-spec";

/**
 * The prompt half of logo drafting — pure, so the wording is testable and
 * the caller (`logo-generate.ts`) is the only file that touches the network.
 *
 * The model never draws. It fills in a fixed form — layout, words, weight,
 * case, spacing, mark, colours — six times, and the renderer draws the form.
 * The system prompt therefore reads like a brief to a typesetter with a small
 * kit, not like an art brief, and the tool schema IS the kit.
 */

export const LOGO_SYSTEM_PROMPT = `You compose simple wordmarks and monograms for small businesses from a fixed kit. You do not draw; you choose. A renderer turns each choice into a clean vector using one typeface (Noto Sans, regular or bold), so quality comes entirely from good choices: what goes on each line, capitals or not, letter-spacing, whether there is a mark and which, and colour.

Rules for a good set:
- Propose exactly six candidates, and make them genuinely different from each other: vary the layout, the case and whether a mark is used. Never repeat a layout+mark pair.
- At least two candidates use no mark at all (the name alone, well set). At most two are monograms.
- Split a long name across line1 and line2 for a stacked or mark-left lockup; keep a short name on one line. line2 may carry the tagline only when it is short (a few words) and reads well small.
- Letter-spacing: spaced capitals (0.12–0.22) look confident and sign-like; title case is tightest at 0 and never above 0.06.
- Colours are hex like "#1f6f5f". Use the business's own colours when given: the primary for the words (or the mark), the accent for the mark. When none are given, pick from the palette provided and keep to one or two colours per candidate; words are usually the near-black ink "#1f2937" with the colour on the mark. markText is the colour of the initials INSIDE a filled mark — white on a dark mark, ink on a pale one.
- A mark should suit the business without being literal or cute: a leaf suits a farm, a bakery or a landscaper; a hexagon or square suits a trade; a ring or circle suits almost anyone; a bar is a quiet underline for a wordmark.
- Initials: two letters from the name's main words, three at most.
- rationale: one short plain sentence a business owner would understand, under 90 characters, no jargon, no dashes.
- Never invent words the business did not give you. Never add "Inc", "LLC" or a slogan.`;

export const PROPOSE_LOGOS_TOOL = {
  name: "propose_logos",
  description:
    "Six wordmark or monogram candidates for the business, each a complete spec the renderer can draw.",
  input_schema: {
    type: "object" as const,
    properties: {
      candidates: {
        type: "array",
        minItems: 6,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            layout: { type: "string", enum: [...LOGO_LAYOUTS] },
            line1: { type: "string", maxLength: LOGO_LINE_MAX },
            line2: { type: "string", maxLength: LOGO_LINE_MAX },
            initials: { type: "string", maxLength: 3 },
            weight: { type: "string", enum: [...LOGO_WEIGHTS] },
            textCase: { type: "string", enum: [...LOGO_CASES] },
            tracking: { type: "number", minimum: 0, maximum: LOGO_TRACKING_MAX },
            mark: { type: "string", enum: [...LOGO_MARKS] },
            colors: {
              type: "object",
              properties: {
                text: { type: "string" },
                mark: { type: "string" },
                markText: { type: "string" },
              },
              required: ["text", "mark", "markText"],
            },
            rationale: { type: "string", maxLength: 160 },
          },
          required: [
            "layout",
            "line1",
            "line2",
            "initials",
            "weight",
            "textCase",
            "tracking",
            "mark",
            "colors",
            "rationale",
          ],
        },
      },
    },
    required: ["candidates"],
  },
};

export function buildLogoUserTurn(brief: LogoBrief): string {
  const lines = [
    `Business name: ${brief.name}`,
    `Initials the owner would expect: ${brief.initials}`,
    brief.tagline ? `Tagline: ${brief.tagline}` : "Tagline: none",
    `Kind of business: ${brief.industry ?? "not stated; treat as a general small business"}`,
    brief.primaryColor
      ? `Primary colour (chosen by the business): ${brief.primaryColor}`
      : "Primary colour: none chosen",
    brief.accentColor
      ? `Accent colour (chosen by the business): ${brief.accentColor}`
      : "Accent colour: none chosen",
    `Palette to pick from when the business has no colours: ${DEFAULT_LOGO_PALETTE.join(", ")}`,
    "",
    "Propose the six candidates now.",
  ];
  return lines.join("\n");
}
