import "server-only";
import { CLAUDE_FAST_MODEL, CLAUDE_THINKING_OFF, getClaude } from "@/lib/claude";
import type { WalkAnswer, WalkStep } from "../walk-math";
import type { ProposedShape } from "../walk-lines-math";

/**
 * WHAT A STEP COMES TO (X2b, ADR 0098): the answers, turned into the shape of
 * some lines.
 *
 * ── LOOK AT WHAT THIS TOOL CANNOT SAY ───────────────────────────────────────
 *
 * There is no field for a price. Not "unitCost", not "total", not "estimate".
 * The nearest thing is `saidUnitCostCents`, which means *"they told me this
 * figure"* and is checked against the transcript before it is believed. That
 * is the whole safety argument of the slice expressed as a schema: **a model
 * that cannot name a price cannot invent one.**
 *
 * The money is put on afterwards by `priceProposed`, from the assembly
 * library, from what this business charged last time, or from a figure the
 * estimator actually gave. A line with none of those comes out unpriced and
 * says so, which is the honest answer and a visible one.
 *
 * ── A QUANTITY IS QUOTED OR EXPLAINED ───────────────────────────────────────
 *
 * The founder asked for the arithmetic after a stricter first version
 * refused to do any: *"let it derive quantities and show the arithmetic."*
 * So `derivedFrom` is required whenever the figure is not one somebody said
 * outright, and it is shown on the line. What makes a derived number safe is
 * not that a model did not do the sum; it is that the sum is on the screen.
 */

export const PROPOSE_MAX_TOKENS = 3_000;

export const PROPOSE_TOOL = {
  name: "propose_lines",
  description:
    "The lines this phase comes to, from what the estimator said. Shapes only — you never price anything.",
  input_schema: {
    type: "object" as const,
    properties: {
      lines: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description:
                "The estimator's own shorthand, the way this trade writes a line: 'Footing concrete', 'Tile, labour'. Not a sentence.",
            },
            clientDescription: {
              type: "string",
              description:
                "What the client should read instead, when the shorthand would not do. Usually leave this out.",
            },
            clientVisible: {
              type: "boolean",
              description: "False for money that should not be itemised to the client. Default true.",
            },
            unit: {
              type: "string",
              description: "How this trade prices it: lf, sf, sq, cy, ea, ls. Leave out for a lump.",
            },
            quantityThousandths: {
              type: "number",
              description:
                "The quantity times 1000 (176 lf is 176000). ONLY when the estimator said the figure, or when you give the working in derivedFrom. Leave out when you do not know.",
            },
            derivedFrom: {
              type: "string",
              description:
                "REQUIRED when the quantity is not a figure they said outright: the arithmetic, briefly. '2 baths at 3 fixtures each'. This is shown on the line.",
            },
            rooms: {
              type: "array",
              items: { type: "string" },
              maxItems: 40,
              description:
                "The rooms this line covers, copied from the room list by name. PUT THEM HERE AND NOT IN THE DESCRIPTION — the software writes them into the line itself, in the spelling the building uses, and it is how a line covering four rooms can be turned into four lines when that is how this item is bid.",
            },
            costCode: {
              type: "string",
              description: "The cost code's digits, copied from the step or the list you were given.",
            },
            assembly: {
              type: "string",
              description:
                "The name of one of their saved assemblies, copied exactly, when one is what this line is. The assembly supplies the lines and their prices.",
            },
            saidUnitCostCents: {
              type: "number",
              description:
                "A unit cost in CENTS that the estimator gave you in this conversation. Never a figure you worked out, remembered or thought reasonable — it is checked against what they actually said and dropped if it is not there.",
            },
          },
          required: ["description"],
        },
      },
      excluded: {
        type: "string",
        description:
          "One sentence for the estimate's exclusions when this phase is somebody else's, or blank.",
      },
    },
    required: ["lines"],
  },
};

export interface Proposal {
  lines: ProposedShape[];
  excluded: string;
}

