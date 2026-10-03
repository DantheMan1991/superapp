import { describe, expect, it } from "vitest";
import {
  CALORIE_TOLERANCE,
  amountWords,
  caloriesOnTarget,
  defaultPortion,
  forGrams,
  forServings,
  gramWords,
  gramsFor,
  kcalWords,
  logFoodSchema,
  logPlateSchema,
  mealAt,
  proteinOnTarget,
  targetsSchema,
  totals,
  towards,
  typedAmount,
  typedWhole,
  NO_NUTRIENTS,
  OUNCE_GRAMS,
} from "../src/modules/food/core/eating";
import { PLATE_GRAMS_MAX, PLATE_ITEMS_MAX, normalizePlate, plateRequestSchema } from "../src/modules/food/core/plate";
import { eatingRows, eatingToday } from "../src/modules/food/core/progress-rows";
import { readablePortion, readableName } from "../scripts/build-usda-foods";
import { readRow, valueWords } from "../src/modules/health/core/progress";

/**
 * FOOD D4a, THE PURE HALF (docs/modules/food.md; ADR 0126): the meal a time
 * suggests, a food's numbers for an amount and a recipe's for servings, the
 * day added up, the targets, the plate's reader, the food list's readable
 * names, and what Food tells Health through the progress slot.
 */

const ID = "6f1c2b8e-4a3d-4c1e-9b7a-2d5e8f9a0b1c";
const banana = { calories: 97, proteinG: 0.74, carbsG: 22.7, fatG: 0.28, fiberG: 2.6, sugarG: 12.2, sodiumMg: 1 };
const bananaPortions = [
  { label: "1 banana", grams: 126 },
  { label: "1 cup", grams: 150 },
];

describe("meals by the time of day", () => {
  it("suggests breakfast from 4, lunch from 11, a snack from 3, dinner from 5 and a snack again from 10 at night", () => {
    expect([3, 4, 10, 11, 14, 15, 16, 17, 21, 22, 0].map(mealAt)).toEqual([
      "snack",
      "breakfast",
      "breakfast",
      "lunch",
      "lunch",
      "snack",
      "snack",
      "dinner",
      "dinner",
      "snack",
      "snack",
    ]);
  });
});

describe("a food's numbers", () => {
  it("works a food out for its grams from its numbers per 100 g", () => {
    const one = forGrams(banana, 126);
    expect(one.calories).toBeCloseTo(122.22);
    expect(one.proteinG).toBeCloseTo(0.9324);
    expect(one.sodiumMg).toBeCloseTo(1.26);
  });

  it("weighs an amount in a food's own portion, in grams or in ounces, and refuses a portion it does not have", () => {
    expect(gramsFor(1, "1 banana", bananaPortions)).toBe(126);
    expect(gramsFor(2, "1 cup", bananaPortions)).toBe(300);
    expect(gramsFor(150, "g", bananaPortions)).toBe(150);
    expect(gramsFor(2, "oz", [])).toBeCloseTo(2 * OUNCE_GRAMS);
    expect(gramsFor(1, "1 slice", bananaPortions)).toBeNull();
  });

  it("starts at a food's first portion, or at 100 g when it has none", () => {
    expect(defaultPortion(bananaPortions)).toEqual({ amount: 1, portion: "1 banana" });
    expect(defaultPortion([])).toEqual({ amount: 100, portion: "g" });
  });

  it("scales a recipe's stated numbers by servings, and keeps what it does not state unknown", () => {
    expect(forServings({ calories: 310, proteinG: 6 }, 1.5)).toEqual({
      ...NO_NUTRIENTS,
      calories: 465,
      proteinG: 9,
    });
    expect(forServings(null, 2)).toEqual(NO_NUTRIENTS);
  });
});

describe("a day added up", () => {
  it("sums what is known, and counts what has no calories", () => {
    const day = totals([
      { ...NO_NUTRIENTS, calories: 150, proteinG: 17, carbsG: 6, fatG: 0 },
      { ...NO_NUTRIENTS, calories: 105, proteinG: 1.3 },
      { ...NO_NUTRIENTS },
    ]);
    expect(day).toMatchObject({ calories: 255, proteinG: 18.3, carbsG: 6, fatG: 0, fiberG: null, count: 3, unknown: 1 });
    expect(totals([])).toMatchObject({ calories: null, count: 0, unknown: 0 });
  });

  it("says the numbers the way the screen does", () => {
    expect(kcalWords(1640.4)).toBe("1,640 kcal");
    expect(gramWords(128.4)).toBe("128 g");
    expect(gramWords(4.46)).toBe("4.5 g");
    expect(amountWords(1, "1 banana")).toBe("1 banana");
    expect(amountWords(2, "1 egg")).toBe("2 × 1 egg");
    expect(amountWords(150, "g")).toBe("150 g");
    expect(amountWords(1, "serving")).toBe("1 serving");
    expect(amountWords(1.5, "serving")).toBe("1.5 servings");
  });
});

