import { describe, expect, it } from "vitest";
import {
  AT_GOAL_KG,
  bodyRows,
  chartScale,
  goalLine,
  goalTitle,
  goalWords,
  inchesChange,
  inchesWords,
  kgFromPounds,
  cmFromInches,
  measureSpan,
  measurementsInputSchema,
  paceWords,
  poundsChange,
  poundsFromKg,
  poundsWords,
  readGoal,
  trendOn,
  typedInches,
  typedPounds,
  weekChange,
  weeklyPace,
  weighinInputSchema,
  weightBetter,
  weightGoalSchema,
  weightTrend,
  type Weighin,
} from "../src/modules/health/core/body";
import { askedDay, dayPhrase, dayRefused, daysFrom, dayWords, FILL_BACK_DAYS, inReach, shortDay } from "../src/modules/health/core/days";
import { barHeights, progressWindows, readRow, shiftDay, valueWords } from "../src/modules/health/core/progress";

/**
 * The body, pure (docs/modules/health.md, H2): pounds and inches both ways,
 * what is typed in, the trend through the weigh-ins, the pace and the goal,
 * the rows on Progress, the chart's scale, and the days that can be filled in.
 * Every date is fixed.
 */

const TODAY = "2026-10-03";
const lb = (pounds: number) => kgFromPounds(pounds);
const daily = (from: string, pounds: number[]): Weighin[] => pounds.map((p, i) => ({ day: shiftDay(from, i), kg: lb(p) }));

describe("pounds and inches", () => {
  it("turn both ways without losing what was typed", () => {
    expect(poundsWords(lb(184.6))).toBe("184.6 lb");
    expect(poundsWords(lb(185))).toBe("185.0 lb");
    expect(poundsFromKg(lb(184.6))).toBeCloseTo(184.6, 10);
    expect(inchesWords(cmFromInches(36.25))).toBe("36.25 in");
    expect(inchesWords(cmFromInches(36.5))).toBe("36.5 in");
    expect(inchesWords(cmFromInches(36))).toBe("36 in");
    expect(goalWords(lb(175))).toBe("175 lb");
    expect(goalWords(lb(172.5))).toBe("172.5 lb");
  });

  it("say a change plainly, and nothing for a change too small to see", () => {
    expect(poundsChange(lb(-0.6))).toBe("down 0.6 lb");
    expect(poundsChange(lb(1.24))).toBe("up 1.2 lb");
    expect(poundsChange(lb(0.02))).toBe("no change");
    expect(inchesChange(cmFromInches(-0.5))).toBe("down 0.5 in");
    expect(inchesChange(cmFromInches(0.25))).toBe("up 0.25 in");
    expect(paceWords(lb(1))).toBe("1 lb a week");
    expect(paceWords(lb(-0.25))).toBe("0.25 lb a week");
  });

  it("read a weight typed in, to a tenth, and refuse what is not one", () => {
    expect(typedPounds("184.6")).toBe(184.6);
    expect(typedPounds(" 184,64 ")).toBe(184.6);
    expect(typedPounds("50")).toBe(50);
    expect(typedPounds("700")).toBe(700);
    for (const wrong of ["", "49.9", "700.1", "abc", "1e3", "184.6.1", "-180"]) expect(typedPounds(wrong)).toBeNull();
  });

  it("read a tape measure as a decimal or as a tape reads it", () => {
    expect(typedInches("36.25")).toBe(36.25);
    expect(typedInches("36 1/4")).toBe(36.25);
    expect(typedInches("36 3/8")).toBe(36.38);
    expect(typedInches("1")).toBe(1);
    for (const wrong of ["", "0.5", "151", "36 4/4", "36 1/0", "1/4", "abc"]) expect(typedInches(wrong)).toBeNull();
  });
});

describe("what the actions take", () => {
  it("a weigh-in is today's unless the page says otherwise, and a goal's pace is one on offer", () => {
    expect(weighinInputSchema.parse({ day: TODAY, pounds: 184.6 })).toEqual({ day: TODAY, pounds: 184.6, asToday: true });
    expect(weighinInputSchema.safeParse({ day: TODAY, pounds: 40 }).success).toBe(false);
    expect(weightGoalSchema.safeParse({ goalPounds: 175, pacePounds: 1 }).success).toBe(true);
    expect(weightGoalSchema.safeParse({ goalPounds: 175, pacePounds: 0.3 }).success).toBe(false);
    const id = "00000000-0000-4000-8000-000000000001";
    expect(measurementsInputSchema.safeParse({ day: TODAY, values: [{ measureId: id, inches: null }] }).success).toBe(true);
    expect(measurementsInputSchema.safeParse({ day: TODAY, values: [] }).success).toBe(false);
    expect(measurementsInputSchema.safeParse({ day: TODAY, values: [{ measureId: id, inches: 200 }] }).success).toBe(false);
  });
});