export function validateProposal(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.lines)) return null;

  const lines: ProposedShape[] = [];
  for (const item of r.lines) {
    const l = item as Record<string, unknown>;
    if (typeof l?.description !== "string" || l.description.trim() === "") continue;
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
    const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
    /** Room names only — anything that is not a non-empty string is not one. */
    const names = Array.isArray(l.rooms)
      ? l.rooms
          .filter((r): r is string => typeof r === "string" && r.trim() !== "")
          .map((r) => r.trim().slice(0, 120))
          .slice(0, 40)
      : [];
    lines.push({
      description: l.description.trim().slice(0, 300),
      clientDescription: str(l.clientDescription)?.slice(0, 300),
      clientVisible: l.clientVisible !== false,
      unit: str(l.unit)?.slice(0, 24),
      quantityThousandths: num(l.quantityThousandths),
      derivedFrom: str(l.derivedFrom)?.slice(0, 200),
      rooms: names.length > 0 ? names : undefined,
      costCode: str(l.costCode)?.slice(0, 60),
      assembly: str(l.assembly)?.slice(0, 200),
      saidUnitCostCents: num(l.saidUnitCostCents),
    });
  }
  return {
    lines,
    excluded: typeof r.excluded === "string" ? r.excluded.trim().slice(0, 500) : "",
  };
}

