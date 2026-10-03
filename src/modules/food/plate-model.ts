import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { PLATE_SYSTEM, recordPlateTool } from "./core/plate";
import { ReadModelError } from "./read-model";

/**
 * THE PLATE CALL (D4a, ADR 0126): one photo of a meal in, the foods on it out,
 * through the `record_plate` tool (core/plate.ts). Built as the recipe reader
 * is (read-model.ts): adaptive thinking, forced tool use, streamed to
 * `finalMessage()`, the tool's input read loosely (`normalizePlate`), the stop
 * reason checked before the input is trusted, a refusal run again on the
 * fallback model. Injected where it is used, so the rest is tested with a
 * function that returns a plate.
 */

export type PlateModel = (jpeg: string) => Promise<unknown>;

export const callPlateModel: PlateModel = async (jpeg) => {
  const response = await getClaude()
    .beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 8_000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: PLATE_SYSTEM,
      tools: [{ ...recordPlateTool, eager_input_streaming: true }],
      tool_choice: { type: "tool", name: recordPlateTool.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "The photo of the meal:" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg } },
          ],
        },
      ],
    })
    .finalMessage();

  if (response.stop_reason === "refusal") throw new ReadModelError("REFUSED");
  if (response.stop_reason === "max_tokens") throw new ReadModelError("TRUNCATED");
  const call = response.content.find((block) => block.type === "tool_use" && block.name === recordPlateTool.name);
  if (!call || call.type !== "tool_use") throw new ReadModelError("NO_TOOL");
  return call.input;
};
