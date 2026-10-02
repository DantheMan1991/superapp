import { describe, expect, it } from "vitest";
import {
  addMinute,
  clampStep,
  cookSessionSchema,
  freshSession,
  isRinging,
  isStale,
  loggedWords,
  madeWords,
  realSteps,
  startTimer,
  stopTimer,
  toggleTick,
} from "../src/modules/food/core/cook";
import { clockFace, durationWords, findTimes, rangeWords, stepPieces } from "../src/modules/food/core/times";
import { foodWords, stepUses } from "../src/modules/food/core/uses";

/**
 * FOOD D1b, cook mode (docs/modules/food.md): the times found in a step, what
 * a step uses, and the session kept on the phone. Invented recipes only.
 */

const ID = "11111111-1111-4111-8111-111111111111";

describe("the times in a step", () => {
  it.each([
    ["Bake 25 minutes, until golden.", [[1500, null]]],
    ["Bake 25 to 30 minutes.", [[1500, 1800]]],
    ["Bake 25-30 min.", [[1500, 1800]]],
    ["Bake 25–30 mins", [[1500, 1800]]],
    ["Simmer for 1 hour 15 minutes.", [[4500, null]]],
    ["Simmer 1 hr 20 min, stirring.", [[4800, null]]],
    ["Braise 1½ hours.", [[5400, null]]],
    ["Braise 1 1/2 hours.", [[5400, null]]],
    ["Rest 30 seconds.", [[30, null]]],
    ["Cook 1 to 2 hours.", [[3600, 7200]]],
    ["Proof for 2h.", [[7200, null]]],
    ["Chill half an hour, then roll out.", [[1800, null]]],
    ["Let it sit an hour.", [[3600, null]]],
    ["Whisk for a minute.", [[60, null]]],
    ["Bake 10 minutes, turn, then bake 5 minutes more.", [[600, null], [300, null]]],
  ] as const)("%s", (step, expected) => {
    expect(findTimes(step).map((t) => [t.lo, t.hi])).toEqual(expected);
  });

  it("finds no timer in temperatures, sizes or vague times", () => {
    for (const step of ["Heat the oven to 400°F.", "Cut into 2-inch pieces.", "Chill overnight.", "Cook until golden.", "Use 2 eggs."]) {
      expect(findTimes(step)).toEqual([]);
    }
  });

  it("splits a step into words and timers, keeping every character", () => {
    const step = "Bake 25 to 30 minutes, until golden. Rest 5 minutes.";
    const pieces = stepPieces(step);
    expect(pieces.map((p) => p.text).join("")).toBe(step);
    expect(pieces.filter((p) => p.kind === "time").map((p) => p.text)).toEqual(["25 to 30 minutes", "5 minutes"]);
  });

  it("writes durations, ranges and the countdown", () => {
    expect(durationWords(1500)).toBe("25 min");
    expect(durationWords(4500)).toBe("1 hr 15 min");
    expect(durationWords(3600)).toBe("1 hr");
    expect(durationWords(30)).toBe("30 sec");
    expect(rangeWords(1500, 1800)).toBe("25–30 min");
    expect(rangeWords(3600, 7200)).toBe("1 hr to 2 hr");
    expect(rangeWords(300, null)).toBe("5 min");
    expect(clockFace(1_499_001)).toBe("25:00");
    expect(clockFace(3_725_000)).toBe("1:02:05");
    expect(clockFace(-5)).toBe("0:00");
  });
});