export function proposeSystemPrompt(input: {
  projectWord: string;
  jobName: string;
  step: WalkStep;
  answers: readonly WalkAnswer[];
  /**
   * Their own saved items: the name, what each is priced per, and **how each
   * one is bid** — one line covering its rooms, or a line per room (X11).
   * The last of those used to be rule 2b's judgement and is now theirs.
   */
  assemblies: { name: string; per: string; perRoom: boolean }[];
  /**
   * **THE ITEM THIS PHASE ALWAYS MAKES** (X11), when the outline names one.
   *
   * Saying it here is courtesy, not mechanism: `applyPin` puts the assembly
   * on the first line whatever comes back. Telling the model anyway is what
   * makes the rest of the answer fit — the quantity, the rooms and the cost
   * code come out addressed to the right item instead of to a line it
   * invented and then had replaced underneath it.
   */
  pinnedAssembly: string | null;
  /** The codes on THIS job's list, so a line lands somewhere real. */
  costCodes: { code: string; name: string }[];
  /**
   * **THE BUILDING'S OWN NUMBERS** (X7, ADR 0100), one line each.
   *
   * This is where the measure-up pays for itself. Rule 2 below already says
   * a quantity is quoted or explained — these are quoted, by the estimator,
   * before the walk even started. Without them here the measurements would
   * inform the CONVERSATION and not the ESTIMATE, and every line would come
   * out a lump: *"Framing labor — what are you getting for that?"* instead
   * of *"Framing labor, 1,216 sf of wall"*.
   */
  measurements: readonly string[];
  /**
   * **THE ROOMS IN THE BUILDING** (X8), grouped by floor, with their
   * floor areas. What turns *"how much flooring?"* into a question
   * that names a room, and what lets one answer cover a whole floor.
   */
  rooms: readonly string[];
}): string {
  return [
    `You are turning one phase of a ${input.projectWord.toLowerCase()} estimate into lines, from what the estimator just told you. You do not price anything: you say what the lines ARE, and the software puts the money on.`,
    ``,
    `THE ${input.projectWord.toUpperCase()}: ${input.jobName}`,
    `THIS PHASE: ${input.step.title}${input.step.costCode ? ` (cost code ${input.step.costCode})` : ""}`,
    ...(input.rooms.length > 0
      ? [``, `THE ROOMS IN IT, with their floor areas:`, ...input.rooms]
      : []),
    input.measurements.length > 0
      ? [
          ``,
          `MEASURED ON THIS BUILDING — these are quoted numbers, use them:`,
          ...input.measurements,
        ].join("\n")
      : ``,
    input.step.guidance.trim() ? `What the business says about it: ${input.step.guidance.trim()}` : ``,
    ``,
    `WHAT THEY SAID`,
    input.answers.length > 0
      ? input.answers
          .map((a) =>
            a.skipped ? `- ${a.prompt} — PASSED: ${a.skipReason}` : `- ${a.prompt} — ${a.answer}`,
          )
          .join("\n")
      : `(nothing)`,
    ``,
    input.assemblies.length > 0
      ? `THEIR SAVED ASSEMBLIES — name one and it supplies its own lines and prices:\n${input.assemblies
          .map((a) => `- ${a.name} (${a.per})${a.perRoom ? " — BID A LINE PER ROOM" : ""}`)
          .join("\n")}`
      : `THEY HAVE NO SAVED ASSEMBLIES YET.`,
    input.pinnedAssembly
      ? `THIS PHASE IS ALWAYS "${input.pinnedAssembly}". Use it. What you work out is how much of it there is and which rooms it is in; the item itself is settled.`
      : ``,
    ``,
    input.costCodes.length > 0
      ? `COST CODES ON THIS JOB:\n${input.costCodes.map((c) => `- ${c.code} ${c.name}`).join("\n")}`
      : ``,
    ``,
    `THE RULES`,
    ``,
    `1. YOU NEVER PRICE ANYTHING. There is no field for a cost you worked out, and there is no point trying — a figure that is not in what they said is dropped and the line comes out unpriced.`,
    `2. A QUANTITY IS QUOTED OR EXPLAINED. Use the number they gave, or give the arithmetic in derivedFrom. No quantity and no working means leave it out, and the line becomes a lump they can fill in.`,
    `2a. THE MEASUREMENTS ABOVE COUNT AS NUMBERS THEY GAVE. Work from them and put the working in derivedFrom: "perimeter 128 lf x wall height 9.5 = 1,216 sf". A phase that could have been measured and came out a lump is a phase somebody now has to price blind.`,
    `2b. ROLL UP WHAT IS IDENTICAL; SPLIT WHAT DIFFERS. The same product in four rooms is ONE line — add their floor areas and put the addition in derivedFrom. Things that differ from each other get a line each: three showers with different tile are three lines, not one. Fifteen flooring lines is a bill of materials; one line for three different showers is a number nobody can check.`,
    `2c. PUT THE ROOMS IN "rooms" AND NOT IN THE DESCRIPTION. Every line that covers rooms lists them there, by the names above; the software writes them into the line itself. An assembly marked BID A LINE PER ROOM is split up for you — name all of its rooms on ONE line and let it be split, rather than writing the lines out yourself.`,
    `3. USE AN ASSEMBLY when one of theirs is what the line is. That is how a phase gets priced properly, and it is better than several bare lines.`,
    `4. BID OUT IS ONE LINE. A phase they are subbing is a single lump for the subcontract, not a breakdown of somebody else's work.`,
    // No backtick may appear inside this template literal — the same trap
    // that ended proposal-html.ts's stylesheet mid-file.
    `5. BY OTHERS IS NO LINES AT ALL — put one sentence in "excluded" instead.`,
    `6. WRITE THE WAY THEY WRITE. "Footing concrete", not "Supply and placement of concrete to footings".`,
    `7. FEW LINES, NOT MANY. A phase is three or four lines an estimator would recognise, not a bill of materials.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

export async function takeProposal(input: {
  system: string;
}): Promise<Proposal | null> {
  const response = await getClaude().messages.create({
    model: CLAUDE_FAST_MODEL,
    max_tokens: PROPOSE_MAX_TOKENS,
    thinking: CLAUDE_THINKING_OFF,
    system: input.system,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: "tool", name: PROPOSE_TOOL.name },
    messages: [{ role: "user", content: "What does this phase come to?" }],
  });
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === PROPOSE_TOOL.name) {
      return validateProposal(block.input);
    }
  }
  return null;
}
