import "server-only";
import { and, asc, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { FoodPortion } from "@/db/schema";
import type { TenantContext } from "@/lib/auth";
import { addDays, todayInTimezone } from "@/lib/timezone";
import { FoodError } from "./core/errors";
import { effectiveNutrition } from "./core/nutrition";
import {
  LOG_BACK_DAYS,
  MEALS,
  NUTRIENT_KEYS,
  forGrams,
  forServings,
  gramsFor,
  type ChangeEatenInput,
  type LogFoodInput,
  type LogPlateInput,
  type LogRecipeInput,
  type Meal,
  type Nutrients,
  type FoodHit,
  type RecipeHit,
  type TargetsInput,
} from "./core/eating";

export type { FoodHit, RecipeHit };

/**
 * WHAT WAS EATEN, KEPT (D4a, docs/modules/food.md; ADR 0126): the food list's
 * search, the log and its changes, and the daily targets. Every read and write
 * of the person's rows takes the space's own transaction, so RLS decides whose
 * they are; the tenant in each `where` is the second lock. The food list is
 * the same for everyone and read under the `modules` table's policy.
 */

/* -- the food list ------------------------------------------------------- */

/** The words of a search, as the food list's index reads them: letters and digits, six at most. */
export function searchWords(q: string): string[] {
  return (q.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 6).map((w) => w.slice(0, 30));
}

function hitOf(row: Record<string, unknown>): FoodHit {
  return {
    fdcId: Number(row.fdc_id),
    name: String(row.name),
    category: String(row.category),
    per100g: {
      calories: Number(row.calories),
      proteinG: Number(row.protein_g),
      carbsG: Number(row.carbs_g),
      fatG: Number(row.fat_g),
      fiberG: Number(row.fiber_g),
      sugarG: Number(row.sugar_g),
      sodiumMg: Number(row.sodium_mg),
    },
    portions: Array.isArray(row.portions) ? (row.portions as FoodPortion[]) : [],
  };
}

/**
 * Search the food list as a person types: every word a prefix ("chick" finds
 * chicken), and the plain food first. A food with more of the words comes
 * before one with fewer, so a search no food has every word of still finds
 * the nearest ("butter on toast" finds butter, "grilled chicken breast
 * sliced" finds grilled chicken breast: the plate's words, D4a's drive).
 * Among foods with as many words, USDA's naming decides: a name that IS the
 * words before its first comma ("Rice, white, cooked" for "rice") comes first,
 * then one whose second part is them ("Fish, salmon, raw" for "salmon"), then
 * one in a category of that name, then one starting with the first word; the
 * index's rank for every word, then for any word, then a shorter name, break
 * ties. Words are reduced to letters and digits before they are put in the
 * queries or the patterns, so nothing typed can change their shape.
 */
export function searchFoods(tx: Tx, q: string, limit = 20): Promise<FoodHit[]> {
  return searchUsda(tx, "food_usda_foods", q, limit);
}

/**
 * The same search on either of USDA's lists: the eating log's foods as eaten
 * (`food_usda_foods`), or a recipe's ingredients as bought
 * (`food_usda_ingredients`, D4). Both have the same columns and a
 * `search_tsv` made the same way.
 */
export async function searchUsda(
  tx: Tx,
  table: "food_usda_foods" | "food_usda_ingredients",
  q: string,
  limit = 20,
): Promise<FoodHit[]> {
  const words = searchWords(q);
  if (words.length === 0) return [];
  const every = words.map((w) => `${w}:*`).join(" & ");
  const any = words.map((w) => `${w}:*`).join(" | ");
  const phrase = words.join(" ");
  const matched = sql.join(
    words.map((w) => sql`(f.search_tsv @@ to_tsquery('english', ${`${w}:*`}))::int`),
    sql` + `,
  );
  const result = await tx.execute(sql`
    with hits as (
      select f.fdc_id, f.name, f.category, f.calories, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g, f.sugar_g,
             f.sodium_mg, f.portions,
             ${matched} as matched,
             ts_rank_cd(f.search_tsv, to_tsquery('english', ${every})) as rank_every,
             ts_rank_cd(f.search_tsv, to_tsquery('english', ${any})) as rank_any
        from ${sql.identifier(table)} f
       where f.search_tsv @@ to_tsquery('english', ${any})
    )
    select fdc_id, name, category, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, portions
      from hits
     order by matched desc,
              (case when lower(name) = ${phrase} or lower(name) like ${`${phrase},%`} then 8 else 0 end)
            + (case when lower(name) ~ ${`^[^,]+, ${phrase}(,|$)`} then 4 else 0 end)
            + (case when lower(category) in (${phrase}, ${`${phrase}s`}, ${`${phrase}es`}) then 2 else 0 end)
            + (case when lower(name) like ${`${words[0]}%`} then 1 else 0 end) desc,
              rank_every desc,
              rank_any desc,
              length(name) asc
     limit ${Math.max(1, Math.min(limit, 50))}`);
  return ((result.rows ?? []) as Record<string, unknown>[]).map(hitOf);
}

/**
 * The food on either list whose name, without USDA's notes in brackets, is
 * `key` (`foodNameKey`, D4): how a recipe's line is matched when Claude names
 * the food exactly as SR Legacy does. The normalising here and in
 * `foodNameKey` must agree.
 */
export async function usdaByName(tx: Tx, table: "food_usda_foods" | "food_usda_ingredients", key: string): Promise<FoodHit | null> {
  if (key === "") return null;
  // The patterns go as parameters: in the sql template a backslash would be lost.
  const notes = "\\s*\\([^)]*\\)";
  const spaces = "\\s+";
  const result = await tx.execute(sql`
    select fdc_id, name, category, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, portions
      from ${sql.identifier(table)}
     where lower(btrim(regexp_replace(regexp_replace(name, ${notes}, '', 'g'), ${spaces}, ' ', 'g'))) = ${key}
     order by length(name) asc, fdc_id asc
     limit 1`);
  const [row] = (result.rows ?? []) as Record<string, unknown>[];
  return row ? hitOf(row) : null;
}

export async function getFood(tx: Tx, fdcId: number): Promise<FoodHit | null> {
  const t = schema.foodUsdaFoods;
  const [row] = await tx.select().from(t).where(eq(t.fdcId, fdcId)).limit(1);
  if (!row) return null;
  return hitOf({
    fdc_id: row.fdcId,
    name: row.name,
    category: row.category,
    calories: row.calories,
    protein_g: row.proteinG,
    carbs_g: row.carbsG,
    fat_g: row.fatG,
    fiber_g: row.fiberG,
    sugar_g: row.sugarG,
    sodium_mg: row.sodiumMg,
    portions: row.portions,
  });
}

/* -- the person's recipes, for the same search --------------------------- */

/**
 * Recipes whose name has every word in it; with no words, the ones cooked
 * most lately. Each counts with its own numbers first and its worked-out ones
 * for the rest (D4, the founder's call).
 */
export async function searchRecipes(tx: Tx, tenantId: string, q: string, limit = 5): Promise<RecipeHit[]> {
  const t = schema.foodRecipes;
  const words = searchWords(q);
  const lastCooked = sql`(select max(c.made_on) from food_cooks c where c.tenant_id = ${t.tenantId} and c.recipe_id = ${t.id})`;
  const rows = await tx
    .select({
      recipeId: t.id,
      title: t.title,
      own: t.nutrition,
      worked: t.workedNutrition,
      yieldAmount: t.yieldAmount,
      yieldUnit: t.yieldUnit,
    })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), ...words.map((w) => ilike(t.title, `%${w}%`))))
    .orderBy(sql`${lastCooked} desc nulls last`, asc(t.title))
    .limit(limit);
  return rows.map(({ own, worked, ...r }) => ({ ...r, perServing: effectiveNutrition(own, worked, r.yieldAmount) }));
}