describe("targets", () => {
  it("counts the calorie target met within a tenth either way, and the protein target at or above it", () => {
    expect(CALORIE_TOLERANCE).toBe(0.1);
    expect(caloriesOnTarget(2_000, 2_200)).toBe(true);
    expect(caloriesOnTarget(2_420, 2_200)).toBe(true);
    expect(caloriesOnTarget(1_900, 2_200)).toBe(false);
    expect(caloriesOnTarget(2_500, 2_200)).toBe(false);
    expect(caloriesOnTarget(2_000, null)).toBeNull();
    expect(proteinOnTarget(150, 150)).toBe(true);
    expect(proteinOnTarget(149, 150)).toBe(false);
    expect(proteinOnTarget(null, 150)).toBeNull();
  });

  it("draws how far along a target is, and never past the end of the bar", () => {
    expect(towards(128, 150, "g")).toEqual({ share: 128 / 150, words: "128 of 150 g" });
    expect(towards(2_640, 2_200, "kcal")).toEqual({ share: 1, words: "2,640 of 2,200 kcal" });
    expect(towards(null, 150, "g").share).toBe(0);
  });

  it("keeps a target in its range, and clearing one is allowed", () => {
    expect(targetsSchema.safeParse({ calories: 2_200, proteinG: 150 }).success).toBe(true);
    expect(targetsSchema.safeParse({ calories: null, proteinG: null }).success).toBe(true);
    for (const bad of [{ calories: 400 }, { calories: 12_000 }, { proteinG: 5 }, { proteinG: 900 }, { calories: 2_200.5 }]) {
      expect(targetsSchema.safeParse({ calories: 2_200, proteinG: 150, ...bad }).success).toBe(false);
    }
  });
});

describe("what the phone sends", () => {
  it("accepts a food logged by its id, day, meal, amount and portion, and refuses one out of shape", () => {
    const food = { id: ID, day: "2026-10-03", meal: "lunch", fdcId: 2709224, amount: 1, portion: "1 banana" };
    expect(logFoodSchema.safeParse(food).success).toBe(true);
    for (const bad of [{ id: "x" }, { meal: "brunch" }, { amount: 0 }, { portion: " " }, { day: "today" }, { fdcId: -1 }]) {
      expect(logFoodSchema.safeParse({ ...food, ...bad }).success).toBe(false);
    }
    expect(logPlateSchema.safeParse({ day: "2026-10-03", meal: "dinner", items: [] }).success).toBe(false);
  });

  it("reads a typed number the way a phone types it", () => {
    expect(typedAmount(" 1,5 ")).toBe(1.5);
    expect(typedAmount("0")).toBeNull();
    expect(typedWhole("2,200")).toBe(2200);
    expect(typedWhole("")).toBeNull();
    expect(typedWhole("150.5")).toBeNull();
  });
});

