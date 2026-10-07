import {
  GRAM_UNITS,
  amountWords,
  defaultPortion,
  forGrams,
  forServings,
  gramsFor,
  kcalWords,
  type FoodHit,
  type Nutrients,
  type RecipeHit,
} from "./eating";

/**
 * WHAT IS BEING LOGGED, before it is: a food on the list or one of the
 * person's recipes, and how much. Shared by Log food and Today's search bar
 * (the redesign, ADR 0132), so both work the numbers out the same way the
 * server keeps them (`core/eating.ts`). Pure.
 */

export type Choice = { kind: "food"; food: FoodHit } | { kind: "recipe"; recipe: RecipeHit };

/** Something logged lately, with the amount it was last had in (`recentEaten`). */
export interface RecentChoice {
  key: string;
  amount: number;
  portion: string;
  food: FoodHit | null;
  recipe: RecipeHit | null;
}

export function recentToChoice(item: RecentChoice): Choice | null {
  if (item.recipe) return { kind: "recipe", recipe: item.recipe };
  if (item.food) return { kind: "food", food: item.food };
  return null;
}

/** A food's own portions, then grams and ounces. */
export function unitsOf(food: FoodHit): string[] {
  return [...food.portions.map((p) => p.label), ...GRAM_UNITS.map((u) => u.label)];
}

/** A food's first portion and what it comes to, for a result line: "1 banana · 122 kcal". */
export function firstPortionWords(food: FoodHit): string {
  const start = defaultPortion(food.portions);
  const grams = gramsFor(start.amount, start.portion, food.portions) ?? 100;
  return `${amountWords(start.amount, start.portion)} · ${kcalWords((food.per100g.calories * grams) / 100)}`;
}

/** Where the amount starts: a food's first portion, a recipe's one serving. */
export function choiceStart(choice: Choice): { amount: number; portion: string } {
  return choice.kind === "food" ? defaultPortion(choice.food.portions) : { amount: 1, portion: "serving" };
}

/** What the amount comes to; null when it is not one this food can be logged in, or not a number. */
export function choiceNumbers(choice: Choice, amount: number | null, portion: string): Nutrients | null {
  if (amount === null) return null;
  if (choice.kind === "recipe") return forServings(choice.recipe.perServing, amount);
  const grams = gramsFor(amount, portion, choice.food.portions);
  return grams === null ? null : forGrams(choice.food.per100g, grams);
}

/** "Almonds, 1 oz", for the toast and the list of what was just added. */
export function choiceWords(choice: Choice, amount: number, portion: string): string {
  return choice.kind === "food"
    ? `${choice.food.name}, ${amountWords(amount, portion)}`
    : `${choice.recipe.title}, ${amountWords(amount, "serving")}`;
}

/** How far − and + move the amount (the design's steps): a serving at a time, half a portion, or 10 grams. */
export function stepFor(choice: Choice, portion: string): number {
  if (choice.kind === "recipe") return 1;
  return portion === "g" ? 10 : 0.5;
}

/** The amount one step up or down, on the step's own grid and never to nothing: below one step, a smaller one. */
export function stepped(amount: number, step: number, direction: 1 | -1): number {
  const onGrid = direction === 1 ? Math.floor(amount / step + 1e-9) * step + step : Math.ceil(amount / step - 1e-9) * step - step;
  if (onGrid > 0) return Math.round(onGrid * 100) / 100;
  // Under a step: halve it rather than reach zero, so 0.5 cup goes to 0.25.
  return Math.round((amount / 2) * 100) / 100 || amount;
}
