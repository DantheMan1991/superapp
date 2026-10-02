import { describe, expect, it } from "vitest";
import {
  clockOf,
  clockWords,
  durationWords,
  minuteOfDay,
  sleepInputSchema,
  sleepMinutes,
} from "../src/modules/health/core/sleep";
import {
  plungeInputSchema,
  plungeWords,
  timedSeconds,
  timerFace,
  typedSeconds,
  typedWater,
  waterWords,
  wholeMinutes,
} from "../src/modules/health/core/plunge";
import {
  amountWords,
  HABIT_NAME_MAX,
  habitDayInputSchema,
  habitInputSchema,
  typedAmount,
} from "../src/modules/health/core/habits";
import {
  barHeights,
  inWindow,
  mean,
  progressWindows,
  readRow,
  shiftDay,
  valueWords,
  weekLabel,
  weekWords,
} from "../src/modules/health/core/progress";
import { healthRows } from "../src/modules/health/core/rows";
import { HEALTH_MESSAGES, HealthError } from "../src/modules/health/core/errors";
import { workoutRows, workoutToday, type WorkedOut } from "../src/modules/fitness/core/progress-rows";
import type { ProgressRow } from "../src/lib/progress-sources/types";

/**
 * HEALTH, THE PURE HALF (docs/modules/health.md, H1): a night's minutes from
 * two clock times, the plunge timer's words, habits typed in, and the weeks
 * Progress adds up and reads. Plus what Workouts tells Health through the
 * progress slot (`fitness/core/progress-rows.ts`).
 */

const ID = "6f1c2b8e-4a3d-4c1e-9b7a-2d5e8f9a0b1c";

describe("sleep", () => {
  it("works out a night that crosses midnight, and one that does not", () => {
    expect(sleepMinutes("22:50", "06:10")).toBe(440);
    expect(sleepMinutes("01:00", "07:30")).toBe(390);
    // A sleep in the day is the wake time less the bed time too.
    expect(sleepMinutes("13:00", "14:30")).toBe(90);
    expect(sleepMinutes("23:59", "00:00")).toBe(1);
  });

  it("has no night when the times are the same, or are not times", () => {
    expect(sleepMinutes("07:00", "07:00")).toBeNull();
    expect(sleepMinutes("7:00", "08:00")).toBeNull();
    expect(sleepMinutes("24:00", "08:00")).toBeNull();
    expect(minuteOfDay("23:59")).toBe(1439);
    expect(minuteOfDay("12:60")).toBeNull();
  });

  it("says a night and a clock time the way a person reads them", () => {
    expect(durationWords(440)).toBe("7 h 20 min");
    expect(durationWords(45)).toBe("45 min");
    expect(durationWords(480)).toBe("8 h");
    expect(durationWords(431.6)).toBe("7 h 12 min");
    expect(clockWords("22:50")).toBe("10:50 pm");
    expect(clockWords("06:10")).toBe("6:10 am");
    expect(clockWords("00:30")).toBe("12:30 am");
    expect(clockWords("12:00")).toBe("12:00 pm");
    expect(clockOf("22:50:00")).toBe("22:50");
  });

  it("refuses a night whose bed and wake times are the same, by the code the action maps", () => {
    const night = { wokeOn: "2026-10-02", bedTime: "22:30", wokeTime: "06:30", rested: 7 };
    expect(sleepInputSchema.safeParse(night).success).toBe(true);
    expect(sleepInputSchema.safeParse({ ...night, rested: null }).success).toBe(true);
    const same = sleepInputSchema.safeParse({ ...night, wokeTime: "22:30" });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0].message).toBe("SAME_TIME");
    expect(HEALTH_MESSAGES.SAME_TIME).toMatch(/same/);
    for (const bad of [{ rested: 11 }, { rested: -1 }, { rested: 6.5 }, { bedTime: "7:00" }, { wokeOn: "2026-10-2" }]) {
      expect(sleepInputSchema.safeParse({ ...night, ...bad }).success).toBe(false);
    }
  });
});