describe("the trend", () => {
  it("starts at the first weigh-in and moves a tenth of the way towards each one a day later", () => {
    const points = weightTrend(daily("2026-10-01", [180, 181]));
    expect(points.map((p) => poundsFromKg(p.trend))).toEqual([expect.closeTo(180, 9), expect.closeTo(180.1, 9)]);
  });

  it("moves further after a gap, about half the way after a week", () => {
    const points = weightTrend([
      { day: "2026-09-01", kg: lb(180) },
      { day: "2026-09-08", kg: lb(190) },
    ]);
    expect(poundsFromKg(points[1].trend)).toBeCloseTo(180 + 10 * (1 - 0.9 ** 7), 9);
  });

  it("sorts what it is given, and reads the trend as of a day", () => {
    const points = weightTrend([
      { day: "2026-10-02", kg: lb(182) },
      { day: "2026-09-30", kg: lb(180) },
    ]);
    expect(points.map((p) => p.day)).toEqual(["2026-09-30", "2026-10-02"]);
    expect(trendOn(points, "2026-09-29")).toBeNull();
    expect(poundsFromKg(trendOn(points, "2026-10-01")!)).toBeCloseTo(180, 9);
    expect(poundsFromKg(trendOn(points, TODAY)!)).toBeCloseTo(180 + 2 * (1 - 0.9 ** 2), 9);
  });

  it("says how it moved this week only with a weigh-in a week or more before", () => {
    expect(weekChange(weightTrend(daily("2026-09-28", [180, 180, 180, 180, 180, 180])), TODAY)).toBeNull();
    const points = weightTrend(daily("2026-09-26", [182, 182, 181, 181, 180, 180, 180, 179]));
    const change = weekChange(points, TODAY)!;
    expect(change).toBeCloseTo(trendOn(points, TODAY)! - trendOn(points, "2026-09-26")!, 12);
    expect(change).toBeLessThan(0);
  });
});

describe("the pace and the goal", () => {
  it("reads the pace from the last four weeks once there are enough weigh-ins, far enough apart", () => {
    // A straight line down a tenth of a pound a day, 28 days ending today: 0.7 lb a week.
    const steady = daily(shiftDay(TODAY, -27), Array.from({ length: 28 }, (_, i) => 190 - 0.1 * i));
    expect(poundsFromKg(weeklyPace(steady, TODAY)!)).toBeCloseTo(-0.7, 9);
    // Older weigh-ins, and any after the day, are not in it.
    const noisy = [{ day: "2026-08-01", kg: lb(250) }, ...steady, { day: "2026-10-04", kg: lb(100) }];
    expect(poundsFromKg(weeklyPace(noisy, TODAY)!)).toBeCloseTo(-0.7, 9);
    expect(weeklyPace(steady.slice(-3), TODAY)).toBeNull();
    expect(weeklyPace(steady.slice(-8), TODAY)).toBeNull();
    expect(weeklyPace(steady.slice(-11), TODAY)).not.toBeNull();
  });

  it("says where the goal is and when it is reached at the pace", () => {
    const goal = { goalKg: lb(175), paceKg: lb(1) };
    expect(readGoal(goal, null, null, TODAY)).toEqual({ aim: null, toGoKg: null, heading: null, reachedOn: null, far: false });
    expect(readGoal(goal, lb(175.4), lb(-1), TODAY).aim).toBe("there");
    expect(readGoal(goal, lb(185), null, TODAY)).toMatchObject({ aim: "lose", heading: null, reachedOn: null });
    expect(readGoal(goal, lb(185), lb(-0.05), TODAY).heading).toBe("level");
    expect(readGoal(goal, lb(185), lb(0.3), TODAY).heading).toBe("away");
    const towards = readGoal(goal, lb(185), lb(-1), TODAY);
    expect(towards).toMatchObject({ aim: "lose", heading: "towards", reachedOn: shiftDay(TODAY, 70), far: false });
    expect(poundsFromKg(towards.toGoKg!)).toBeCloseTo(10, 9);
    expect(readGoal(goal, lb(205), lb(-0.11), TODAY)).toMatchObject({ heading: "towards", reachedOn: null, far: true });
    expect(readGoal({ goalKg: lb(190), paceKg: lb(0.5) }, lb(180), lb(0.5), TODAY)).toMatchObject({
      aim: "gain",
      reachedOn: shiftDay(TODAY, 140),
    });
    expect(AT_GOAL_KG).toBeCloseTo(lb(0.5), 12);
  });

  it("puts the goal in words, and colours Progress towards it", () => {
    const goal = { goalKg: lb(175), paceKg: lb(1) };
    expect(goalTitle(goal, "lose")).toBe("Lose to 175 lb, about 1 lb a week");
    expect(goalTitle({ goalKg: lb(190), paceKg: lb(0.5) }, "gain")).toBe("Gain to 190 lb, about 0.5 lb a week");
    expect(goalTitle(goal, null)).toBe("Reach 175 lb, about 1 lb a week");
    expect(goalTitle(goal, "there")).toBe("Your goal: 175 lb");

    const at = (trend: number | null, pace: number | null) =>
      goalLine(goal, readGoal(goal, trend === null ? null : lb(trend), pace === null ? null : lb(pace), TODAY), pace === null ? null : lb(pace), TODAY);
    expect(at(null, null)).toBe("Weigh in to see how far you have to go.");
    expect(at(175.2, -1)).toBe("Your trend is within half a pound of it.");
    expect(at(185, null)).toBe("10.0 lb to go. Two weeks of weigh-ins give a pace and a date.");
    expect(at(185, -0.05)).toBe("10.0 lb to go. Your recent pace is about level, so there is no date yet.");
    expect(at(185, 0.3)).toBe("10.0 lb to go. Your recent pace is up 0.3 lb a week, away from 175 lb.");
    expect(at(185, -0.9)).toBe("10.0 lb to go. At your recent pace (0.9 lb a week), 175 lb around Dec 20.");
    expect(at(205, -0.11)).toBe("30.0 lb to go. At your recent pace (0.1 lb a week), more than three years off.");

    expect(weightBetter(null)).toBeNull();
    expect(weightBetter(readGoal(goal, lb(185), null, TODAY))).toBe("down");
    expect(weightBetter(readGoal({ goalKg: lb(190), paceKg: lb(1) }, lb(180), null, TODAY))).toBe("up");
    expect(weightBetter(readGoal(goal, lb(175), null, TODAY))).toBeNull();
  });
});

