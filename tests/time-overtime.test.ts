import { describe, expect, it } from "vitest";
import { addDays } from "../src/lib/timezone";
import {
  evaluateWeek,
  hasPremium,
  minutesUntilWeeklyOvertime,
  type DayWorked,
} from "../src/modules/time/core/overtime";
import {
  CALIFORNIA,
  FEDERAL,
  NONE,
  RULESETS,
  isRulesetSlug,
  rulesetFor,
} from "../src/modules/time/core/rulesets";
import {
  PAY_FREQUENCIES,
  adjacentPayPeriod,
  isPayFrequency,
  payFrequencyLabel,
  payPeriodFor,
  periodLabel,
  workweeksPaidIn,
} from "../src/modules/time/core/periods";

/**
 * The overtime evaluator and the pay-period arithmetic.
 *
 * THIS FILE IS THE POINT OF SLICE 2. Everything here is somebody's paycheck,
 * it is all pure, and every case below is a rule that exists in the world
 * rather than a restatement of what the code happens to do. Where a case is
 * the classic error in this domain, the comment says which error.
 *
 * 2026-09-06 is a Sunday, which is what every week here starts on.
 */

const SUN = "2026-09-06";
const H = (h: number) => h * 60;

/** Seven days from `start`, in order, from a list of minutes. */
function week(start: string, minutes: number[]): DayWorked[] {
  return Array.from({ length: 7 }, (_, i) => ({
    date: addDays(start, i),
    workedMinutes: minutes[i] ?? 0,
  }));
}

/** Five eight-hour days, Monday to Friday, on a Sunday-start week. */
const NINE_TO_FIVE = [0, H(8), H(8), H(8), H(8), H(8), 0];

describe("federal: over 40 in a workweek", () => {
  it("under 40 is all regular", () => {
    const r = evaluateWeek(week(SUN, [0, H(7), H(7), H(7), H(7), H(7), 0]), FEDERAL);
    expect(r.workedMinutes).toBe(H(35));
    expect(r.regularMinutes).toBe(H(35));
    expect(r.overtimeMinutes).toBe(0);
    expect(hasPremium(r)).toBe(false);
  });

  it("exactly 40 is all regular — the threshold is 'over'", () => {
    const r = evaluateWeek(week(SUN, NINE_TO_FIVE), FEDERAL);
    expect(r.regularMinutes).toBe(H(40));
    expect(r.overtimeMinutes).toBe(0);
  });

  it("over 40 pays the excess as overtime", () => {
    const r = evaluateWeek(week(SUN, [0, H(9), H(9), H(9), H(9), H(9), 0]), FEDERAL);
    expect(r.workedMinutes).toBe(H(45));
    expect(r.regularMinutes).toBe(H(40));
    expect(r.overtimeMinutes).toBe(H(5));
    expect(r.weeklyOvertimeMinutes).toBe(H(5));
    expect(r.doubleTimeMinutes).toBe(0);
  });

  it("a single long day is not daily overtime under federal rules", () => {
    // Sixteen hours on one day and nothing else. Federal has no daily rule, so
    // this is 16 regular hours — which surprises people, and is correct.
    const r = evaluateWeek(week(SUN, [0, H(16), 0, 0, 0, 0, 0]), FEDERAL);
    expect(r.regularMinutes).toBe(H(16));
    expect(r.overtimeMinutes).toBe(0);
  });

  it("BIWEEKLY IS TWO WORKWEEKS, and averaging them is the classic error", () => {
    // 30 hours then 50 hours. Averaged over a fortnight that is 40 a week and
    // no overtime at all; evaluated per workweek, as the law requires, it is
    // ten hours. This is the single most common payroll violation there is.
    const first = evaluateWeek(week(SUN, [0, H(6), H(6), H(6), H(6), H(6), 0]), FEDERAL);
    const second = evaluateWeek(
      week(addDays(SUN, 7), [0, H(10), H(10), H(10), H(10), H(10), 0]),
      FEDERAL,
    );
    expect(first.overtimeMinutes).toBe(0);
    expect(second.overtimeMinutes).toBe(H(10));
    expect(first.overtimeMinutes + second.overtimeMinutes).toBe(H(10));

    const averaged = evaluateWeek(week(SUN, [0, H(8), H(8), H(8), H(8), H(8), 0]), FEDERAL);
    expect(averaged.overtimeMinutes).toBe(0); // what the wrong answer looks like
  });

  it("only minutes WORKED are ever passed in", () => {
    // The caller strips paid leave and holiday with `countsAsWorked` before
    // calling. Proved here from the other side: a week of four worked days and
    // one day of leave is 32 worked hours, so no overtime — where counting the
    // leave day would have found 40 and, at 41 paid hours, invented overtime
    // nobody earned.
    const worked = evaluateWeek(week(SUN, [0, H(8), H(8), H(8), H(8), 0, 0]), FEDERAL);
    expect(worked.workedMinutes).toBe(H(32));
    expect(worked.overtimeMinutes).toBe(0);
  });
});

