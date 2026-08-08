import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/** Lazy so the app builds and boots without an Anthropic key configured. */
export function getClaude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. See SETUP.md.");
  }
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export const CLAUDE_MODEL = "claude-opus-5";

/**
 * THINKING IS ON BY DEFAULT ON THIS MODEL, and that is the one thing to know
 * before adding a call site.
 *
 * On `claude-opus-4-8` (what this constant used to be) omitting the `thinking`
 * parameter meant no thinking. On `claude-opus-5` omitting it runs ADAPTIVE
 * thinking — and `max_tokens` caps thinking plus response together, so a tight
 * budget that was ample for a structured answer can now truncate mid-tool-call.
 *
 * Every call site that existed before the bump therefore pins
 * `thinking: { type: "disabled" }` explicitly, which preserves exactly the
 * behaviour it had on 4.8. That makes the model change behaviour-neutral for
 * shipped features rather than silently re-tuning five of them at once.
 * Turning adaptive thinking ON for the reasoning-heavy ones (the Discovery
 * copilot, the close narrative) is a real improvement and belongs in its own
 * change, where it can be evaluated.
 *
 * New call sites should think: pass `{ type: "adaptive" }` and give
 * `max_tokens` room for it.
 *
 * One correction while bumping: several call sites carried the comment
 * "no extended thinking (incompatible with forced tools)". That was true of an
 * older model and is NOT true here — verified against the live API, forced
 * `tool_choice` returns a `tool_use` block with thinking both on and off.
 * Disabling it at those sites is now a budget decision, not a compatibility one.
 */
export const CLAUDE_THINKING_OFF = { type: "disabled" } as const;
