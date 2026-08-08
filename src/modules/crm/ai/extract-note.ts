import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { CrmError } from "../core/errors";
import { NOTE_MAX_CHARS } from "./note-shape";

/**
 * The server half of note extraction: the gate, and the one network call.
 *
 * The schemas, limits and pure resolution logic live in `note-shape.ts`,
 * which carries no `server-only` marker because the review dialog imports
 * NOTE_MAX_CHARS from it. Keep it that way — the first version of this file
 * held both, and the client import pulled the Anthropic SDK toward the
 * browser bundle. tsc and the tests were both happy; the build caught it.
 *
 * The house pattern (see accounting/ai/extract.ts):
 *   gather + gate  — ONE tenant transaction; claims the cooldown as it checks it
 *   call the model — the ONLY network function, injectable so tests never call out
 *
 * Network work never happens inside a transaction. Holding a tx open across
 * seconds of model latency is how you exhaust a connection pool.
 *
 * It does not write. `note-actions.ts` writes only what a human reviewed.
 */

/** Per tenant. Long enough that a double-click cannot spend two calls. */
const COOLDOWN_MS = 15_000;

const MAX_TOKENS = 4_000;

/* -- The tool ------------------------------------------------------------- */

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "record_note",
  description:
    "Record what happened in this note as activities, plus any follow-ups it commits to.",
  input_schema: {
    type: "object",
    properties: {
      activities: {
        type: "array",
        description:
          "What actually happened — one entry per distinct interaction. A note describing a single call is ONE activity, not one per topic discussed.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["call", "meeting", "note"],
              description:
                "How it happened. Use 'note' when the note records information rather than an interaction, and for anything that happened over email — email is not a kind here.",
            },
            summary: {
              type: "string",
              description:
                "What happened, in the note's own terms. Do not add detail that is not in the note.",
            },
          },
          required: ["kind", "summary"],
        },
      },
      tasks: {
        type: "array",
        description:
          "Follow-ups the note COMMITS TO — something somebody said they would do. Do not invent next steps that seem sensible; if the note commits to nothing, return an empty array.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The action, phrased as an instruction to do it.",
            },
            dueInDays: {
              type: ["integer", "null"],
              description:
                "Days from today, or null when the note names no timing. 0 means today, 1 tomorrow. 'Next week' is 7. Never guess a date the note does not imply.",
            },
            assigneeHint: {
              type: ["string", "null"],
              description:
                "The name of the person the note says will do it, verbatim, or null if it does not say. Do not guess.",
            },
          },
          required: ["title", "dueInDays", "assigneeHint"],
        },
      },
    },
    required: ["activities", "tasks"],
  },
};

const SYSTEM_PROMPT = `You turn a note about a business relationship into structured records.

The note was written by somebody at the business, about a customer, supplier or contact. Record only what the note says.

Two rules matter more than completeness:

Do not invent. If the note does not say when something is due, or who will do it, return null for that field. A follow-up with no date is useful; a follow-up with a date nobody agreed is worse than nothing, because it will chase somebody on a day they did not commit to.

Do not editorialise. Summaries use the note's own terms. You are transcribing into a shape, not writing a report about it.

If the note records no interaction and commits to nothing, return empty arrays. That is a valid answer.`;

/* -- Gather + gate -------------------------------------------------------- */

export interface NoteGathered {
  tenantId: string;
  partyId: string;
  note: string;
  /** The tenant's today, so day offsets resolve against the business's calendar. */
  today: string;
}

/**
 * Validate, check the record is visible, and claim the cooldown — in one tenant
 * transaction, so concurrent pastes serialize here rather than both calling out.
 *
 * The party read is not decoration: it runs under the caller's RLS, so a
 * record they may not see fails here rather than after a model call.
 */
export async function gatherNoteInput(
  ctx: { tenantId: string; userId: string; role: "owner" | "staff" | "expert" },
  input: { partyId: string; note: string; today: string },
): Promise<NoteGathered> {
  const note = input.note.trim();
  if (note.length === 0) {
    throw new CrmError("NOTE_EMPTY", "a note is required");
  }
  if (note.length > NOTE_MAX_CHARS) {
    throw new CrmError("NOTE_TOO_LONG", `${note.length} chars`);
  }

  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const party = await tx.query.parties.findFirst({
        where: eq(schema.parties.id, input.partyId),
      });
      if (!party) throw new CrmError("RECORD_NOT_FOUND", input.partyId);

      const settings = await tx.query.crmSettings.findFirst({
        where: eq(schema.crmSettings.tenantId, ctx.tenantId),
      });
      if (settings?.aiLastExtractedAt) {
        const age = Date.now() - settings.aiLastExtractedAt.getTime();
        if (age < COOLDOWN_MS) {
          throw new CrmError("AI_COOLDOWN", `last extraction ${age}ms ago`);
        }
      }

      // Claim the slot in the same tx that checked it — see the file header.
      if (settings) {
        await tx
          .update(schema.crmSettings)
          .set({ aiLastExtractedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.crmSettings.id, settings.id));
      } else {
        await tx
          .insert(schema.crmSettings)
          .values({ tenantId: ctx.tenantId, aiLastExtractedAt: new Date() })
          .onConflictDoNothing({ target: schema.crmSettings.tenantId });
      }

      return {
        tenantId: ctx.tenantId,
        partyId: input.partyId,
        note,
        today: input.today,
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );
}

/* -- The network call ----------------------------------------------------- */

/**
 * The only function here that touches the network — injectable so every test
 * above runs without an API key or a bill.
 *
 * Adaptive thinking, unlike the pre-existing call sites which pin it off (see
 * lib/claude.ts): this is a genuine extraction judgement — deciding what counts
 * as one interaction, whether a sentence commits to a follow-up — and the
 * 4,000-token budget has ample room for it alongside a small tool call.
 */
export async function callExtractNoteModel(
  g: NoteGathered,
): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "record_note" },
    // The note is the entire tenant payload. No record name, no history, no
    // contact details — the model needs none of it to do this, and data
    // minimisation is cheaper to keep than to retrofit (S9).
    messages: [{ role: "user", content: g.note }],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new CrmError("AI_NO_RESULT", "no tool_use block");
  return toolUse.input;
}

