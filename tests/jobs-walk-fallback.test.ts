import { describe, expect, it } from "vitest";
import { outlineCanCarry, outlineTurn } from "../src/packs/jobs/walk-fallback";
import type { WalkAnswer, WalkQuestion, WalkStep } from "../src/packs/jobs/walk-math";

/**
 * THE WALK WITHOUT THE MODEL.
 *
 * The founder's words: *"There should be no errors period. If errors start
 * happening people get frustrated and stop using the tool."* The outline was
 * always the floor; this is the floor doing its job.
 */

function q(id: string, prompt: string, over: Partial<WalkQuestion> = {}): WalkQuestion {
  return {
    id,
    prompt,
    kind: "text",
    choices: [],
    unit: "",
    notes: "",
    alwaysAsk: false,
    standardAnswer: "",
    ...over,
  };
}

const STEP: WalkStep = {
  id: "s1",
  title: "Plans and engineering",
  section: "",
  costCode: "1100",
  guidance: "",
  assemblyId: null,
  questions: [
    q("q1", "Who is producing the drawings?", {
      kind: "choice",
      choices: ["We are", "The client's architect"],
    }),
    q("q2", "Are the drawings complete, or still in design?"),
    q("q3", "Does anything need an engineer's stamp?", { kind: "yes_no" }),
  ],
};

function said(questionId: string | null, prompt: string, answer: string): WalkAnswer {
  return {
    questionId,
    stepId: "s1",
    prompt,
    answer,
    skipped: false,
    skipReason: "",
    superseded: false,
    fromStandard: false,
  };
}

describe("outlineTurn", () => {
  it("opens a step with its first question, in the outline's own words", () => {
    const turn = outlineTurn({
      step: STEP,
      answers: [],
      pendingQuestionId: null,
      pendingSay: "",
      said: undefined,
    });
    expect(turn.record).toEqual([]);
    expect(turn.say).toBe("Who is producing the drawings?");
    expect(turn.askingQuestionId).toBe("q1");
    expect(turn.quickReplies).toEqual(["We are", "The client's architect"]);
    expect(turn.stepDone).toBe(false);
  });

  /**
   * **THE ANSWER GOES TO THE QUESTION THAT WAS ON THE SCREEN.** Nothing here
   * infers or matches — that is the model's job, and this runs precisely
   * when the model is not there to do it.
   */
  it("banks what was said against the question that was asked, then moves on", () => {
    const turn = outlineTurn({
      step: STEP,
      answers: [],
      pendingQuestionId: "q1",
      pendingSay: "Who is producing the drawings?",
      said: "We are",
    });
    expect(turn.record).toEqual([
      { questionId: "q1", prompt: "Who is producing the drawings?", answer: "We are" },
    ]);
    expect(turn.askingQuestionId).toBe("q2");
  });

  /** A question the walk asked of its own has no id, and still records. */
  it("banks an answer to a question the outline never had", () => {
    const turn = outlineTurn({
      step: STEP,
      answers: [],
      pendingQuestionId: null,
      pendingSay: "Is there a survey already?",
      said: "Yes, last spring",
    });
    expect(turn.record).toEqual([
      { prompt: "Is there a survey already?", answer: "Yes, last spring" },
    ]);
    expect(turn.record[0]).not.toHaveProperty("questionId");
    /** And it still moves the walk on to the outline's first unanswered one. */
    expect(turn.askingQuestionId).toBe("q1");
  });

  it("never asks again the question it has just answered", () => {
    const turn = outlineTurn({
      step: STEP,
      answers: [],
      pendingQuestionId: "q1",
      pendingSay: "Who is producing the drawings?",
      said: "We are",
    });
    expect(turn.askingQuestionId).not.toBe("q1");
  });

  it("skips over everything already settled", () => {
    const turn = outlineTurn({
      step: STEP,
      answers: [
        said("q1", "Who is producing the drawings?", "We are"),
        said("q2", "Are the drawings complete, or still in design?", "Complete"),
      ],
      pendingQuestionId: null,
      pendingSay: "",
      said: undefined,
    });
    expect(turn.askingQuestionId).toBe("q3");
    expect(turn.quickReplies).toEqual(["Yes", "No"]);
  });

  it("says the step is done when nothing is left", () => {
    const turn = outlineTurn({
      step: STEP,
      answers: [
        said("q1", "a", "x"),
        said("q2", "b", "y"),
      ],
      pendingQuestionId: "q3",
      pendingSay: "Does anything need an engineer's stamp?",
      said: "No",
    });
    expect(turn.record).toHaveLength(1);
    expect(turn.stepDone).toBe(true);
    expect(turn.say).toBe("");
    expect(turn.askingQuestionId).toBeUndefined();
  });

  it("records nothing when nothing was said", () => {
    const turn = outlineTurn({
      step: STEP,
      answers: [],
      pendingQuestionId: "q1",
      pendingSay: "Who is producing the drawings?",
      said: "   ",
    });
    expect(turn.record).toEqual([]);
    /** And it asks the pending one again rather than skipping it. */
    expect(turn.askingQuestionId).toBe("q1");
  });

  /** It never volunteers and never skips: both need judgement it has not got. */
  it("asks only what the outline holds, and passes nothing over", () => {
    const turn = outlineTurn({
      step: STEP,
      answers: [],
      pendingQuestionId: null,
      pendingSay: "",
      said: undefined,
    });
    expect(turn.skip).toEqual([]);
    expect(STEP.questions.map((x) => x.prompt)).toContain(turn.say);
  });
});

describe("outlineCanCarry", () => {
  it("can while the step still has a question", () => {
    expect(outlineCanCarry(STEP, [])).toBe(true);
  });

  /**
   * It cannot once everything is settled: whether the walk should go further
   * than the list is a judgement, and inventing a question here would be the
   * fallback pretending to be the model.
   */
  it("cannot once every question is settled", () => {
    const all = STEP.questions.map((x) => said(x.id, x.prompt, "x"));
    expect(outlineCanCarry(STEP, all)).toBe(false);
  });
});
