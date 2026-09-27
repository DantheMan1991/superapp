import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import {
  DRAFT_SYSTEM,
  RECORD_PROGRAM_TOOL,
  buildDraftPrompt,
  recordProgramTool,
  type DraftRequest,
} from "./core/draft";

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

/** Why Claude's answer could not be used, for the sentence the person sees. */
export class DraftModelError extends Error {
  constructor(readonly code: "REFUSED" | "TRUNCATED" | "NO_TOOL") {
    super(code);
    this.name = "DraftModelError";
  }
}

export const callDraftModel: DraftModel = async (request) => {
  const response = await getClaude()
    .beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 64_000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: DRAFT_SYSTEM,
      tools: [{ ...recordProgramTool, eager_input_streaming: true }],
      tool_choice: { type: "tool", name: RECORD_PROGRAM_TOOL },
      messages: [{ role: "user", content: buildDraftPrompt(request) }],
    })
    .finalMessage();

  // Before reading the tool input: a refused or cut-off answer can still carry
  // a tool_use block, holding a program that stops halfway.
  if (response.stop_reason === "refusal") throw new DraftModelError("REFUSED");
  if (response.stop_reason === "max_tokens") throw new DraftModelError("TRUNCATED");
  const call = response.content.find(
    (block) => block.type === "tool_use" && block.name === RECORD_PROGRAM_TOOL,
  );
  if (!call || call.type !== "tool_use") throw new DraftModelError("NO_TOOL");
  return call.input;
};