describe("cold plunge", () => {
  it("shows the timer as a clock, and a plunge in words", () => {
    expect(timerFace(7_000)).toBe("0:07");
    expect(timerFace(165_400)).toBe("2:45");
    expect(timerFace(723_000)).toBe("12:03");
    expect(timerFace(-500)).toBe("0:00");
    expect(plungeWords(190)).toBe("3 min 10 s");
    expect(plungeWords(45)).toBe("45 s");
    expect(plungeWords(240)).toBe("4 min");
    expect(waterWords(48)).toBe("48°F");
    expect(waterWords(48.5)).toBe("48.5°F");
  });

  it("sounds a tone as each whole minute turns, and keeps a timed plunge to an hour", () => {
    expect(wholeMinutes(59_999)).toBe(0);
    expect(wholeMinutes(60_000)).toBe(1);
    expect(wholeMinutes(-1)).toBe(0);
    expect(timedSeconds(0, 400)).toBe(1);
    expect(timedSeconds(0, 190_400)).toBe(190);
    expect(timedSeconds(0, 5 * 3_600_000)).toBe(3600);
  });

  it("reads minutes and seconds typed in, and refuses what is not a plunge", () => {
    expect(typedSeconds("3", "10")).toBe(190);
    expect(typedSeconds("", "45")).toBe(45);
    expect(typedSeconds("4", "")).toBe(240);
    expect(typedSeconds("60", "0")).toBe(3600);
    expect(typedSeconds("0", "0")).toBeNull();
    expect(typedSeconds("", "")).toBeNull();
    expect(typedSeconds("2", "60")).toBeNull();
    expect(typedSeconds("60", "1")).toBeNull();
    expect(typedSeconds("1.5", "0")).toBeNull();
    expect(typedSeconds("-1", "30")).toBeNull();
  });

  it("reads a water temperature typed in: a number in range, nothing, or not one", () => {
    expect(typedWater("")).toBe("");
    expect(typedWater("  ")).toBe("");
    expect(typedWater("48")).toBe(48);
    expect(typedWater("48,5")).toBe(48.5);
    expect(typedWater("39.04")).toBe(39);
    expect(typedWater("20")).toBeNull();
    expect(typedWater("111")).toBeNull();
    expect(typedWater("cold")).toBeNull();
  });

  it("accepts a plunge the phone sends, and refuses one out of range", () => {
    const plunge = { id: ID, startedAt: "2026-10-02T07:05:00-04:00", seconds: 190, waterF: 48, feelAfter: 8 };
    expect(plungeInputSchema.safeParse(plunge).success).toBe(true);
    expect(plungeInputSchema.safeParse({ ...plunge, waterF: null, feelAfter: null }).success).toBe(true);
    for (const bad of [
      { id: "not-an-id" },
      { seconds: 0 },
      { seconds: 3601 },
      { seconds: 12.5 },
      { waterF: 27 },
      { waterF: 111 },
      { feelAfter: 11 },
      { startedAt: "this morning" },
    ]) {
      expect(plungeInputSchema.safeParse({ ...plunge, ...bad }).success).toBe(false);
    }
  });
});

describe("habits", () => {
  it("trims a habit's name and unit, and keeps no unit as none", () => {
    expect(habitInputSchema.parse({ name: "  Sauna ", unit: "" })).toEqual({ name: "Sauna", unit: null });
    expect(habitInputSchema.parse({ name: "Sauna", unit: " min " })).toEqual({ name: "Sauna", unit: "min" });
    expect(habitInputSchema.parse({ name: "Creatine", unit: null })).toEqual({ name: "Creatine", unit: null });
    expect(habitInputSchema.safeParse({ name: "   ", unit: null }).success).toBe(false);
    expect(habitInputSchema.safeParse({ name: "x".repeat(HABIT_NAME_MAX + 1), unit: null }).success).toBe(false);
  });

  it("reads an amount typed in, and says it with its unit", () => {
    expect(typedAmount("20")).toBe(20);
    expect(typedAmount(" 2,5 ")).toBe(2.5);
    expect(typedAmount("1.234")).toBe(1.23);
    expect(typedAmount("0")).toBeNull();
    expect(typedAmount("-1")).toBeNull();
    expect(typedAmount("a lot")).toBeNull();
    expect(amountWords(20, "min")).toBe("20 min");
    expect(amountWords(2.5, "g")).toBe("2.5 g");
    expect(amountWords(3, null)).toBe("3");
  });

  it("marks a day done with a positive amount or none, and refuses nothing as an amount", () => {
    const day = { habitId: ID, day: "2026-10-02", done: true, amount: 20 };
    expect(habitDayInputSchema.safeParse(day).success).toBe(true);
    expect(habitDayInputSchema.safeParse({ ...day, amount: null }).success).toBe(true);
    expect(habitDayInputSchema.safeParse({ ...day, amount: 0 }).success).toBe(false);
    expect(habitDayInputSchema.safeParse({ ...day, day: "today" }).success).toBe(false);
  });

  it("carries the sentence the person is told", () => {
    const error = new HealthError("HABIT_NAME_TAKEN");
    expect(error.code).toBe("HABIT_NAME_TAKEN");
    expect(error.message).toBe(HEALTH_MESSAGES.HABIT_NAME_TAKEN);
  });
});

