import { describe, expect, it } from "vitest";
import {
  beginSession,
  canAddSet,
  finishExercise,
  finishSession,
  fullSets,
  lastActivity,
  localDayOf,
  nextStep,
  oneMoreSet,
  recordSet,
  sessionDocSchema,
  sessionSummary,
  skipExercise,
  type SessionDoc,
  type SessionPlan,
} from "../src/modules/fitness/core/session";

/**
 * Workout mode's pure half (docs/modules/fitness.md, F2a): a session walked
 * from Start to Finish with no clock and no randomness, the way the phone
 * walks it. The database half is tests/fitness-ops.test.ts.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 13, minute, 0));
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** An invented phase: a per-side breath drill, then an optional rep drill. */
function plan(): SessionPlan {
  return {
    programId: "11111111-1111-4111-8111-111111111111",
    programName: "Starter Mobility",
    phaseId: "22222222-2222-4222-8222-222222222222",
    phaseName: "Weeks 1–2",
    phaseIndex: 0,
    phaseCount: 2,
    phases: [
      { id: "22222222-2222-4222-8222-222222222222", name: "Weeks 1–2" },
      { id: "33333333-3333-4333-8333-333333333333", name: "Weeks 3–4" },
    ],
    breath: { outS: 5, inS: 5 },
    effort: { min: 3, max: 5 },
    items: [
      {
        itemId: "44444444-4444-4444-8444-444444444444",
        exerciseId: "55555555-5555-4555-8555-555555555555",
        name: "Side-lying pullback",
        purpose: "",
        cues: ["Low back relaxed", "Ribs down"],
        unit: "breaths",
        perSide: true,
        optional: false,
        setsMin: 2,
        setsMax: 3,
        targetMin: 5,
        targetMax: 8,
        notes: "",
        video: null,
      },
      {
        itemId: "66666666-6666-4666-8666-666666666666",
        exerciseId: "77777777-7777-4777-8777-777777777777",
        name: "Wall stack",
        purpose: "",
        cues: [],
        unit: "reps",
        perSide: false,
        optional: true,
        setsMin: 1,
        setsMax: null,
        targetMin: 10,
        targetMax: null,
        notes: "",
        video: null,
      },
    ],
  };
}

function set(p: SessionPlan, doc: SessionDoc, itemIndex: number, count: number, minute: number) {
  return recordSet(p, doc, { itemIndex, count, setId: id(), exerciseId: id(), now: at(minute) });
}

describe("a session, walked from Start to Finish", () => {
  it("goes set by set, right side then left, then the three taps, then the next exercise", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: 4 });
    expect(doc.revision).toBe(1);
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 0, number: 1, side: "right" });

    doc = set(p, doc, 0, 8, 2);
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 0, number: 1, side: "left" });
    doc = set(p, doc, 0, 7, 4);
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 0, number: 2, side: "right" });
    doc = set(p, doc, 0, 8, 6);
    doc = set(p, doc, 0, 8, 8);
    expect(nextStep(p, doc)).toEqual({ kind: "check", itemIndex: 0 });

    const logged = doc.exercises[0];
    expect(logged.sets.map((s) => [s.number, s.side, s.count, s.target])).toEqual([
      [1, "right", 8, 5],
      [1, "left", 7, 5],
      [2, "right", 8, 5],
      [2, "left", 8, 5],
    ]);
    // The names travel with the log, because the program may change later.
    expect(logged).toMatchObject({ name: "Side-lying pullback", unit: "breaths", perSide: true });

    doc = finishExercise(p, doc, {
      itemIndex: 0,
      effort: 4,
      cuesFelt: ["Ribs down"],
      hurt: "pinch",
      hurtNote: "  left hip, front  ",
      now: at(9),
    });
    expect(doc.exercises[0]).toMatchObject({ effort: 4, cuesFelt: ["Ribs down"], hurt: "pinch", hurtNote: "left hip, front" });
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 1, number: 1, side: null });

    doc = set(p, doc, 1, 10, 11);
    doc = finishExercise(p, doc, { itemIndex: 1, effort: null, cuesFelt: [], hurt: "none", hurtNote: "ignored", now: at(12) });
    expect(doc.exercises[1].hurtNote).toBe("");
    expect(nextStep(p, doc)).toEqual({ kind: "finish" });

    doc = finishSession(doc, { feelAfter: 7, now: at(13) });
    // Three sets, not five rows: one set of a per-side exercise is both sides (F2c).
    expect(sessionSummary(doc)).toEqual({ exercises: 2, sets: 3, minutes: 13, feelBefore: 4, feelAfter: 7 });
    // Every change raised the revision, so the server can tell old from new.
    expect(doc.revision).toBe(1 + 4 + 1 + 1 + 1 + 1);
    expect(sessionDocSchema.safeParse(doc).success).toBe(true);
  });

  it("logs a set once however many times it is tapped: a set that is not next is refused", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    // The second exercise's set, while the first is next: nothing changes.
    expect(set(p, doc, 1, 10, 1)).toBe(doc);
    doc = set(p, doc, 0, 8, 1);
    doc = set(p, doc, 0, 8, 2);
    doc = set(p, doc, 0, 8, 3);
    doc = set(p, doc, 0, 8, 4);
    // Every planned set is done: another tap on it is refused, not a fifth set.
    expect(set(p, doc, 0, 8, 5)).toBe(doc);
  });

  it("offers one more set up to the program's maximum, and no further", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    for (let i = 0; i < 4; i++) doc = set(p, doc, 0, 8, i + 1);
    expect(canAddSet(p, doc, 0)).toBe(true);
    doc = oneMoreSet(p, doc, 0);
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 0, number: 3, side: "right" });
    expect(canAddSet(p, doc, 0)).toBe(false);
    expect(oneMoreSet(p, doc, 0)).toBe(doc);
  });

  it("skips an exercise, started or not, and moves on", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    doc = skipExercise(p, doc, { itemIndex: 0, exerciseId: id(), now: at(1) });
    expect(doc.exercises[0]).toMatchObject({ skipped: true, sets: [] });
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 1, number: 1, side: null });
    doc = skipExercise(p, doc, { itemIndex: 1, exerciseId: id(), now: at(2) });
    expect(nextStep(p, doc)).toEqual({ kind: "finish" });
    expect(sessionSummary(doc).exercises).toBe(0);
  });

  it("resumes where it was: the next step comes from the document, never from anything beside it", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    doc = set(p, doc, 0, 8, 1);
    // What a reload reads back from storage.
    const reloaded = sessionDocSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(nextStep(p, reloaded)).toEqual({ kind: "set", itemIndex: 0, number: 1, side: "left" });
  });

  it("ends a session left open at its last set, and says the day on the phone's own clock", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    doc = set(p, doc, 0, 8, 7);
    expect(lastActivity(doc)).toBe(at(7).toISOString());
    const local = new Date(2026, 8, 27, 23, 30);
    expect(localDayOf(local)).toBe("2026-09-27");
  });

  it("refuses a document that is not one", () => {
    const p = plan();
    const doc = beginSession(p, { id: id(), now: at(0), feelBefore: 4 });
    expect(sessionDocSchema.safeParse({ ...doc, feelBefore: 11 }).success).toBe(false);
    expect(sessionDocSchema.safeParse({ ...doc, localDay: "27/09/2026" }).success).toBe(false);
    expect(sessionDocSchema.safeParse({ ...doc, id: "not-a-uuid" }).success).toBe(false);
    expect(sessionDocSchema.safeParse({ ...doc, revision: 0 }).success).toBe(false);
  });
});

