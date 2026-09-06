import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import type { ResolvedBrand } from "@/lib/brand/core";
import { applySiteWords, templateSlots } from "@/lib/site-templates/core";
import type { AssembledPage, SiteTemplate } from "@/lib/site-templates/types";
import type { SiteBrief } from "@/lib/sites/copy";
import type { SiteSettings } from "@/lib/sites/schema";
import { SITE_COPY_SYSTEM_PROMPT, WRITE_SITE_TOOL, buildSiteCopyUserTurn } from "./ai/site-copy-prompt";

/**
 * Writing the site's words (slice 1, rebuilt on the templates in slice
 * 15): the template's pages come in assembled with their starter words,
 * the writer is handed every word slot, and what it wrote goes back one
 * section at a time; a section it got wrong keeps its starter words. The
 * only network edge is the model call, and it is optional — without a key
 * the starter words ARE the site, and the screen says so.
 */
export type SiteCopySource = "model" | "standard";

/** Five pages of slots plus their reasons, with room to think first. */
const MAX_TOKENS = 12000;

export type SiteCopyCall = (brief: SiteBrief, notes: string[], pages: AssembledPage[]) => Promise<unknown>;

/** The only network-touching function — injectable in tests. */
export async function callSiteCopyModel(brief: SiteBrief, notes: string[], pages: AssembledPage[]): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    // Adaptive, deliberately: writing a business's site from a thin brief is
    // the reasoning-shaped task lib/claude.ts says new call sites should
    // think about, and the owner pressed "Build it" expecting to wait a
    // little. The budget above covers the thinking and the words.
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: SITE_COPY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [WRITE_SITE_TOOL],
    tool_choice: { type: "tool", name: WRITE_SITE_TOOL.name },
    messages: [{ role: "user", content: buildSiteCopyUserTurn(brief, notes, templateSlots(pages)) }],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("no tool_use block in site copy");
  return toolUse.input;
}

export async function writeSite(
  template: SiteTemplate,
  brief: SiteBrief,
  pages: AssembledPage[],
  opts: { call?: SiteCopyCall } = {},
): Promise<{ pages: AssembledPage[]; source: SiteCopySource }> {
  if (!process.env.ANTHROPIC_API_KEY) return { pages, source: "standard" };
  try {
    const raw = await (opts.call ?? callSiteCopyModel)(brief, template.writerNotes, pages);
    const written = applySiteWords(pages, raw);
    return { pages: written.pages, source: written.filled > 0 ? "model" : "standard" };
  } catch (err) {
    // The starter words are the fallback, not an error: the owner pressing
    // "Build it" gets a site either way, and the screen says which words.
    console.error("site copy failed; using the starter words", err);
    return { pages, source: "standard" };
  }
}

/** The brief, from what the tenant already holds plus the details just typed. */
export function siteBriefFor(input: {
  brand: ResolvedBrand;
  industry: string | null;
  settings: SiteSettings;
}): SiteBrief {
  return {
    name: input.brand.displayName,
    tagline: input.brand.tagline,
    industry: input.industry,
    phone: input.settings.phone,
    email: input.settings.email,
    address: input.settings.address,
    hoursLines: input.settings.hoursLines,
    about: input.settings.about,
  };
}
