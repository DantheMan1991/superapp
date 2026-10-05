import "server-only";
import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { FoodNutrition, WorkedNutrition } from "@/db/schema";
import type { TenantContext } from "@/lib/auth";
import { FoodError } from "./core/errors";
import { cleanLine } from "./core/list";
import type { FoodHit } from "./core/eating";
import {
  MATCH_LINES_MAX,
  closestByName,
  effectiveNutrition,
  foodNameKey,
  gramsOf,
  matchPrompt,
  normalizeMatches,
  workedWhole,
  type DraftLine,
  type IngredientFood,
  type LineMatch,
  type SaveWorkedInput,
} from "./core/nutrition";
import { yieldWords } from "./core/recipe";
import { searchUsda, usdaByName } from "./eating-ops";
import { callMatchModel, type MatchModel } from "./nutrition-model";

/**
 * A RECIPE'S NUTRITION, WORKED OUT AND KEPT (D4, docs/modules/food.md, ADR
 * 0131): Claude finds each line's food on USDA's ingredient list and
 * estimates grams where neither the line nor USDA can say; the person checks
 * every line; what is kept is worked out again here, on the server, from the
 * list and the grams they checked, never from numbers the screen sends.
 * Saving can fill in the numbers past logs of the recipe did not have; a
 * number already logged is never changed.
 */

/** The ingredient-list foods with these ids. */
export async function getIngredients(tx: Tx, fdcIds: readonly number[]): Promise<Map<number, IngredientFood>> {
  if (fdcIds.length === 0) return new Map();
  const t = schema.foodUsdaIngredients;
  const rows = await tx.select().from(t).where(inArray(t.fdcId, [...new Set(fdcIds)]));
  return new Map(
    rows.map((row) => [
      row.fdcId,
      {
        fdcId: row.fdcId,
        name: row.name,
        per100g: {
          calories: row.calories,
          proteinG: row.proteinG,
          carbsG: row.carbsG,
          fatG: row.fatG,
          fiberG: row.fiberG,
          sugarG: row.sugarG,
          sodiumMg: row.sodiumMg,
        },
        portions: row.portions,
      },
    ]),
  );
}

interface RecipeForWork {
  title: string;
  yieldAmount: number | null;
  yieldUnit: string | null;
  lines: string[];
  nutrition: FoodNutrition | null;
  worked: WorkedNutrition | null;
}

/** A recipe's ingredient lines (no headings, each as the list reads it), what it makes, and its numbers. */
export async function recipeForWork(tx: Tx, tenantId: string, recipeId: string): Promise<RecipeForWork | null> {
  const r = schema.foodRecipes;
  const [row] = await tx
    .select({
      title: r.title,
      yieldAmount: r.yieldAmount,
      yieldUnit: r.yieldUnit,
      ingredients: r.ingredients,
      nutrition: r.nutrition,
      worked: r.workedNutrition,
    })
    .from(r)
    .where(and(eq(r.tenantId, tenantId), eq(r.id, recipeId)))
    .limit(1);
  if (!row) return null;
  return {
    title: row.title,
    yieldAmount: row.yieldAmount,
    yieldUnit: row.yieldUnit,
    lines: (row.ingredients ?? []).filter((line) => !line.heading).map((line) => cleanLine(line.text)).filter(Boolean),
    nutrition: row.nutrition ?? null,
    worked: row.worked ?? null,
  };
}

const INGREDIENTS = "food_usda_ingredients";

/**
 * The food on the ingredient list a line is matched to: the one named exactly
 * as Claude named it (USDA's notes in brackets aside); else, of the foods
 * found by that name, by Claude's words and by the line's own words, the one
 * whose name is closest to Claude's; with no name, the first found by the
 * words, then by the line. Null when nothing is found.
 */
async function findIngredient(tx: Tx, match: LineMatch | undefined, line: string): Promise<FoodHit | null> {
  const key = match?.name ? foodNameKey(match.name) : "";
  const exact = key ? await usdaByName(tx, INGREDIENTS, key) : null;
  if (exact) return exact;
  const pools = [
    match?.name ? await searchUsda(tx, INGREDIENTS, match.name, 25) : [],
    match?.search ? await searchUsda(tx, INGREDIENTS, match.search, 10) : [],
    await searchUsda(tx, INGREDIENTS, line, 5),
  ];
  const found = new Map<number, FoodHit>();
  for (const pool of pools) for (const hit of pool) if (!found.has(hit.fdcId)) found.set(hit.fdcId, hit);
  const candidates = [...found.values()];
  return match?.name ? closestByName(match.name, candidates) : (candidates[0] ?? null);
}

