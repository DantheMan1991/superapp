import { describe, expect, it } from "vitest";
import { shiftDay, type DayItem, type DaySession } from "../src/modules/fitness/core/day";
import {
  calendarWeeks,
  doneDaysWords,
  effortWarning,
  feelOf,
  mondayOf,
  newExercisesWords,
  phaseDays,
  phaseGate,
  programDays,
  weekCount,
  weeksOnTarget,
} from "../src/modules/fitness/core/progress";

/**
 * PROGRESS AND THE GATE (docs/modules/fitness.md, F3; approved from a
 * mockup, 2026-09-27). Worked out from the sessions logged, with no clock:
 * `today` is an argument. An invented program, as every fitness test uses.
 */

const PHASE_1 = "11111111-1111-4111-8111-111111111111";
const PHASE_2 = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Phase 1: two exercises, one set of A and two of B; phase 2: one of C. */
const phase1: DayItem[] = [
  { itemId: A, name: "Foam roll", optional: false, setsMin: 1, setsMax: null },
  { itemId: B, name: "Side-lying pullback", optional: false, setsMin: 2, setsMax: 3 },
];
const phase2: DayItem[] = [{ itemId: C, name: "Wall stack", optional: false, setsMin: 1, setsMax: null }];

let n = 0;
function session(localDay: string, sets: Record<string, number>, over: Partial<DaySession> = {}): DaySession {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    localDay,
    startedAt: `${localDay}T08:00:00.000Z`,
    endedAt: `${localDay}T08:20:00.000Z`,
    finished: true,
    items: Object.entries(sets).map(([itemId, count]) => ({ itemId, sets: count })),
    phaseId: PHASE_1,
    feelBefore: null,
    feelAfter: null,
    efforts: [],
    ...over,
  };
}

/** A whole phase 1 day. */
const whole = (day: string, over: Partial<DaySession> = {}) => session(day, { [A]: 1, [B]: 2 }, over);

// Sunday 27 September 2026.
const TODAY = "2026-09-27";

describe("done days", () => {
  it("counts a day done when its sessions together did every exercise's sets", () => {
    const sessions = [
      whole("2026-09-21"),
      // A split day: the morning's half and the evening's rest.
      session("2026-09-22", { [A]: 1, [B]: 1 }),
      session("2026-09-22", { [B]: 1 }),
      // Some sets, not all.
      session("2026-09-23", { [B]: 2 }),
      // Another phase's day is nothing to this one.
      session("2026-09-24", { [C]: 1 }, { phaseId: PHASE_2 }),
    ];
    expect(phaseDays(phase1, sessions)).toEqual({
      done: ["2026-09-21", "2026-09-22"],
      partial: ["2026-09-23"],
    });
    expect(phaseDays(phase2, sessions)).toEqual({ done: ["2026-09-24"], partial: [] });
  });

  it("counts a day for the program when any phase was done on it", () => {
    const sessions = [
      session("2026-09-24", { [B]: 1 }),
      session("2026-09-24", { [C]: 1 }, { phaseId: PHASE_2 }),
      session("2026-09-25", { [A]: 1 }),
    ];
    const days = programDays([{ items: phase1 }, { items: phase2 }], sessions);
    expect([...days.done]).toEqual(["2026-09-24"]);
    // A day done for one phase is not "some sets" for another.
    expect([...days.partial]).toEqual(["2026-09-25"]);
    expect(days.perPhase.map((p) => p.done.length)).toEqual([0, 1]);
  });
});

describe("the gate", () => {
  it("opens at the phase's done days, and is open when the program sets none", () => {
    expect(phaseGate(14, 6)).toEqual({ done: 6, needed: 14, open: false });
    expect(phaseGate(14, 14)).toEqual({ done: 14, needed: 14, open: true });
    expect(phaseGate(14, 17).open).toBe(true);
    expect(phaseGate(null, 0)).toEqual({ done: 0, needed: null, open: true });
  });

  it("says the done days in words, never past the number needed", () => {
    expect(doneDaysWords(phaseGate(14, 6))).toBe("6 of 14 done days");
    expect(doneDaysWords(phaseGate(14, 17))).toBe("14 of 14 done days");
    expect(doneDaysWords(phaseGate(1, 1))).toBe("1 of 1 done day");
    expect(doneDaysWords(phaseGate(null, 3))).toBe("3 done days");
    expect(doneDaysWords(phaseGate(null, 1))).toBe("1 done day");
  });

  it("says what the next phase brings", () => {
    expect(newExercisesWords(4, ["Wall stack", "Side reach"])).toBe("4 exercises, 2 of them new: Wall stack, Side reach.");
    expect(newExercisesWords(2, ["Wall stack", "Side reach"])).toBe("2 exercises, all new: Wall stack, Side reach.");
    expect(newExercisesWords(3, [])).toBe("3 exercises.");
    expect(newExercisesWords(1, ["Wall stack"])).toBe("1 exercise, all new: Wall stack.");
  });
});

