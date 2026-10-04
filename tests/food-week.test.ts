import { describe, expect, it } from "vitest";
import {
  batchFits,
  batchLeft,
  canPlan,
  compareSlots,
  dayTitle,
  daysToPlan,
  eatsHere,
  firstLeftovers,
  isAfter,
  leftoverChoices,
  leftoverCount,
  leftoverServings,
  mondayOf,
  planAmountWords,
  planCookSchema,
  planNumbers,
  planTotals,
  plannable,
  rangeWords,
  repeatPlan,
  slotKey,
  slotWords,
  weekAverage,
  weekDays,
  weekInReach,
  weekWords,
  type PlanItem,
  type PlanRowLike,
} from "../src/modules/food/core/week";

/**
 * FOOD'S WEEK, THE PURE HALF (D2, docs/modules/food.md, ADR 0129): the weeks
 * and what can be planned, the meals in order, the leftovers a cook offers and
 * puts on first, the numbers a planned day comes to, and a past week repeated.
 *
 * Today is Wednesday 7 Oct 2026 throughout: this week runs 5 to 11 October, the
 * next 12 to 18.
 */

const TODAY = "2026-10-07";

function item(change: Partial<PlanItem>): PlanItem {
  return {
    id: "p",
    day: TODAY,
    meal: "dinner",
    kind: "cook",
    recipeId: "r",
    cookId: null,
    fdcId: null,
    name: "Turkey chili",
    servings: 1,
    make: 4,
    yieldUnit: "servings",
    amount: null,
    portion: null,
    grams: null,
    portions: null,
    perServing: { calories: 520, proteinG: 44 },
    per100g: null,
    eatenId: null,
    cookSlot: null,
    leftovers: [],
    ...change,
  };
}

