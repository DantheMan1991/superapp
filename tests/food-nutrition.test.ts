import { describe, expect, it } from "vitest";
import { legacyPortions } from "../scripts/build-usda-ingredients";
import type { WorkedNutrition } from "../src/db/schema";
import {
  closestByName,
  effectiveNutrition,
  keepChecked,
  foodNameKey,
  gramsOf,
  lineNumbers,
  matchPrompt,
  normalizeMatches,
  nutritionTiles,
  perServingOf,
  portionMl,
  statedWeight,
  statesAll,
  workedStillFits,
  workedWhole,
  type IngredientFood,
} from "../src/modules/food/core/nutrition";

/**
 * A RECIPE'S NUTRITION, WORKED OUT: THE PURE HALF (D4, docs/modules/food.md,
 * ADR 0131): which numbers count (the recipe's own first), the grams of a
 * line (the line's weight, a container's size, USDA's portion, Claude's
 * estimate), the totals, whether a result still fits, Claude's answer read,
 * and the ingredient list's portions as built. Foods here are invented for the
 * test, with USDA's shape.
 */

function food(name: string, per100g: Partial<IngredientFood["per100g"]>, portions: [string, number][] = []): IngredientFood {
  return {
    fdcId: name.length,
    name,
    per100g: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0, ...per100g },
    portions: portions.map(([label, grams]) => ({ label, grams })),
  };
}

const onion = food("Onions, raw", { calories: 40, carbsG: 9.3 }, [
  ["1 cup, chopped", 160],
  ["1 large", 150],
  ["1 medium (2-1/2\" dia)", 110],
  ["1 small", 70],
]);
const garlic = food("Garlic, raw", { calories: 149 }, [
  ["1 cup", 136],
  ["1 tsp", 2.8],
  ["1 clove", 3],
]);
const cumin = food("Spices, cumin seed", { calories: 375 }, [
  ["1 tsp, whole", 2.1],
  ["1 tbsp, whole", 6],
]);
const turkey = food("Turkey, ground, raw", { calories: 148, proteinG: 19.7, fatG: 8.3 });
const salmon = food("Fish, salmon, Atlantic, wild, raw", { calories: 142 }, [
  ["1 fillet", 198],
  ["3 oz", 85],
]);
const flour = food("Wheat flour, white, all-purpose, enriched, bleached", { calories: 364 }, [["1 cup", 125]]);
const rice = food("Rice, white, long-grain, regular, raw, enriched", { calories: 365, proteinG: 7.1, carbsG: 80 }, [["1 cup", 185]]);

describe("which numbers count", () => {
  const worked: WorkedNutrition = {
    whole: { calories: 3072, proteinG: 258, carbsG: 216, fatG: 126 },
    lines: [],
    workedAt: "2026-10-03T00:00:00Z",
  };

  it("are the recipe's own first, number by number, and worked out for the rest", () => {
    expect(effectiveNutrition({ calories: 520, proteinG: 44 }, worked, 6)).toEqual({ calories: 520, proteinG: 44, carbsG: 36, fatG: 21 });
    expect(effectiveNutrition(null, worked, 6)).toEqual({ calories: 512, proteinG: 43, carbsG: 36, fatG: 21 });
    expect(effectiveNutrition({ calories: 520 }, null, 6)).toEqual({ calories: 520 });
    expect(effectiveNutrition(null, null, 6)).toBeNull();
    expect(effectiveNutrition({}, null, 6)).toBeNull();
  });

  it("follow what the recipe makes now, and a recipe that does not say is one serving", () => {
    expect(effectiveNutrition(null, worked, 8)?.calories).toBe(384);
    expect(effectiveNutrition(null, worked, null)).toEqual({ calories: 3072, proteinG: 258, carbsG: 216, fatG: 126 });
    expect(effectiveNutrition({ calories: 520 }, worked, 8)?.calories).toBe(520);
  });

  it("need nothing worked out when the recipe states all four main ones", () => {
    expect(statesAll({ calories: 520, proteinG: 44, carbsG: 38, fatG: 18 })).toBe(true);
    expect(statesAll({ calories: 520, proteinG: 44 })).toBe(false);
    expect(statesAll(null)).toBe(false);
  });

  it("show on a recipe's page as four tiles, saying whose each number is (ADR 0132)", () => {
    const perServing = perServingOf(worked.whole, 6);
    const values = (own: Parameters<typeof nutritionTiles>[0], estimate: Parameters<typeof nutritionTiles>[1]) =>
      nutritionTiles(own, estimate).tiles.map((tile) => [tile.label, tile.value, tile.from]);

    // All its own, as stated, the worked-out ones not wanted.
    expect(nutritionTiles({ calories: 1250.5, proteinG: 44, carbsG: 38.25, fatG: 18 }, perServing).source).toBe("own");
    expect(values({ calories: 1250.5, proteinG: 44, carbsG: 38.25, fatG: 18 }, perServing)).toEqual([
      ["kcal", "1,250.5", "own"],
      ["protein", "44 g", "own"],
      ["carbs", "38.25 g", "own"],
      ["fat", "18 g", "own"],
    ]);
    // Its own first, worked out for the rest, rounded as Today rounds them.
    expect(nutritionTiles({ calories: 520 }, { ...perServing, fatG: 4.56 }).source).toBe("mixed");
    expect(values({ calories: 520 }, { ...perServing, fatG: 4.56 })).toEqual([
      ["kcal", "520", "own"],
      ["protein", "43 g", "worked"],
      ["carbs", "36 g", "worked"],
      ["fat", "4.6 g", "worked"],
    ]);
    expect(nutritionTiles(null, perServing).source).toBe("worked");
    // Some of its own and nothing for the rest; then nothing at all.
    expect(nutritionTiles({ calories: 520 }, null).source).toBe("partial");
    expect(values({ calories: 520 }, null)[1]).toEqual(["protein", null, null]);
    expect(nutritionTiles(null, null).source).toBe("none");
    expect(nutritionTiles({}, {}).source).toBe("none");
  });
});