/* -- the log ---------------------------------------------------------- */

/** A day a person may log or change: today, as the space counts it, and the two weeks before. */
export function checkDay(day: string, timeZone: string, now: Date): void {
  const today = todayInTimezone(timeZone, now);
  if (day > today || day < addDays(today, -LOG_BACK_DAYS)) throw new FoodError("DAY");
}

function nutrientColumns(n: Nutrients) {
  return {
    calories: n.calories,
    proteinG: n.proteinG,
    carbsG: n.carbsG,
    fatG: n.fatG,
    fiberG: n.fiberG,
    sugarG: n.sugarG,
    sodiumMg: n.sodiumMg,
  };
}

/**
 * A food eaten, with the numbers its grams come to. The id is the phone's and
 * a planned meal (D2) is logged once, so either sent twice is one row: the
 * conflict names no target, which takes both the id and `food_eaten_plan_once_idx`.
 */
export async function insertEatenFood(
  tx: Tx,
  ctx: TenantContext,
  entry: { id: string; day: string; meal: Meal; fdcId: number; amount: number; portion: string; planId?: string | null },
  source: "food" | "photo",
): Promise<void> {
  const food = await getFood(tx, entry.fdcId);
  if (!food) throw new FoodError("FOOD_MISSING");
  const grams = gramsFor(entry.amount, entry.portion, food.portions);
  if (grams === null || grams <= 0) throw new FoodError("PORTION");
  await tx
    .insert(schema.foodEaten)
    .values({
      id: entry.id,
      tenantId: ctx.tenant.id,
      eatenOn: entry.day,
      meal: entry.meal,
      source,
      fdcId: food.fdcId,
      name: food.name,
      amount: entry.amount,
      portion: entry.portion,
      grams,
      ...nutrientColumns(forGrams(food.per100g, grams)),
      planId: entry.planId ?? null,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing();
}

/** A recipe eaten by servings, with the numbers it states per serving (none when it states none). */
export async function insertEatenRecipe(
  tx: Tx,
  ctx: TenantContext,
  entry: { id: string; day: string; meal: Meal; recipeId: string; servings: number; planId?: string | null },
): Promise<void> {
  const t = schema.foodRecipes;
  const [recipe] = await tx
    .select({ title: t.title, own: t.nutrition, worked: t.workedNutrition, yieldAmount: t.yieldAmount })
    .from(t)
    .where(and(eq(t.tenantId, ctx.tenant.id), eq(t.id, entry.recipeId)))
    .limit(1);
  if (!recipe) throw new FoodError("RECIPE_MISSING");
  await tx
    .insert(schema.foodEaten)
    .values({
      id: entry.id,
      tenantId: ctx.tenant.id,
      eatenOn: entry.day,
      meal: entry.meal,
      source: "recipe",
      recipeId: entry.recipeId,
      name: recipe.title,
      amount: entry.servings,
      portion: "serving",
      grams: null,
      ...nutrientColumns(forServings(effectiveNutrition(recipe.own, recipe.worked, recipe.yieldAmount), entry.servings)),
      planId: entry.planId ?? null,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing();
}

/** A planned meal named by Log food (Change first, D2) must still be on the week. */
async function checkPlan(tx: Tx, tenantId: string, planId: string | undefined): Promise<void> {
  if (!planId) return;
  const p = schema.foodPlan;
  const [row] = await tx
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.tenantId, tenantId), eq(p.id, planId)))
    .limit(1);
  if (!row) throw new FoodError("PLAN_MISSING");
}

/** Log a food from the list. Its id is the phone's, so an Add sent twice is one row. */
export async function logFood(tx: Tx, ctx: TenantContext, input: LogFoodInput, now: Date = new Date()): Promise<void> {
  checkDay(input.day, ctx.tenant.timezone, now);
  await checkPlan(tx, ctx.tenant.id, input.planId);
  await insertEatenFood(tx, ctx, input, "food");
}

/** Log a recipe by servings, with the numbers it states per serving (none when it states none). */
export async function logRecipe(tx: Tx, ctx: TenantContext, input: LogRecipeInput, now: Date = new Date()): Promise<void> {
  checkDay(input.day, ctx.tenant.timezone, now);
  await checkPlan(tx, ctx.tenant.id, input.planId);
  await insertEatenRecipe(tx, ctx, input);
}

/** Log a plate the person checked: each item a food on the list, all or none. */
export async function logPlate(tx: Tx, ctx: TenantContext, input: LogPlateInput, now: Date = new Date()): Promise<void> {
  checkDay(input.day, ctx.tenant.timezone, now);
  for (const item of input.items) await insertEatenFood(tx, ctx, { ...item, day: input.day, meal: input.meal }, "photo");
}

export interface EatenRow extends Nutrients {
  id: string;
  eatenOn: string;
  meal: Meal;
  source: "food" | "recipe" | "photo";
  fdcId: number | null;
  recipeId: string | null;
  name: string;
  amount: number;
  portion: string;
  grams: number | null;
  createdAt: Date;
}

const eatenColumns = {
  id: schema.foodEaten.id,
  eatenOn: schema.foodEaten.eatenOn,
  meal: schema.foodEaten.meal,
  source: schema.foodEaten.source,
  fdcId: schema.foodEaten.fdcId,
  recipeId: schema.foodEaten.recipeId,
  name: schema.foodEaten.name,
  amount: schema.foodEaten.amount,
  portion: schema.foodEaten.portion,
  grams: schema.foodEaten.grams,
  calories: schema.foodEaten.calories,
  proteinG: schema.foodEaten.proteinG,
  carbsG: schema.foodEaten.carbsG,
  fatG: schema.foodEaten.fatG,
  fiberG: schema.foodEaten.fiberG,
  sugarG: schema.foodEaten.sugarG,
  sodiumMg: schema.foodEaten.sodiumMg,
  createdAt: schema.foodEaten.createdAt,
};

const mealOrder = sql`array_position(${sql.param([...MEALS])}::text[], ${schema.foodEaten.meal}::text)`;

export interface DayEntry extends EatenRow {
  /** A food's own portions, for changing its amount; null for a recipe, or a food no longer on the list. */
  portions: FoodPortion[] | null;
}

/** A day's log, meal by meal, in the order things were logged. */
export async function dayEaten(tx: Tx, tenantId: string, day: string): Promise<DayEntry[]> {
  const t = schema.foodEaten;
  const f = schema.foodUsdaFoods;
  return tx
    .select({ ...eatenColumns, portions: f.portions })
    .from(t)
    .leftJoin(f, eq(f.fdcId, t.fdcId))
    .where(and(eq(t.tenantId, tenantId), eq(t.eatenOn, day)))
    .orderBy(mealOrder, asc(t.createdAt));
}

/** One of the person's recipes, as the search gives it, for a Log food opened from the recipe. */
export async function recipeHit(tx: Tx, tenantId: string, recipeId: string): Promise<RecipeHit | null> {
  const t = schema.foodRecipes;
  const [row] = await tx
    .select({
      recipeId: t.id,
      title: t.title,
      own: t.nutrition,
      worked: t.workedNutrition,
      yieldAmount: t.yieldAmount,
      yieldUnit: t.yieldUnit,
    })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), eq(t.id, recipeId)))
    .limit(1);
  if (!row) return null;
  const { own, worked, ...hit } = row;
  return { ...hit, perServing: effectiveNutrition(own, worked, hit.yieldAmount) };
}