describe("progress, by week", () => {
  it("is four weeks of seven days, the newest ending today", () => {
    expect(progressWindows("2026-10-02")).toEqual([
      { from: "2026-09-05", to: "2026-09-11" },
      { from: "2026-09-12", to: "2026-09-18" },
      { from: "2026-09-19", to: "2026-09-25" },
      { from: "2026-09-26", to: "2026-10-02" },
    ]);
    // Across a year, and a leap day.
    expect(progressWindows("2027-01-03", 1)).toEqual([{ from: "2026-12-28", to: "2027-01-03" }]);
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekLabel({ from: "2026-09-26", to: "2026-10-02" })).toBe("Sep 26");
  });

  it("counts a day on either end of a week as in it", () => {
    const week = { from: "2026-09-26", to: "2026-10-02" };
    expect(inWindow("2026-09-26", week)).toBe(true);
    expect(inWindow("2026-10-02", week)).toBe(true);
    expect(inWindow("2026-09-25", week)).toBe(false);
    expect(inWindow("2026-10-03", week)).toBe(false);
  });

  it("says each kind of number in the person's words", () => {
    expect(valueWords(1, "days")).toBe("1 day");
    expect(valueWords(4, "days")).toBe("4 days");
    expect(valueWords(432, "minutes")).toBe("7 h 12 min");
    expect(valueWords(190, "seconds")).toBe("3 min 10 s");
    expect(valueWords(7.25, "score")).toBe("7.3");
    expect(valueWords(7, "score")).toBe("7.0");
    expect(valueWords(3.4, "count")).toBe("3");
    expect(valueWords(60, "amount", "min")).toBe("60 min");
    expect(valueWords(2.46, "amount", "g")).toBe("2.5 g");
    // A week's score on its own carries its scale; a change in one does not.
    expect(weekWords(6.5, "score")).toBe("6.5 of 10");
    expect(weekWords(432, "minutes")).toBe("7 h 12 min");
  });

  function row(values: (number | null)[], format: ProgressRow["format"], better: ProgressRow["better"] = "up"): ProgressRow {
    return { key: "test", name: "Test", values, format, better };
  }

  it("reads the newest week against the weeks before it that had something", () => {
    // 420 and 400 before (the empty week is not a zero): 410 on average, 450 now.
    expect(readRow(row([420, 400, null, 450], "minutes"))).toEqual({
      latest: "7 h 30 min",
      change: "up 40 min on the weeks before",
      moved: "up",
      direction: "better",
    });
    expect(readRow(row([6, 5, 7, 3], "score"))).toEqual({
      latest: "3.0 of 10",
      change: "down 3.0 on the weeks before",
      moved: "down",
      direction: "worse",
    });
  });

  it("calls a small change about the same, and says which way only when a way is better", () => {
    expect(readRow(row([420, 425], "minutes"))).toMatchObject({
      change: "about the same as the weeks before",
      moved: null,
      direction: "same",
    });
    expect(readRow(row([2, 3], "count", null))).toMatchObject({ change: "up 1 on the weeks before", moved: "up", direction: null });
    // Fewer is better here: the number went down (the arrow), and that is better (the colour).
    expect(readRow(row([10, 5], "count", "down"))).toMatchObject({
      change: "down 5 on the weeks before",
      moved: "down",
      direction: "better",
    });
  });

  it("says only what it can when the newest week is empty, or nothing came before it", () => {
    expect(readRow(row([3, 4, null], "count"))).toEqual({ latest: null, change: null, moved: null, direction: null });
    expect(readRow(row([null, null, 4], "days"))).toEqual({ latest: "4 days", change: null, moved: null, direction: null });
  });

  it("draws each week as a share of the row's largest, and an empty week as no bar", () => {
    expect(barHeights([2, null, 4, 0])).toEqual([0.5, null, 1, 0]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
    expect(barHeights([null, null])).toEqual([null, null]);
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 6])).toBe(3);
  });
});