describe("a line's grams", () => {
  it("use a weight the line writes, as written", () => {
    expect(gramsOf("2 lb ground turkey", turkey, 900)).toEqual({ grams: 907.2, source: "line" });
    expect(gramsOf("200g rice", rice, null)).toEqual({ grams: 200, source: "line" });
  });

  it("use a container's size, unless the line drains it and Claude weighed what is left", () => {
    expect(gramsOf("1 can (28 oz) crushed tomatoes", null, null).grams).toBeCloseTo(793.8, 1);
    expect(gramsOf("1 can (28 oz) crushed tomatoes", null, null).source).toBe("line");
    expect(gramsOf("2 cans (15 oz) black beans, drained", null, 480)).toEqual({ grams: 480, source: "estimate" });
    expect(gramsOf("2 cans (15 oz) black beans, drained", null, null).grams).toBeCloseTo(850.5, 1);
  });

  it("use a weight stated past the amount, for each thing or for the whole line", () => {
    // The drive's salmon: USDA's fillet is 198 g, the line's is 6 oz.
    expect(gramsOf("2 salmon fillets (6 oz each)", salmon, 400)).toEqual({ grams: 340.2, source: "line" });
    expect(gramsOf("2 (6-ounce) salmon fillets", salmon, null)).toEqual({ grams: 340.2, source: "line" });
    expect(gramsOf("2 x 400g tins chopped tomatoes", null, null)).toEqual({ grams: 800, source: "line" });
    expect(gramsOf("1 ½ cups (190 g) flour", flour, null)).toEqual({ grams: 190, source: "line" });
    expect(gramsOf("4 chicken thighs (about 1 1/2 lb total)", null, 700)).toEqual({ grams: 680.4, source: "line" });
    expect(gramsOf("2 cans black beans (15 oz each), drained", null, 480)).toEqual({ grams: 480, source: "estimate" });
    expect(gramsOf("2 cans black beans (15 oz each)", null, null)).toEqual({ grams: 850.5, source: "line" });
  });

  it("find a stated weight, and none where there is none", () => {
    expect(statedWeight("4 salmon fillets (5 to 7 oz each)")).toEqual({ grams: 6 * 28.349523125, each: true });
    expect(statedWeight("3 medium potatoes, about 1 lb")).toEqual({ grams: 453.59237, each: false });
    expect(statedWeight("2 eggs")).toBeNull();
    expect(statedWeight("1 cup milk (2%)")).toBeNull();
    expect(statedWeight("2 tbsp chili powder")).toBeNull();
    expect(statedWeight("Juice of 1 lemon")).toBeNull();
  });

  it("use USDA's weight for the portion the line counts in", () => {
    expect(gramsOf("2 yellow onions, diced", onion, 300)).toEqual({ grams: 220, source: "list" });
    expect(gramsOf("2 large onions", onion, null)).toEqual({ grams: 300, source: "list" });
    // An egg is a large one unless the line says otherwise; an onion a medium one.
    const egg = food("Egg, whole, raw, fresh", { calories: 143 }, [
      ["1 medium", 44],
      ["1 large", 50],
      ["1 small", 38],
    ]);
    expect(gramsOf("1 egg", egg, null)).toEqual({ grams: 50, source: "list" });
    expect(gramsOf("2 small eggs", egg, null)).toEqual({ grams: 76, source: "list" });
    expect(gramsOf("4 cloves garlic, minced", garlic, null)).toEqual({ grams: 12, source: "list" });
    expect(gramsOf("2 cups chopped onions", onion, null)).toEqual({ grams: 320, source: "list" });
    expect(gramsOf("1 tsp ground cumin", cumin, null).grams).toBeCloseTo(2.1, 5);
    expect(gramsOf("1 cup long-grain rice", rice, null)).toEqual({ grams: 185, source: "list" });
    // A tablespoon of something USDA weighs by the cup.
    expect(gramsOf("2 tbsp rice", rice, null).grams).toBeCloseTo(23.1, 1);
  });

  it("fall back to Claude's estimate, and to nothing", () => {
    expect(gramsOf("juice of 1 lemon", null, 45)).toEqual({ grams: 45, source: "estimate" });
    expect(gramsOf("Salt and pepper to taste", null, null)).toEqual({ grams: null, source: "none" });
    expect(gramsOf("1 cup broth", food("Broth", {}), 240)).toEqual({ grams: 240, source: "estimate" });
    expect(gramsOf("3 sprigs thyme", null, null)).toEqual({ grams: null, source: "none" });
  });

  it("know a portion written as a volume", () => {
    expect(portionMl("1 cup, chopped")).toBeCloseTo(236.6, 1);
    expect(portionMl("1 tbsp chopped")).toBeCloseTo(14.8, 1);
    expect(portionMl("1 tsp, whole")).toBeCloseTo(4.9, 1);
    expect(portionMl("1 medium (2-1/2\" dia)")).toBeNull();
    expect(portionMl("1 clove")).toBeNull();
  });
});

