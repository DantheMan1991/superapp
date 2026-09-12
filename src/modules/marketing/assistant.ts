import "server-only";
import { z } from "zod";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import type { SiteBrief } from "@/lib/sites/copy";
import type { PageContent, Section } from "@/lib/sites/schema";
import { normalizeImageForVision } from "@/lib/vision-image";
import {
  AltTextSchema,
  applyWords,
  ASSISTANT_SYSTEM_PROMPT,
  assemblePageBlocks,
  buildDraftUserTurn,
  buildRewriteUserTurn,
  DESCRIBE_PHOTO_PROMPT,
  DESCRIBE_PHOTO_TOOL,
  DRAFT_PAGE_TOOL,
  REWRITE_SECTION_TOOL,
  sectionWords,
} from "./ai/assistant-prompt";
import type { Spot } from "@/lib/sites/shots";
import { buildShotsUserTurn, WRITE_SHOTS_PROMPT, WRITE_SHOTS_TOOL } from "./ai/shots-prompt";
import { MarketingError } from "./core/errors";

/** What the model must hand back; anything else is the one friendly refusal. */
const ShotNotesAnswer = z.object({
  shots: z.array(z.object({ key: z.string().max(40), note: z.string().max(600) })).max(80),
});

/**
 * The assistant in the editor — the half that talks to the model (slice
 * 12). One shape for all three jobs: a system prompt, one forced tool, a
 * user turn, adaptive thinking with room for it; what comes back is the
 * tool's input and nothing else, and the pure half decides whether it is
 * usable. Every call is optional in the same sense the copywriter's is —
 * without a key the buttons are not drawn — and every failure is the one
 * friendly refusal, with the reason in the log.
 */
type Content = string | Array<{ type: "image"; source: { type: "base64"; media_type: string; data: string } } | { type: "text"; text: string }>;

interface ToolCall {
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  content: Content;
  maxTokens: number;
}

export type ModelCall = (call: ToolCall) => Promise<unknown>;

/** The only network-touching function — injectable in tests. */
export async function callAssistantModel(call: ToolCall): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: call.maxTokens,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [call.tool as never],
    tool_choice: { type: "tool", name: call.tool.name },
    messages: [{ role: "user", content: call.content as never }],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error(`no tool_use block for ${call.tool.name}`);
  return toolUse.input;
}

export function assistantOn(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function refused(what: string, err?: unknown): MarketingError {
  console.error(`assistant: ${what}`, err instanceof Error ? err.message : err ?? "");
  return new MarketingError("ASSISTANT_FAILED", what);
}

/** New words for one section's text slots; everything else on it untouched. */
export async function rewriteSectionWords(
  input: { brief: SiteBrief; pageTitle: string; section: Section; instruction: string },
  call: ModelCall = callAssistantModel,
): Promise<Section> {
  const words = sectionWords(input.section);
  if (Object.keys(words).length === 0) throw refused("nothing to rewrite in this section");
  let raw: unknown;
  try {
    raw = await call({
      tool: REWRITE_SECTION_TOOL,
      content: buildRewriteUserTurn({ ...input, kind: input.section.type, words }),
      maxTokens: 4000,
    });
  } catch (err) {
    throw refused("rewrite call failed", err);
  }
  const parsed = z.object({ words: z.record(z.string(), z.string()) }).safeParse(raw);
  if (!parsed.success) throw refused("rewrite answer was not words by slot");
  const next = applyWords(input.section, parsed.data.words);
  if (!next) throw refused("rewrite answer did not fit the section");
  return next;
}

/** A page's sections and description from a sentence, with the code's defaults for everything the model did not write. */
export async function draftPageContent(
  input: { brief: SiteBrief; pageTitle: string; otherPages: string[]; sentence: string; schedulingOn: boolean },
  call: ModelCall = callAssistantModel,
): Promise<PageContent> {
  let raw: unknown;
  try {
    raw = await call({ tool: DRAFT_PAGE_TOOL, content: buildDraftUserTurn(input), maxTokens: 8000 });
  } catch (err) {
    throw refused("page call failed", err);
  }
  const content = assemblePageBlocks(raw, { schedulingOn: input.schedulingOn });
  if (!content) throw refused("page answer had no usable blocks");
  return content;
}

/** One sentence for someone who cannot see the photo. The pixels go to the model; nothing about the site does. */
export async function describePhoto(
  input: { bytes: Uint8Array; mimeType: string },
  call: ModelCall = callAssistantModel,
): Promise<string> {
  let raw: unknown;
  try {
    const normalized = await normalizeImageForVision(input.bytes, input.mimeType);
    raw = await call({
      tool: DESCRIBE_PHOTO_TOOL,
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: normalized.mimeType, data: Buffer.from(normalized.bytes).toString("base64") },
        },
        { type: "text", text: DESCRIBE_PHOTO_PROMPT },
      ],
      maxTokens: 1500,
    });
  } catch (err) {
    throw refused("photo call failed", err);
  }
  const parsed = AltTextSchema.safeParse(raw);
  if (!parsed.success) throw refused("photo answer was not a description");
  return parsed.data.description;
}

/**
 * What to photograph on one page, one note per spot (slice 19).
 *
 * ONE CALL FOR THE WHOLE PAGE, not one per spot: the notes have to sit
 * together — the cover and the cards beneath it are a set, and a model
 * answering each in isolation repeats itself and cannot decide that THIS
 * spot is the screenshot because THAT one took the wide view.
 *
 * A key it invents is dropped and a key it misses keeps its standing note,
 * so a partial answer is still worth having.
 */
export async function writeShotNotes(
  input: {
    brief: SiteBrief;
    pageTitle: string;
    pagePath: string;
    pageDescription: string;
    spots: Spot[];
    /** The tools the product ships — what bounds a screenshot (`productCatalogue`). */
    catalogue?: Array<{ name: string; description: string }>;
  },
  call: ModelCall = callAssistantModel,
): Promise<Record<string, string>> {
  if (input.spots.length === 0) return {};
  let raw: unknown;
  try {
    raw = await call({
      tool: WRITE_SHOTS_TOOL,
      content: [
        { type: "text", text: WRITE_SHOTS_PROMPT },
        { type: "text", text: buildShotsUserTurn(input) },
      ],
      maxTokens: 8000,
    });
  } catch (err) {
    throw refused("shot list call failed", err);
  }
  const parsed = ShotNotesAnswer.safeParse(raw);
  if (!parsed.success) throw refused("shot list answer was not a list of notes");
  const wanted = new Set(input.spots.map((s) => s.key));
  const out: Record<string, string> = {};
  for (const shot of parsed.data.shots) {
    if (!wanted.has(shot.key)) continue;
    const note = shot.note.trim();
    if (note) out[shot.key] = note;
  }
  return out;
}
