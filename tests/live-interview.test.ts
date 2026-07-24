import "dotenv/config";
import { describe, expect, it } from "vitest";
import { callInterviewModel } from "../src/lib/interview";
import { INTERVIEW_OPENER } from "../src/lib/interview-prompt";
import { validateInterviewTurn } from "../src/lib/interview-validate";

/**
 * Live health-check interview turn against the real Anthropic API.
 * Costs real tokens — gated:
 *   RUN_LIVE_INTERVIEW=1 npx vitest run tests/live-interview.test.ts
 */

const RUN = process.env.RUN_LIVE_INTERVIEW === "1" && !!process.env.ANTHROPIC_API_KEY;
const d = RUN ? describe : describe.skip;

d("live interview turn", () => {
  it("returns a valid turn for a first answer", async () => {
    const raw = await callInterviewModel({
      sessionId: "live-test",
      history: [{ role: "assistant", content: INTERVIEW_OPENER }],
      exchangeCount: 0,
      userMessage:
        "We're a plumbing outfit, 6 vans, maybe $1.8M a year. I run it with my wife doing the books at night.",
    });
    const turn = validateInterviewTurn(raw, 1);
    expect(turn).not.toBeNull();
    expect(turn!.reply.length).toBeGreaterThan(20);
    expect(turn!.done).toBe(false);
    expect(turn!.topicsCovered).toContain("business_basics");
    console.log("live reply:", turn!.reply);
    console.log("topics:", turn!.topicsCovered);
  }, 120_000);
});
