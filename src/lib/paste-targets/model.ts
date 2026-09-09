import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { normalizeImageForVision } from "@/lib/vision-image";
import { proposeToolFor, PROPOSE_TOOL_NAME } from "./shape";
import type { PasteField } from "./types";

/**
 * The one network call, and the image it may carry.
 *
 * The house pattern (`crm/ai/extract-note.ts`, `accounting/ai/extract.ts`):
 * this is the ONLY function that touches the model, it is injectable so no
 * test ever calls out, and it never runs inside a transaction — `resolve.ts`
 * describes the target in one tenant transaction, calls this between, and
 * checks duplicates in another.
 *
 * Data minimisation (S9): the pasted text, the photo, and the labels of the
 * choices are the whole tenant payload. `types.ts` says why the labels.
 */

/**
 * Enough for two hundred rows of six fields with room to think. The tool call
 * is the bulk of it; a herd book photographed forty animals at a time is far
 * inside.
 */
const MAX_TOKENS = 16_000;

/**
 * Per tenant, in this process. The other extractors keep theirs on a settings
 * row; the platform has none, and a paste is always a person pressing a button
 * that the dialog disables while it works, so the window only has to stop a
 * double submit from two tabs. Stated in the dossier as the limit it is.
 */
const COOLDOWN_MS = 10_000;
const lastCallAt = new Map<string, number>();

/** True when this tenant may call now; claims the window as it checks. */
export function claimCooldown(tenantId: string, now = Date.now()): boolean {
  const last = lastCallAt.get(tenantId);
  if (last !== undefined && now - last < COOLDOWN_MS) return false;
  lastCallAt.set(tenantId, now);
  return true;
}

/** For tests, which propose several times a second and never call out. */
export function resetPasteCooldown(tenantId: string): void {
  lastCallAt.delete(tenantId);
}

export interface PasteImage {
  mimeType: string;
  base64: string;
}

/** Downscaled for the vision API; a PDF passes through. */
export async function prepareImage(bytes: Uint8Array, mimeType: string): Promise<PasteImage> {
  const normalized = await normalizeImageForVision(bytes, mimeType);
  return {
    mimeType: normalized.mimeType,
    base64: Buffer.from(normalized.bytes).toString("base64"),
  };
}

export interface ProposeCall {
  about: string;
  fields: PasteField[];
  text: string;
  image: PasteImage | null;
}

export type ProposeModel = (call: ProposeCall) => Promise<unknown>;

function systemPromptFor(about: string): string {
  return `You turn a pasted list — typed, copied out of a spreadsheet, or photographed — into rows for a business's records.

The list is about ${about}. Return one row per thing in it, in the order they appear.

Copy, do not invent. A field the list does not give is null. Never fill a field from what would be typical for such a thing; only from what is written or shown. Never merge two things into one row, and never split one thing into two.

For a field with choices, copy one choice exactly when the list clearly means it. When nothing fits, write the words the list uses, so a person can decide.

Column headings, numbering, totals, notes about the list itself, and lines that are not one of these things are not rows. If the list holds nothing of this kind, return no rows. That is a valid answer.`;
}

type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

function contentFor(call: ProposeCall): Anthropic.MessageParam["content"] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (call.image) {
    blocks.push(
      call.image.mimeType === "application/pdf"
        ? {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: call.image.base64 },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: call.image.mimeType as ImageMime,
              data: call.image.base64,
            },
          },
    );
  }
  const text = call.text.trim();
  if (text) blocks.push({ type: "text", text: `The list:\n\n${text}` });
  blocks.push({ type: "text", text: "Read every row." });
  return blocks;
}

/**
 * Adaptive thinking, like the note extractor: deciding what is a row and what
 * is a heading, and which of the choices a line means, is a judgement, and
 * the budget has room for it beside the tool call.
 */
export const callProposeModel: ProposeModel = async (call) => {
  const tool = proposeToolFor(call.fields) as unknown as Anthropic.Tool;
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: systemPromptFor(call.about),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [tool],
    tool_choice: { type: "tool", name: PROPOSE_TOOL_NAME },
    messages: [{ role: "user", content: contentFor(call) }],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("no tool_use block in the model's reply");
  return toolUse.input;
};
