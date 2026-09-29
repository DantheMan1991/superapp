import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { DRAFT_SYSTEM, buildDraftPrompt, recordProgramTool, type DraftRequest } from "./core/draft";
import type { ProgramInput } from "./core/program";
import { ADDITIONS_SYSTEM, buildAdditionsPrompt, recordAdditionsTool } from "./core/read-again";

/**
 * THE ONE CLAUDE CALL IN WORKOUTS: the pages of a program PDF in, the
 * program out, through the `record_program` tool (core/draft.ts).
 *
 * Injected everywhere it is used (`draftProgram(ctx, request, { model })`),
 * so the database half is tested with a function that returns a draft — the
 * pattern paste-a-list and the setup interview set.
 *
 * The request, and why each part of it:
 *
 * - **`CLAUDE_MODEL` with adaptive thinking.** Putting a program together from
 *   overview tables, exercise pages and a list of links is reading, not
 *   chatting; it happens once per program and a better draft is worth the
 *   minute. `max_tokens` covers the thinking AND the tool call, so it is
 *   generous: a truncated tool call is a lost draft.
 * - **Forced tool use.** Works with thinking on for this model — verified, per
 *   the note in src/lib/claude.ts.
 * - **Streamed, `finalMessage()`.** A long answer on a non-streamed request
 *   risks the HTTP timeout; nothing streams to the browser.
 * - **`eager_input_streaming` on the tool.** The tool input — the whole
 *   program — streams as it is written instead of arriving in one burst after
 *   the server buffers it. The API then does not validate it, which is why
 *   `normalizeDraft` holds it loosely and `programInputSchema` has the last
 *   word, and why the stop reason is checked before the input is trusted.
 * - **A refusal falls back to `claude-opus-4-8`** (server-side fallbacks,
 *   beta). A workout program should never be declined, but if a classifier
 *   ever does, the same request runs again on the other model inside the same
 *   call rather than the person being told nothing could be read.
 * - **No prompt cache.** One call per program, and the frozen prefix is under
 *   the model's minimum cacheable length anyway.
 */

export type DraftModel = (request: DraftRequest) => Promise<unknown>;

/** Reading a program again (F4b): the pages, and the program as the app has it. */
export type AdditionsModel = (request: DraftRequest, program: ProgramInput) => Promise<unknown>;

/** Why Claude's answer could not be used, for the sentence the person sees. */
export class DraftModelError extends Error {
  constructor(readonly code: "REFUSED" | "TRUNCATED" | "NO_TOOL") {
    super(code);
    this.name = "DraftModelError";
  }
}

/**
 * The words, then each picture of a page (F4b, ADR 0117) after a line naming
 * it: a table given as an image is read with the words that point to it.
 */
function content(text: string, request: DraftRequest) {
  return [
    { type: "text" as const, text },
    ...request.pictures.flatMap((picture) => [
      { type: "text" as const, text: `Page ${picture.n}, as a picture:` },
      {
        type: "image" as const,
        source: { type: "base64" as const, media_type: "image/jpeg" as const, data: picture.jpeg },
      },
    ]),
  ];
}

async function callTool(
  system: string,
  tool: { name: string; description: string; input_schema: Record<string, unknown> & { type: "object" } },
  text: string,
  request: DraftRequest,
): Promise<unknown> {
  const response = await getClaude()
    .beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 64_000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system,
      tools: [{ ...tool, eager_input_streaming: true }],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: content(text, request) }],
    })
    .finalMessage();

  // Before reading the tool input: a refused or cut-off answer can still carry
  // a tool_use block, holding a program that stops halfway.
  if (response.stop_reason === "refusal") throw new DraftModelError("REFUSED");
  if (response.stop_reason === "max_tokens") throw new DraftModelError("TRUNCATED");
  const call = response.content.find((block) => block.type === "tool_use" && block.name === tool.name);
  if (!call || call.type !== "tool_use") throw new DraftModelError("NO_TOOL");
  return call.input;
}

export const callDraftModel: DraftModel = (request) =>
  callTool(DRAFT_SYSTEM, recordProgramTool, buildDraftPrompt(request), request);

export const callAdditionsModel: AdditionsModel = (request, program) =>
  callTool(ADDITIONS_SYSTEM, recordAdditionsTool, buildAdditionsPrompt(request, program), request);