describe("one side only, for a person whose side is known (F4b)", () => {
  /** The first item as `sessionPlan` gives it to someone who leans left: lying on the left, and not per side. */
  function oneSided(): SessionPlan {
    const p = plan();
    return { ...p, lean: "left", items: [{ ...p.items[0], perSide: false, onlySide: "left", sideMeans: "lying" }, p.items[1]] };
  }

  it("does every set on that side, never turning to the other, and counts each set once", () => {
    const p = oneSided();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: 4 });
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 0, number: 1, side: "left" });
    doc = set(p, doc, 0, 8, 2);
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 0, number: 2, side: "left" });
    doc = set(p, doc, 0, 8, 4);
    expect(nextStep(p, doc)).toEqual({ kind: "check", itemIndex: 0 });

    const logged = doc.exercises[0];
    expect(logged).toMatchObject({ perSide: false, onlySide: "left" });
    expect(logged.sets.map((s) => [s.number, s.side])).toEqual([
      [1, "left"],
      [2, "left"],
    ]);
    // Two sets, not one: a set on its one side is a whole set.
    expect(fullSets(logged.perSide, logged.sets.map((s) => s.side))).toBe(2);
    expect(sessionSummary(doc).sets).toBe(2);
    // What a reload reads back: the side is in the document, so the next set is still on it.
    doc = oneMoreSet(p, doc, 0);
    const reloaded = sessionDocSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(nextStep(p, reloaded)).toEqual({ kind: "set", itemIndex: 0, number: 3, side: "left" });
  });

  it("finishes an exercise begun on both sides on both, when the side is saved mid-session", () => {
    let doc = beginSession(plan(), { id: id(), now: at(0), feelBefore: null });
    doc = set(plan(), doc, 0, 8, 1);
    const p = oneSided();
    // Begun right side first: the left of set 1 comes next, as it would have.
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 0, number: 1, side: "left" });
    doc = set(p, doc, 0, 8, 2);
    expect(nextStep(p, doc)).toEqual({ kind: "set", itemIndex: 0, number: 2, side: "right" });
    expect(doc.exercises[0]).not.toHaveProperty("onlySide");
  });

  it("leaves a document of both sides exactly as it was: no side field on an exercise done on both", () => {
    const p = plan();
    let doc = beginSession(p, { id: id(), now: at(0), feelBefore: null });
    doc = set(p, doc, 0, 8, 1);
    expect(doc.exercises[0]).not.toHaveProperty("onlySide");
    expect(sessionDocSchema.safeParse({ ...doc, exercises: [{ ...doc.exercises[0], onlySide: "middle" }] }).success).toBe(false);
  });
});
