import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { PROPOSE_TOOL_NAME, tellToolFor } from "./shape";
import type { TellAction } from "./types";

/**
 * The one network call.
 *
 * The house pattern (`crm/ai/extract-note.ts`, `paste-targets/model.ts`):
 * this is the ONLY function that touches the model, it is injectable so no
 * test calls out, and it never runs inside a transaction.
 *
 * Data minimisation (S9): the sentence, and the labels of the choices — this
 * farm's pens, paddocks and feeds — are the whole tenant payload. Nothing
 * about what is in them, what they cost, or who owns them.
 */

/** A sentence is short and so is its answer. Room to think, not to ramble. */
const MAX_TOKENS = 4_000;

/**
 * Per PERSON, in this process. A person in a barn presses the button once and
 * the box disables while it works; this only has to stop a double submit from
 * two tabs on one server. Stated in the dossier as the limit it is.
 *
 * ── WHY THE KEY IS THE PERSON AND NOT THE TENANT ─────────────────────────────
 *
 * It was the tenant until the device endpoint (ADR 0048) gave this path a
 * second door. Behind a screen the difference never showed: one person, one
 * button, and the button disables itself. A phone has no button and no tab,
 * and five farmhands saying "clock me in" at seven in the morning are five
 * independent callers — a tenant-wide window would answer the first and
 * refuse the other four, silently, from their pockets.
 *
 * The stated purpose above was always per-person ("a double submit"), so this
 * is the key it should have had. `paste-targets/model.ts` keeps the per-tenant
 * key deliberately: a paste is a desk activity behind a dialog that disables
 * itself, and nothing reaches it without a screen.
 *
 * NOT A RATE LIMIT, and never was — it is in-process, so it holds on one
 * serverless instance and no further. The device endpoint's real limit counts
 * rows in `device_grant_uses`.
 */
const COOLDOWN_MS = 5_000;
const lastCallAt = new Map<string, number>();

function cooldownKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

export function claimCooldown(
  tenantId: string,
  userId: string,
  now = Date.now(),
): boolean {
  const key = cooldownKey(tenantId, userId);
  const last = lastCallAt.get(key);
  if (last !== undefined && now - last < COOLDOWN_MS) return false;
  lastCallAt.set(key, now);
  return true;
}

/** For tests, which propose many times a second and never call out. */
export function resetTellCooldown(tenantId: string, userId: string): void {
  lastCallAt.delete(cooldownKey(tenantId, userId));
}

export interface TellCall {
  sentence: string;
  actions: TellAction[];
  today: string;
}

export type TellModel = (call: TellCall) => Promise<unknown>;

function systemPrompt(today: string): string {
  return `You turn one sentence from somebody working on a farm into records.

Today is ${today}.

The sentence was typed or spoken by the person who was there, usually on a phone, standing where it happened. It is short, and it may describe more than one thing: "three chicks dead in pen two and moved the cows to the creek field" is two entries.

Rules that matter more than completeness:

Do not invent. A field the sentence does not give is left out. Never guess how many, never guess which pen, never guess a date. A number somebody has to check is worse than a blank they have to fill.

Choose from what is offered. For a field with choices, copy one exactly when the sentence clearly means it. When the words match none of them, put the sentence's own words in the field instead — a person will pick from the list. Do not pick the nearest one.

One entry per thing that happened. Do not split one event into two records, and do not merge two into one.

If the sentence describes nothing you have an action for, return no entries. That is a valid answer.`;
}

export const callTellModel: TellModel = async (call) => {
  const tool = tellToolFor(call.actions) as unknown as Anthropic.Tool;
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: systemPrompt(call.today),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [tool],
    tool_choice: { type: "tool", name: PROPOSE_TOOL_NAME },
    messages: [{ role: "user", content: call.sentence }],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("no tool_use block in the model's reply");
  return toolUse.input;
};
