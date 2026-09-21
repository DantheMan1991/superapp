import { describe, expect, it } from "vitest";
import {
  groupStandards,
  refusesTheUsual,
  standardsIn,
  standardsOutstanding,
  usualLines,
  usualSize,
} from "../src/packs/jobs/usual-math";
import type { WalkAnswer, WalkQuestion, WalkStep } from "../src/packs/jobs/walk-math";

/**
 * WHAT NEVER VARIES (X13).
 *
 * The founder: *"i'd say 80/20 standard vs custom"*, and, with a screenshot
 * of the walk asking it for the ninth time, *"I'm getting questions like this
 * one: who is doing this one. it doesn't give any context."*
 *
 * Thirty-three phases asking who is doing each one is thirty-three questions
 * with one answer, against a target of a bid in forty-five minutes.
 */

function q(over: Partial<WalkQuestion> & { id: string }): WalkQuestion {
  return {
    prompt: "Who is doing this one?",
    kind: "choice",
    choices: ["In-house", "Bidding it out"],
    unit: "",
    notes: "",
    alwaysAsk: false,
    standardAnswer: "",
    ...over,
  };
}

function step(over: Partial<WalkStep> & { id: string }): WalkStep {
  return {
    title: "Rough carpentry",
    section: "",
    costCode: "",
    guidance: "",
    assemblyId: null,
    questions: [],
    ...over,
  };
}

function answer(over: Partial<WalkAnswer> & { questionId: string }): WalkAnswer {
  return {
    stepId: "s1",
    prompt: "Who is doing this one?",
    answer: "Bidding it out",
    skipped: false,
    skipReason: "",
    superseded: false,
    fromStandard: false,
    ...over,
  };
}

const WHO = "Who is doing this one?";

describe("standardsIn", () => {
  it("reads the answers the outline gives for itself, in walking order", () => {
    const out = standardsIn([
      step({ id: "s1", title: "Rough carpentry", questions: [q({ id: "q1", standardAnswer: "In-house" })] }),
      step({ id: "s2", title: "Roofing", questions: [q({ id: "q2" })] }),
      step({ id: "s3", title: "Drywall", questions: [q({ id: "q3", standardAnswer: "In-house" })] }),
    ]);
    expect(out.map((s) => [s.stepTitle, s.answer])).toEqual([
      ["Rough carpentry", "In-house"],
      ["Drywall", "In-house"],
    ]);
  });

  /**
   * **A BLANK IS THE WHOLE SAFETY OF THE FEATURE.** *Roofing* above is how a
   * business says "this one really does vary" — and it is why skipping what
   * never varies is not the same as assuming what does.
   */
  it("leaves out a question with no standard", () => {
    expect(standardsIn([step({ id: "s1", questions: [q({ id: "q1" })] })])).toEqual([]);
    expect(
      standardsIn([step({ id: "s1", questions: [q({ id: "q1", standardAnswer: "   " })] })]),
    ).toEqual([]);
  });

  /**
   * **`always_ask` WINS, AT BOTH ENDS.** `writeSteps` refuses to store one;
   * this refuses to read one, so a row written before the rule existed does
   * not start being obeyed by a later reader.
   */
  it("never takes one from a must-ask question", () => {
    const out = standardsIn([
      step({
        id: "s1",
        questions: [
          q({ id: "q1", prompt: "Is there asbestos?", alwaysAsk: true, standardAnswer: "No" }),
        ],
      }),
    ]);
    expect(out).toEqual([]);
  });
});

describe("standardsOutstanding", () => {
  const s = step({
    id: "s1",
    questions: [
      q({ id: "q1", standardAnswer: "In-house" }),
      q({ id: "q2", prompt: "Finish level?", standardAnswer: "Level 4" }),
    ],
  });

  it("is every standard on a phase nobody has been through", () => {
    expect(standardsOutstanding(s, []).map((x) => x.questionId)).toEqual(["q1", "q2"]);
  });

  /** A phase already answered is not re-answered underneath somebody. */
  it("leaves alone a question that has an answer", () => {
    expect(
      standardsOutstanding(s, [answer({ questionId: "q1" })]).map((x) => x.questionId),
    ).toEqual(["q2"]);
  });

  /**
   * **RE-OPENING ONE PUTS ITS STANDARD BACK**, which is right: `askAgain`
   * supersedes the answer and takes the walk to where it was before, and
   * where it was before is with the usual taken.
   */
  it("comes back when somebody asks that question again", () => {
    expect(
      standardsOutstanding(s, [answer({ questionId: "q1", superseded: true })]).map(
        (x) => x.questionId,
      ),
    ).toEqual(["q1", "q2"]);
  });
});

describe("groupStandards and usualLines", () => {
  const many = standardsIn(
    ["Rough carpentry", "Roofing", "Drywall"].map((title, i) =>
      step({
        id: `s${i}`,
        title,
        questions: [q({ id: `q${i}`, standardAnswer: "In-house" })],
      }),
    ),
  );

  /**
   * **THE SCREEN HAS TO BE SMALL ENOUGH TO READ.** Thirty-three lines each
   * saying the same thing is a rubber stamp, and a rubber stamp is worse
   * than no confirmation at all.
   */
  it("says one thing once, with the phases it covers", () => {
    expect(groupStandards(many)).toEqual([
      { prompt: WHO, answer: "In-house", steps: ["Rough carpentry", "Roofing", "Drywall"] },
    ]);
    expect(usualLines(groupStandards(many), 3)).toEqual([
      `- ${WHO} In-house — every phase`,
    ]);
  });

  it("names the phases when it is not all of them", () => {
    expect(usualLines(groupStandards(many), 10)).toEqual([
      `- ${WHO} In-house — Rough carpentry, Roofing, Drywall`,
    ]);
  });

  /** A different answer is its own line, which is how the odd one out shows. */
  it("keeps a different answer apart", () => {
    const mixed = standardsIn([
      step({ id: "s1", title: "Framing", questions: [q({ id: "q1", standardAnswer: "In-house" })] }),
      step({
        id: "s2",
        title: "HVAC",
        questions: [q({ id: "q2", standardAnswer: "Bidding it out" })],
      }),
    ]);
    expect(usualLines(groupStandards(mixed), 2)).toEqual([
      `- ${WHO} In-house — Framing`,
      `- ${WHO} Bidding it out — HVAC`,
    ]);
  });

  it("counts what is being agreed to", () => {
    expect(usualSize(many)).toEqual({ questions: 3, steps: 3 });
    expect(usualSize([])).toEqual({ questions: 0, steps: 0 });
  });
});

/**
 * **THE UNCERTAIN ANSWER GOES TO "NO".** Reading an unclear reply as a yes
 * would settle a screenful of answers on somebody who meant to object; the
 * cost of the other mistake is being asked questions you would have skipped.
 */
describe("refusesTheUsual", () => {
  it("takes the two buttons at their word", () => {
    expect(refusesTheUsual("That's right")).toBe(false);
    expect(refusesTheUsual("Ask me everything")).toBe(true);
  });

  it("reads a typed refusal", () => {
    for (const said of [
      "no",
      "Nope",
      "not this one",
      "ask me each one",
      "some are different",
      "that's wrong",
      "hold on",
    ]) {
      expect(refusesTheUsual(said), said).toBe(true);
    }
  });

  it("reads a typed agreement", () => {
    for (const said of ["yes", "yep", "correct", "that is right", "go ahead", "all good"]) {
      expect(refusesTheUsual(said), said).toBe(false);
    }
  });
});
