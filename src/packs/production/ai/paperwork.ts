import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { normalizeImageForVision, VISION_MAX_BYTES } from "@/lib/vision-image";
import { ProductionError } from "../ops";

/**
 * READING SOMEBODY ELSE'S PIECE OF PAPER.
 *
 * **ONE PATH, TWO CONSUMERS, AND THAT IS WHY THEY SHIPPED TOGETHER.** A kill
 * sheet and a processor's price list are the same problem — a photograph or a
 * PDF arrives, a person would otherwise retype it, and what it says has to end
 * up in a table. They differ only in which table. Building the path twice would
 * have meant arguing about the confirm step twice, and the second argument is
 * the one that gets lost.
 *
 * ── THE RULE THAT IS NOT NEGOTIABLE ─────────────────────────────────────────
 *
 * **NOTHING HERE WRITES.** Every function in this file returns a PROPOSAL. A
 * person reads it, corrects it, and presses a button that calls the ordinary
 * ops — `addRunCarcass`, `setHandle` — which validate and audit exactly as they
 * do when somebody types the numbers by hand. That is the design's
 * *compute-and-commit* case, and the reason is specific rather than
 * philosophical:
 *
 *   - a carcass row is **a statement about whether meat was fit to sell**, made
 *     by a licensed plant. An extraction that quietly recorded a condemnation,
 *     or quietly failed to, would be this app putting words in an inspector's
 *     mouth.
 *   - a handle row is **the terms of a commercial relationship**. A fee changed
 *     by an extraction nobody read is worse than a fee nobody typed, because it
 *     looks like it was agreed.
 *
 * ── THE FILE IS NOT KEPT, AND THAT IS A GAP RATHER THAN A DECISION ──────────
 *
 * The bytes are read, sent, and dropped. The design says "the kill sheet as a
 * DOCUMENT", and a kill sheet genuinely is a retained record — but filing it
 * would make `production` the first pack to import a core MODULE, and that is
 * an architectural decision that deserves to be made on its own merits rather
 * than smuggled in behind an AI feature. Recorded as an open item.
 */

/** What can be read. PDFs pass through; images are normalised first. */
export const PAPERWORK_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

/**
 * The cap on what may be uploaded, BEFORE normalisation.
 *
 * Deliberately larger than `VISION_MAX_BYTES`: a phone photograph of a kill
 * sheet is routinely 8–12 MB and `normalizeImageForVision` exists precisely to
 * bring it under the API's limit. Rejecting it here would refuse the exact input
 * this feature was built for. A PDF gets no such help, so it is held to the
 * vision cap.
 */
export const PAPERWORK_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function isPaperworkMime(mime: string): boolean {
  return (PAPERWORK_MIME_TYPES as readonly string[]).includes(mime);
}

export interface PaperworkFile {
  mimeType: string;
  bytes: Uint8Array;
}

/** An image or PDF, ready for the API. */
export interface PaperworkPayload {
  mimeType: string;
  base64: string;
}

export async function preparePaperwork(
  file: PaperworkFile,
): Promise<PaperworkPayload> {
  if (!isPaperworkMime(file.mimeType)) {
    throw new ProductionError(
      "PAPERWORK_INVALID",
      "that is not a kind of file this can read — a photograph or a PDF",
    );
  }
  if (file.bytes.byteLength > PAPERWORK_MAX_UPLOAD_BYTES) {
    throw new ProductionError(
      "PAPERWORK_INVALID",
      "that file is too big to read — a photograph of the page rather than a scan of the whole folder",
    );
  }
  if (
    file.mimeType === "application/pdf" &&
    file.bytes.byteLength > VISION_MAX_BYTES
  ) {
    // A PDF cannot be downscaled the way an image can, so this is the honest
    // refusal rather than a call that would fail at the API with a worse message.
    throw new ProductionError(
      "PAPERWORK_INVALID",
      "that PDF is too big to read — export just the page, or photograph it",
    );
  }
  const normalized = await normalizeImageForVision(file.bytes, file.mimeType);
  return {
    mimeType: normalized.mimeType,
    base64: Buffer.from(normalized.bytes).toString("base64"),
  };
}

/**
 * The only network-touching function, and it is injectable so every test above
 * it runs without a key — the same arrangement `accounting/ai/extract.ts` uses.
 *
 * **FORCED TOOL CHOICE, so the answer is a structured object rather than prose
 * this would then have to parse.** Thinking is left ADAPTIVE and `max_tokens`
 * is generous, which is the opposite of the accounting call site: that one pins
 * thinking off to preserve a budget it was tuned for on an older model. This is
 * a new call site, and reading a smudged, handwritten, column-misaligned kill
 * sheet is exactly the sort of thing thinking helps with.
 */
export async function callPaperworkModel(
  payload: PaperworkPayload,
  system: string,
  // The SDK's own type rather than a hand-rolled shape — it already describes a
  // tool definition, and redefining it here would lose the schema typing.
  tool: Anthropic.Tool,
): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 16_000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [
          payload.mimeType === "application/pdf"
            ? {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: payload.base64,
                },
              }
            : {
                type: "image",
                source: {
                  type: "base64",
                  media_type: payload.mimeType as
                    | "image/jpeg"
                    | "image/png"
                    | "image/webp"
                    | "image/gif",
                  data: payload.base64,
                },
              },
          {
            type: "text",
            text: "Read this and fill in the tool. Leave anything you cannot read out rather than guessing at it.",
          },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new ProductionError(
      "PAPERWORK_INVALID",
      "nothing could be read off that — try a straighter photograph, or type it in",
    );
  }
  return toolUse.input;
}

/**
 * A number as it came off a page, or null.
 *
 * **NULL IS THE POINT OF THIS FUNCTION.** An unreadable weight is not a zero,
 * and a zero on a kill sheet is a real value meaning the animal produced
 * nothing. Anything that is not a finite number in range becomes null, which
 * every consumer renders as an empty field for a person to fill in — the same
 * rule the rest of this pack applies to an unquoted fee and an unweighed
 * carcass.
 */
export function readNumber(
  value: unknown,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  /**
   * **AN EMPTY STRING IS NOT A ZERO, and `Number("")` is.** Caught by a test
   * that expected null and got 0 — which is the exact failure this whole slice
   * is built to prevent: a blank cell on a rate sheet becoming a confident
   * $0.00 fee that reads as "they waived it" rather than "nobody said".
   * Whitespace-only is the same case.
   */
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (opts.integer && !Number.isInteger(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

/** Trimmed text, or "" — never undefined, so a form can bind to it directly. */
export function readText(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}