describe("what a step uses", () => {
  const ingredients = [
    { text: "1 ¼ cups cornmeal" },
    { text: "¾ cup all-purpose flour" },
    { text: "2 tsp baking powder" },
    { text: "½ tsp salt" },
    { text: "1 cup buttermilk" },
    { text: "2 large eggs" },
    { text: "4 tbsp butter, melted" },
  ];

  it("reads the food a line names", () => {
    expect(foodWords("4 tbsp butter, melted")).toEqual(["butter"]);
    expect(foodWords("2 large eggs")).toEqual(["eggs"]);
    expect(foodWords("1 can (15 oz) cannellini beans, rinsed")).toEqual(["cannellini", "beans"]);
    expect(foodWords("Juice of 1 lemon")).toEqual(["lemon"]);
    expect(foodWords("salt and pepper to taste")).toEqual(["salt", "pepper"]);
    expect(foodWords("¾ cup all-purpose flour")).toEqual(["all-purpose", "flour"]);
  });

  it("finds the lines a step names, in the recipe's order", () => {
    const step = "Whisk the cornmeal, flour, baking powder and salt, then stir in the buttermilk, eggs and butter.";
    expect(stepUses(step, ingredients)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(stepUses("Heat the oven to 400°F with the skillet inside.", ingredients)).toEqual([]);
    // "buttered" is not butter.
    expect(stepUses("Pour into the hot buttered skillet.", ingredients)).toEqual([]);
    expect(stepUses("Beat the egg.", ingredients)).toEqual([5]);
  });

  it("names a shared word only when the step names the whole food", () => {
    const oils = [{ text: "2 tbsp olive oil" }, { text: "1 tsp sesame oil" }, { text: "1 lemon" }];
    expect(stepUses("Whisk the lemon with the oil.", oils)).toEqual([2]);
    expect(stepUses("Drizzle with the sesame oil.", oils)).toEqual([1]);
  });

  it("never counts a heading", () => {
    expect(stepUses("Make the sauce.", [{ text: "For the sauce", heading: true }, { text: "1 cup tomato sauce" }])).toEqual([1]);
  });
});

describe("the session on the phone", () => {
  const now = 1_790_000_000_000;

  it("starts at the gather list and reads back through its schema", () => {
    const session = freshSession(ID, now, 8);
    expect(session.screen).toBe("gather");
    expect(cookSessionSchema.safeParse(session).success).toBe(true);
    expect(cookSessionSchema.safeParse({ ...session, v: 2 }).success).toBe(false);
  });

  it("goes stale after twelve hours", () => {
    const session = freshSession(ID, now, null);
    expect(isStale(session, now + 11 * 3600_000)).toBe(false);
    expect(isStale(session, now + 13 * 3600_000)).toBe(true);
  });

  it("folds headings into the steps under them, and keeps the step inside the recipe", () => {
    expect(
      realSteps([{ text: "Mix." }, { text: "For the glaze", heading: true }, { text: "Whisk." }, { text: "Pour." }]),
    ).toEqual([
      { text: "Mix.", heading: null },
      { text: "Whisk.", heading: "For the glaze" },
      { text: "Pour.", heading: "For the glaze" },
    ]);
    expect(clampStep(7, 3)).toBe(2);
    expect(clampStep(-1, 3)).toBe(0);
    expect(clampStep(0, 0)).toBe(0);
  });

  it("ticks and unticks a line", () => {
    const once = toggleTick(freshSession(ID, now, null), 3);
    expect(once.ticked).toEqual([3]);
    expect(toggleTick(once, 3).ticked).toEqual([]);
  });

  it("runs timers as end times: ringing when due, a minute more from now once ringing", () => {
    let session = startTimer(freshSession(ID, now, null), { label: "Step 4 · 25–30 min", lo: 1500, hi: 1800 }, now, "t1");
    const [timer] = session.timers;
    expect(timer.endsAt).toBe(now + 1_500_000);
    expect(isRinging(timer, now + 1_499_999)).toBe(false);
    expect(isRinging(timer, now + 1_500_000)).toBe(true);
    session = addMinute(session, "t1", now + 60_000);
    expect(session.timers[0].endsAt).toBe(now + 1_560_000);
    session = addMinute(session, "t1", now + 2_000_000);
    expect(session.timers[0].endsAt).toBe(now + 2_060_000);
    expect(stopTimer(session, "t1").timers).toEqual([]);
  });

  it("says how often it was made", () => {
    expect(madeWords(0, null, "2026-10-02")).toBeNull();
    expect(madeWords(1, "2026-10-02", "2026-10-02")).toBe("Made once, today.");
    expect(madeWords(3, "2026-09-30", "2026-10-02")).toBe("Made 3 times, last on Sep 30.");
    expect(madeWords(1, "2025-12-24", "2026-10-02")).toBe("Made once, on Dec 24, 2025.");
    expect(madeWords(2, "2026-10-02", "2026-10-02")).toBe("Made 2 times, last today.");
  });

  it("says what was logged", () => {
    expect(loggedWords("2026-10-02", "2026-10-02", "8 wedges")).toBe("Logged: made today, for 8 wedges.");
    expect(loggedWords("2026-10-01", "2026-10-02", null)).toBe("Logged: made on Oct 1.");
  });
});
