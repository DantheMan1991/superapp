import { describe, expect, it } from "vitest";
import {
  breathLine,
  cueFor,
  EXERCISE_DONE,
  holdLine,
  setIntro,
  spokenPrescription,
} from "../src/modules/fitness/core/coach";
import {
  beginSession,
  finishExercise,
  nextStep,
  oneMoreSet,
  recordSet,
  type SessionDoc,
  type SessionPlan,
  type Step,
} from "../src/modules/fitness/core/session";

/**
 * WHAT THE COACH SAYS (docs/modules/fitness.md, F2b). Every word a person on
 * the floor hears, pinned, because none of it can be checked by looking at a
 * screen. An invented program, as every fitness test uses.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 13, minute, 0));
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function plan(): SessionPlan {
  const item = {
    purpose: "",
    notes: "",
    video: null,
    optional: false,
  };
  return {
    programId: "11111111-1111-4111-8111-111111111111",
    programName: "Starter Mobility",
    phaseId: "22222222-2222-4222-8222-222222222222",
    phaseName: "Weeks 1–2",
    phaseIndex: 0,
    phaseCount: 1,
    phases: [{ id: "22222222-2222-4222-8222-222222222222", name: "Weeks 1–2" }],
    breath: { outS: 5, inS: 5 },
    effort: { min: 3, max: 5 },
    items: [
      {
        ...item,
        itemId: "44444444-4444-4444-8444-444444444444",
        exerciseId: "55555555-5555-4555-8555-555555555555",
        name: "Side-lying pullback",
        cues: ["Low back relaxed", "Ribs down"],
        unit: "breaths",
        perSide: true,
        setsMin: 2,
        setsMax: 3,
        targetMin: 5,
        targetMax: 8,
      },
      {
        ...item,
        itemId: "66666666-6666-4666-8666-666666666666",
        exerciseId: "77777777-7777-4777-8777-777777777777",
        name: "Foam roll — calves",
        cues: ["Slow, about an inch a second"],
        unit: "rolls",
        perSide: false,
        setsMin: 1,
        setsMax: null,
        targetMin: 15,
        targetMax: null,
      },
      {
        ...item,
        itemId: "88888888-8888-4888-8888-888888888888",
        exerciseId: "99999999-9999-4999-8999-999999999999",
        name: "Wall hold",
        cues: [],
        unit: "seconds",
        perSide: false,
        setsMin: 2,
        setsMax: null,
        targetMin: 30,
        targetMax: null,
      },
    ],
  };
}

function setStep(p: SessionPlan, doc: SessionDoc): Extract<Step, { kind: "set" }> {
  const step = nextStep(p, doc);
  if (step.kind !== "set") throw new Error(`expected a set, got ${step.kind}`);
  return step;
}

function done(p: SessionPlan, doc: SessionDoc, itemIndex: number, count: number): SessionDoc {
  return recordSet(p, doc, { itemIndex, count, setId: id(), exerciseId: id(), now: at(1) });
}

function finish(p: SessionPlan, doc: SessionDoc, itemIndex: number): SessionDoc {
  return finishExercise(p, doc, { itemIndex, effort: null, cuesFelt: [], hurt: null, hurtNote: "", now: at(2) });
}

describe("the prescription, said", () => {
  it("says sets and the target as words a voice reads well", () => {
    const [pullback, roll, hold] = plan().items;
    expect(spokenPrescription(pullback)).toBe("2 to 3 sets of 5 to 8 breaths, each side");
    expect(spokenPrescription(roll)).toBe("1 set of 15 rolls");
    expect(spokenPrescription(hold)).toBe("2 sets of 30 seconds");
    expect(spokenPrescription({ ...roll, targetMin: 1, unit: "reps" })).toBe("1 set of 1 rep");
  });
});

describe("each set, as it appears", () => {
  it("names the exercise and the side to start on, then the other side, then the next set", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });

    expect(setIntro(p, doc, setStep(p, doc))).toEqual({
      text: "Side-lying pullback. 2 to 3 sets of 5 to 8 breaths, each side. Right side first.",
      priority: "normal",
      key: "step",
    });

    doc = done(p, doc, 0, 8);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Now the left side.");

    doc = done(p, doc, 0, 8);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Set 2 of 2. Right side.");

    doc = done(p, doc, 0, 8);
    doc = done(p, doc, 0, 8);
    // One more set, up to the program's three.
    doc = oneMoreSet(p, doc, 0);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Set 3 of 3. Right side.");
  });

  it("says this session's share on a split day, not the whole day's sets (F2c)", () => {
    const p = plan();
    const aim = p.items.map((item) => ({ itemId: item.itemId, sets: 1, max: item.setsMax ?? item.setsMin }));
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null, aim });
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe(
      "Side-lying pullback. 1 set of 5 to 8 breaths, each side. Right side first.",
    );
    doc = done(p, doc, 0, 8);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Now the left side.");
  });

  it("gives a set counted in reps or rolls its cue with it, having no timer to say it later", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    for (let i = 0; i < 4; i++) doc = done(p, doc, 0, 8);
    doc = finish(p, doc, 0);
    // The dash in a name is a pause to the ear, not a word.
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe(
      "Foam roll, calves. 1 set of 15 rolls. Slow, about an inch a second.",
    );
  });

  it("says a set of a hold without its cue, which comes halfway through", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    for (let i = 0; i < 4; i++) doc = done(p, doc, 0, 8);
    doc = finish(p, doc, 0);
    doc = finish(p, done(p, doc, 1, 15), 1);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Wall hold. 2 sets of 30 seconds.");
    doc = done(p, doc, 2, 30);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Set 2 of 2.");
  });
});

describe("during a set", () => {
  it("says the cue as the middle breath starts and 'Last one.' as the last does", () => {
    const heard = Array.from({ length: 8 }, (_, i) => breathLine(i + 1, 8, "Ribs down"));
    expect(heard.map((l) => l?.text ?? null)).toEqual([
      null,
      null,
      null,
      null,
      "Ribs down.",
      null,
      null,
      "Last one.",
    ]);
    expect(heard[4]).toMatchObject({ priority: "low", key: "cue" });
    expect(heard[7]).toMatchObject({ priority: "normal", key: "count" });
  });

  it("keeps a short set short: no cue under three breaths, nothing for one", () => {
    expect(breathLine(2, 2, "Ribs down")?.text).toBe("Last one.");
    expect(breathLine(1, 2, "Ribs down")).toBeNull();
    expect(breathLine(1, 1, "Ribs down")).toBeNull();
    expect(breathLine(2, 3, "Ribs down")?.text).toBe("Ribs down.");
    expect(breathLine(3, 5, null)).toBeNull();
  });

  it("gives a hold its cue halfway and ten seconds' warning when it is long", () => {
    const said = (max: number, cue: string | null) =>
      Array.from({ length: max - 1 }, (_, i) => [i + 1, holdLine(i + 1, max, cue)?.text] as const).filter(
        ([, text]) => text,
      );
    expect(said(30, "Breathe")).toEqual([
      [15, "Breathe."],
      [20, "Ten seconds left."],
    ]);
    // Twenty seconds: the warning would land on the halfway, so only the cue.
    expect(said(20, "Breathe")).toEqual([[10, "Breathe."]]);
    expect(said(8, "Breathe")).toEqual([]);
    expect(said(40, null)).toEqual([[30, "Ten seconds left."]]);
  });

  it("changes the cue with each set, as the screen does", () => {
    const [pullback, , hold] = plan().items;
    expect([0, 1, 2, 3].map((d) => cueFor(pullback, d))).toEqual([
      "Low back relaxed",
      "Ribs down",
      "Low back relaxed",
      "Ribs down",
    ]);
    expect(cueFor(hold, 0)).toBeNull();
  });
});

describe("after an exercise", () => {
  it("says it is done, as the next step", () => {
    expect(EXERCISE_DONE).toEqual({ text: "Exercise done.", priority: "normal", key: "step" });
  });
});
