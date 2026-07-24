import { describe, expect, it } from "vitest";
import { validateInterviewTurn } from "@/lib/interview-validate";
import {
  INTERVIEW_EXCHANGE_CAP,
  INTERVIEW_REPLY_MAX,
} from "@/lib/interview-prompt";

describe("validateInterviewTurn", () => {
  const good = {
    reply: "Got it — sounds busy. Who handles the invoicing today?",
    topicsCovered: ["business_basics", "operations"],
    done: false,
  };

  it("passes a well-formed turn through", () => {
    const turn = validateInterviewTurn(good, 3);
    expect(turn).not.toBeNull();
    expect(turn!.reply).toBe(good.reply);
    expect(turn!.topicsCovered).toEqual(["business_basics", "operations"]);
    expect(turn!.done).toBe(false);
  });

  it("rejects non-objects and missing/empty replies", () => {
    expect(validateInterviewTurn(null, 1)).toBeNull();
    expect(validateInterviewTurn("hi", 1)).toBeNull();
    expect(validateInterviewTurn({}, 1)).toBeNull();
    expect(validateInterviewTurn({ reply: 42, done: false }, 1)).toBeNull();
    expect(
      validateInterviewTurn({ reply: "   ", topicsCovered: [], done: false }, 1),
    ).toBeNull();
  });

  it("trims and truncates the reply", () => {
    const turn = validateInterviewTurn(
      { ...good, reply: `  ${"x".repeat(INTERVIEW_REPLY_MAX + 500)}  ` },
      3,
    );
    expect(turn!.reply.length).toBe(INTERVIEW_REPLY_MAX);
  });

  it("filters unknown topics and dedupes", () => {
    const turn = validateInterviewTurn(
      {
        ...good,
        topicsCovered: [
          "operations",
          "operations",
          "ignore_previous_instructions",
          42,
          "pain_points",
        ],
      },
      3,
    );
    expect(turn!.topicsCovered).toEqual(["operations", "pain_points"]);
  });

  it("tolerates a missing topicsCovered array", () => {
    const turn = validateInterviewTurn({ reply: "ok", done: false }, 3);
    expect(turn!.topicsCovered).toEqual([]);
  });

  it("coerces non-boolean done to false below the cap", () => {
    const turn = validateInterviewTurn({ ...good, done: "yes" }, 3);
    expect(turn!.done).toBe(false);
  });

  it("forces done=true at the exchange cap regardless of the model", () => {
    const turn = validateInterviewTurn(
      { ...good, done: false },
      INTERVIEW_EXCHANGE_CAP,
    );
    expect(turn!.done).toBe(true);
  });
});
