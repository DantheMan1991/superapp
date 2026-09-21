import { describe, expect, it } from "vitest";
import {
  currentStep,
  mustAskOutstanding,
  nextStep,
  outstanding,
  quickRepliesFor,
  settledIds,
  stepIsCovered,
  walkProgress,
  type WalkAnswer,
  type WalkQuestion,
  type WalkStep,
} from "../src/packs/jobs/walk-math";
import { validateWalkTurn, walkSystemPrompt } from "../src/packs/jobs/ai/walk";
import { proposeSystemPrompt } from "../src/packs/jobs/ai/propose";

/**
 * THE WALK (X2a, ADR 0098) — the pure half.
 *
 * Two things are load-bearing here and everything else is arithmetic:
 * **a must-ask question cannot be got past**, and **the outline is read live**,
 * so a step added or removed mid-walk lands somewhere sensible rather than
 * stranding somebody on a step that no longer exists.
 */

function q(over: Partial<WalkQuestion> = {}): WalkQuestion {
  return {
    id: "q1",
    prompt: "Block or poured?",
    kind: "choice",
    choices: ["Block", "Poured"],
    unit: "",
    notes: "",
    alwaysAsk: false,
    ...over,
  };
}

function step(over: Partial<WalkStep> = {}): WalkStep {
  return {
    id: "s1",
    title: "Foundation",
    section: "",
    costCode: "2000",
    guidance: "",
    questions: [q()],
    ...over,
  };
}

function answer(over: Partial<WalkAnswer> = {}): WalkAnswer {
  return {
    questionId: "q1",
    stepId: "s1",
    prompt: "Block or poured?",
    answer: "Poured",
    skipped: false,
    superseded: false,
    skipReason: "",
    ...over,
  };
}

describe("what a step still needs", () => {
  const foundation = step({
    questions: [q({ id: "a" }), q({ id: "b" }), q({ id: "c", alwaysAsk: true })],
  });

  it("counts an answered and a skipped question as settled alike", () => {
    const answers = [
      answer({ questionId: "a" }),
      answer({ questionId: "b", skipped: true, answer: "", skipReason: "it is block" }),
    ];
    expect(settledIds(answers)).toEqual(new Set(["a", "b"]));
    expect(outstanding(foundation, answers).map((x) => x.id)).toEqual(["c"]);
  });

  it("ignores an answer the walk volunteered — it settles no outline question", () => {
    const answers = [answer({ questionId: null, prompt: "Is there a keyway?" })];
    expect(outstanding(foundation, answers)).toHaveLength(3);
  });

  it("is covered only when nothing is outstanding", () => {
    expect(stepIsCovered(foundation, [])).toBe(false);
    expect(
      stepIsCovered(foundation, ["a", "b", "c"].map((id) => answer({ questionId: id }))),
    ).toBe(true);
  });

  /** A step with no questions is already covered, so a walk passes through it. */
  it("passes straight through a step that asks nothing", () => {
    expect(stepIsCovered(step({ questions: [] }), [])).toBe(true);
  });
});

describe("mustAskOutstanding: the guardrail always_ask exists for", () => {
  const foundation = step({
    questions: [q({ id: "a" }), q({ id: "asbestos", alwaysAsk: true })],
  });

  it("names a must-ask question nobody has settled", () => {
    expect(mustAskOutstanding(foundation, []).map((x) => x.id)).toEqual(["asbestos"]);
  });

  it("is satisfied once it is answered", () => {
    expect(mustAskOutstanding(foundation, [answer({ questionId: "asbestos" })])).toEqual([]);
  });

  /**
   * A PERSON may skip one — the mark guards against the walk's judgement, not
   * against a decision somebody makes with their eyes open. By the time it is
   * a skip row, it is settled either way; `recordAnswers` is what refuses the
   * walk's attempt to write one.
   */
  it("is satisfied by a skip, because only a person can have written it", () => {
    expect(
      mustAskOutstanding(foundation, [
        answer({ questionId: "asbestos", skipped: true, answer: "", skipReason: "asked later" }),
      ]),
    ).toEqual([]);
  });

  it("says nothing about an ordinary question left outstanding", () => {
    expect(mustAskOutstanding(step(), [])).toEqual([]);
  });
});