/** How many times the recipe was logged without one of its four main numbers: what Save can fill in. */
export async function pastWithoutNumbers(tx: Tx, tenantId: string, recipeId: string): Promise<number> {
  const e = schema.foodEaten;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(e)
    .where(
      and(
        eq(e.tenantId, tenantId),
        eq(e.recipeId, recipeId),
        sql`(${e.calories} is null or ${e.proteinG} is null or ${e.carbsG} is null or ${e.fatG} is null)`,
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Work a recipe out, to be checked: one call to Claude for each line's food
 * as USDA names it, search words and estimated grams, outside any
 * transaction (it takes seconds), then each line's food found on the
 * ingredient list (`findIngredient`) and its grams found as `gramsOf` says.
 * Nothing is written.
 */
export async function workOut(
  ctx: TenantContext,
  recipeId: string,
  deps: { model?: MatchModel } = {},
): Promise<{ lines: DraftLine[] }> {
  const recipe = await withTenant(ctx.tenant.id, (tx) => recipeForWork(tx, ctx.tenant.id, recipeId), { role: ctx.role });
  if (!recipe) throw new FoodError("RECIPE_MISSING");
  const lines = recipe.lines.slice(0, MATCH_LINES_MAX);
  if (lines.length === 0) throw new FoodError("NUTRITION_EMPTY");

  const makes = recipe.yieldAmount !== null ? yieldWords(recipe.yieldAmount, recipe.yieldUnit) : "not said";
  let raw: unknown;
  try {
    raw = await (deps.model ?? callMatchModel)(matchPrompt(recipe.title, makes, lines));
  } catch (error) {
    console.error("nutrition matching failed", error instanceof Error ? error.name : "unknown");
    throw new FoodError("NUTRITION_FAILED");
  }
  const matches = normalizeMatches(raw, lines.length);

  const drafts = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const out: DraftLine[] = [];
      for (const [i, line] of lines.entries()) {
        const match = matches.get(i);
        const food = await findIngredient(tx, match, line);
        const estimate = match?.grams ?? null;
        const { grams, source } = gramsOf(line, food, estimate);
        out.push({
          line,
          food: food ? { fdcId: food.fdcId, name: food.name, per100g: food.per100g, portions: food.portions } : null,
          grams,
          source,
          counted: (match?.count ?? true) && food !== null && grams !== null,
          estimate,
        });
      }
      return out;
    },
    { role: ctx.role },
  );
  return { lines: drafts };
}

/**
 * Keep what the person checked: every line must still be one of the recipe's
 * (a recipe edited meanwhile is refused), the whole recipe's numbers worked
 * out here from the list for the grams they checked. With `fillPast`, the
 * recipe's logs get the numbers they lack, at what a serving counts now (the
 * recipe's own first), times the servings logged; a number already there
 * stays. How many logs were filled in.
 */
export async function saveWorked(ctx: TenantContext, input: SaveWorkedInput, now: Date = new Date()): Promise<{ filled: number }> {
  return withTenant(
    ctx.tenant.id,
    async (tx) => {
      const recipe = await recipeForWork(tx, ctx.tenant.id, input.recipeId);
      if (!recipe) throw new FoodError("RECIPE_MISSING");
      const current = new Set(recipe.lines);
      if (input.lines.some((line) => !current.has(cleanLine(line.line)))) throw new FoodError("NUTRITION_CHANGED");

      const foods = await getIngredients(
        tx,
        input.lines.flatMap((line) => (line.fdcId === null ? [] : [line.fdcId])),
      );
      const checked = input.lines.map((line) => {
        const food = line.fdcId === null ? null : (foods.get(line.fdcId) ?? null);
        return { line, food, counted: line.counted && food !== null && line.grams !== null };
      });
      const worked: WorkedNutrition = {
        whole: workedWhole(checked.map((c) => ({ food: c.food, grams: c.line.grams, counted: c.counted }))),
        lines: checked.map(({ line, food, counted }) => ({
          line: cleanLine(line.line),
          fdcId: food?.fdcId ?? null,
          food: food?.name ?? null,
          grams: line.grams,
          source: line.source,
          counted,
        })),
        workedAt: now.toISOString(),
      };
      const r = schema.foodRecipes;
      await tx
        .update(r)
        .set({ workedNutrition: worked })
        .where(and(eq(r.tenantId, ctx.tenant.id), eq(r.id, input.recipeId)));

      if (!input.fillPast) return { filled: 0 };
      const counts = effectiveNutrition(recipe.nutrition, worked, recipe.yieldAmount) ?? {};
      const e = schema.foodEaten;
      const fill = (column: SQLWrapper, value: number | undefined) =>
        sql`coalesce(${column}, ${value ?? null}::double precision * ${e.amount})`;
      const filled = await tx
        .update(e)
        .set({
          calories: fill(e.calories, counts.calories),
          proteinG: fill(e.proteinG, counts.proteinG),
          carbsG: fill(e.carbsG, counts.carbsG),
          fatG: fill(e.fatG, counts.fatG),
          fiberG: fill(e.fiberG, counts.fiberG),
          sugarG: fill(e.sugarG, counts.sugarG),
          sodiumMg: fill(e.sodiumMg, counts.sodiumMg),
          updatedAt: now,
        })
        .where(
          and(
            eq(e.tenantId, ctx.tenant.id),
            eq(e.recipeId, input.recipeId),
            sql`(${e.calories} is null or ${e.proteinG} is null or ${e.carbsG} is null or ${e.fatG} is null)`,
          ),
        )
        .returning({ id: e.id });
      return { filled: filled.length };
    },
    { role: ctx.role },
  );
}