describe("the totals", () => {
  it("count USDA's numbers for each counted line's grams, for the whole recipe and a serving", () => {
    const lines = [
      { food: turkey, grams: 907.18, counted: true },
      { food: onion, grams: 220, counted: true },
      { food: garlic, grams: 12, counted: false },
      { food: null, grams: 10, counted: true },
      { food: rice, grams: null, counted: true },
    ];
    expect(lineNumbers(lines[1])?.calories).toBeCloseTo(88, 5);
    expect(lineNumbers(lines[2])).toBeNull();
    const whole = workedWhole(lines);
    expect(whole.calories).toBeCloseTo(1342.6 + 88, 0);
    expect(perServingOf(whole, 6)).toEqual({ calories: 238, proteinG: 29.8, carbsG: 3.4, fatG: 12.5, fiberG: 0, sugarG: 0, sodiumMg: 0 });
    expect(perServingOf(whole, null).calories).toBe(1431);
  });

  it("are nothing when nothing counts", () => {
    expect(workedWhole([{ food: null, grams: null, counted: false }])).toEqual({});
    expect(perServingOf({}, 4)).toEqual({});
  });
});

describe("a result worked out earlier", () => {
  const worked: WorkedNutrition = {
    whole: { calories: 3072 },
    lines: [
      { line: "2 lb ground turkey", fdcId: 1, food: "Turkey", grams: 907, source: "line", counted: true },
      { line: "1 tsp salt", fdcId: null, food: null, grams: null, source: "none", counted: false },
    ],
    workedAt: "2026-10-03T00:00:00Z",
  };

  it("still fits while the lines are the same, whatever the recipe now makes", () => {
    expect(workedStillFits(worked, ["1 tsp  salt", "2 lb ground turkey"])).toBe(true);
    expect(workedStillFits(worked, ["2 lb ground turkey", "1 tsp salt", "1 onion"])).toBe(false);
    expect(workedStillFits(worked, ["2 lb ground turkey"])).toBe(false);
  });
});