/**
 * THE OUTLINE IS READ LIVE (ADR 0098), so these are the cases where it moved
 * underneath a walk in progress. The stored step id is a bookmark and this is
 * the function that refuses to trust it.
 */
describe("currentStep: the bookmark is not the truth", () => {
  const steps = [
    step({ id: "s1", title: "Site" }),
    step({ id: "s2", title: "Foundation" }),
    step({ id: "s3", title: "Framing" }),
  ];

  it("stays on the bookmarked step while it has work", () => {
    expect(currentStep(steps, [], "s2")?.id).toBe("s2");
  });

  it("moves on when the bookmarked step is covered", () => {
    const done = [answer({ questionId: "q1", stepId: "s2" })];
    // Every step shares question id q1 in this fixture, so all are covered.
    expect(currentStep(steps, done, "s2")).toBeNull();
  });

  it("falls to the first step with work when the bookmark points at nothing", () => {
    expect(currentStep(steps, [], "deleted-step")?.id).toBe("s1");
    expect(currentStep(steps, [], null)?.id).toBe("s1");
  });

  /**
   * THE FOUNDER'S OWN CASE: add a question mid-bid and it shows up in the bid
   * you are doing. A step inserted before the bookmark takes the walk back.
   */
  it("goes back to a step added before the one you are on", () => {
    const withNew = [
      step({ id: "s0", title: "Demolition", questions: [q({ id: "new" })] }),
      ...steps,
    ];
    const onS2 = [answer({ questionId: "q1", stepId: "s1" })];
    expect(currentStep(withNew, onS2, "s2")?.id).toBe("s0");
  });

  it("is null when the whole outline is covered", () => {
    expect(currentStep([], [], null)).toBeNull();
  });
});

describe("nextStep", () => {
  const steps = [
    step({ id: "s1", questions: [q({ id: "a" })] }),
    step({ id: "s2", questions: [] }),
    step({ id: "s3", questions: [q({ id: "c" })] }),
  ];

  it("skips a step that asks nothing", () => {
    expect(nextStep(steps, [], "s1")?.id).toBe("s3");
  });

  it("is null at the end", () => {
    expect(nextStep(steps, [answer({ questionId: "c" })], "s1")).toBeNull();
  });

  it("starts from the beginning when the step it is after has gone", () => {
    expect(nextStep(steps, [], "deleted")?.id).toBe("s1");
  });
});

describe("walkProgress", () => {
  it("counts answers, skips, what the walk thought of, and what is still owed", () => {
    const steps = [
      step({ id: "s1", questions: [q({ id: "a" }), q({ id: "b", alwaysAsk: true })] }),
      step({ id: "s2", questions: [q({ id: "c" })] }),
    ];
    const answers = [
      answer({ questionId: "a", stepId: "s1" }),
      answer({ questionId: "c", stepId: "s2" }),
      answer({ questionId: null, stepId: "s1", prompt: "Keyway?" }),
    ];
    expect(walkProgress(steps, answers)).toEqual({
      steps: 2,
      covered: 1,
      questions: 3,
      answered: 2,
      skipped: 0,
      volunteered: 1,
      mustAskLeft: 1,
    });
  });

  it("is all zeroes for an outline with nothing in it", () => {
    expect(walkProgress([], [])).toEqual({
      steps: 0,
      covered: 0,
      questions: 0,
      answered: 0,
      skipped: 0,
      volunteered: 0,
      mustAskLeft: 0,
    });
  });
});

