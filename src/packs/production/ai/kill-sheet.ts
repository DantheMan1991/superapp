import "server-only";
import {
  callPaperworkModel,
  preparePaperwork,
  readNumber,
  readText,
  type PaperworkFile,
} from "./paperwork";

/**
 * A photographed kill sheet, read into proposed carcass lines.
 *
 * **IT PROPOSES; IT NEVER RECORDS.** The rows come back to a screen, a person
 * corrects them against the paper still in their hand, and `addRunCarcass`
 * writes them one at a time with the same validation and the same audit entry
 * as if they had been typed. See `paperwork.ts` for why that is not negotiable
 * here in particular.
 */

/**
 * **THE PROMPT'S REAL JOB IS TEACHING IT WHEN TO SAY NOTHING.** A model asked to
 * read a smudged sheet will produce a plausible number for every cell, and a
 * plausible hanging weight is indistinguishable from a real one once it is in
 * the table. Every instruction below is aimed at the same thing: leave it out.
 */
const SYSTEM = `You are reading a meat processor's kill sheet so a farmer does not have to retype it. Fill in the tool with what the page actually says.

WHAT A KILL SHEET IS. It records what came off the line between the animal and the box: how many head, what they weighed live, what the carcasses weighed hanging, and anything the plant condemned. Layouts vary wildly — printed forms, handwriting on a template, a photograph of a clipboard.

RULES, IN ORDER OF IMPORTANCE.

1. LEAVE OUT WHAT YOU CANNOT READ. Null is always available and is always better than a guess. A farmer who sees an empty box types the number in; a farmer who sees a confident wrong number does not notice it. This applies to every field independently — a line whose hanging weight is illegible still has a readable head count.

2. NEVER CALCULATE ANYTHING. Do not derive a live weight from a hanging weight, do not divide a total by a count to get a per-head figure, do not sum lines to fill in a total. Only report numbers that are written on the page. If the sheet shows a total and no line detail, report one line with that total.

3. ONE LINE IS ONE OUTCOME. A sheet reading "100 birds, 3 condemned" is TWO lines: 97 that passed and 3 that did not. Never one line with a condemned count on it.

4. A CONDEMNED LINE HAS NO HANGING WEIGHT. Nothing off it can be sold, so there are no pounds to record. If the page shows a weight beside a condemnation, leave hangingLb null — that number is something else.

5. WEIGHTS ARE TOTALS FOR THE LINE, in pounds. If the sheet is per-animal and shows 12 animals at 61 lb each, that is a line of 12 head with a total, only if the page shows the total. If it does not, report 12 separate lines.

6. THE CONDEMN REASON IS THE PLANT'S WORDS. Copy them. Do not tidy "airsac" into "airsacculitis", do not translate an abbreviation you are unsure of, and leave it empty if the page gives no cause — an unexplained condemnation is a real and common thing.

7. IGNORE ANYTHING THAT IS NOT THE ANIMALS. Prices, fees, dates, addresses, establishment numbers and signatures are not carcass lines.

If the page is not a kill sheet at all, return no lines and say so in the note.`;

const TOOL = {
  name: "record_kill_sheet",
  description:
    "Report the carcass lines written on a kill sheet, and nothing that is not written on it.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      lines: {
        type: "array",
        description:
          "One entry per outcome. Passed animals and condemned animals are always separate entries.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            tag: {
              type: "string",
              description:
                "The animal's identifier if the sheet gives one — an ear tag, a carcass number. Empty for a batch line covering many animals.",
            },
            headCount: {
              type: "integer",
              description: "How many animals this line covers. At least 1.",
            },
            liveLb: {
              type: ["number", "null"],
              description:
                "Total live weight for this line in pounds, off the plant's scale. Null if the page does not give one.",
            },
            hangingLb: {
              type: ["number", "null"],
              description:
                "Total hanging weight for this line in pounds. Null if not given, and ALWAYS null when condemned is true.",
            },
            condemned: {
              type: "boolean",
              description: "True if the plant condemned these animals.",
            },
            condemnReason: {
              type: "string",
              description:
                "The plant's stated cause, in the plant's own words. Empty when condemned is false, or when the page gives no cause.",
            },
          },
          required: [
            "tag",
            "headCount",
            "liveLb",
            "hangingLb",
            "condemned",
            "condemnReason",
          ],
        },
      },
      note: {
        type: "string",
        description:
          "Anything a person should know before accepting this — what was unreadable, what was ambiguous, or that the page is not a kill sheet.",
      },
    },
    required: ["lines", "note"],
  },
} as const;

export interface ProposedCarcassLine {
  tag: string;
  headCount: number;
  liveLb: number | null;
  hangingLb: number | null;
  condemned: boolean;
  condemnReason: string;
}

export interface KillSheetProposal {
  lines: ProposedCarcassLine[];
  note: string;
}

/**
 * Turn whatever came back into something a form can bind to. NEVER THROWS on
 * shape — a malformed answer becomes zero lines and a note, because the screen
 * has a perfectly good fallback (type it in) and an exception there would take
 * the dialog down instead of degrading.
 *
 * **THE INVARIANTS ARE RE-APPLIED HERE, not trusted from the prompt.** The rule
 * that a condemned line carries no hanging weight is a CHECK constraint on the
 * table; a proposal that violated it would be a form somebody fills in, presses
 * save on, and gets a constraint violation from. So it is enforced on the way
 * out of the model as well as on the way into the database.
 */
export function validateKillSheet(raw: unknown): KillSheetProposal {
  if (!raw || typeof raw !== "object") return { lines: [], note: "" };
  const source = raw as Record<string, unknown>;
  const rawLines = Array.isArray(source.lines) ? source.lines : [];

  const lines: ProposedCarcassLine[] = [];
  for (const entry of rawLines.slice(0, 200)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const headCount = readNumber(row.headCount, {
      min: 1,
      max: 1_000_000,
      integer: true,
    });
    // A line covering no animals is not a line. Everything else can be blank.
    if (headCount === null) continue;
    const condemned = row.condemned === true;
    lines.push({
      tag: readText(row.tag, 120),
      headCount,
      liveLb: readNumber(row.liveLb, { min: 0.0001, max: 100_000_000 }),
      // Enforced, not trusted: the table's CHECK says the same thing.
      hangingLb: condemned
        ? null
        : readNumber(row.hangingLb, { min: 0.0001, max: 100_000_000 }),
      condemned,
      // Likewise — a passed line carries no cause.
      condemnReason: condemned ? readText(row.condemnReason, 500) : "",
    });
  }
  return { lines, note: readText(source.note, 2000) };
}

export async function readKillSheet(
  file: PaperworkFile,
  callModel = callPaperworkModel,
): Promise<KillSheetProposal> {
  const payload = await preparePaperwork(file);
  const raw = await callModel(payload, SYSTEM, TOOL as never);
  return validateKillSheet(raw);
}