describe("the week and the streak", () => {
  it("starts a week on Monday", () => {
    expect(mondayOf("2026-09-27")).toBe("2026-09-21"); // a Sunday
    expect(mondayOf("2026-09-21")).toBe("2026-09-21");
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
    expect(mondayOf("2026-03-01")).toBe("2026-02-23");
  });

  it("counts this week's done days up to today", () => {
    const done = new Set(["2026-09-20", "2026-09-21", "2026-09-23", "2026-09-27", "2026-09-28"]);
    expect(weekCount(done, TODAY)).toBe(3);
    expect(weekCount(done, "2026-09-23")).toBe(2);
  });

  it("counts weeks in a row that met the program's minimum, never broken by the week going on", () => {
    const week = (monday: string, days: number[]) => days.map((d) => shiftDay(monday, d));
    const done = new Set([
      ...week("2026-08-31", [0, 2]), // two: short of three
      ...week("2026-09-07", [0, 2, 4]),
      ...week("2026-09-14", [1, 3, 5, 6]),
    ]);
    // This week (from the 21st) has nothing yet: it does not break the two before.
    expect(weeksOnTarget(done, TODAY, 3)).toBe(2);
    // Three done this week: it counts too.
    const withThisWeek = new Set([...done, ...week("2026-09-21", [0, 2, 4])]);
    expect(weeksOnTarget(withThisWeek, TODAY, 3)).toBe(3);
    // A week with two breaks the streak behind it: on the Sunday the 13th, that
    // week has its three and counts, and the week before it has two.
    expect(weeksOnTarget(done, "2026-09-13", 3)).toBe(1);
    // Midweek, with two so far, the week going on has not counted yet.
    expect(weeksOnTarget(done, "2026-09-10", 3)).toBe(0);
    expect(weeksOnTarget(new Set(), TODAY, 3)).toBe(0);
    expect(weeksOnTarget(done, TODAY, 0)).toBe(0);
  });
});

describe("the calendar", () => {
  it("draws the last four weeks, Monday to Sunday, with done, some sets, nothing and still to come", () => {
    const weeks = calendarWeeks(new Set(["2026-09-22"]), new Set(["2026-09-23"]), "2026-09-24");
    expect(weeks).toHaveLength(4);
    expect(weeks.every((row) => row.length === 7)).toBe(true);
    expect(weeks[0][0].day).toBe("2026-08-31"); // the Monday four weeks back
    expect(weeks[3].map((cell) => cell.state)).toEqual([
      "none",
      "done",
      "partial",
      "none",
      "ahead",
      "ahead",
      "ahead",
    ]);
    expect(weeks[3].filter((cell) => cell.today).map((cell) => cell.day)).toEqual(["2026-09-24"]);
  });
});

describe("the effort warning", () => {
  const zone = { min: 3, max: 5 };

  it("counts this week's exercises rated above the program's zone, in its own terms", () => {
    const sessions = [
      whole("2026-09-22", { efforts: [4, 6] }),
      whole("2026-09-24", { efforts: [6, 5] }),
      // Last week does not count.
      whole("2026-09-18", { efforts: [9] }),
    ];
    expect(effortWarning(sessions, zone, TODAY)).toBe(
      "2 exercises at 6/10 this week. The program says stay at 3–5.",
    );
    expect(effortWarning([whole("2026-09-22", { efforts: [6, 7] })], zone, TODAY)).toBe(
      "2 exercises above 5/10 this week. The program says stay at 3–5.",
    );
    expect(effortWarning([whole("2026-09-22", { efforts: [7] })], { min: 3, max: 3 }, TODAY)).toBe(
      "1 exercise at 7/10 this week. The program says stay at 3.",
    );
  });

  it("says nothing within the zone, or for a program with no zone", () => {
    expect(effortWarning([whole("2026-09-22", { efforts: [3, 5] })], zone, TODAY)).toBeNull();
    expect(effortWarning([whole("2026-09-22", { efforts: [9] })], null, TODAY)).toBeNull();
  });
});

describe("how the body felt", () => {
  it("averages before and after over the phase's sessions that asked both", () => {
    const sessions = [
      whole("2026-09-21", { feelBefore: 4, feelAfter: 7 }),
      whole("2026-09-22", { feelBefore: 5, feelAfter: 6 }),
      whole("2026-09-23", { feelBefore: 3, feelAfter: null }),
      whole("2026-09-24", { feelBefore: 2, feelAfter: 9, phaseId: PHASE_2 }),
    ];
    expect(feelOf(sessions, PHASE_1)).toEqual({
      before: 4.5,
      after: 6.5,
      sessions: 2,
      series: [
        { before: 4, after: 7 },
        { before: 5, after: 6 },
      ],
    });
    expect(feelOf(sessions, PHASE_1, 1)?.series).toEqual([{ before: 5, after: 6 }]);
    expect(feelOf([whole("2026-09-23", { feelBefore: 3 })], PHASE_1)).toBeNull();
  });
});
