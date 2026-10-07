import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { choiceNumbers, choiceWords, recentToChoice, stepFor, stepped, type Choice } from "../src/modules/food/core/choice";
import type { FoodHit, RecipeHit } from "../src/modules/food/core/eating";
import { FOOD_ICONS, foodIconFor } from "../src/modules/food/core/food-icons";
import { photoVersion, recipePhotoOrNull, recipePhotoUrl } from "../src/modules/food/core/photo-url";
import { caloriesLeft, cheerFor, energySplit, greetingFor, mealName, plannedWords, ringShare, upNext } from "../src/modules/food/core/today";

/**
 * FOOD'S TODAY, REDRAWN (the "Fresh Market" design, ADR 0132): the greeting,
 * what is up next, the line under the day's numbers, the energy split, a
 * food's icon by its USDA category, and what the search bar and the sheet log.
 */

describe("the greeting", () => {
  it("says morning from 4 to 11, afternoon to 5, evening until 4 in the morning", () => {
    expect([3, 4, 10, 11, 16, 17, 23, 0].map(greetingFor)).toEqual([
      "Good evening",
      "Good morning",
      "Good morning",
      "Good afternoon",
      "Good afternoon",
      "Good evening",
      "Good evening",
      "Good evening",
    ]);
  });

  it("names the meal already planned, and one meal as one", () => {
    expect(plannedWords("dinner")).toBe("dinner's already planned");
    expect(plannedWords("breakfast")).toBe("breakfast's already planned");
    expect(plannedWords("snack")).toBe("a snack's already planned");
    // The meal's label is "Snacks"; one planned snack is not.
    expect(mealName("snack")).toBe("Snack");
    expect(mealName("dinner")).toBe("Dinner");
  });
});

describe("what is up next", () => {
  const plan = (id: string, meal: "breakfast" | "lunch" | "dinner" | "snack", eatenId: string | null = null, eats = true) => ({
    id,
    meal,
    eatenId,
    eats,
  });
  const eats = (p: { eats: boolean }) => p.eats;

  it("is the first meal not eaten whose time is not over", () => {
    const day = [plan("b", "breakfast"), plan("d", "dinner")];
    expect(upNext(day, 9, eats)?.id).toBe("b");
    expect(upNext(day, 12, eats)?.id).toBe("d");
    expect(upNext(day, 22, eats)).toBeNull();
  });

  it("puts dinner before a snack at half past three, when the time of day says snack", () => {
    expect(upNext([plan("s", "snack"), plan("d", "dinner")], 15, eats)?.id).toBe("d");
    expect(upNext([plan("s", "snack"), plan("d", "dinner")], 23, eats)?.id).toBe("s");
    // One in the morning is still the day before: dinner is over, a snack is not.
    expect(upNext([plan("s", "snack"), plan("d", "dinner")], 1, eats)?.id).toBe("s");
  });

  it("skips a meal already eaten and a batch cooked ahead, which has nothing to eat", () => {
    expect(upNext([plan("l", "lunch", "eaten-1"), plan("d", "dinner")], 12, eats)?.id).toBe("d");
    expect(upNext([plan("l", "lunch", null, false), plan("d", "dinner")], 12, eats)?.id).toBe("d");
  });
});

describe("the rings and the split", () => {
  it("fills a ring to its target and no further", () => {
    expect(ringShare(1100, 2200)).toBe(0.5);
    expect(ringShare(3000, 2200)).toBe(1);
    expect(ringShare(null, 2200)).toBe(0);
    expect(caloriesLeft(1050, 2200)).toEqual({ amount: 1150, over: false });
    expect(caloriesLeft(2323, 2200)).toEqual({ amount: 123, over: true });
  });

  it("splits the calories by the energy in each macro, fat at 9 a gram", () => {
    const split = energySplit({ proteinG: 74, carbsG: 129, fatG: 30 });
    expect(split).not.toBeNull();
    expect((split?.protein ?? 0) + (split?.carbs ?? 0) + (split?.fat ?? 0)).toBeCloseTo(1, 10);
    expect(split?.fat).toBeCloseTo(270 / (296 + 516 + 270), 10);
    expect(energySplit({ proteinG: null, carbsG: 0, fatG: null })).toBeNull();
  });
});