describe("quickRepliesFor", () => {
  it("offers a choice's own options and a yes/no's two", () => {
    expect(quickRepliesFor(q())).toEqual(["Block", "Poured"]);
    expect(quickRepliesFor(q({ kind: "yes_no", choices: [] }))).toEqual(["Yes", "No"]);
  });

  it("offers nothing for an answer that has to be typed", () => {
    for (const kind of ["number", "money", "text"]) {
      expect(quickRepliesFor(q({ kind, choices: [] })), kind).toEqual([]);
    }
  });
});

/**
 * `validateWalkTurn` is the seam between a model and the database, so it is
 * written to distrust what it is handed. Every case here is something a model
 * can and eventually will do.
 */
describe("validateWalkTurn: nothing the model says is taken on trust", () => {
  const here = step({
    questions: [
      q({ id: "a", prompt: "Block or poured?" }),
      q({ id: "must", prompt: "Any asbestos?", kind: "yes_no", choices: [], alwaysAsk: true }),
    ],
  });

  it("reads a well-formed turn", () => {
    const out = validateWalkTurn(
      {
        record: [{ questionId: "a", prompt: "Block or poured?", answer: "Poured" }],
        skip: [],
        say: "How tall is the wall?",
        stepDone: false,
      },
      here,
    );
    expect(out?.record).toEqual([
      { questionId: "a", prompt: "Block or poured?", answer: "Poured" },
    ]);
    expect(out?.say).toBe("How tall is the wall?");
    expect(out?.stepDone).toBe(false);
  });

  it("refuses a turn with nothing to say", () => {
    expect(validateWalkTurn({ record: [], skip: [], say: "  ", stepDone: false }, here)).toBeNull();
    expect(validateWalkTurn(null, here)).toBeNull();
    expect(validateWalkTurn({ say: 42 }, here)).toBeNull();
  });

  /**
   * A MADE-UP QUESTION ID IS DROPPED, NOT TRUSTED — but the answer still
   * lands, as one the walk asked of its own. Throwing the answer away because
   * the id was wrong would lose what somebody actually said.
   */
  it("keeps an answer whose questionId it invented, as a volunteered one", () => {
    const out = validateWalkTurn(
      {
        record: [{ questionId: "not-a-question", prompt: "Keyway?", answer: "Yes" }],
        skip: [],
        say: "Next.",
        stepDone: false,
      },
      here,
    );
    expect(out?.record).toEqual([{ questionId: undefined, prompt: "Keyway?", answer: "Yes" }]);
  });

  it("drops a record with no prompt or no answer", () => {
    const out = validateWalkTurn(
      {
        record: [
          { prompt: "", answer: "x" },
          { prompt: "y", answer: "  " },
          { prompt: "Good", answer: "one" },
        ],
        skip: [],
        say: "Next.",
        stepDone: false,
      },
      here,
    );
    expect(out?.record).toHaveLength(1);
  });

  /** Two guards on this, and that is the right number: the ops refuses it too. */
  it("will not let it skip a must-ask question", () => {
    const out = validateWalkTurn(
      {
        record: [],
        skip: [{ questionId: "must", reason: "old building, obviously fine" }],
        say: "Next.",
        stepDone: true,
      },
      here,
    );
    expect(out?.skip).toEqual([]);
  });

  it("drops a skip of a question that is not on this step, or with no reason", () => {
    const out = validateWalkTurn(
      {
        record: [],
        skip: [
          { questionId: "elsewhere", reason: "nope" },
          { questionId: "a", reason: "  " },
        ],
        say: "Next.",
        stepDone: false,
      },
      here,
    );
    expect(out?.skip).toEqual([]);
  });

  /**
   * THE QUESTION'S OWN OPTIONS WIN. A model that offers "Concrete / Masonry"
   * on a question whose options are "Block / Poured" would record an answer
   * the outline does not recognise.
   */
  it("takes the question's options over anything the model offered", () => {
    const out = validateWalkTurn(
      {
        record: [],
        skip: [],
        say: "Block or poured?",
        askingQuestionId: "a",
        quickReplies: ["Concrete", "Masonry", "Other"],
        stepDone: false,
      },
      here,
    );
    expect(out?.quickReplies).toEqual(["Block", "Poured"]);
  });

  it("keeps the model's own replies for a question the outline never had", () => {
    const out = validateWalkTurn(
      {
        record: [],
        skip: [],
        say: "Is there a retaining wall?",
        quickReplies: ["Yes", "No", "Not sure"],
        stepDone: false,
      },
      here,
    );
    expect(out?.quickReplies).toEqual(["Yes", "No", "Not sure"]);
    expect(out?.askingQuestionId).toBeUndefined();
  });

  /**
   * **THE QUESTION IT IS ASKING, RECOVERED WHEN IT FORGETS TO SAY SO.** The
   * founder hit this on the first real walk: it asked "Block or poured
   * wall?" — the outline's own words — with no `askingQuestionId`, so the
   * buttons were three guesses instead of the question's four, `Come back to
   * this` vanished, and the answer would have been filed as volunteered with
   * the real question left outstanding.
   */
  describe("recovering an untagged question", () => {
    it("matches the outline's own words, punctuation and case aside", () => {
      for (const said of [
        "Block or poured?",
        "block or poured",
        "Right — block or poured?  ",
      ]) {
        const out = validateWalkTurn(
          { record: [], skip: [], say: said, stepDone: false },
          here,
        );
        expect(out?.askingQuestionId, said).toBe("a");
        expect(out?.quickReplies, said).toEqual(["Block", "Poured"]);
      }
    });

    it("leaves a question of its own alone", () => {
      const out = validateWalkTurn(
        { record: [], skip: [], say: "Is there a retaining wall?", stepDone: false },
        here,
      );
      expect(out?.askingQuestionId).toBeUndefined();
    });

    /** A near miss is left alone: mislabelling an answer is worse than a
     *  missing chip, because it files what somebody said under the wrong
     *  question and leaves the right one outstanding. */
    it("will not guess at a near miss", () => {
      const out = validateWalkTurn(
        { record: [], skip: [], say: "Is the wall block?", stepDone: false },
        here,
      );
      expect(out?.askingQuestionId).toBeUndefined();
    });

    it("says nothing when two questions reduce to the same words", () => {
      const twins = step({
        questions: [
          q({ id: "x", prompt: "How wide?" }),
          q({ id: "y", prompt: "How wide!" }),
        ],
      });
      const out = validateWalkTurn(
        { record: [], skip: [], say: "How wide?", stepDone: false },
        twins,
      );
      expect(out?.askingQuestionId).toBeUndefined();
    });

    it("an explicit id still wins", () => {
      const out = validateWalkTurn(
        {
          record: [],
          skip: [],
          say: "Any asbestos?",
          askingQuestionId: "a",
          stepDone: false,
        },
        here,
      );
      expect(out?.askingQuestionId).toBe("a");
    });
  });

  it("caps the replies it will draw and trims them", () => {
    const out = validateWalkTurn(
      {
        record: [],
        skip: [],
        say: "Which?",
        quickReplies: ["  a  ", "b", "c", "d", "e", "f", "g", "h"],
        stepDone: false,
      },
      here,
    );
    expect(out?.quickReplies).toHaveLength(6);
    expect(out?.quickReplies[0]).toBe("a");
  });

  it("treats a missing stepDone as not done", () => {
    const out = validateWalkTurn({ record: [], skip: [], say: "Next." }, here);
    expect(out?.stepDone).toBe(false);
  });

  /**
   * **A STEP YOU ARE STILL ASKING ABOUT IS NOT DONE.** Driving the walk found
   * this: asked to move on, the model set `stepDone` AND asked a follow-up in
   * the same breath, and the screen showed the next step's name over the last
   * step's question. The contradiction resolves in favour of the QUESTION,
   * because on a barn conversion "how much of the existing frame are you
   * keeping" was the best thing it did and no outline could have held it.
   */
  it("refuses to be done while it is still asking something", () => {
    const asking = validateWalkTurn(
      {
        record: [],
        skip: [],
        say: "How much of the existing frame are you keeping?",
        stepDone: true,
      },
      here,
    );
    expect(asking?.stepDone).toBe(false);

    const byId = validateWalkTurn(
      { record: [], skip: [], say: "Right then.", askingQuestionId: "a", stepDone: true },
      here,
    );
    expect(byId?.stepDone).toBe(false);
  });

  it("is done on a closing line that asks nothing", () => {
    const out = validateWalkTurn(
      { record: [], skip: [], say: "That is the framing covered.", stepDone: true },
      here,
    );
    expect(out?.stepDone).toBe(true);
  });
});