describe("the plate's reader", () => {
  it("keeps each named food with its grams, held to what a plate can be", () => {
    const plate = normalizePlate({
      found: true,
      items: [
        { name: "  Grilled  chicken breast ", search: "chicken breast grilled", grams: 151.6 },
        { name: "White rice", search: "", grams: 180 },
        { name: "Soup", search: "soup", grams: 9_000 },
        { name: "", search: "nothing", grams: 50 },
        { name: "Garnish", search: "parsley", grams: 0 },
        "not an item",
      ],
    });
    expect(plate).toEqual({
      found: true,
      items: [
        { name: "Grilled chicken breast", search: "chicken breast grilled", grams: 152 },
        { name: "White rice", search: "White rice", grams: 180 },
        { name: "Soup", search: "soup", grams: PLATE_GRAMS_MAX },
      ],
    });
  });

  it("finds nothing on a photo with no food, or an answer with no items", () => {
    expect(normalizePlate({ found: false, items: [] })).toEqual({ found: false, items: [] });
    expect(normalizePlate({ found: true })).toEqual({ found: false, items: [] });
    expect(normalizePlate(null)).toEqual({ found: false, items: [] });
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Food ${i}`, search: "x", grams: 10 }));
    expect(normalizePlate({ found: true, items: many }).items).toHaveLength(PLATE_ITEMS_MAX);
  });

  it("takes one photo of a size, as base64", () => {
    expect(plateRequestSchema.safeParse({ jpeg: "A".repeat(200) }).success).toBe(true);
    expect(plateRequestSchema.safeParse({ jpeg: "not base64!" + "A".repeat(200) }).success).toBe(false);
  });
});

describe("the food list's names", () => {
  it("spells out USDA's abbreviations, and changes nothing else", () => {
    expect(readableName("Chicken breast, NS as to cooking method, skin eaten")).toBe(
      "Chicken breast, cooking method not specified, skin eaten",
    );
    expect(readableName("Yogurt, NFS")).toBe("Yogurt, not further specified");
    expect(readableName("Banana, raw")).toBe("Banana, raw");
    expect(readablePortion("1 cup, NFS")).toBe("1 cup");
    expect(readablePortion("1 fl oz (NFS)")).toBe("1 fl oz");
    expect(readablePortion("1 egg, NS as to size")).toBe("1 egg");
    expect(readablePortion("1 cup, cooked, diced")).toBe("1 cup, cooked, diced");
  });
});

describe("what Food tells Health", () => {
  const windows = [
    { from: "2026-09-20", to: "2026-09-26" },
    { from: "2026-09-27", to: "2026-10-03" },
  ];
  const ate = (eatenOn: string, calories: number | null, proteinG: number | null) => ({
    ...NO_NUTRIENTS,
    eatenOn,
    calories,
    proteinG,
    carbsG: calories === null ? null : 10,
    fatG: calories === null ? null : 5,
  });

  it("averages each number over the days something was logged, and counts the days on each target", () => {
    const entries = [
      ate("2026-09-28", 1_200, 80),
      ate("2026-09-28", 900, 70),
      ate("2026-10-01", 2_000, 120),
      ate("2026-10-02", null, null),
    ];
    const rows = eatingRows(entries, windows, { calories: 2_100, proteinG: 150 });
    expect(Object.fromEntries(rows.map((r) => [r.key, r.values]))).toEqual({
      "food.calories": [null, (2_100 + 2_000) / 2],
      "food.protein": [null, (150 + 120) / 2],
      "food.carbs": [null, (20 + 10) / 2],
      "food.fat": [null, (10 + 5) / 2],
      "food.calorie-target": [0, 2],
      "food.protein-target": [0, 1],
    });
    expect(rows.find((r) => r.key === "food.calories")).toMatchObject({ format: "amount", unit: "kcal", better: null });
  });

  it("leaves the target rows out until a target is set", () => {
    const keys = eatingRows([], windows, { calories: null, proteinG: 150 }).map((r) => r.key);
    expect(keys).toEqual(["food.calories", "food.protein", "food.carbs", "food.fat", "food.protein-target"]);
  });

  it("puts the day on Health's Today, with how far along each target", () => {
    expect(eatingToday([], { calories: null, proteinG: null })).toEqual({
      key: "food",
      title: "Eating",
      icon: "utensils",
      lines: ["Nothing logged today"],
      href: "/personal/m/food",
    });
    const card = eatingToday(
      [
        { ...NO_NUTRIENTS, calories: 1_640, proteinG: 128, carbsG: 150, fatG: 52 },
        { ...NO_NUTRIENTS },
      ],
      { calories: 2_200, proteinG: 150 },
    );
    expect(card.lines).toEqual([
      "1,640 kcal · protein 128 g · carbs 150 g · fat 52 g",
      "Protein 128 of 150 g · calories 1,640 of 2,200",
      "1 thing has no nutrition stated",
    ]);
  });

  it("reads on Health's Progress as whole kilocalories, and calls a small change about the same", () => {
    expect(valueWords(2_010.4, "amount", "kcal")).toBe("2,010 kcal");
    expect(valueWords(60, "amount", "min")).toBe("60 min");
    const row = (values: number[]) => ({ key: "k", name: "Calories a day", values, format: "amount" as const, unit: "kcal", better: null });
    expect(readRow(row([2_000, 2_040]))).toMatchObject({ change: "about the same as the weeks before" });
    expect(readRow(row([2_000, 2_300]))).toMatchObject({ change: "up 300 kcal on the weeks before", direction: null });
  });
});