describe("california: daily, weekly, and the seventh day", () => {
  it("over 8 in a day is overtime even in a short week", () => {
    const r = evaluateWeek(week(SUN, [0, H(10), 0, 0, 0, 0, 0]), CALIFORNIA);
    expect(r.regularMinutes).toBe(H(8));
    expect(r.overtimeMinutes).toBe(H(2));
    expect(r.doubleTimeMinutes).toBe(0);
  });

  it("over 12 in a day is double time, and the middle four are overtime", () => {
    const r = evaluateWeek(week(SUN, [0, H(13), 0, 0, 0, 0, 0]), CALIFORNIA);
    expect(r.regularMinutes).toBe(H(8));
    expect(r.overtimeMinutes).toBe(H(4));
    expect(r.doubleTimeMinutes).toBe(H(1));
    expect(r.workedMinutes).toBe(H(13));
  });

  it("NO PYRAMIDING: five ten-hour days are 40 regular and 10 overtime", () => {
    // Fifty hours worked. Ten of them are already daily overtime, so only the
    // forty straight-time hours face the weekly test — and forty is not over
    // forty. Counting the whole fifty against the weekly threshold would pay
    // ten hours of overtime twice.
    const r = evaluateWeek(week(SUN, [0, H(10), H(10), H(10), H(10), H(10), 0]), CALIFORNIA);
    expect(r.workedMinutes).toBe(H(50));
    expect(r.regularMinutes).toBe(H(40));
    expect(r.overtimeMinutes).toBe(H(10));
    expect(r.weeklyOvertimeMinutes).toBe(0); // all of it came from the daily rule
    expect(r.doubleTimeMinutes).toBe(0);
  });

  it("six eight-hour days are 40 regular and 8 weekly overtime", () => {
    const r = evaluateWeek(week(SUN, [H(8), H(8), H(8), H(8), H(8), H(8), 0]), CALIFORNIA);
    expect(r.regularMinutes).toBe(H(40));
    expect(r.overtimeMinutes).toBe(H(8));
    expect(r.weeklyOvertimeMinutes).toBe(H(8));
  });

  it("the SEVENTH consecutive day pays overtime from the first hour", () => {
    // Seven eight-hour days. Days one to six give 48 hours of straight time, of
    // which 40 are regular and 8 are weekly overtime. The seventh day is priced
    // entirely by its own rule: eight hours at time and a half.
    const r = evaluateWeek(week(SUN, [H(8), H(8), H(8), H(8), H(8), H(8), H(8)]), CALIFORNIA);
    expect(r.workedMinutes).toBe(H(56));
    expect(r.regularMinutes).toBe(H(40));
    expect(r.overtimeMinutes).toBe(H(16));
    expect(r.doubleTimeMinutes).toBe(0);
    expect(r.days[6].seventhDay).toBe(true);
    expect(r.days[6].straightMinutes).toBe(0);
  });

  it("the seventh day past eight hours is double time", () => {
    const r = evaluateWeek(week(SUN, [H(8), H(8), H(8), H(8), H(8), H(8), H(10)]), CALIFORNIA);
    expect(r.doubleTimeMinutes).toBe(H(2));
    expect(r.days[6].dailyOvertimeMinutes).toBe(H(8));
  });

  it("six days worked and one off is NOT a seventh day", () => {
    // The rule turns on only when every day of the workweek was worked. A week
    // with a day off can never reach it however many hours are in it.
    const r = evaluateWeek(week(SUN, [H(8), H(8), H(8), H(8), H(8), H(8), 0]), CALIFORNIA);
    expect(r.days.some((d) => d.seventhDay)).toBe(false);
  });

  it("a caller that dropped the empty days would turn the rule off", () => {
    // Why `evaluateWeek` asks for all seven days including the blank ones: six
    // worked days handed over as six entries look exactly like a full week.
    const sixDays = week(SUN, [H(8), H(8), H(8), H(8), H(8), H(8), 0]).filter(
      (d) => d.workedMinutes > 0,
    );
    expect(sixDays).toHaveLength(6);
    expect(evaluateWeek(sixDays, CALIFORNIA).days.some((d) => d.seventhDay)).toBe(false);
  });
});