/**
 * WHAT THE MODEL IS ACTUALLY TOLD ABOUT THE BUILDING (X7).
 *
 * The half of the measure-up nobody can see by watching the screen, and the
 * half the founder asked for: *"then the questions can use this information
 * as it goes."* If the lines are not in the prompt, the measure-up is a
 * data-entry chore that changes nothing.
 */
describe("the building's numbers in the prompt", () => {
  const base = {
    jobName: "24-109 Barn",
    estimateNumber: "EST-3",
    outlineName: "New build",
    step: step(),
    stepNumber: 1,
    stepCount: 10,
    settledHere: [],
    earlier: [],
    projectWord: "Project",
    rooms: [],
  };

  it("puts them in, and tells it they are facts", () => {
    const prompt = walkSystemPrompt({
      ...base,
      measurements: ["- Wall perimeter: 128 lf", "- Roof area: 2,840 sf (4:12)"],
    });
    expect(prompt).toContain("MEASURED ON THIS BUILDING");
    expect(prompt).toContain("- Wall perimeter: 128 lf");
    expect(prompt).toContain("- Roof area: 2,840 sf (4:12)");
  });

  /**
   * **THE RULE THAT MAKES THEM WORTH CARRYING.** Without it the walk has the
   * numbers and asks for them anyway, which is the complaint this slice
   * exists to answer.
   */
  it("tells it not to ask again for a number it already has", () => {
    const prompt = walkSystemPrompt({ ...base, measurements: ["- Wall perimeter: 128 lf"] });
    expect(prompt).toContain("Never ask for a number that is already up there");
  });

  /**
   * Arithmetic on a number somebody GAVE is not pricing, and the prompt has
   * to say so — rule 2 forbids quantities it was not told, and a walk that
   * read that as "no arithmetic" would be useless.
   */
  it("keeps rule 2 and still allows the arithmetic", () => {
    const prompt = walkSystemPrompt({ ...base, measurements: ["- Wall area: 2,232 sf"] });
    expect(prompt).toContain("GATHER, NEVER PRICE");
    expect(prompt).toContain("Arithmetic on a number you were GIVEN is not pricing");
  });

  it("says nothing at all when the building has not been measured", () => {
    expect(walkSystemPrompt({ ...base, measurements: [] })).not.toContain("MEASURED ON THIS");
  });
});

