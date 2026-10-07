import { z } from "zod";
import type { FoodNutrition, FoodPortion } from "@/db/schema";

/**
 * WHAT WAS EATEN (D4a, docs/modules/food.md; the founder's calls 2026-10-03):
 * a food found on USDA's list by its amount, or a saved recipe by servings,
 * in breakfast, lunch, dinner or snacks; calories and the three macros shown
 * alike; daily targets for calories and protein. Pure: the arithmetic, the
 * words and the inputs' schemas. The numbers always come from the food list
 * or the recipe, never from a model (ADR 0126).
 */

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = (typeof MEALS)[number];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

/**
 * The meal a time of day suggests, changeable when logging: breakfast from 4
 * in the morning, lunch from 11, a snack from 3 in the afternoon, dinner from
 * 5, and a snack again from 10 at night.
 */
export function mealAt(hour: number): Meal {
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return "snack";
}

/** The seven numbers, in the order a label gives them; null where nothing is known. */
export const NUTRIENT_KEYS = ["calories", "proteinG", "carbsG", "fatG", "fiberG", "sugarG", "sodiumMg"] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Record<NutrientKey, number | null>;

export const NO_NUTRIENTS: Nutrients = {
  calories: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  fiberG: null,
  sugarG: null,
  sodiumMg: null,
};

/** A food's numbers for some grams, from its numbers per 100 g. */
export function forGrams(per100g: Record<NutrientKey, number>, grams: number): Nutrients {
  const out = { ...NO_NUTRIENTS };
  for (const key of NUTRIENT_KEYS) out[key] = (per100g[key] * grams) / 100;
  return out;
}

/** A recipe's numbers for some servings, from what it states per serving; what it does not state stays unknown. */
export function forServings(perServing: FoodNutrition | null, servings: number): Nutrients {
  const out = { ...NO_NUTRIENTS };
  if (!perServing) return out;
  for (const key of NUTRIENT_KEYS) {
    const value = perServing[key];
    out[key] = typeof value === "number" ? value * servings : null;
  }
  return out;
}

/** A food on the list, as a search gives it: its numbers per 100 g and its portions. */
export interface FoodHit {
  fdcId: number;
  name: string;
  category: string;
  per100g: Record<NutrientKey, number>;
  portions: FoodPortion[];
}

/** One of the person's recipes, as a search gives it. */
export interface RecipeHit {
  recipeId: string;
  title: string;
  /** As the recipe states it, per serving; null when it states none. */
  perServing: FoodNutrition | null;
  /** What one batch makes, in `yieldUnit` (D2's Cook starts there); null when it does not say. */
  yieldAmount: number | null;
  yieldUnit: string | null;
  /** Its photo, for the picture beside it (the redesign); null or absent when it has none. */
  photoUrl?: string | null;
}

/** The universal amounts every food can be logged in, beside its own portions. */
export const OUNCE_GRAMS = 28.349523125;
export const GRAM_UNITS = [
  { label: "g", grams: 1 },
  { label: "oz", grams: OUNCE_GRAMS },
] as const;

/** What an amount of a portion weighs, or null when the portion is not one of this food's. */
export function gramsFor(amount: number, portion: string, portions: readonly FoodPortion[]): number | null {
  const unit = GRAM_UNITS.find((u) => u.label === portion);
  if (unit) return amount * unit.grams;
  const own = portions.find((p) => p.label === portion);
  return own ? amount * own.grams : null;
}

/** The portion a food starts with: its first household measure, or 100 g when it has none. */
export function defaultPortion(portions: readonly FoodPortion[]): { amount: number; portion: string } {
  return portions.length > 0 ? { amount: 1, portion: portions[0].label } : { amount: 100, portion: "g" };
}

export interface EatenLike extends Nutrients {
  meal: Meal;
}

export interface DayTotals extends Nutrients {
  /** How many things were logged that day. */
  count: number;
  /** How many of them have no calories (a recipe that states none). */
  unknown: number;
}