/** Every row in a run of days, both ends included: what Progress adds up. */
export async function eatenBetween(tx: Tx, tenantId: string, from: string, to: string): Promise<EatenRow[]> {
  const t = schema.foodEaten;
  return tx
    .select(eatenColumns)
    .from(t)
    .where(and(eq(t.tenantId, tenantId), gte(t.eatenOn, from), lte(t.eatenOn, to)))
    .orderBy(asc(t.eatenOn), mealOrder, asc(t.createdAt));
}

/**
 * Change how much, or which meal. The numbers are scaled from the ones kept
 * when it was logged, never read again from the list or the recipe, so the
 * entry keeps meaning what it meant (a recipe edited since, or deleted, does
 * not change it). A food may change its portion to another of its own, or to
 * grams or ounces.
 */
export async function changeEaten(tx: Tx, ctx: TenantContext, input: ChangeEatenInput, now: Date = new Date()): Promise<void> {
  const t = schema.foodEaten;
  const [row] = await tx
    .select(eatenColumns)
    .from(t)
    .where(and(eq(t.tenantId, ctx.tenant.id), eq(t.id, input.id)))
    .limit(1);
  if (!row) throw new FoodError("EATEN_MISSING");
  checkDay(row.eatenOn, ctx.tenant.timezone, now);

  let portion = row.portion;
  let grams = row.grams;
  let scale: number;
  if (row.source === "recipe") {
    scale = input.amount / row.amount;
  } else {
    portion = input.portion ?? row.portion;
    const food = row.fdcId === null ? null : await getFood(tx, row.fdcId);
    grams = gramsFor(input.amount, portion, food?.portions ?? []);
    if (grams === null || grams <= 0 || row.grams === null) throw new FoodError("PORTION");
    scale = grams / row.grams;
  }
  const scaled: Partial<Record<keyof Nutrients, number | null>> = {};
  for (const key of NUTRIENT_KEYS) scaled[key] = row[key] === null ? null : (row[key] as number) * scale;
  await tx
    .update(t)
    .set({ meal: input.meal, amount: input.amount, portion, grams, ...scaled, updatedAt: now })
    .where(and(eq(t.tenantId, ctx.tenant.id), eq(t.id, input.id)));
}

