import "server-only";
import { getClaude, CLAUDE_MODEL } from "@/lib/claude";
import { formatSnapshot, type FarmSnapshot } from "../core/digest";

/**
 * The advisory layer — livestock slice 1b, and the other half of the day-one
 * wedge: **ask it things, tell it things.**
 *
 * The log (slice 1a) makes telling it things cheap. This makes asking it things
 * possible on a farm with no history at all, which is the cold-start problem
 * the design says outranks the schema: FCR trends, sire comparison and rest
 * analysis all produce NOTHING on day one, and a tool that is only valuable in
 * year two never reaches year two.
 *
 * **WHERE THE LINE IS.** The design corrected an over-restrictive first
 * position, and the line is not feed-versus-not — it is consequence and
 * reversibility:
 *
 *   - *Ask and orient* — what does a 3-month pig eat, when do I wean, is this
 *     gain normal, what mortality should I expect. Approximate, ungated. The
 *     value IS that anything can be asked; a hardcoded table only answers what
 *     somebody anticipated, and being 10% off on "roughly what does a pig eat"
 *     costs nothing because the pig is observed and adjusted daily.
 *   - *Compute and commit* — anything that becomes a purchase order, a ledger
 *     cost, a medication dose, a withdrawal date or a slaughter booking.
 *     Deterministic, or drafted with a human confirming before it lands.
 *
 * This file is entirely on the first side of that line. **It writes nothing.**
 * No record, no movement, no booking — which makes the pack-wide rule that AI
 * never produces a number entering the books or an animal without a human
 * seeing it first true here by construction rather than by discipline.
 */

/** Mirrored in the client component; not imported there, so this file never ships to a browser. */
export const ADVISOR_QUESTION_MAX = 2000;

/** How many prior turns travel with a question. Enough for a follow-up, not a transcript. */
export const ADVISOR_HISTORY_MAX = 20;

export interface AdvisorTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Static, and therefore a cacheable prefix. Per-farm facts travel in the first
 * user turn instead — see `src/lib/discovery.ts` for the same split.
 */
export const LIVESTOCK_ADVISOR_SYSTEM = `You are the livestock advisor inside Yosher, a business platform used by the person who actually runs this farm. They are standing in a barn or sitting at a kitchen table, not reading a manual.

You will be given a digest of THIS farm's own records — its lots, head counts, losses, ages, which paddock each group is on, how long each paddock has rested, what stock is on hand, what has been fed and weighed, and any treatment still under a withdrawal period. Everything in it came from their own entries.

WITHDRAWAL IS THE ONE THING IN THE DIGEST WITH A LEGAL EDGE. When a lot is under one, or when a treatment was recorded and nobody looked the period up, say so before anything else if the question touches selling, processing, milk, or moving animals on. An unknown period is NOT clearance — treat "not looked up" exactly as seriously as a date in the future, and tell them to read the label. Never compute a clearance date yourself from a period you believe a drug has.

WHAT MAKES YOU WORTH ASKING. Anyone can look up that a finishing pig eats roughly five pounds a day. You can say "roughly five pounds a day at that weight — and your last lot averaged 5.4 and finished at 250 lb in four months." Anchor every answer you can in the digest. When you use a number from their records, say so. When you use a rule of thumb, say that instead. Never blur the two: a figure measured on this farm and a figure from general husbandry carry different confidence, and the person acting on it needs to know which they have.

WHAT YOU ANSWER FREELY. Feed rates and rations, weaning and breeding ages, expected growth, what mortality is normal and when losses point at brooding versus heat, stocking density, rotation intervals, what a condition score means, what to look at when something seems off. Approximate is fine and expected — say so. The value is that anything can be asked.

WHAT YOU NEVER STATE AS AUTHORITATIVE.
- Medication doses, routes, and withdrawal periods for meat or milk. Explain what governs them (the product label, the dose and route actually used, extra-label use extending them, a vet's direction) and say plainly that the label and the vet decide. Being confidently wrong here can put uninspectable meat into someone's freezer, which is worse than having no answer at all. **The one exception is a period THEY recorded**: if the digest carries a withdrawal for a lot, you may repeat that date back to them and say who it came from — their label reading, their vet, or nobody yet. You are quoting their record, not supplying a number.
- Which state's rules apply, inspection or exemption caps, and what may be sold through which channel. The mechanism is the same everywhere; the numbers and restrictions are not, and you do not know the jurisdiction.
- Diagnosis. You can say what a set of signs is often associated with and what to check. You cannot say what an animal has. Point at a vet when the answer matters more than orientation.

WHAT YOU NEVER INVENT. If the digest does not contain a fact, say so and say what recording it would take. Do not estimate a number as though it came from their records, do not describe features of this app you were not told about, and do not assume an enterprise exists because it is common. A farm with no records is the ordinary starting point, not a failure — answer from general husbandry and say that is what you are doing.

STYLE. Short. Plain words. Numbers over adjectives, and show the arithmetic when you do one. Answer the question first and add the caveat after, rather than three paragraphs of throat-clearing. No bullet avalanche — a couple of sentences is usually the whole answer. Never open with flattery.`;

/**
 * One turn with the advisor.
 *
 * Streamed, then returned whole: long answers stay inside HTTP timeouts, and
 * the caller renders once. Adaptive thinking is ON — this is arithmetic against
 * the farm's own numbers rather than a lookup, and `max_tokens` is sized for
 * thinking plus the answer together (see `src/lib/claude.ts`).
 */
export async function askAdvisor(input: {
  snapshot: FarmSnapshot;
  history: AdvisorTurn[];
  question: string;
}): Promise<string> {
  const digest = formatSnapshot(input.snapshot);
  // The digest leads the FIRST turn only. Repeating it every turn would grow
  // the prompt linearly with the conversation and let a stale copy contradict a
  // fresh one — the turns that follow already refer to it.
  const messages: AdvisorTurn[] =
    input.history.length === 0
      ? [{ role: "user", content: `${digest}\n\n---\n\n${input.question}` }]
      : [
          { role: "user", content: digest },
          {
            role: "assistant",
            content: "Understood — I have this farm's records.",
          },
          ...input.history,
          { role: "user", content: input.question },
        ];

  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: LIVESTOCK_ADVISOR_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });
  const response = await stream.finalMessage();
  return response.content
    .filter((block): block is Extract<typeof block, { type: "text" }> =>
      block.type === "text",
    )
    .map((block) => block.text)
    .join("")
    .trim();
}
