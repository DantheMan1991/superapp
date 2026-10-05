import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { NUTRITION_SYSTEM, recordMatchesTool } from "./core/nutrition";
import { ReadModelError } from "./read-model";

/**
 * THE MATCHING CALL (D4, ADR 0131): a recipe's lines in, for each the words to
 * find it on USDA's ingredient list and about how many grams it means, through
 * the `record_matches` tool (core/nutrition.ts). Built as the plate's and the
 * list's are: adaptive thinking, forced tool use, streamed to `finalMessage()`,
 * the stop reason checked before the input is trusted, a refusal run again on
 * the fallback model. Injected where it is used, so the rest is tested with a
 * function that matches lines.
 */

export type MatchModel = (prompt: string) => Promise<unknown>;

export const callMatchModel: MatchModel = async (prompt) => {
  const response = await getClaude()
    .beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 16_000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: NUTRITION_SYSTEM,
      tools: [{ ...recordMatchesTool, eager_input_streaming: true }],
      tool_choice: { type: "tool", name: recordMatchesTool.name },
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();

  if (response.stop_reason === "refusal") throw new ReadModelError("REFUSED");
  if (response.stop_reason === "max_tokens") throw new ReadModelError("TRUNCATED");
  const call = response.content.find((block) => block.type === "tool_use" && block.name === recordMatchesTool.name);
  if (!call || call.type !== "tool_use") throw new ReadModelError("NO_TOOL");
  return call.input;
};
