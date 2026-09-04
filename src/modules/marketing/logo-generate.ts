import "server-only";
import { CLAUDE_MODEL, CLAUDE_THINKING_OFF, getClaude } from "@/lib/claude";
import { standardLogoSpecs } from "@/lib/brand/logo-defaults";
import type {
  LogoBrief,
  LogoCandidate,
  LogoSpec,
} from "@/lib/brand/logo-spec";
import { renderLogoSvg } from "@/lib/brand/logo-svg";
import {
  LOGO_SYSTEM_PROMPT,
  PROPOSE_LOGOS_TOOL,
  buildLogoUserTurn,
} from "./ai/logo-prompt";
import { LOGO_CANDIDATES, validateLogoProposal } from "./ai/logo-validate";
import type { KitLogo } from "./kit-ops";
import { putLogoPng, rasterizeOrExplain } from "./logo-ingest";

/**
 * Drawing a logo: the assistant proposes, the code draws, the owner picks.
 *
 * Two network edges and nothing else: the model call (optional — the standard
 * set stands in when there is no key or the call fails, and the screen says
 * so) and the blob write when a candidate is adopted. Both run OUTSIDE any
 * transaction; the action layer does the row afterwards.
 *
 * The client only ever sends back a SPEC, never a picture. Adoption
 * re-validates it and re-draws it server-side, so what lands in the store is
 * always something this renderer produced.
 */

export type LogoDraftSource = "model" | "standard";

/** Room for six specs and their one-line reasons; thinking is off. */
const MAX_TOKENS = 2500;

/** The only network-touching function in drafting — injectable in tests. */
export async function callLogoModel(brief: LogoBrief): Promise<unknown> {
  const stream = getClaude().messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    // Picking six layouts from a fixed catalogue is a form to fill, not a
    // problem to reason through: thinking would add seconds to a button an
    // owner presses while watching. A budget decision — see lib/claude.ts.
    thinking: CLAUDE_THINKING_OFF,
    system: [
      {
        type: "text",
        text: LOGO_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [PROPOSE_LOGOS_TOOL],
    tool_choice: { type: "tool", name: PROPOSE_LOGOS_TOOL.name },
    messages: [{ role: "user", content: buildLogoUserTurn(brief) }],
  });
  const msg = await stream.finalMessage();
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("no tool_use block in logo proposal");
  return toolUse.input;
}

const specKey = (s: LogoSpec) => `${s.layout}:${s.mark}:${s.textCase}`;

export async function draftLogoCandidates(
  brief: LogoBrief,
  opts: { call?: (brief: LogoBrief) => Promise<unknown> } = {},
): Promise<{ candidates: LogoCandidate[]; source: LogoDraftSource }> {
  let specs: LogoSpec[] = [];
  let source: LogoDraftSource = "standard";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      specs = validateLogoProposal(await (opts.call ?? callLogoModel)(brief));
      if (specs.length > 0) source = "model";
    } catch (err) {
      // The standard set is the fallback, not an error: an owner pressing
      // "Draw" gets six logos either way, and the screen says which kind.
      console.error("logo drafting failed; using the standard set", err);
    }
  }
  if (specs.length < LOGO_CANDIDATES) {
    const seen = new Set(specs.map(specKey));
    for (const spec of standardLogoSpecs(brief)) {
      if (specs.length >= LOGO_CANDIDATES) break;
      if (seen.has(specKey(spec))) continue;
      seen.add(specKey(spec));
      specs.push(spec);
    }
  }
  return {
    candidates: specs.slice(0, LOGO_CANDIDATES).map((spec, i) => ({
      key: `c${i}`,
      spec,
      ...renderLogoSvg(spec),
    })),
    source,
  };
}

/** Draw the chosen spec for real: SVG → PNG → the tenant's brand namespace. */
export async function drawLogoToBlob(
  tenantId: string,
  spec: LogoSpec,
): Promise<KitLogo> {
  const { svg } = renderLogoSvg(spec);
  const raster = await rasterizeOrExplain(svg);
  const stored = await putLogoPng(tenantId, raster.png, "drawn-logo");
  return {
    pathname: stored.pathname,
    mimeType: "image/png",
    width: raster.width,
    height: raster.height,
    bytes: stored.bytes,
    source: "generated",
    spec,
  };
}

/**
 * "homestead-farm" → "Homestead farm". The tenant's industry slug, made
 * readable for the brief WITHOUT importing the profile manifests: a core
 * module reads no industry code, only a word the tenant already carries.
 */
export function industryLabel(slug: string | null | undefined): string | null {
  if (!slug || slug === "general") return null;
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}
