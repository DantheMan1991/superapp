import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { RECIPE_SYSTEM, buildReadPrompt, recordRecipeTool, type ReadRequest } from "./core/draft";

/**
 * THE ONE CLAUDE CALL IN FOOD: a page's words, a paste or photos of a page
 * in, the recipe out, through the `record_recipe` tool (core/draft.ts).
 * Workouts' draft call is the model for it (src/modules/fitness/draft-model.ts
 * says why each part of the request is there): adaptive thinking, forced tool
 * use, streamed to `finalMessage()`, the tool's input streamed eagerly and so
 * read loosely (`normalizeDraft`), the stop reason checked before the input is
 * trusted, and a refusal run again on the fallback model.
 *
 * A page that carries its own recipe data never reaches here: it is read
 * exactly, with no model (`core/recipe-page.ts`).
 *
 * Injected where it is used (`readIntoImport(…, { model })`), so the database
 * half is tested with a function that returns a draft.
 */

export type ReadModel = (request: ReadRequest) => Promise<unknown>;

/** Why Claude's answer could not be used. */
export class ReadModelError extends Error {
  constructor(readonly code: "REFUSED" | "TRUNCATED" | "NO_TOOL") {
    super(code);
    this.name = "ReadModelError";
  }
}

function content(request: ReadRequest) {
  return [
    { type: "text" as const, text: buildReadPrompt(request) },
    ...(request.kind === "photo"
      ? request.pictures.flatMap((picture, i) => [
          ...(request.pictures.length > 1 ? [{ type: "text" as const, text: `Photo ${i + 1}:` }] : []),
          {
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/jpeg" as const, data: picture.jpeg },
          },
        ])
      : []),
  ];
}

export const callReadModel: ReadModel = async (request) => {
  const response = await getClaude()
    .beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 32_000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: RECIPE_SYSTEM,
      tools: [{ ...recordRecipeTool, eager_input_streaming: true }],
      tool_choice: { type: "tool", name: recordRecipeTool.name },
      messages: [{ role: "user", content: content(request) }],
    })
    .finalMessage();

  if (response.stop_reason === "refusal") throw new ReadModelError("REFUSED");
  if (response.stop_reason === "max_tokens") throw new ReadModelError("TRUNCATED");
  const call = response.content.find((block) => block.type === "tool_use" && block.name === recordRecipeTool.name);
  if (!call || call.type !== "tool_use") throw new ReadModelError("NO_TOOL");
  return call.input;
};