describe("the line under the day's numbers", () => {
  const targets = { calories: 2200, proteinG: 150 };
  const dinner = { meal: "dinner" as const, numbers: { calories: 480, proteinG: 38 } };

  it("says where the meal up next takes the day (the design's own numbers)", () => {
    expect(cheerFor({ day: { calories: 1050, proteinG: 74 }, targets, next: dinner, isToday: true })).toBe(
      "Dinner gets you to 70% of calories and 75% of protein.",
    );
    expect(cheerFor({ day: { calories: 1050, proteinG: 74 }, targets: { calories: null, proteinG: 150 }, next: dinner, isToday: true })).toBe(
      "Dinner gets you to 75% of protein.",
    );
    // Not "Snacks gets you", which the drive found.
    expect(cheerFor({ day: { calories: 1050, proteinG: 74 }, targets, next: { ...dinner, meal: "snack" }, isToday: true })).toBe(
      "Your snack gets you to 70% of calories and 75% of protein.",
    );
  });

  it("says what is left to go once nothing is up next", () => {
    expect(cheerFor({ day: { calories: 1530, proteinG: 112 }, targets, next: null, isToday: true })).toBe(
      "670 kcal and 38 g protein to go. A good day.",
    );
    expect(cheerFor({ day: { calories: null, proteinG: null }, targets, next: null, isToday: true })).toBe("2,200 kcal and 150 g protein to go.");
  });

  it("says a day on target is, and a day well over is over", () => {
    expect(cheerFor({ day: { calories: 2150, proteinG: 160 }, targets, next: dinner, isToday: true })).toBe(
      "On target for calories and protein. A good day.",
    );
    expect(cheerFor({ day: { calories: 2500, proteinG: 160 }, targets, next: null, isToday: true })).toBe(
      "300 kcal over your calorie target.",
    );
    expect(cheerFor({ day: { calories: 2500, proteinG: 120 }, targets, next: null, isToday: true })).toBe(
      "300 kcal over your calorie target, 30 g protein to go.",
    );
  });

  it("says nothing without a target, and only 'on target' about a day gone", () => {
    expect(cheerFor({ day: { calories: 1000, proteinG: 50 }, targets: { calories: null, proteinG: null }, next: dinner, isToday: true })).toBeNull();
    expect(cheerFor({ day: { calories: 2150, proteinG: 160 }, targets, next: null, isToday: false })).toBe("On target for calories and protein.");
    expect(cheerFor({ day: { calories: 1500, proteinG: 90 }, targets, next: null, isToday: false })).toBeNull();
  });
});

describe("a food's icon, by its USDA category", () => {
  const data = JSON.parse(readFileSync("scripts/data/usda-foods.json", "utf8")) as { columns: string[]; foods: unknown[][] };
  const at = data.columns.indexOf("category");
  const categories = [...new Set(data.foods.map((row) => row[at] as string))];

  it("gives every category on the food list an icon of its own kind", () => {
    expect(categories.length).toBeGreaterThan(150);
    const unknown = categories.filter((category) => foodIconFor(category) === "food");
    expect(unknown).toEqual(["Not included in a food category"]);
    for (const category of categories) expect(FOOD_ICONS).toContain(foodIconFor(category));
  });

  it("reads whole words where a short one hides in a longer", () => {
    expect(foodIconFor("Chicken, whole pieces")).toBe("poultry");
    expect(foodIconFor("Cakes and pies")).toBe("cake");
    expect(foodIconFor("Peaches and nectarines")).toBe("apple");
    expect(foodIconFor("Pears")).toBe("apple");
    expect(foodIconFor("White potatoes, baked or boiled")).toBe("vegetable");
    expect(foodIconFor("Salad dressings and vegetable oils")).toBe("jar");
  });

  it("takes the narrow rule first", () => {
    expect(foodIconFor("Cheese sandwiches")).toBe("sandwich");
    expect(foodIconFor("Egg rolls, dumplings, sushi")).toBe("dish");
    expect(foodIconFor("Eggs and omelets")).toBe("egg");
    expect(foodIconFor("String beans")).toBe("greens");
    expect(foodIconFor("Beans, peas, legumes")).toBe("bean");
    expect(foodIconFor("Yogurt, Greek")).toBe("bowl");
    expect(foodIconFor(null)).toBe("food");
  });
});

