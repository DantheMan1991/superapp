import { describe, expect, it } from "vitest";
import {
  askWords,
  dueWords,
  markLabel,
  markLabels,
  postureMarks,
  type MarkCheck,
  type MarkProgram,
  type MarkSession,
} from "../src/modules/fitness/posture/core/marks";

/**
 * A PROGRAM'S POSTURE MARKS (docs/modules/posture.md, slice 3c): a posture
 * check at a workout program's start and at the end of each phase, worked out
 * from the sessions and the checks, asked for while it is due and left behind
 * once its days pass. An invented program, three phases of three done days.
 */

const PROGRAM: MarkProgram = {
  id: "p",
  name: "Starter Mobility",
  phases: [
    { id: "a", name: "Phase 1", minDoneDays: 3 },
    { id: "b", name: "Phase 2", minDoneDays: 3 },
    { id: "c", name: "Phase 3", minDoneDays: 3 },
  ],
};

const session = (localDay: string, phaseId: string): MarkSession => ({ localDay, phaseId });
const check = (id: string, localDay: string, repeatOf: string | null = null): MarkCheck => ({
  id,
  takenAt: `${localDay}T09:00:00.000Z`,
  localDay,
  repeatOf,
});

/** Every session a done day, per phase. */
function marksOf(sessions: MarkSession[], checks: MarkCheck[], today: string, program = PROGRAM) {
  const doneDays = program.phases.map((phase) => sessions.filter((s) => s.phaseId === phase.id).map((s) => s.localDay).sort());
  return postureMarks({ program, doneDays, sessions, checks, today });
}

// Phase 1 done on Sep 1, 10 and 15: its gate opens on the 15th.
const PHASE_ONE = [session("2026-09-01", "a"), session("2026-09-10", "a"), session("2026-09-15", "a")];
const STARTED = check("start", "2026-08-31");

describe("the start of a program", () => {
  it("is asked for before the first workout, unless a check was taken in the past week", () => {
    const stale = marksOf([], [check("old", "2026-09-01")], "2026-09-20");
    expect(stale.due?.kind).toBe("start");
    expect(askWords(stale.due!).ask).toBe("Take a posture check before your first workout.");

    const fresh = marksOf([], [check("recent", "2026-09-14")], "2026-09-20");
    expect(fresh.due).toBeNull();
    expect(fresh.marks[0].met?.id).toBe("recent");
  });

  it("is marked by a check from a week before the first workout to a week after", () => {
    expect(marksOf(PHASE_ONE.slice(0, 1), [check("before", "2026-08-25")], "2026-09-02").marks[0].met?.id).toBe("before");
    expect(marksOf(PHASE_ONE.slice(0, 1), [check("after", "2026-09-07")], "2026-09-08").marks[0].met?.id).toBe("after");
    const early = marksOf(PHASE_ONE.slice(0, 1), [check("early", "2026-08-24")], "2026-09-03");
    expect(early.marks[0].met).toBeNull();
    expect(askWords(early.due!).ask).toBe("Take a posture check this week, to mark the start of Starter Mobility.");
  });

  it("is left behind without a word once its week has passed", () => {
    expect(marksOf(PHASE_ONE.slice(0, 1), [check("early", "2026-08-24")], "2026-09-08").due).toBeNull();
  });
});