describe("the food a line is matched to", () => {
  it("is compared by name without USDA's notes in brackets", () => {
    expect(foodNameKey("Cheese, cheddar (Includes foods for USDA's Food Distribution Program)")).toBe("cheese, cheddar");
    expect(foodNameKey("  Onions,   raw ")).toBe("onions, raw");
  });

  it("is the closest name when none is exact", () => {
    const named = (...names: string[]) => names.map((name) => ({ name }));
    expect(closestByName("Spices, cumin seed, ground", named("Spices, coriander seed", "Spices, cumin seed", "Beef, ground, raw"))?.name).toBe(
      "Spices, cumin seed",
    );
    expect(
      closestByName(
        "Cheese, mozzarella, part skim milk, low moisture",
        named("Cheese, mozzarella, whole milk", "Cheese, mozzarella, low moisture, part-skim", "Cheese, mozzarella, part skim milk, ricotta"),
      )?.name,
    ).toBe("Cheese, mozzarella, low moisture, part-skim");
    // A plural and its singular are one word.
    expect(
      closestByName("Chicken, broilers or fryers, breast, meat only, raw", named("Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw", "Chicken, breast, roasted"))
        ?.name,
    ).toBe("Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw");
    expect(closestByName("Onions, raw", [])).toBeNull();
  });
});

describe("checking again after an edit", () => {
  it("keeps what was checked for the lines the recipe still has, and a fresh match for the rest", () => {
    const line = (text: string, grams: number, source: "list" | "typed" | "line"): Parameters<typeof keepChecked>[0][number] => ({
      line: text,
      food: onion,
      grams,
      source,
      counted: true,
      estimate: null,
    });
    const fresh = [line("2 yellow onions, diced", 220, "list"), line("2 tbsp olive oil", 27, "list"), line("1 tsp  salt", 6, "list"), line("1 tsp salt", 6, "list")];
    const kept = [line("2 yellow onions, diced", 300, "typed"), line("1 tbsp olive oil", 13.5, "list"), line("1 tsp salt", 1, "typed")];
    expect(keepChecked(fresh, kept).map((l) => [l.line, l.grams, l.source])).toEqual([
      ["2 yellow onions, diced", 300, "typed"],
      ["2 tbsp olive oil", 27, "list"],
      // A line written twice: the first keeps the check, the second is fresh.
      ["1 tsp salt", 1, "typed"],
      ["1 tsp salt", 6, "list"],
    ]);
    expect(keepChecked(fresh, [])).toEqual(fresh);
  });
});

describe("Claude's matches, read", () => {
  it("keep the first answer for each line, with grams only when they make sense", () => {
    const out = normalizeMatches(
      {
        items: [
          { line: 1, name: "  Turkey, ground,  raw ", search: "  turkey  ground raw ", grams: 907, count: true },
          { line: 1, search: "chicken", grams: 1, count: true },
          { line: 2, search: "salt table", grams: null, count: false },
          { line: 3, search: "onions raw", grams: -5 },
          { line: 4, search: "x", grams: 999_999, count: true },
          { line: 9, search: "ghost", grams: 1, count: true },
        ],
      },
      4,
    );
    expect(out.get(0)).toEqual({ name: "Turkey, ground, raw", search: "turkey ground raw", grams: 907, count: true });
    expect(out.get(1)).toEqual({ name: "", search: "salt table", grams: null, count: false });
    expect(out.get(2)).toEqual({ name: "", search: "onions raw", grams: null, count: true });
    expect(out.get(3)?.grams).toBeNull();
    expect(out.size).toBe(4);
    expect(normalizeMatches(null, 3).size).toBe(0);
  });

  it("are asked with the recipe's name, what it makes, and its numbered lines", () => {
    expect(matchPrompt("Turkey chili", "6 servings", ["2 lb ground turkey", "1 tsp salt"])).toBe(
      "Recipe: Turkey chili\nMakes: 6 servings\n\nThe lines:\n1. 2 lb ground turkey\n2. 1 tsp salt",
    );
  });
});

describe("the ingredient list's portions, as built", () => {
  it("read each as one of its words, a plural beside its singular dropped", () => {
    expect(
      legacyPortions([
        { modifier: "cloves", gramWeight: 9, sequenceNumber: 4 },
        { modifier: "cup", gramWeight: 136, sequenceNumber: 1 },
        { modifier: "clove", gramWeight: 3, sequenceNumber: 3 },
        { modifier: "tsp", gramWeight: 2.8, sequenceNumber: 2 },
        { modifier: "  ", gramWeight: 5, sequenceNumber: 5 },
        { modifier: "pinch", gramWeight: 0, sequenceNumber: 6 },
        { modifier: "cup", gramWeight: 140, sequenceNumber: 7 },
      ]),
    ).toEqual([
      ["1 cup", 136],
      ["1 tsp", 2.8],
      ["1 clove", 3],
    ]);
  });
});