/**
 * AND THE SAME NUMBERS MUST REACH THE PROPOSAL (X7).
 *
 * The one that nearly got away. Feeding the measurements to the CONVERSATION
 * and not to the thing that writes the lines would have left every phase a
 * lump — *"Framing labor — what are you getting for that?"* over a building
 * whose wall area is sitting right there. The measure-up would have been a
 * data-entry chore that changed nothing on the estimate.
 */
describe("the building's numbers in the proposal prompt", () => {
  const base = {
    projectWord: "Project",
    jobName: "24-109 Barn",
    step: step(),
    answers: [],
    assemblies: [],
    costCodes: [],
    rooms: [],
  };

  it("puts them in as quoted numbers", () => {
    const prompt = proposeSystemPrompt({
      ...base,
      measurements: ["- Wall perimeter: 128 lf", "- Wall height: 9.5 lf"],
    });
    expect(prompt).toContain("MEASURED ON THIS BUILDING");
    expect(prompt).toContain("- Wall perimeter: 128 lf");
  });

  /**
   * Rule 2 says a quantity is quoted or explained. Without 2a the model has
   * the numbers and no permission to multiply them, which is the whole
   * difference between a measured line and a lump.
   */
  it("says the measurements count as numbers they gave, with the working shown", () => {
    const prompt = proposeSystemPrompt({ ...base, measurements: ["- Wall perimeter: 128 lf"] });
    expect(prompt).toContain("A QUANTITY IS QUOTED OR EXPLAINED");
    expect(prompt).toContain("COUNT AS NUMBERS THEY GAVE");
    expect(prompt).toContain("derivedFrom");
  });

  /** It still may not price anything. That rule is not what this relaxes. */
  it("leaves the no-pricing rule exactly where it was", () => {
    const prompt = proposeSystemPrompt({ ...base, measurements: ["- Roof area: 2,840 sf"] });
    expect(prompt).toContain("YOU NEVER PRICE ANYTHING");
  });

  it("says nothing at all when the building has not been measured", () => {
    expect(proposeSystemPrompt({ ...base, measurements: [] })).not.toContain("MEASURED ON THIS");
  });
});

