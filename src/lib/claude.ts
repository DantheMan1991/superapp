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

export const CLAUDE_MODEL = "claude-opus-4-8";