describe("the end of a phase", () => {
  it("opens the day its gate opens, and is asked for while the person has not moved on", () => {
    const { marks, due } = marksOf(PHASE_ONE, [STARTED], "2026-10-20");
    expect(marks.map((m) => m.kind)).toEqual(["start", "end"]);
    expect(due).toMatchObject({ kind: "end", phaseIndex: 0, day: "2026-09-15", movedOn: null, to: null });
    expect(askWords(due!)).toEqual({
      ask: "Take a posture check before you move on.",
      why: "One at the end of each phase shows what that phase changed.",
    });
    expect(markLabel(due!)).toBe("End of Phase 1");
    expect(dueWords(due!)).toBe("A check now marks the end of Phase 1, in Starter Mobility.");
  });

  it("is marked by a check from three days before the gate, and not four", () => {
    expect(marksOf(PHASE_ONE, [STARTED, check("end", "2026-09-12")], "2026-09-16").marks[1].met?.id).toBe("end");
    const tooSoon = marksOf(PHASE_ONE, [STARTED, check("mid", "2026-09-11")], "2026-09-16");
    expect(tooSoon.marks[1].met).toBeNull();
    expect(tooSoon.due?.kind).toBe("end");
  });

  it("is asked for a week after moving on, then left behind", () => {
    const moved = [...PHASE_ONE, session("2026-09-17", "b")];
    const due = marksOf(moved, [STARTED], "2026-09-23").due;
    expect(due).toMatchObject({ kind: "end", phaseIndex: 0, movedOn: "2026-09-17", to: "2026-09-23" });
    expect(askWords(due!).ask).toBe("Take a posture check this week, to mark the end of Phase 1.");
    expect(marksOf(moved, [STARTED], "2026-09-24").due).toBeNull();
    expect(marksOf(moved, [STARTED, check("late", "2026-09-22")], "2026-09-24").marks[1].met?.id).toBe("late");
  });

  it("ends the day the person moved on, when that came before the gate", () => {
    const early = [session("2026-09-01", "a"), session("2026-09-03", "a"), session("2026-09-05", "b")];
    expect(marksOf(early, [STARTED], "2026-09-06").due).toMatchObject({ kind: "end", day: "2026-09-05", from: "2026-09-02" });
  });

  it("has none for a phase never done, or one still going with no gate", () => {
    expect(marksOf(PHASE_ONE.slice(0, 2), [STARTED], "2026-09-12").marks.map((m) => m.kind)).toEqual(["start"]);
    const open = { ...PROGRAM, phases: [{ id: "a", name: "Every day", minDoneDays: null }] };
    expect(marksOf(PHASE_ONE, [STARTED], "2026-09-20", open).marks.map((m) => m.kind)).toEqual(["start"]);
  });

  it("stays open at the end of the last phase, to see what the program changed", () => {
    const whole = [
      ...PHASE_ONE,
      ...["2026-09-17", "2026-09-20", "2026-09-24"].map((d) => session(d, "b")),
      ...["2026-09-26", "2026-09-28", "2026-09-30"].map((d) => session(d, "c")),
    ];
    const checks = [STARTED, check("one", "2026-09-16"), check("two", "2026-09-25")];
    const { marks, due } = marksOf(whole, checks, "2026-12-01");
    expect(marks.map((m) => m.met?.id ?? null)).toEqual(["start", "one", "two", null]);
    expect(due).toMatchObject({ kind: "end", phaseIndex: 2, last: true, to: null });
    expect(askWords(due!).ask).toBe("Take a posture check to see what Starter Mobility changed.");
    expect(marksOf(whole, [...checks, check("three", "2026-12-01")], "2026-12-01").marks[3].met?.id).toBe("three");
  });
});

describe("which check marks what", () => {
  it("never a repeat, and a check marks one at most", () => {
    const repeat = marksOf(PHASE_ONE, [STARTED, check("rep", "2026-09-15", "start")], "2026-09-16");
    expect(repeat.marks[1].met).toBeNull();
    // Three done days in three: the start's week and the end's days overlap. A
    // check a day after the start and a day before the end marks the start, the
    // one it came after, and marks nothing else.
    const quick = [session("2026-09-01", "a"), session("2026-09-02", "a"), session("2026-09-03", "a")];
    const one = marksOf(quick, [check("only", "2026-09-02")], "2026-09-04");
    expect(one.marks.map((m) => m.met?.id ?? null)).toEqual(["only", null]);
    expect(one.due?.kind).toBe("end");
  });

  it("goes to the mark whose day it is nearest, where their days overlap", () => {
    // Phase 1's gate opens on the 5th, inside the start's week: a check on the
    // 4th is a day from the end and three from the start.
    const short = [session("2026-09-01", "a"), session("2026-09-02", "a"), session("2026-09-05", "a")];
    const { marks, due } = marksOf(short, [check("near-end", "2026-09-04")], "2026-09-06");
    expect(marks.map((m) => m.met?.id ?? null)).toEqual([null, "near-end"]);
    // The latest mark is marked, so nothing is asked for, though the start's week is still open.
    expect(due).toBeNull();
    // Two checks: each mark takes the one nearest its day.
    const both = marksOf(short, [check("early", "2026-08-26"), check("pre", "2026-08-31"), check("near-end", "2026-09-04")], "2026-09-06");
    expect(both.marks.map((m) => m.met?.id ?? null)).toEqual(["pre", "near-end"]);
  });

  it("asks only for the latest mark, and never a person who has not taken a posture check", () => {
    const moved = [...PHASE_ONE, ...["2026-09-17", "2026-09-20", "2026-09-24"].map((d) => session(d, "b"))];
    // Phase 1's end went unmarked; phase 2's gate opened on the 24th and nobody has moved on.
    expect(marksOf(moved, [STARTED], "2026-09-25").due).toMatchObject({ kind: "end", phaseIndex: 1 });
    expect(marksOf(moved, [], "2026-09-25").due).toBeNull();
    expect(marksOf([], [], "2026-09-25").due).toBeNull();
  });

  it("labels each check that marked something, naming the program once, both programs' when two share it", () => {
    const first = marksOf(PHASE_ONE, [STARTED, check("end", "2026-09-15")], "2026-09-16");
    const other = { ...PROGRAM, id: "q", name: "Strong Feet" };
    const second = marksOf([session("2026-09-16", "a")], [STARTED, check("end", "2026-09-15")], "2026-09-16", other);
    expect(markLabels([...first.marks, ...second.marks])).toEqual({
      start: [{ label: "Start of Starter Mobility", full: "Start of Starter Mobility" }],
      end: [
        { label: "End of Phase 1", full: "End of Phase 1, in Starter Mobility" },
        { label: "Start of Strong Feet", full: "Start of Strong Feet" },
      ],
    });
  });
});