describe("none: hours are recorded and never priced", () => {
  it("leaves even a seventy-hour week entirely regular", () => {
    const r = evaluateWeek(week(SUN, [H(10), H(10), H(10), H(10), H(10), H(10), H(10)]), NONE);
    expect(r.workedMinutes).toBe(H(70));
    expect(r.regularMinutes).toBe(H(70));
    expect(r.overtimeMinutes).toBe(0);
    expect(r.doubleTimeMinutes).toBe(0);
    expect(hasPremium(r)).toBe(false);
  });
});

describe("every ruleset, every week", () => {
  it("never loses or invents a minute", () => {
    // The invariant that matters most and is easiest to break while editing:
    // the three buckets always add back up to what was worked.
    const shapes = [
      [0, 0, 0, 0, 0, 0, 0],
      [H(8), 0, 0, 0, 0, 0, 0],
      [0, H(13), H(2), 0, H(9), 0, 0],
      [H(8), H(8), H(8), H(8), H(8), H(8), H(8)],
      [H(12), H(12), H(12), H(12), H(12), H(12), H(12)],
      [37, 421, 1, 0, 0, 1439, 60],
    ];
    for (const ruleset of RULESETS) {
      for (const shape of shapes) {
        const r = evaluateWeek(week(SUN, shape), ruleset);
        expect(
          r.regularMinutes + r.overtimeMinutes + r.doubleTimeMinutes,
          `${ruleset.slug} / ${shape.join(",")}`,
        ).toBe(r.workedMinutes);
        expect(r.regularMinutes).toBeGreaterThanOrEqual(0);
        expect(r.overtimeMinutes).toBeGreaterThanOrEqual(0);
        expect(r.doubleTimeMinutes).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is registered, labelled and looked up by slug", () => {
    for (const r of RULESETS) {
      expect(isRulesetSlug(r.slug)).toBe(true);
      expect(rulesetFor(r.slug)).toBe(r);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.summary.length).toBeGreaterThan(0);
    }
    expect(isRulesetSlug("massachusetts")).toBe(false);
    // Falls back rather than throwing: a row naming a ruleset this build does
    // not carry is a deploy that went backwards, and the federal floor is a
    // better answer than a page that will not render.
    expect(rulesetFor("massachusetts")).toBe(FEDERAL);
  });
});

describe("minutesUntilWeeklyOvertime", () => {
  it("counts down toward the threshold", () => {
    const r = evaluateWeek(week(SUN, [0, H(8), H(8), H(8), 0, 0, 0]), FEDERAL);
    expect(minutesUntilWeeklyOvertime(r, FEDERAL)).toBe(H(16));
  });

  it("is null once the threshold is reached or passed", () => {
    const at = evaluateWeek(week(SUN, NINE_TO_FIVE), FEDERAL);
    expect(minutesUntilWeeklyOvertime(at, FEDERAL)).toBeNull();
    const over = evaluateWeek(week(SUN, [0, H(9), H(9), H(9), H(9), H(9), 0]), FEDERAL);
    expect(minutesUntilWeeklyOvertime(over, FEDERAL)).toBeNull();
  });

  it("is null when the ruleset has no weekly threshold", () => {
    const r = evaluateWeek(week(SUN, NINE_TO_FIVE), NONE);
    expect(minutesUntilWeeklyOvertime(r, NONE)).toBeNull();
  });

  it("counts straight time, not hours worked", () => {
    // A Californian who has done three ten-hour days has 30 hours worked but
    // only 24 of straight time, because six are already daily overtime. Sixteen
    // hours remain before the weekly threshold, not ten.
    const r = evaluateWeek(week(SUN, [0, H(10), H(10), H(10), 0, 0, 0]), CALIFORNIA);
    expect(r.workedMinutes).toBe(H(30));
    expect(minutesUntilWeeklyOvertime(r, CALIFORNIA)).toBe(H(16));
  });
});

describe("pay periods", () => {
  const weekly = { frequency: "weekly" as const, weekStartsOn: 0, anchor: null };
  const biweekly = {
    frequency: "biweekly" as const,
    weekStartsOn: 0,
    anchor: "2026-09-06",
  };

  it("weekly is the workweek, and the only frequency where they agree", () => {
    expect(payPeriodFor("2026-09-09", weekly)).toEqual({
      start: "2026-09-06",
      end: "2026-09-12",
    });
  });

  it("weekly follows the week start rather than the calendar", () => {
    const monday = { ...weekly, weekStartsOn: 1 };
    expect(payPeriodFor("2026-09-09", monday)).toEqual({
      start: "2026-09-07",
      end: "2026-09-13",
    });
  });

  it("biweekly is fourteen days from the anchor, forwards and back", () => {
    expect(payPeriodFor("2026-09-06", biweekly)).toEqual({
      start: "2026-09-06",
      end: "2026-09-19",
    });
    expect(payPeriodFor("2026-09-19", biweekly)).toEqual({
      start: "2026-09-06",
      end: "2026-09-19",
    });
    expect(payPeriodFor("2026-09-20", biweekly)).toEqual({
      start: "2026-09-20",
      end: "2026-10-03",
    });
    // Before the anchor, which a business reading last quarter will do.
    expect(payPeriodFor("2026-09-05", biweekly)).toEqual({
      start: "2026-08-23",
      end: "2026-09-05",
    });
    expect(payPeriodFor("2026-08-23", biweekly)).toEqual({
      start: "2026-08-23",
      end: "2026-09-05",
    });
  });

  it("a biweekly anchor typed mid-week is pulled back to the week start", () => {
    // Otherwise a period would cut a workweek in half and the overtime inside
    // it could never be paid whole.
    const midweek = { ...biweekly, anchor: "2026-09-09" };
    expect(payPeriodFor("2026-09-09", midweek)).toEqual({
      start: "2026-09-06",
      end: "2026-09-19",
    });
  });

  it("semi-monthly splits at the 15th, whatever the month is worth", () => {
    const s = { frequency: "semimonthly" as const, weekStartsOn: 0, anchor: null };
    expect(payPeriodFor("2026-09-15", s)).toEqual({ start: "2026-09-01", end: "2026-09-15" });
    expect(payPeriodFor("2026-09-16", s)).toEqual({ start: "2026-09-16", end: "2026-09-30" });
    expect(payPeriodFor("2026-02-20", s)).toEqual({ start: "2026-02-16", end: "2026-02-28" });
    expect(payPeriodFor("2024-02-20", s)).toEqual({ start: "2024-02-16", end: "2024-02-29" });
    expect(payPeriodFor("2026-12-31", s)).toEqual({ start: "2026-12-16", end: "2026-12-31" });
  });

  it("monthly is the calendar month, leap year included", () => {
    const m = { frequency: "monthly" as const, weekStartsOn: 0, anchor: null };
    expect(payPeriodFor("2026-02-10", m)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(payPeriodFor("2024-02-10", m)).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(payPeriodFor("2026-12-01", m)).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("steps to the period either side, across a year end", () => {
    const m = { frequency: "monthly" as const, weekStartsOn: 0, anchor: null };
    const dec = payPeriodFor("2026-12-10", m);
    expect(adjacentPayPeriod(dec, 1, m)).toEqual({ start: "2027-01-01", end: "2027-01-31" });
    expect(adjacentPayPeriod(dec, -1, m)).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    const b = payPeriodFor("2026-09-06", biweekly);
    expect(adjacentPayPeriod(b, 1, biweekly)).toEqual({
      start: "2026-09-20",
      end: "2026-10-03",
    });
  });

  it("every frequency is labelled and validates", () => {
    for (const f of PAY_FREQUENCIES) {
      expect(isPayFrequency(f)).toBe(true);
      expect(payFrequencyLabel(f)).not.toBe(f);
    }
    expect(isPayFrequency("fortnightly")).toBe(false);
  });

  it("labels a period for a heading", () => {
    expect(periodLabel({ start: "2026-09-06", end: "2026-09-19" })).toBe(
      "Sep 6 – Sep 19, 2026",
    );
  });
});

describe("workweeksPaidIn — the straddle rule", () => {
  it("a weekly period pays exactly its own week", () => {
    expect(workweeksPaidIn({ start: "2026-09-06", end: "2026-09-12" }, 0)).toEqual([
      { start: "2026-09-06", end: "2026-09-12" },
    ]);
  });

  it("a biweekly period pays exactly two whole workweeks", () => {
    // The property the whole design turns on: each of these is evaluated for
    // overtime on its own.
    expect(workweeksPaidIn({ start: "2026-09-06", end: "2026-09-19" }, 0)).toEqual([
      { start: "2026-09-06", end: "2026-09-12" },
      { start: "2026-09-13", end: "2026-09-19" },
    ]);
  });

  it("a month pays the weeks that END in it, not the ones that start in it", () => {
    // September 2026 starts on a Tuesday. The week of Aug 30 – Sep 5 ENDS in
    // September, so September pays it; the week of Sep 27 – Oct 3 ends in
    // October and is October's. One rule, and no week is ever split.
    const weeks = workweeksPaidIn({ start: "2026-09-01", end: "2026-09-30" }, 0);
    expect(weeks[0]).toEqual({ start: "2026-08-30", end: "2026-09-05" });
    expect(weeks[weeks.length - 1]).toEqual({ start: "2026-09-20", end: "2026-09-26" });
    expect(weeks).toHaveLength(4);
  });

  it("consecutive periods never pay the same week twice, and never skip one", () => {
    // Walk a year of semi-monthly periods and check the weeks tile exactly.
    const s = { frequency: "semimonthly" as const, weekStartsOn: 0, anchor: null };
    let period = payPeriodFor("2026-01-10", s);
    const seen: string[] = [];
    for (let i = 0; i < 24; i++) {
      for (const w of workweeksPaidIn(period, 0)) seen.push(w.end);
      period = adjacentPayPeriod(period, 1, s);
    }
    expect(new Set(seen).size).toBe(seen.length); // no week paid twice
    for (let i = 1; i < seen.length; i++) {
      // Consecutive week ends are exactly seven days apart: nothing skipped.
      expect(addDays(seen[i - 1], 7)).toBe(seen[i]);
    }
  });
});