describe("the body on Progress", () => {
  const windows = progressWindows(TODAY);
  const waist = { id: "w", name: "Waist", better: "smaller" as const };
  const arm = { id: "a", name: "Arm", better: null };

  it("reads the weight as the trend at each week's last weigh-in, warmed up by the weeks before", () => {
    const weighins = [
      { day: "2026-08-20", kg: lb(190) },
      { day: windows[1].from, kg: lb(186) },
      { day: windows[3].to, kg: lb(184) },
    ];
    const [weight] = bodyRows(windows, weighins, { goalKg: lb(175), paceKg: lb(1) }, [], []);
    const points = weightTrend(weighins);
    expect(weight).toMatchObject({ key: "health.weight", name: "Weight", format: "measure", unit: "lb", better: "down" });
    expect(weight.values[0]).toBeNull();
    expect(weight.values[1]).toBeCloseTo(poundsFromKg(points[1].trend), 9);
    expect(weight.values[2]).toBeNull();
    expect(weight.values[3]).toBeCloseTo(poundsFromKg(points[2].trend), 9);
    // No goal, no better way.
    expect(bodyRows(windows, weighins, null, [], [])[0].better).toBeNull();
  });

  it("reads each tape measure as the week's mean, in inches, the better way the person's", () => {
    const rows = bodyRows(windows, [], null, [waist, arm], [
      { measureId: "w", day: windows[0].from, cm: cmFromInches(37) },
      { measureId: "w", day: windows[3].from, cm: cmFromInches(36) },
      { measureId: "w", day: windows[3].to, cm: cmFromInches(36.5) },
      { measureId: "a", day: windows[2].to, cm: cmFromInches(14) },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["health.weight", "health.measure.w", "health.measure.a"]);
    expect(rows[1]).toMatchObject({ name: "Waist", format: "measure", unit: "in", better: "down" });
    expect(rows[1].values.map((v) => (v === null ? null : Math.round(v * 100) / 100))).toEqual([37, null, null, 36.25]);
    expect(rows[2]).toMatchObject({ better: null });
    expect(rows[2].values.map((v) => (v === null ? null : Math.round(v * 100) / 100))).toEqual([null, null, 14, null]);
  });

  it("draws a level's bars across its range, at least five pounds or two inches of it, and reads it as the tape does", () => {
    expect(barHeights([186, 185, null, 184], "measure")).toEqual([1, expect.closeTo(0.6, 12), null, 0.2]);
    expect(barHeights([180, 180], "measure")).toEqual([1, 1]);
    expect(barHeights([2, 4])).toEqual([0.5, 1]);
    // A pound in a week is a fifth of the bar's height, not all of it (the drive, 2026-10-03).
    expect(barHeights([186.9, 186], "measure", "lb")).toEqual([1, expect.closeTo(1 - (0.8 * 0.9) / 5, 12)]);
    expect(barHeights([180, 170], "measure", "lb")).toEqual([1, 0.2]);
    expect(barHeights([37, 36.5], "measure", "in")).toEqual([1, expect.closeTo(0.8, 12)]);
    expect(valueWords(184.64, "measure", "lb")).toBe("184.6 lb");
    expect(valueWords(185, "measure", "lb")).toBe("185.0 lb");
    expect(valueWords(36, "measure", "in")).toBe("36 in");
    expect(valueWords(36.25, "measure", "in")).toBe("36.25 in");

    const row = (values: (number | null)[], unit: string) =>
      readRow({ key: "k", name: "Weight", values, format: "measure", unit, better: "down" });
    expect(row([186, 185.8, 185.6, 184], "lb")).toMatchObject({
      latest: "184.0 lb",
      change: "down 1.8 lb on the weeks before",
      moved: "down",
      direction: "better",
    });
    expect(row([185, 185, 185, 184.8], "lb").change).toBe("about the same as the weeks before");
    expect(row([36.5, null, null, 36.2], "in").change).toBe("down 0.3 in on the weeks before");
    expect(row([36.5, null, null, 36.4], "in").change).toBe("about the same as the weeks before");
  });

  it("finds a measure's first and latest", () => {
    expect(measureSpan([])).toBeNull();
    const span = measureSpan([
      { measureId: "w", day: "2026-09-21", cm: 92 },
      { measureId: "w", day: "2026-09-07", cm: 93 },
      { measureId: "w", day: "2026-09-28", cm: 91 },
    ])!;
    expect([span.first.day, span.latest.day]).toEqual(["2026-09-07", "2026-09-28"]);
  });
});

describe("the chart's scale", () => {
  it("leaves a little room, steps at round numbers, and takes the goal only when it is near", () => {
    expect(chartScale([], null)).toBeNull();
    const scale = chartScale([184.2, 186.4, 188.6], null)!;
    // A tenth of the span, but never under half a pound.
    expect(scale.low).toBeCloseTo(183.7, 9);
    expect(scale.high).toBeCloseTo(189.1, 9);
    expect(scale.ticks).toEqual([184, 186, 188]);
    const near = chartScale([184.2, 188.6], 180)!;
    expect(near.low).toBeLessThan(180);
    const far = chartScale([184.2, 188.6], 150)!;
    expect(far.low).toBeGreaterThan(183);
    expect(chartScale([180, 180], null)!.ticks).toEqual([180]);
  });
});

describe("the days that can be filled in", () => {
  it("are today and the two weeks before it", () => {
    expect(FILL_BACK_DAYS).toBe(14);
    expect(inReach(TODAY, TODAY)).toBe(true);
    expect(inReach(shiftDay(TODAY, -14), TODAY)).toBe(true);
    expect(inReach(shiftDay(TODAY, -15), TODAY)).toBe(false);
    expect(inReach(shiftDay(TODAY, 1), TODAY)).toBe(false);
    expect(inReach("2026-10-3", TODAY)).toBe(false);
    expect(askedDay("2026-09-30", TODAY)).toBe("2026-09-30");
    expect(askedDay("2026-01-01", TODAY)).toBe(TODAY);
    expect(askedDay(null, TODAY)).toBe(TODAY);
  });

  it("refuse a page that fell behind the day, then a day out of reach", () => {
    expect(dayRefused(TODAY, TODAY, true)).toBeNull();
    expect(dayRefused("2026-10-02", TODAY, true)).toBe("NEW_DAY");
    expect(dayRefused("2026-10-02", TODAY, false)).toBeNull();
    expect(dayRefused(shiftDay(TODAY, -15), TODAY, false)).toBe("DAY");
    expect(dayRefused(shiftDay(TODAY, 1), TODAY, false)).toBe("DAY");
  });

  it("are put in words", () => {
    expect(dayWords(TODAY, TODAY)).toBe("Today");
    expect(dayWords("2026-10-02", TODAY)).toBe("Yesterday");
    expect(dayWords("2026-10-01", TODAY)).toBe("Thursday, Oct 1");
    expect(dayPhrase("2026-10-02", TODAY)).toBe("yesterday");
    expect(dayPhrase("2026-10-01", TODAY)).toBe("on Thursday, Oct 1");
    expect(shortDay("2026-09-07", TODAY)).toBe("Sep 7");
    expect(shortDay("2025-12-30", TODAY)).toBe("Dec 30, 2025");
    expect(daysFrom("2026-09-30", TODAY)).toBe(3);
    expect(daysFrom(TODAY, "2026-09-30")).toBe(-3);
  });
});