describe("Health's own rows", () => {
  const windows = [
    { from: "2026-09-19", to: "2026-09-25" },
    { from: "2026-09-26", to: "2026-10-02" },
  ];

  it("averages sleep and how rested, counts plunges, and averages the time in the cold", () => {
    const rows = healthRows(
      windows,
      [
        { wokeOn: "2026-09-26", minutes: 420, rested: 6 },
        { wokeOn: "2026-10-02", minutes: 480, rested: null },
      ],
      [
        { takenOn: "2026-09-20", seconds: 120 },
        { takenOn: "2026-09-27", seconds: 180 },
        { takenOn: "2026-10-02", seconds: 240 },
      ],
      [],
      [],
    );
    expect(rows.map((r) => [r.key, r.values])).toEqual([
      // A week with no night logged is nothing, not zero hours.
      ["health.sleep", [null, 450]],
      // A night with no "rested" is left out of the average, not a zero.
      ["health.rested", [null, 6]],
      // No plunges in a week IS zero plunges.
      ["health.plunges", [1, 2]],
      ["health.plunge-time", [120, 210]],
    ]);
    expect(rows.map((r) => r.format)).toEqual(["minutes", "score", "count", "seconds"]);
  });

  it("gives each habit a row: how much when it is counted, how many days when it is not", () => {
    const sauna = { id: "h-sauna", name: "Sauna", unit: "min" };
    const stretch = { id: "h-stretch", name: "Stretch", unit: null };
    const rows = healthRows(windows, [], [], [sauna, stretch], [
      { habitId: "h-sauna", doneOn: "2026-09-26", amount: 20 },
      { habitId: "h-sauna", doneOn: "2026-10-01", amount: 15 },
      { habitId: "h-stretch", doneOn: "2026-09-22", amount: null },
      { habitId: "h-stretch", doneOn: "2026-10-02", amount: null },
      { habitId: "h-stretch", doneOn: "2026-10-01", amount: null },
    ]).slice(4);
    expect(rows).toEqual([
      { key: "health.habit.h-sauna", name: "Sauna", values: [0, 35], format: "amount", unit: "min", better: "up" },
      { key: "health.habit.h-stretch", name: "Stretch", values: [1, 2], format: "days", better: "up" },
    ]);
  });
});

describe("what Workouts tells Health", () => {
  const windows = [
    { from: "2026-09-19", to: "2026-09-25" },
    { from: "2026-09-26", to: "2026-10-02" },
  ];
  const at = (day: number, hour: number) => new Date(2026, 8, day, hour);
  function worked(localDay: string, extra: Partial<WorkedOut> = {}): WorkedOut {
    return { localDay, exercises: 2, minutes: 20, feelBefore: null, feelAfter: null, startedAt: at(1, 8), ...extra };
  }

  it("counts workout days, two sessions on one day being one, and averages the feel after", () => {
    const rows = workoutRows(
      [
        worked("2026-09-26", { feelAfter: 6 }),
        worked("2026-09-26", { feelAfter: 8 }),
        worked("2026-09-29"),
        worked("2026-10-02", { feelAfter: 7 }),
      ],
      windows,
    );
    expect(rows).toEqual([
      { key: "fitness.days", name: "Workout days", values: [0, 3], format: "days", better: "up" },
      { key: "fitness.feel", name: "Feel after a workout", values: [null, 7], format: "score", better: "up" },
    ]);
  });

  it("puts today's workout on a card, with how the last one left the person", () => {
    expect(workoutToday([])).toEqual({
      key: "fitness",
      title: "Workout",
      icon: "dumbbell",
      lines: ["Not yet today"],
      href: "/personal/m/fitness",
    });
    const morning = worked("2026-10-02", { exercises: 3, minutes: 25, feelBefore: 4, feelAfter: 7, startedAt: at(2, 7) });
    const evening = worked("2026-10-02", { exercises: 1, minutes: 10, feelAfter: 8, startedAt: at(2, 19) });
    expect(workoutToday([morning]).lines).toEqual(["Worked out · 3 exercises · 25 min", "Felt 4 before, 7 after"]);
    // The latest session speaks for the day, whatever order they come in.
    expect(workoutToday([evening, morning]).lines).toEqual(["Worked out · 4 exercises · 35 min", "Felt 8 after"]);
    expect(workoutToday([worked("2026-10-02", { exercises: 1, feelBefore: 5 })]).lines).toEqual([
      "Worked out · 1 exercise · 20 min",
      "Felt 5 before",
    ]);
    expect(workoutToday([worked("2026-10-02")]).lines).toHaveLength(1);
  });
});