/** A day added up. A number nothing on the day knows stays null; one that some know is their sum. */
export function totals(entries: readonly Nutrients[]): DayTotals {
  const out: DayTotals = { ...NO_NUTRIENTS, count: entries.length, unknown: 0 };
  for (const entry of entries) {
    if (entry.calories === null) out.unknown += 1;
    for (const key of NUTRIENT_KEYS) {
      const value = entry[key];
      if (value === null) continue;
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

/** "1,640 kcal". */
export function kcalWords(calories: number): string {
  return `${Math.round(calories).toLocaleString("en-US")} kcal`;
}

/** "128 g", "4.5 g" below ten, so a small amount is not shown as nothing. */
export function gramWords(grams: number): string {
  const rounded = grams < 10 ? Math.round(grams * 10) / 10 : Math.round(grams);
  return `${rounded.toLocaleString("en-US")} g`;
}

/** "2,300 mg". */
export function mgWords(mg: number): string {
  return `${Math.round(mg).toLocaleString("en-US")} mg`;
}

/** An amount as it was logged: "1 banana", "150 g", "1.5 servings", "2 × 1 egg". */
export function amountWords(amount: number, portion: string): string {
  const n = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  if (portion === "serving") return `${n} ${amount === 1 ? "serving" : "servings"}`;
  if (portion === "g" || portion === "oz") return `${n} ${portion}`;
  if (amount === 1) return portion;
  return `${n} × ${portion}`;
}

/** The calories target counts as met within a tenth of it, either way: neither far under nor far over. */
export const CALORIE_TOLERANCE = 0.1;

export function caloriesOnTarget(calories: number | null, target: number | null): boolean | null {
  if (target === null || calories === null) return null;
  return Math.abs(calories - target) <= target * CALORIE_TOLERANCE;
}

/** The protein target counts as met at or above it. */
export function proteinOnTarget(proteinG: number | null, target: number | null): boolean | null {
  if (target === null || proteinG === null) return null;
  return proteinG >= target;
}

/** How far along a target the day is, 0 to 1 (a bar), and the words beside it: "128 of 150 g". */
export function towards(value: number | null, target: number, unit: "kcal" | "g"): { share: number; words: string } {
  const v = value ?? 0;
  const words =
    unit === "kcal"
      ? `${Math.round(v).toLocaleString("en-US")} of ${target.toLocaleString("en-US")} kcal`
      : `${Math.round(v).toLocaleString("en-US")} of ${target.toLocaleString("en-US")} g`;
  return { share: Math.max(0, Math.min(1, v / target)), words };
}

/* -- inputs -------------------------------------------------------------- */

/** How far back a day may be logged or changed: last week, and a bit. */
export const LOG_BACK_DAYS = 14;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const meal = z.enum(MEALS);
const amount = z.number().positive().max(100_000);

export const logFoodSchema = z.object({
  /** The phone's id, so an Add sent twice is one row. */
  id: z.string().uuid(),
  day,
  meal,
  fdcId: z.number().int().positive(),
  amount,
  portion: z.string().trim().min(1).max(120),
  /** The planned meal this is (D2: Change first, from Today), logged once. */
  planId: z.string().uuid().optional(),
});
export type LogFoodInput = z.infer<typeof logFoodSchema>;

export const logRecipeSchema = z.object({
  id: z.string().uuid(),
  day,
  meal,
  recipeId: z.string().uuid(),
  servings: amount,
  planId: z.string().uuid().optional(),
});
export type LogRecipeInput = z.infer<typeof logRecipeSchema>;

/** A plate read from a photo, after the person checked it: each item a food on the list. */
export const logPlateSchema = z.object({
  day,
  meal,
  items: z
    .array(z.object({ id: z.string().uuid(), fdcId: z.number().int().positive(), amount, portion: z.string().trim().min(1).max(120) }))
    .min(1)
    .max(20),
});
export type LogPlateInput = z.infer<typeof logPlateSchema>;

export const changeEatenSchema = z.object({
  id: z.string().uuid(),
  meal,
  amount,
  /** For a food: the portion the amount is in. A recipe's stays "serving". */
  portion: z.string().trim().min(1).max(120).optional(),
});
export type ChangeEatenInput = z.infer<typeof changeEatenSchema>;

export const targetsSchema = z.object({
  calories: z.number().int().min(500).max(10_000).nullable(),
  proteinG: z.number().int().min(10).max(500).nullable(),
});
export type TargetsInput = z.infer<typeof targetsSchema>;

/** A typed whole number, or null when it is not one. */
export function typedWhole(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isInteger(value) ? value : null;
}

/** A typed amount: positive, at most two decimals kept; null when it is not one. */
export function typedAmount(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 && value <= 100_000 ? Math.round(value * 100) / 100 : null;
}
