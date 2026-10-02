import type { FoodLine } from "@/db/schema/food";
import {
  NUTRITION_KEYS,
  NUTRITION_LABELS,
  RECIPE_LIMITS,
  cleanIngredient,
  cleanStep,
  isWebUrl,
  plainNumber,
  uniqueTags,
  type NutritionKey,
  type RecipeInput,
} from "./recipe";

/**
 * THE EDITOR'S FORM (docs/help/food/editor.md): a recipe as text boxes, and
 * back again with the sentence for each thing that is wrong. Pure, so every
 * message the guide lists is proven in tests/food-core.test.ts.
 *
 * Ingredients and steps are one box each, a line per entry, because a phone
 * types and pastes lines faster than it fills rows. A line that ends with a
 * colon ("For the sauce:") starts a group.
 */

export interface EditorRecipe {
  title: string;
  yieldAmount: string;
  yieldUnit: string;
  prep: string;
  cook: string;
  total: string;
  tags: string[];
  ingredients: string;
  steps: string;
  notes: string;
  nutrition: Record<NutritionKey, string>;
  sourceUrl: string;
}

const number = (value: number | null | undefined): string => (value === null || value === undefined ? "" : plainNumber(value));

/** Lines as the box shows them: a heading ends with a colon. */
export function textOfLines(lines: readonly FoodLine[]): string {
  return lines.map((line) => (line.heading ? `${line.text.replace(/:$/, "")}:` : line.text)).join("\n");
}

/**
 * The box's lines, cleaned: empty lines dropped, a line ending with a colon a
 * heading, an ingredient's bullet and a step's number taken off.
 */
export function linesOfText(text: string, kind: "ingredient" | "step"): FoodLine[] {
  const out: FoodLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const clean = kind === "ingredient" ? cleanIngredient(raw) : cleanStep(raw);
    if (!clean) continue;
    if (clean.endsWith(":") && clean.length > 1) {
      out.push({ text: clean.slice(0, -1).trim(), heading: true });
    } else {
      out.push({ text: clean });
    }
  }
  return out.filter((line) => line.text.length > 0);
}

export function toEditor(recipe: RecipeInput): EditorRecipe {
  return {
    title: recipe.title,
    yieldAmount: number(recipe.yieldAmount),
    yieldUnit: recipe.yieldUnit ?? (recipe.yieldAmount === null ? "" : "servings"),
    prep: number(recipe.prepMinutes),
    cook: number(recipe.cookMinutes),
    total: number(recipe.totalMinutes),
    tags: [...recipe.tags],
    ingredients: textOfLines(recipe.ingredients),
    steps: textOfLines(recipe.steps),
    notes: recipe.notes ?? "",
    nutrition: Object.fromEntries(
      NUTRITION_KEYS.map((key) => [key, number(recipe.nutrition?.[key])]),
    ) as Record<NutritionKey, string>,
    sourceUrl: recipe.sourceUrl ?? "",
  };
}

/** A number typed in a box: "4", "1.5", "1,5", "½". Null when the box is empty, NaN when it is not a number. */
export function readNumber(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (value === "") return null;
  const vulgar: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  if (vulgar[value] !== undefined) return vulgar[value];
  return /^\d*\.?\d+$/.test(value) ? Number(value) : Number.NaN;
}

export type EditorOutcome = { ok: true; recipe: RecipeInput } | { ok: false; problems: string[] };

/** The form back to a recipe, or every problem with it, in the order of the form. */
export function fromEditor(form: EditorRecipe): EditorOutcome {
  const problems: string[] = [];
  const title = form.title.replace(/\s+/g, " ").trim();
  if (!title) problems.push("Give the recipe a name.");
  else if (title.length > RECIPE_LIMITS.title) problems.push(`Keep the name under ${RECIPE_LIMITS.title} characters.`);

  const yieldAmount = readNumber(form.yieldAmount);
  const yieldUnit = form.yieldUnit.replace(/\s+/g, " ").trim();
  if (yieldAmount !== null && !(yieldAmount > 0 && yieldAmount <= RECIPE_LIMITS.yieldAmount)) {
    problems.push("Write how many it makes as a number, like 4.");
  } else if (yieldAmount === null && yieldUnit) {
    problems.push("Write how many it makes, like 4, or clear the word after it.");
  }
  if (yieldUnit.length > RECIPE_LIMITS.yieldUnit) {
    problems.push(`Keep what it makes under ${RECIPE_LIMITS.yieldUnit} characters, like servings or cookies.`);
  }

  const times: Record<"prep" | "cook" | "total", number | null> = { prep: null, cook: null, total: null };
  for (const key of ["prep", "cook", "total"] as const) {
    const value = readNumber(form[key]);
    if (value !== null && !(Number.isInteger(value) && value >= 0 && value <= RECIPE_LIMITS.minutes)) {
      problems.push(`Write the ${key} time as whole minutes, like 20.`);
    } else {
      times[key] = value;
    }
  }

  const tags = uniqueTags(form.tags);
  if (tags.length > RECIPE_LIMITS.tags) problems.push(`Keep the tags to ${RECIPE_LIMITS.tags} or fewer.`);
  if (tags.some((tag) => tag.length > RECIPE_LIMITS.tag)) {
    problems.push(`Keep each tag under ${RECIPE_LIMITS.tag} characters.`);
  }

  const ingredients = linesOfText(form.ingredients, "ingredient");
  if (ingredients.length > RECIPE_LIMITS.ingredients) {
    problems.push(`A recipe can have up to ${RECIPE_LIMITS.ingredients} ingredient lines.`);
  }
  if (ingredients.some((line) => line.text.length > RECIPE_LIMITS.ingredient)) {
    problems.push(`Keep each ingredient line under ${RECIPE_LIMITS.ingredient} characters.`);
  }
  const steps = linesOfText(form.steps, "step");
  if (steps.length > RECIPE_LIMITS.steps) problems.push(`A recipe can have up to ${RECIPE_LIMITS.steps} steps.`);
  if (steps.some((line) => line.text.length > RECIPE_LIMITS.step)) {
    problems.push(`Keep each step under ${RECIPE_LIMITS.step.toLocaleString("en-US")} characters.`);
  }

  const notes = form.notes.trim();
  if (notes.length > RECIPE_LIMITS.notes) {
    problems.push(`Keep the notes under ${RECIPE_LIMITS.notes.toLocaleString("en-US")} characters.`);
  }

  const nutrition: Partial<Record<NutritionKey, number>> = {};
  for (const key of NUTRITION_KEYS) {
    const value = readNumber(form.nutrition[key]);
    const { label, max } = NUTRITION_LABELS[key];
    if (value === null) continue;
    if (!(value >= 0 && value <= max)) {
      problems.push(`Write ${label.toLowerCase()} as a number, like 12.`);
    } else {
      nutrition[key] = value;
    }
  }

  const sourceUrl = form.sourceUrl.trim();
  if (sourceUrl && (!isWebUrl(sourceUrl) || sourceUrl.length > RECIPE_LIMITS.url)) {
    problems.push("Write the source as a web address that starts with https://.");
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    recipe: {
      title,
      yieldAmount,
      yieldUnit: yieldAmount === null ? null : yieldUnit || "servings",
      prepMinutes: times.prep,
      cookMinutes: times.cook,
      totalMinutes: times.total,
      tags,
      ingredients,
      steps,
      notes: notes || null,
      nutrition: Object.keys(nutrition).length > 0 ? nutrition : null,
      sourceUrl: sourceUrl || null,
    },
  };
}
