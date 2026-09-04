import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import type { ResolvedBrand } from "@/lib/brand/core";
import { standardSiteCopy, type SiteBrief, type SiteCopy } from "@/lib/sites/copy";
import type { SiteSettings } from "@/lib/sites/schema";
import {
  SITE_COPY_SYSTEM_PROMPT,
  WRITE_SITE_COPY_TOOL,
  buildSiteCopyUserTurn,
} from "./ai/site-copy-prompt";
import { mergeSiteCopy } from "./ai/site-copy-validate";

/**
 * Writing the site's words: the assistant writes into fixed slots, the
 * standard copy fills whatever it left, and `assembleSite` (pure) turns the
 * words into pages. The only network edge is the model call, and it is
 * optional — without a key the standard copy IS the site, and the screen
 * says so.
 */
export type SiteCopySource = "model" | "standard";

/** Six slots of prose plus their reasons, with room to think first. */
const MAX_TOKENS = 6000;

/** The only network-touching function — injectable in tests. */
export async function callSiteCopyModel(brief: SiteBrief): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    // Adaptive, deliberately: writing a business's first page from a thin
    // brief is the reasoning-shaped task lib/claude.ts says new call sites
    // should think about, and the owner pressed "Build it" expecting to wait
    // a little. The budget above covers the thinking and the words.
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: SITE_COPY_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [WRITE_SITE_COPY_TOOL],
    tool_choice: { type: "tool", name: WRITE_SITE_COPY_TOOL.name },
    messages: [{ role: "user", content: buildSiteCopyUserTurn(brief) }],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("no tool_use block in site copy");
  return toolUse.input;
}

export async function writeSiteCopy(
  brief: SiteBrief,
  opts: { call?: (brief: SiteBrief) => Promise<unknown> } = {},
): Promise<{ copy: SiteCopy; source: SiteCopySource }> {
  const fallback = standardSiteCopy(brief);
  if (!process.env.ANTHROPIC_API_KEY) return { copy: fallback, source: "standard" };
  try {
    const raw = await (opts.call ?? callSiteCopyModel)(brief);
    const { copy, filled } = mergeSiteCopy(raw, fallback);
    return { copy, source: filled > 0 ? "model" : "standard" };
  } catch (err) {
    // The standard copy is the fallback, not an error: the owner pressing
    // "Build it" gets a site either way, and the screen says which words.
    console.error("site copy failed; using the standard copy", err);
    return { copy: fallback, source: "standard" };
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
  };
}