/**
 * THE ROOMS, IN BOTH PROMPTS (X8).
 *
 * The founder: *"then the estimate questions can start asking questions like
 * what type of flooring in Master bedroom."* The rules below are the two
 * that stop that being a disaster — one question instead of fifteen, and one
 * LINE instead of fifteen.
 */
describe("the rooms in the prompts", () => {
  const walkBase = {
    jobName: "24-109 Barn",
    estimateNumber: "EST-3",
    outlineName: "New build",
    step: step(),
    stepNumber: 1,
    stepCount: 10,
    settledHere: [],
    earlier: [],
    projectWord: "Project",
    measurements: [],
  };
  const proposeBase = {
    projectWord: "Project",
    jobName: "24-109 Barn",
    step: step(),
    answers: [],
    assemblies: [],
    costCodes: [],
    measurements: [],
  };
  const rooms = ["Main floor:", "- Kitchen: 310 sf", "Upstairs:", "- Master bath: 62 sf"];

  it("puts the rooms in the walk's prompt", () => {
    const prompt = walkSystemPrompt({ ...walkBase, rooms });
    expect(prompt).toContain("THE ROOMS IN IT");
    expect(prompt).toContain("- Master bath: 62 sf");
  });

  /**
   * **THE RULE THAT DECIDES WHETHER THIS FEATURE HELPS OR HURTS.** Fifteen
   * rooms times five finish categories is seventy-five questions, and the
   * whole target is a bid in forty-five minutes.
   */
  it("tells the walk to ask once and share the answer out", () => {
    const prompt = walkSystemPrompt({ ...walkBase, rooms });
    expect(prompt).toContain("ASK ONCE AND SHARE IT OUT");
    expect(prompt).toContain("Never ask the same question room by room");
    /** And to name the rooms the answer missed rather than leaving a hole. */
    expect(prompt).toContain("Any room the answer did not cover");
  });

  it("puts the rooms in the proposal's prompt too", () => {
    const prompt = proposeSystemPrompt({ ...proposeBase, rooms });
    expect(prompt).toContain("THE ROOMS IN IT");
    expect(prompt).toContain("- Kitchen: 310 sf");
  });

  /** The same trap one layer down: fifteen flooring lines is not an estimate. */
  it("tells the proposal one line per finish, not one per room", () => {
    const prompt = proposeSystemPrompt({ ...proposeBase, rooms });
    expect(prompt).toContain("ONE LINE PER FINISH, NOT ONE PER ROOM");
    expect(prompt).toContain("derivedFrom");
  });

  it("says nothing at all about rooms on a job with none", () => {
    expect(walkSystemPrompt({ ...walkBase, rooms: [] })).not.toContain("THE ROOMS IN IT");
    expect(proposeSystemPrompt({ ...proposeBase, rooms: [] })).not.toContain("THE ROOMS IN IT");
  });
});
