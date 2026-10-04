import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { LIST_NAMES_SYSTEM, recordItemsTool } from "./core/list-names";
import { ReadModelError } from "./read-model";

/**
 * THE NAMING CALL (D3, ADR 0130): a list's new lines in, what each buys out,
 * through the `record_items` tool (core/list-names.ts). Built as the plate's
 * is (plate-model.ts): adaptive thinking, forced tool use, streamed to
 * `finalMessage()`, the stop reason checked before the input is trusted, a
 * refusal run again on the fallback model. Injected where it is used, so the
 * rest is tested with a function that names lines.
 */

export type NamesModel = (prompt: string) => Promise<unknown>;

export const callNamesModel: NamesModel = async (prompt) => {
  const response = await getClaude()
    .beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 16_000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: LIST_NAMES_SYSTEM,
      tools: [{ ...recordItemsTool, eager_input_streaming: true }],
      tool_choice: { type: "tool", name: recordItemsTool.name },
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();

  if (response.stop_reason === "refusal") throw new ReadModelError("REFUSED");
  if (response.stop_reason === "max_tokens") throw new ReadModelError("TRUNCATED");
  const call = response.content.find((block) => block.type === "tool_use" && block.name === recordItemsTool.name);
  if (!call || call.type !== "tool_use") throw new ReadModelError("NO_TOOL");
  return call.input;
};
