import { z } from "zod";
import type { FoodLine, FoodNutrition } from "@/db/schema/food";

/**
 * A RECIPE AS IT IS SAVED (D1, docs/modules/food.md): what the editor sends,
 * what a draft is read back through, and what `saveRecipe` writes. Pure and
 * server-free, so the editor and the tests use the same rules.
 */

export const RECIPE_LIMITS = {
  title: 200,
  yieldAmount: 10_000,
  yieldUnit: 40,
  /** A week: a brine, a sourdough, a cure. */
  minutes: 10_080,
  tags: 12,
  tag: 40,
  ingredients: 150,
  ingredient: 500,
  steps: 100,
  step: 3_000,
  notes: 10_000,
  url: 2_048,
} as const;

/** The nutrition a recipe can state per serving, in the order the page shows it. */
export const NUTRITION_KEYS = ["calories", "proteinG", "carbsG", "fatG", "fiberG", "sugarG", "sodiumMg"] as const;
export type NutritionKey = (typeof NUTRITION_KEYS)[number];

export const NUTRITION_LABELS: Record<NutritionKey, { label: string; unit: string; max: number }> = {
  calories: { label: "Calories", unit: "kcal", max: 20_000 },
  proteinG: { label: "Protein", unit: "g", max: 2_000 },
  carbsG: { label: "Carbs", unit: "g", max: 2_000 },
  fatG: { label: "Fat", unit: "g", max: 2_000 },
  fiberG: { label: "Fiber", unit: "g", max: 2_000 },
  sugarG: { label: "Sugar", unit: "g", max: 2_000 },
  sodiumMg: { label: "Sodium", unit: "mg", max: 100_000 },
};

function line(max: number) {
  return z
    .object({ text: z.string().trim().min(1).max(max), heading: z.boolean().optional() })
    .transform((value): FoodLine => (value.heading ? { text: value.text, heading: true } : { text: value.text }));
}

const minutes = z.number().int().min(0).max(RECIPE_LIMITS.minutes);

/** A web address the app may link to: http or https, nothing else. */
export function isWebUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const nutritionSchema = z
  .object(
    Object.fromEntries(
      NUTRITION_KEYS.map((key) => [key, z.number().min(0).max(NUTRITION_LABELS[key].max).optional()]),
    ) as Record<NutritionKey, z.ZodOptional<z.ZodNumber>>,
  )
  .strict()
  .transform((value): FoodNutrition | null => {
    const kept = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
    return Object.keys(kept).length > 0 ? (kept as FoodNutrition) : null;
  });

export const recipeInputSchema = z.object({
  title: z.string().trim().min(1).max(RECIPE_LIMITS.title),
  yieldAmount: z.number().positive().max(RECIPE_LIMITS.yieldAmount).nullable(),
  yieldUnit: z.string().trim().min(1).max(RECIPE_LIMITS.yieldUnit).nullable(),
  prepMinutes: minutes.nullable(),
  cookMinutes: minutes.nullable(),
  totalMinutes: minutes.nullable(),
  tags: z.array(z.string().trim().min(1).max(RECIPE_LIMITS.tag)).max(RECIPE_LIMITS.tags),
  ingredients: z.array(line(RECIPE_LIMITS.ingredient)).max(RECIPE_LIMITS.ingredients),
  steps: z.array(line(RECIPE_LIMITS.step)).max(RECIPE_LIMITS.steps),
  notes: z.string().trim().min(1).max(RECIPE_LIMITS.notes).nullable(),
  nutrition: nutritionSchema.nullable(),
  sourceUrl: z.string().trim().max(RECIPE_LIMITS.url).refine(isWebUrl).nullable(),
});

export type RecipeInput = z.output<typeof recipeInputSchema>;

export function emptyRecipe(): RecipeInput {
  return {
    title: "",
    yieldAmount: null,
    yieldUnit: null,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    tags: [],
    ingredients: [],
    steps: [],
    notes: null,
    nutrition: null,
    sourceUrl: null,
  };
}

/**
 * An ingredient line as kept: the bullet or tick box a copied page put in
 * front of it gone, and its spaces tidied. Nothing else is changed.
 */
export function cleanIngredient(text: string): string {
  return text
    .replace(/[   ]/g, " ")
    .replace(/^\s*(?:[-–—•·*▪▢□☐◦‣⁃]\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A step as kept: its number gone ("1.", "2)", "Step 3:"), since the page numbers the steps itself. */
export function cleanStep(text: string): string {
  return cleanIngredient(text)
    .replace(/^(?:step\s*)?\d{1,3}\s*[.):-]\s+/i, "")
    .replace(/^step\s*\d{1,3}\s*$/i, "")
    .trim();
}

/** Tags without repeats, however they were capitalized; the first spelling wins. */
export function uniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/\s+/g, " ").trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** "cooking-site.com" for a link, without its `www.`; null when it is not one. */
export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

/** "35 min", "1 hr 10 min", "2 hr". */
export function minutesWords(total: number): string {
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** The time a recipe takes, as the list shows it: its total, or prep and cook added up. */
export function timeOf(recipe: Pick<RecipeInput, "prepMinutes" | "cookMinutes" | "totalMinutes">): number | null {
  if (recipe.totalMinutes !== null) return recipe.totalMinutes;
  if (recipe.prepMinutes === null && recipe.cookMinutes === null) return null;
  return (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
}

/** Trailing zeros off a number for words: 4, 1.5, 0.25. */
export function plainNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** "4 servings", "1 serving", "24 cookies", "1 loaf". */
export function yieldWords(amount: number, unit: string | null): string {
  const word = unit ?? "servings";
  const lower = word.toLowerCase();
  const one = amount === 1;
  if (lower === "servings" || lower === "serving") return `${plainNumber(amount)} ${one ? "serving" : "servings"}`;
  if (lower === "portions" || lower === "portion") return `${plainNumber(amount)} ${one ? "portion" : "portions"}`;
  return `${plainNumber(amount)} ${word}`;
}