describe("weeks", () => {
  it("run Monday to Sunday", () => {
    expect(mondayOf(TODAY)).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(weekDays("2026-10-05")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });

  it("plan this week and the next, and offer today onwards", () => {
    expect(plannable(TODAY)).toEqual({ from: "2026-10-05", to: "2026-10-18" });
    expect(canPlan("2026-10-05", TODAY)).toBe(true);
    expect(canPlan("2026-10-18", TODAY)).toBe(true);
    expect(canPlan("2026-10-04", TODAY)).toBe(false);
    expect(canPlan("2026-10-19", TODAY)).toBe(false);
    const days = daysToPlan(TODAY);
    expect(days[0]).toBe(TODAY);
    expect(days.at(-1)).toBe("2026-10-18");
    expect(days).toHaveLength(12);
  });

  it("can be looked back on for twelve weeks, and on to the next", () => {
    expect(weekInReach("2026-07-13", TODAY)).toBe(true);
    expect(weekInReach("2026-07-06", TODAY)).toBe(false);
    expect(weekInReach("2026-10-12", TODAY)).toBe(true);
    expect(weekInReach("2026-10-19", TODAY)).toBe(false);
  });

  it("are named for the person", () => {
    expect(weekWords("2026-10-05", TODAY)).toBe("This week, Oct 5 to 11");
    expect(weekWords("2026-10-12", TODAY)).toBe("Next week, Oct 12 to 18");
    expect(weekWords("2026-09-28", TODAY)).toBe("Last week, Sep 28 to Oct 4");
    expect(weekWords("2026-09-21", TODAY)).toBe("Sep 21 to 27");
    expect(rangeWords("2026-08-31")).toBe("Aug 31 to Sep 6");
    expect(dayTitle("2026-10-05")).toBe("Mon, Oct 5");
  });
});

describe("meals in order", () => {
  it("go by day, then breakfast, lunch, dinner and snacks", () => {
    const lunch = { day: TODAY, meal: "lunch" as const };
    const dinner = { day: TODAY, meal: "dinner" as const };
    const tomorrow = { day: "2026-10-08", meal: "breakfast" as const };
    expect(compareSlots(lunch, dinner)).toBeLessThan(0);
    expect(isAfter(dinner, lunch)).toBe(true);
    expect(isAfter(lunch, lunch)).toBe(false);
    expect(isAfter(tomorrow, dinner)).toBe(true);
    expect(isAfter({ day: TODAY, meal: "snack" }, dinner)).toBe(true);
  });

  it("are named near today by the day's name", () => {
    expect(slotWords({ day: TODAY, meal: "lunch" }, TODAY)).toBe("Today's lunch");
    expect(slotWords({ day: "2026-10-08", meal: "dinner" }, TODAY)).toBe("Tomorrow's dinner");
    expect(slotWords({ day: "2026-10-09", meal: "lunch" }, TODAY)).toBe("Fri lunch");
  });
});

describe("leftovers", () => {
  it("are offered for lunch and dinner on the four days after the cook", () => {
    const choices = leftoverChoices({ day: TODAY, meal: "dinner" }, TODAY).map(slotKey);
    expect(choices).toEqual([
      "2026-10-08:lunch",
      "2026-10-08:dinner",
      "2026-10-09:lunch",
      "2026-10-09:dinner",
      "2026-10-10:lunch",
      "2026-10-10:dinner",
      "2026-10-11:lunch",
      "2026-10-11:dinner",
    ]);
    // A lunch cook offers its own day's dinner too.
    expect(leftoverChoices({ day: TODAY, meal: "lunch" }, TODAY).map(slotKey)[0]).toBe("2026-10-07:dinner");
  });

  it("are never offered past next week, nor on a day gone by", () => {
    const late = leftoverChoices({ day: "2026-10-17", meal: "dinner" }, TODAY).map(slotKey);
    expect(late).toEqual(["2026-10-18:lunch", "2026-10-18:dinner"]);
    const early = leftoverChoices({ day: "2026-10-05", meal: "dinner" }, TODAY).map(slotKey);
    expect(early[0]).toBe("2026-10-07:lunch");
  });

  it("are as much as the person eats at the cook, and as many as the batch has left", () => {
    expect(leftoverServings(1)).toBe(1);
    expect(leftoverServings(2)).toBe(2);
    expect(leftoverServings(0)).toBe(1);
    expect(leftoverCount(4, 1)).toBe(3);
    expect(leftoverCount(6, 2)).toBe(2);
    expect(leftoverCount(4, 0)).toBe(4);
    expect(leftoverCount(1, 1)).toBe(0);
    expect(leftoverCount(5, 2)).toBe(1);
  });

  it("go on the next free lunches first, then dinners, as drawn", () => {
    const choices = leftoverChoices({ day: TODAY, meal: "dinner" }, TODAY);
    expect(firstLeftovers(choices, 3, new Set()).map(slotKey)).toEqual(["2026-10-08:lunch", "2026-10-09:lunch", "2026-10-10:lunch"]);
    const taken = new Set(["2026-10-09:lunch"]);
    expect(firstLeftovers(choices, 3, taken).map(slotKey)).toEqual(["2026-10-08:lunch", "2026-10-10:lunch", "2026-10-11:lunch"]);
    const lunchesTaken = new Set(["2026-10-08:lunch", "2026-10-09:lunch", "2026-10-10:lunch", "2026-10-11:lunch"]);
    expect(firstLeftovers(choices, 2, lunchesTaken).map(slotKey)).toEqual(["2026-10-08:dinner", "2026-10-09:dinner"]);
    expect(firstLeftovers(choices, 0, new Set())).toEqual([]);
  });

  it("must fit in the batch", () => {
    expect(batchLeft(4, 1, [1, 1])).toBe(1);
    expect(batchFits(4, 1, [1, 1, 1])).toBe(true);
    expect(batchFits(4, 1, [1, 1, 1, 1])).toBe(false);
    expect(batchFits(1, 1 / 3, [1 / 3, 1 / 3])).toBe(true);
  });
});

describe("a planned meal's numbers", () => {
  it("come from the recipe as it is now, or the food's grams", () => {
    expect(planNumbers(item({ servings: 2 }))).toMatchObject({ calories: 1040, proteinG: 88, carbsG: null });
    const banana = item({
      kind: "food",
      recipeId: null,
      servings: null,
      make: null,
      grams: 126,
      perServing: null,
      per100g: { calories: 97, proteinG: 1, carbsG: 22, fatG: 0.3, fiberG: 2, sugarG: 12, sodiumMg: 1 },
    });
    expect(planNumbers(banana).calories).toBeCloseTo(122.2, 1);
    expect(planNumbers({ ...banana, per100g: null }).calories).toBeNull();
  });

  it("leave out a batch made ahead, and add up the rest of the day", () => {
    const ahead = item({ id: "a", servings: 0, make: 4 });
    const lunch = item({ id: "b", kind: "leftover", make: null, servings: 1, meal: "lunch" });
    const noNumbers = item({ id: "c", perServing: null, meal: "snack" });
    expect(eatsHere(ahead)).toBe(false);
    const day = planTotals([ahead, lunch, noNumbers]);
    expect(day.count).toBe(2);
    expect(day.calories).toBe(520);
    expect(day.unknown).toBe(1);
  });

  it("average the days with something planned", () => {
    const days = [planTotals([item({})]), planTotals([]), planTotals([item({ servings: 2 })])];
    expect(weekAverage(days)).toEqual({ calories: 780, proteinG: 66, days: 2 });
    expect(weekAverage([planTotals([])])).toEqual({ calories: null, proteinG: null, days: 0 });
  });

  it("is said as a cook, leftovers or a food's amount", () => {
    expect(planAmountWords(item({}))).toBe("Cook 4 servings, eat 1");
    expect(planAmountWords(item({ servings: 0 }))).toBe("Cook 4 servings, eat none here");
    expect(planAmountWords(item({ make: 24, servings: 2, yieldUnit: "cookies" }))).toBe("Cook 24 cookies, eat 2");
    expect(planAmountWords(item({ kind: "leftover", make: null, servings: 1 }))).toBe("Leftovers · 1 serving");
    expect(planAmountWords(item({ kind: "food", amount: 1, portion: "1 cup" }))).toBe("1 cup");
  });
});

describe("a week repeated", () => {
  const row = (change: Partial<PlanRowLike>): PlanRowLike => ({
    id: "x",
    day: "2026-09-28",
    meal: "dinner",
    kind: "cook",
    recipeId: "chili",
    cookId: null,
    servings: 1,
    make: 4,
    fdcId: null,
    name: null,
    amount: null,
    portion: null,
    grams: null,
    ...change,
  });
  let n = 0;
  const ids = () => `new-${++n}`;

  it("puts each meal on the same weekday, its leftovers following their cook", () => {
    n = 0;
    const out = repeatPlan(
      [
        row({ id: "cook", day: "2026-09-28" }),
        row({ id: "left", day: "2026-09-29", meal: "lunch", kind: "leftover", recipeId: null, cookId: "cook", make: null }),
        row({ id: "yog", day: "2026-09-30", meal: "breakfast", kind: "food", recipeId: null, servings: null, make: null, fdcId: 1, name: "Yogurt", amount: 1, portion: "1 cup", grams: 245 }),
      ],
      "2026-09-28",
      "2026-10-12",
      TODAY,
      ids,
    );
    expect(out.map((r) => [r.day, r.meal, r.kind])).toEqual([
      ["2026-10-12", "dinner", "cook"],
      ["2026-10-13", "lunch", "leftover"],
      ["2026-10-14", "breakfast", "food"],
    ]);
    const cook = out.find((r) => r.kind === "cook");
    expect(out.find((r) => r.kind === "leftover")?.cookId).toBe(cook?.id);
    expect(out.every((r) => r.id.startsWith("new-"))).toBe(true);
  });

  it("leaves out the days gone by on this week, and leftovers whose cook went with them", () => {
    n = 0;
    const out = repeatPlan(
      [
        row({ id: "cook", day: "2026-09-28" }),
        row({ id: "left", day: "2026-09-30", meal: "lunch", kind: "leftover", recipeId: null, cookId: "cook", make: null }),
        row({ id: "other", day: "2026-10-01" }),
        row({ id: "gone", day: "2026-10-02", kind: "food", recipeId: null, servings: null, make: null, fdcId: null, name: "Gone", amount: 1, portion: "g", grams: 1 }),
      ],
      "2026-09-28",
      "2026-10-05",
      TODAY,
      ids,
    );
    // Monday the 5th is gone by; the leftover on the 7th lost its cook; a food off the list is left out.
    expect(out.map((r) => [r.day, r.kind])).toEqual([["2026-10-08", "cook"]]);
  });
});

describe("the inputs", () => {
  it("take a cook, its leftovers and what is eaten, 0 included", () => {
    const base = {
      id: "6f1f8a1e-8b1f-4f5e-9a7b-0d2f3a4b5c6d",
      day: TODAY,
      meal: "dinner",
      recipeId: "7a1f8a1e-8b1f-4f5e-9a7b-0d2f3a4b5c6d",
      make: 4,
      eat: 0,
      leftovers: [],
    };
    expect(planCookSchema.safeParse(base).success).toBe(true);
    expect(planCookSchema.safeParse({ ...base, make: 0 }).success).toBe(false);
    expect(planCookSchema.safeParse({ ...base, eat: -1 }).success).toBe(false);
    expect(planCookSchema.safeParse({ ...base, meal: "brunch" }).success).toBe(false);
  });
});