/** Take something off the log. Already gone is fine: the person wanted it gone. */
export async function deleteEaten(tx: Tx, tenantId: string, id: string): Promise<void> {
  const t = schema.foodEaten;
  await tx.delete(t).where(and(eq(t.tenantId, tenantId), eq(t.id, id)));
}

export interface RecentItem {
  /** "f:<fdc id>" or "r:<recipe id>". */
  key: string;
  /** What was last had, to start the amount from. */
  amount: number;
  portion: string;
  food: FoodHit | null;
  recipe: RecipeHit | null;
}

/**
 * What the person logged most lately, one line a food or recipe, with the
 * amount they last had: most days are the same few things, and two taps log
 * one again. A food no longer on the list, or a recipe deleted, is left out.
 */
export async function recentEaten(tx: Tx, tenantId: string, limit = 8): Promise<RecentItem[]> {
  const t = schema.foodEaten;
  const f = schema.foodUsdaFoods;
  const r = schema.foodRecipes;
  const rows = await tx
    .select({
      fdcId: t.fdcId,
      recipeId: r.id,
      amount: t.amount,
      portion: t.portion,
      food: {
        fdcId: f.fdcId,
        name: f.name,
        category: f.category,
        calories: f.calories,
        proteinG: f.proteinG,
        carbsG: f.carbsG,
        fatG: f.fatG,
        fiberG: f.fiberG,
        sugarG: f.sugarG,
        sodiumMg: f.sodiumMg,
        portions: f.portions,
      },
      recipeTitle: r.title,
      recipeNutrition: r.nutrition,
      recipeWorked: r.workedNutrition,
      recipeYieldAmount: r.yieldAmount,
      recipeYieldUnit: r.yieldUnit,
    })
    .from(t)
    .leftJoin(f, eq(f.fdcId, t.fdcId))
    .leftJoin(r, and(eq(r.tenantId, t.tenantId), eq(r.id, t.recipeId)))
    .where(and(eq(t.tenantId, tenantId), sql`(${f.fdcId} is not null or ${r.id} is not null)`))
    .orderBy(desc(t.createdAt))
    .limit(80);
  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const row of rows) {
    const key = row.recipeId ? `r:${row.recipeId}` : `f:${row.fdcId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const food =
      !row.recipeId && row.food?.fdcId != null
        ? {
            fdcId: row.food.fdcId,
            name: row.food.name,
            category: row.food.category,
            per100g: {
              calories: row.food.calories,
              proteinG: row.food.proteinG,
              carbsG: row.food.carbsG,
              fatG: row.food.fatG,
              fiberG: row.food.fiberG,
              sugarG: row.food.sugarG,
              sodiumMg: row.food.sodiumMg,
            },
            portions: row.food.portions,
          }
        : null;
    const recipe = row.recipeId
      ? {
          recipeId: row.recipeId,
          title: row.recipeTitle ?? "",
          perServing: effectiveNutrition(row.recipeNutrition, row.recipeWorked, row.recipeYieldAmount),
          yieldAmount: row.recipeYieldAmount ?? null,
          yieldUnit: row.recipeYieldUnit ?? null,
        }
      : null;
    out.push({ key, amount: row.amount, portion: row.portion, food, recipe });
    if (out.length >= limit) break;
  }
  return out;
}

/* -- targets -------------------------------------------------------------- */

export async function getTargets(tx: Tx, tenantId: string): Promise<TargetsInput> {
  const t = schema.foodTargets;
  const [row] = await tx.select({ calories: t.calories, proteinG: t.proteinG }).from(t).where(eq(t.tenantId, tenantId)).limit(1);
  return row ?? { calories: null, proteinG: null };
}

export async function setTargets(tx: Tx, tenantId: string, input: TargetsInput, now: Date = new Date()): Promise<void> {
  const t = schema.foodTargets;
  await tx
    .insert(t)
    .values({ tenantId, calories: input.calories, proteinG: input.proteinG, updatedAt: now })
    .onConflictDoUpdate({ target: t.tenantId, set: { calories: input.calories, proteinG: input.proteinG, updatedAt: now } });
}