describe("what the search bar and the sheet log", () => {
  const almonds: FoodHit = {
    fdcId: 1,
    name: "Almonds, unsalted",
    category: "Nuts and seeds",
    per100g: { calories: 600, proteinG: 20, carbsG: 20, fatG: 50, fiberG: 10, sugarG: 4, sodiumMg: 1 },
    portions: [{ label: "1 oz", grams: 28.35 }],
  };
  const chili: RecipeHit = {
    recipeId: "r1",
    title: "Turkey chili",
    perServing: { calories: 480, proteinG: 38 },
    yieldAmount: 4,
    yieldUnit: null,
    photoUrl: null,
  };
  const food: Choice = { kind: "food", food: almonds };
  const recipe: Choice = { kind: "recipe", recipe: chili };

  it("works the numbers out as the server keeps them", () => {
    expect(choiceNumbers(food, 2, "1 oz")?.calories).toBeCloseTo(340.2, 1);
    expect(choiceNumbers(food, 100, "g")?.proteinG).toBe(20);
    expect(choiceNumbers(food, 1, "1 cup")).toBeNull();
    expect(choiceNumbers(food, null, "g")).toBeNull();
    expect(choiceNumbers(recipe, 2, "serving")?.calories).toBe(960);
  });

  it("words what was added for the toast", () => {
    expect(choiceWords(food, 1, "1 oz")).toBe("Almonds, unsalted, 1 oz");
    expect(choiceWords(recipe, 2, "serving")).toBe("Turkey chili, 2 servings");
  });

  it("steps a serving at a time, half a portion, or 10 grams, and never to nothing", () => {
    expect(stepFor(recipe, "serving")).toBe(1);
    expect(stepFor(food, "1 oz")).toBe(0.5);
    expect(stepFor(food, "g")).toBe(10);
    expect(stepped(1, 0.5, 1)).toBe(1.5);
    expect(stepped(1.3, 0.5, 1)).toBe(1.5);
    expect(stepped(1.3, 0.5, -1)).toBe(1);
    expect(stepped(150, 10, -1)).toBe(140);
    expect(stepped(1, 1, -1)).toBe(0.5);
    expect(stepped(0.5, 0.5, -1)).toBe(0.25);
  });

  it("takes something logged lately as a recipe or a food", () => {
    expect(recentToChoice({ key: "r:r1", amount: 1, portion: "serving", food: null, recipe: chili })).toEqual(recipe);
    expect(recentToChoice({ key: "f:1", amount: 1, portion: "1 oz", food: almonds, recipe: null })).toEqual(food);
    expect(recentToChoice({ key: "f:2", amount: 1, portion: "g", food: null, recipe: null })).toBeNull();
  });
});

describe("a recipe photo's address", () => {
  it("is the recipe's own photo route, versioned by the photo", () => {
    expect(recipePhotoUrl("r1", "food/t/photos/a.jpg")).toBe(`/personal/m/food/recipes/r1/photo?v=${photoVersion("food/t/photos/a.jpg")}`);
    expect(photoVersion("food/t/photos/a.jpg")).not.toBe(photoVersion("food/t/photos/b.jpg"));
    expect(recipePhotoOrNull("r1", null)).toBeNull();
    expect(recipePhotoOrNull(null, "food/t/photos/a.jpg")).toBeNull();
  });
});
