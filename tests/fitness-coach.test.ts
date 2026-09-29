import { describe, expect, it } from "vitest";
import {
  breathLine,
  cueFor,
  EXERCISE_DONE,
  holdLine,
  sessionLines,
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

/**
 * THE LINES FETCHED AHEAD (F2d, ADR 0115): what the coach's recordings are
 * asked for before the session says them. A line missing here is said late,
 * or in the device's robotic voice, so the list is checked against the
 * screen's own functions, walked the way the screen walks.
 */
describe("every line a session can say, fetched ahead", () => {
  it("walks the session to its end: each set's line, each timed set's cue, and the lines any set may say", () => {
    const p = plan();
    const doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    // In the order they are needed, so the first few (fetched on their own)
    // hold the first set's line.
    expect(sessionLines(p, doc)).toEqual([
      "Side-lying pullback. 2 to 3 sets of 5 to 8 breaths, each side. Right side first.",
      "Low back relaxed.",
      "Now the left side.",
      "Ribs down.",
      "Set 2 of 2. Right side.",
      "Foam roll, calves. 1 set of 15 rolls. Slow, about an inch a second.",
      "Wall hold. 2 sets of 30 seconds.",
      "Set 2 of 2.",
      "Last one.",
      "Ten seconds left.",
      "Exercise done.",
    ]);
  });

  it("holds every line the screen then says, set by set", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    const fetched = new Set(sessionLines(p, doc));
    const said: string[] = [];
    for (let guard = 0; guard < 50; guard++) {
      const step = nextStep(p, doc);
      if (step.kind === "finish") break;
      if (step.kind === "check") {
        said.push(EXERCISE_DONE.text);
        doc = finish(p, doc, step.itemIndex);
        continue;
      }
      const item = p.items[step.itemIndex];
      const max = item.targetMax ?? item.targetMin;
      const cue = cueFor(item, doc.exercises.find((e) => e.itemId === item.itemId)?.sets.length ?? 0);
      said.push(setIntro(p, doc, step).text);
      for (let n = 1; n <= max; n++) {
        const line =
          item.unit === "breaths" ? breathLine(n, max, cue) : item.unit === "seconds" ? holdLine(n, max, cue) : null;
        if (line) said.push(line.text);
      }
      doc = done(p, doc, step.itemIndex, max);
    }
    expect(said.length).toBeGreaterThan(10);
    expect(said.filter((line) => !fetched.has(line))).toEqual([]);
  });

  it("from the middle of a session, fetches only what is left", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    for (let i = 0; i < 4; i++) doc = done(p, doc, 0, 8);
    doc = finish(p, doc, 0);
    const lines = sessionLines(p, doc);
    expect(lines.some((line) => line.startsWith("Side-lying pullback"))).toBe(false);
    expect(lines).toContain("Foam roll, calves. 1 set of 15 rolls. Slow, about an inch a second.");
  });

  it("says a split day's share, as the screen will (F2c)", () => {
    const p = plan();
    const aim = p.items.map((item) => ({ itemId: item.itemId, sets: 1, max: item.setsMax ?? item.setsMin }));
    const lines = sessionLines(p, beginSession(p, { id: id(), now: at(0), feelBefore: null, aim }));
    expect(lines).toContain("Side-lying pullback. 1 set of 5 to 8 breaths, each side. Right side first.");
    expect(lines).toContain("Wall hold. 1 set of 30 seconds.");
    expect(lines).not.toContain("Set 2 of 2. Right side.");
  });

  it("does not foresee a set added with One more set, and fetches it once it is added", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    for (let i = 0; i < 4; i++) doc = done(p, doc, 0, 8);
    expect(sessionLines(p, doc)).not.toContain("Set 3 of 3. Right side.");
    doc = oneMoreSet(p, doc, 0);
    expect(sessionLines(p, doc)).toContain("Set 3 of 3. Right side.");
  });

  it("has nothing but the three standing lines once the session is over", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    for (let guard = 0; guard < 50; guard++) {
      const step = nextStep(p, doc);
      if (step.kind === "finish") break;
      doc = step.kind === "check" ? finish(p, doc, step.itemIndex) : done(p, doc, step.itemIndex, 30);
    }
    expect(sessionLines(p, doc)).toEqual(["Last one.", "Ten seconds left.", "Exercise done."]);
  });
});

describe("one side only, for a person whose side is known (F4b)", () => {
  /** The pullback as `sessionPlan` gives it to someone who leans left: lying on the left, not per side. */
  function oneSided(means: "side" | "lying" | "top_leg" = "lying"): SessionPlan {
    const p = plan();
    const [pullback, ...rest] = p.items;
    return { ...p, lean: "left", items: [{ ...pullback, perSide: false, onlySide: "left", sideMeans: means }, ...rest] };
  }

  it("says the side the way the program names it, every set, and never the other side", () => {
    const p = oneSided();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe(
      "Side-lying pullback. 2 to 3 sets of 5 to 8 breaths. Lying on your left side.",
    );
    doc = done(p, doc, 0, 8);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Set 2 of 2. Lying on your left side.");
    doc = done(p, doc, 0, 8);
    doc = oneMoreSet(p, doc, 0);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Set 3 of 3. Lying on your left side.");

    const leg = oneSided("top_leg");
    const fresh = beginSession(leg, { id: id(), now: at(0), feelBefore: null });
    expect(setIntro(leg, fresh, setStep(leg, fresh)).text).toContain("Left leg on top.");
  });

  it("fetches the one-sided lines ahead, and none of the two-sided ones", () => {
    const p = oneSided();
    const lines = sessionLines(p, beginSession(p, { id: id(), now: at(0), feelBefore: null }));
    expect(lines).toContain("Side-lying pullback. 2 to 3 sets of 5 to 8 breaths. Lying on your left side.");
    expect(lines).toContain("Set 2 of 2. Lying on your left side.");
    expect(lines.some((line) => /Right side|Now the left side|each side/.test(line))).toBe(false);
  });

  it("finishes an exercise begun on both sides in the words of both, when the side is saved mid-session", () => {
    let doc = beginSession(plan(), { id: id(), now: at(0), feelBefore: null });
    doc = done(plan(), doc, 0, 8);
    const p = oneSided();
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe("Now the left side.");
  });
});

describe("an exercise with levels (F4c)", () => {
  it("names the level with the exercise on its first set, and not after", () => {
    const base = plan();
    const p: SessionPlan = {
      ...base,
      items: [
        base.items[0],
        { ...base.items[1], level: { index: 1, count: 3, name: "Step 2", next: "Step 3", mark: { sets: 1, target: 15 } } },
        base.items[2],
      ],
    };
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    for (let k = 0; k < 4; k++) doc = done(p, doc, 0, 8);
    doc = finish(p, doc, 0);
    expect(setIntro(p, doc, setStep(p, doc)).text).toBe(
      "Foam roll, calves. Step 2. 1 set of 15 rolls. Slow, about an inch a second.",
    );
  });
});
