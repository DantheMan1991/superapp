import type { DraftableThread } from "@/lib/mail-extensions/types";

/**
 * The prompt seam for drafting an invoice or a bill from a conversation.
 * Pure — no database, no `server-only`, no model call. Table-testable.
 *
 * Mirrors `bill-prompt.ts`: a system prompt, one forced tool, and a builder
 * that turns gathered rows into the user turn. Nothing here decides anything.
 */

/** How much of one message we are willing to send. Enough for an agreement. */
export const MESSAGE_CHAR_CAP = 4000;
/** And how many messages. A long thread's tail is where the deal lands. */
export const MAX_MESSAGES = 20;

export interface ThreadDraftParty {
  id: string;
  name: string;
  /** Known addresses, so the model can match the correspondent. */
  emails: string[];
}

export type ThreadDraftKind = "invoice" | "bill";

export function threadDraftSystemPrompt(kind: ThreadDraftKind): string {
  const record = kind === "invoice" ? "invoice" : "bill";
  const counterparty = kind === "invoice" ? "customer" : "supplier";
  const direction =
    kind === "invoice"
      ? "money the business is OWED for work it agreed to do"
      : "money the business OWES for goods or services it agreed to buy";

  return [
    `You read a business email conversation and propose a draft ${record}.`,
    "",
    `You are looking for ${direction}. If the conversation does not contain a`,
    `clear agreement about ${counterparty === "customer" ? "work and a price" : "a purchase and a price"}, say so`,
    "by returning no lines and explaining why in `caveats`. Proposing an",
    `${record} nobody agreed to is far worse than proposing none.`,
    "",
    "RULES THAT MATTER:",
    "",
    "1. EVERY line must quote the conversation. For each line give the index of",
    "   the message it came from and the exact words, copied character for",
    "   character from that message. Do not paraphrase the quote, do not fix",
    "   its spelling, and do not join words from two messages. The quote is",
    "   checked against the message; a line whose quote cannot be found is",
    "   shown to the reader as unverified.",
    "",
    "2. NEVER invent a figure. If a price was discussed but never settled, or",
    "   only a range was given, do not pick a number — leave the line out and",
    "   put the ambiguity in `caveats`.",
    "",
    "3. Amounts are in whole cents, as integers. $1,250.00 is 125000. If the",
    "   conversation gives a rate and a quantity, give both and let the",
    "   arithmetic follow; do not pre-multiply.",
    "",
    "4. Match the counterparty to one of the known parties by email address",
    "   where you can. If none matches, give the name as written in the",
    "   conversation and leave the id null.",
    "",
    "5. A date the conversation states beats today's date. If no due date was",
    "   agreed, return null rather than guessing terms.",
    "",
    "You are drafting for a human who will read your citations next to the",
    "original email. Be conservative; being caught inventing detail costs more",
    "than missing a line.",
  ].join("\n");
}

export function threadDraftTool(kind: ThreadDraftKind) {
  return {
    name: kind === "invoice" ? "propose_invoice" : "propose_bill",
    description: `Propose a draft ${kind} from the conversation, citing sources.`,
    input_schema: {
      type: "object" as const,
      properties: {
        partyId: {
          type: ["string", "null"],
          description: "Id of the matched party, or null if none matched.",
        },
        partyName: {
          type: "string",
          description: "The counterparty's name as the conversation gives it.",
        },
        issueDate: { type: "string", description: "yyyy-mm-dd" },
        dueDate: { type: ["string", "null"], description: "yyyy-mm-dd or null" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: {
                type: "string",
                description: "Decimal string, e.g. \"1\" or \"2.5\".",
              },
              unitPriceCents: { type: "integer" },
              citationMessageIndex: { type: "integer" },
              citationQuote: {
                type: "string",
                description: "Exact words from that message. Not paraphrased.",
              },
            },
            required: [
              "description",
              "quantity",
              "unitPriceCents",
              "citationMessageIndex",
              "citationQuote",
            ],
          },
        },
        caveats: {
          type: "array",
          items: { type: "string" },
          description: "Anything ambiguous or missing. Plain sentences.",
        },
      },
      required: ["partyName", "issueDate", "lines", "caveats"],
    },
  };
}

/**
 * The conversation, numbered so citations can point at a message.
 *
 * Indices are 0-based and stable for one call — the validator resolves a
 * citation against `thread.messages[i]`, so the numbering the model sees and
 * the numbering that is checked are the same array.
 */
export function buildThreadDraftUserTurn(
  thread: DraftableThread,
  parties: ThreadDraftParty[],
  todayIso: string,
): string {
  const known =
    parties.length > 0
      ? parties
          .map((p) => `${p.id} | ${p.name} | ${p.emails.join(", ")}`)
          .join("\n")
      : "(none on file)";

  const conversation = thread.messages
    .slice(0, MAX_MESSAGES)
    .map((m, i) =>
      [
        `--- message ${i} ---`,
        `from: ${m.from}`,
        `date: ${m.date}`,
        "",
        m.text.slice(0, MESSAGE_CHAR_CAP),
      ].join("\n"),
    )
    .join("\n\n");

  return [
    `Today is ${todayIso}.`,
    "",
    "KNOWN PARTIES (id | name | addresses):",
    known,
    "",
    `SUBJECT: ${thread.subject}`,
    "",
    "CONVERSATION, oldest first:",
    "",
    conversation,
  ].join("\n");
}
