import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { FoodRecipe } from "@/db/schema";
import type { TenantContext } from "@/lib/auth";
import { cookCounts } from "./cook-ops";
import { FoodError } from "./core/errors";
import { effectiveNutrition } from "./core/nutrition";
import { photoVersion, recipePhotoUrl } from "./core/photo-url";
import { timeOf, type RecipeInput } from "./core/recipe";
import type { StoredPhoto } from "./photo-ops";

export { recipePhotoUrl };

/**
 * RECIPES: the person's own copies (src/db/schema/food.ts). Saved whole: a
 * recipe is one row, its lines and steps inside it, so a save is one statement
 * and an edit can never leave half a recipe behind.
 */

/** Food's front page: what was eaten today (D4a). */
export const FOOD_HOME = "/personal/m/food";
/** The recipes, their own page since D4a made Today the front. */
export const FOOD_RECIPES = "/personal/m/food/recipes";
/** The week (D2): `?week=` a Monday, this week's without one. */
export const FOOD_WEEK = "/personal/m/food/week";
/** The shopping list (D3). */
export const FOOD_LIST = "/personal/m/food/list";

export function weekHref(monday: string | null): string {
  return monday ? `${FOOD_WEEK}?week=${monday}` : FOOD_WEEK;
}

export function recipeHref(recipeId: string): string {
  return `${FOOD_HOME}/recipes/${recipeId}`;
}

export function draftPhotoUrl(importId: string, pathname: string): string {
  return `${FOOD_HOME}/drafts/${importId}/photo?v=${photoVersion(pathname)}`;
}

/** The two numbers a recipe card shows, or null when the recipe has neither. */
function servingOf(numbers: { calories?: number; proteinG?: number } | null): RecipeSummary["perServing"] {
  if (!numbers || (numbers.calories === undefined && numbers.proteinG === undefined)) return null;
  return { calories: numbers.calories ?? null, proteinG: numbers.proteinG ?? null };
}

/** A recipe as the list shows it, with its lines for the search box. */
export interface RecipeSummary {
  id: string;
  title: string;
  tags: string[];
  yieldAmount: number | null;
  yieldUnit: string | null;
  minutes: number | null;
  photoUrl: string | null;
  /** How many times it was made (cook mode's log, D1b). */
  made: number;
  /** A serving's calories and protein, its own first and worked out for the rest (D4); null when it has neither. */
  perServing: { calories: number | null; proteinG: number | null } | null;
  /** Ingredient lines, lower case, so "chicken" finds a recipe by what is in it. */
  search: string;
}

export async function listRecipes(tx: Tx, tenantId: string): Promise<RecipeSummary[]> {
  const t = schema;
  const rows = await tx
    .select()
    .from(t.foodRecipes)
    .where(eq(t.foodRecipes.tenantId, tenantId))
    .orderBy(asc(sql`lower(${t.foodRecipes.title})`))
    .limit(2_000);
  const made = await cookCounts(tx, tenantId);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    tags: row.tags,
    yieldAmount: row.yieldAmount,
    yieldUnit: row.yieldUnit,
    minutes: timeOf(row),
    photoUrl: row.photoPathname ? recipePhotoUrl(row.id, row.photoPathname) : null,
    made: made.get(row.id) ?? 0,
    perServing: servingOf(effectiveNutrition(row.nutrition, row.workedNutrition, row.yieldAmount)),
    search: [row.title, ...row.tags, ...row.ingredients.map((line) => line.text)].join("\n").toLowerCase(),
  }));
}

export async function loadRecipe(tx: Tx, tenantId: string, recipeId: string): Promise<FoodRecipe | null> {
  const t = schema;
  const [row] = await tx
    .select()
    .from(t.foodRecipes)
    .where(and(eq(t.foodRecipes.tenantId, tenantId), eq(t.foodRecipes.id, recipeId)))
    .limit(1);
  return row ?? null;
}

export function recipeToInput(row: FoodRecipe): RecipeInput {
  return {
    title: row.title,
    yieldAmount: row.yieldAmount,
    yieldUnit: row.yieldUnit,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    totalMinutes: row.totalMinutes,
    tags: row.tags,
    ingredients: row.ingredients,
    steps: row.steps,
    notes: row.notes,
    nutrition: row.nutrition,
    sourceUrl: row.sourceUrl,
  };
}

/** Every tag the person has used, for the editor to suggest. */
export async function knownTags(tx: Tx, tenantId: string): Promise<string[]> {
  const t = schema;
  const rows = await tx
    .selectDistinct({ tag: sql<string>`unnest(${t.foodRecipes.tags})` })
    .from(t.foodRecipes)
    .where(eq(t.foodRecipes.tenantId, tenantId));
  return rows.map((row) => row.tag).sort((a, b) => a.localeCompare(b));
}

function columns(input: RecipeInput) {
  return {
    title: input.title,
    yieldAmount: input.yieldAmount,
    yieldUnit: input.yieldUnit,
    prepMinutes: input.prepMinutes,
    cookMinutes: input.cookMinutes,
    totalMinutes: input.totalMinutes,
    tags: input.tags,
    ingredients: input.ingredients,
    steps: input.steps,
    notes: input.notes,
    nutrition: input.nutrition,
    sourceUrl: input.sourceUrl,
  };
}

function photoColumns(photo: StoredPhoto | null) {
  return {
    photoPathname: photo?.pathname ?? null,
    photoWidth: photo?.width ?? null,
    photoHeight: photo?.height ?? null,
  };
}

export async function insertRecipe(
  tx: Tx,
  ctx: TenantContext,
  input: RecipeInput,
  photo: StoredPhoto | null,
): Promise<string> {
  const t = schema;
  const [row] = await tx
    .insert(t.foodRecipes)
    .values({
      tenantId: ctx.tenant.id,
      ...columns(input),
      ...photoColumns(photo),
      createdByClerkUserId: ctx.userId,
    })
    .returning({ id: t.foodRecipes.id });
  return row.id;
}

/**
 * Save an edit. The photo is kept, replaced or taken off; the one it replaces
 * is returned for the caller to delete from the store once this commits.
 */
export async function updateRecipe(
  tx: Tx,
  tenantId: string,
  recipeId: string,
  input: RecipeInput,
  photo: "keep" | StoredPhoto | null,
): Promise<{ replaced: string | null }> {
  const t = schema;
  const [current] = await tx
    .select({ photoPathname: t.foodRecipes.photoPathname })
    .from(t.foodRecipes)
    .where(and(eq(t.foodRecipes.tenantId, tenantId), eq(t.foodRecipes.id, recipeId)))
    .for("update")
    .limit(1);
  if (!current) throw new FoodError("RECIPE_MISSING");
  await tx
    .update(t.foodRecipes)
    .set({
      ...columns(input),
      ...(photo === "keep" ? {} : photoColumns(photo)),
      updatedAt: new Date(),
    })
    .where(and(eq(t.foodRecipes.tenantId, tenantId), eq(t.foodRecipes.id, recipeId)));
  return { replaced: photo === "keep" ? null : current.photoPathname };
}

/** Delete a recipe; its photo's pathname is returned for the store. */
export async function deleteRecipe(tx: Tx, tenantId: string, recipeId: string): Promise<string | null> {
  const t = schema;
  const [row] = await tx
    .delete(t.foodRecipes)
    .where(and(eq(t.foodRecipes.tenantId, tenantId), eq(t.foodRecipes.id, recipeId)))
    .returning({ photoPathname: t.foodRecipes.photoPathname });
  if (!row) throw new FoodError("RECIPE_MISSING");
  return row.photoPathname;
}
