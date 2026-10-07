import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import type { Tenant } from "../src/db/schema";
import type { TenantContext } from "../src/lib/auth";
import { emptyRecipe } from "../src/modules/food/core/recipe";
import { logRecipe, recipeHit, searchRecipes, usdaByName } from "../src/modules/food/eating-ops";
import { perServingOf } from "../src/modules/food/core/nutrition";
import { pastWithoutNumbers, saveWorked, workOut } from "../src/modules/food/nutrition-ops";
import { planBetween, planCook } from "../src/modules/food/plan-ops";
import { insertRecipe, listRecipes } from "../src/modules/food/recipe-ops";

/**
 * A recipe's nutrition worked out, against a real database (docs/modules/food.md,
 * D4, ADR 0131): the lines matched on USDA's ingredient list (the seed's) with
 * a stand-in for Claude, weighed by the line, by USDA's portions or by the
 * estimate; what is kept worked out again on the server, for the whole
 * recipe, a serving following what it makes; the recipe's own
 * numbers first wherever a recipe is counted (search, a new log, the week);
 * past logs given the numbers they lacked and no other; a recipe edited
 * meanwhile refused. The clock is fixed: noon in New York on 7 Oct 2026.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `food-nutrition-${process.pid}`;
const NOW = new Date("2026-10-07T16:00:00Z");
const TODAY = "2026-10-07";

let tenant: Tenant;
let ctx: TenantContext;

function inTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(tenant.id, fn, { role: "owner" });
}

const LINES = ["2 lb ground turkey", "2 yellow onions, diced", "4 cloves garlic, minced", "Salt and pepper to taste"];

async function chili(nutrition: { calories?: number; proteinG?: number } | null = null): Promise<string> {
  return inTenant((tx) =>
    insertRecipe(
      tx,
      ctx,
      {
        ...emptyRecipe(),
        title: "Turkey chili",
        yieldAmount: 4,
        yieldUnit: "servings",
        ingredients: [{ text: "For the chili", heading: true }, ...LINES.map((text) => ({ text }))],
        nutrition,
      },
      null,
    ),
  );
}

/** A stand-in for Claude: USDA's words for each line, an estimate for one, and salt left out. */
const model = async () => ({
  items: [
    { line: 1, search: "turkey ground raw", grams: 900, count: true },
    { line: 2, search: "onions raw", grams: null, count: true },
    { line: 3, search: "garlic raw", grams: null, count: true },
    { line: 4, search: "salt table", grams: null, count: false },
  ],
});

d("food: a recipe's nutrition, worked out (db)", () => {
  beforeAll(async () => {
    tenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Personal",
          slug: `${STAMP}-slug`,
          kind: "personal",
          personalOwnerClerkUserId: `user_foodnutrition${process.pid}`,
          timezone: "America/New_York",
        })
        .returning();
      return row;
    });
    ctx = { tenant, userId: `user_foodnutrition${process.pid}`, role: "owner", support: null };
  });

  afterAll(async () => {
    if (tenant) await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)));
  });

  beforeEach(async () => {
    if (!tenant) return;
    await withSystem(async (tx) => {
      await tx.delete(schema.foodEaten).where(eq(schema.foodEaten.tenantId, tenant.id));
      await tx.delete(schema.foodPlan).where(eq(schema.foodPlan.tenantId, tenant.id));
      await tx.delete(schema.foodRecipes).where(eq(schema.foodRecipes.tenantId, tenant.id));
    });
  });

  it("matches each line on the ingredient list and weighs it by the line, USDA's portions or nothing", async () => {
    const id = await chili();
    const { lines } = await workOut(ctx, id, { model });
    expect(lines.map((l) => [l.line, l.food?.name ?? null, l.grams === null ? null : Math.round(l.grams), l.source, l.counted])).toEqual([
      // USDA's own spelling.
      ["2 lb ground turkey", "Turkey, Ground, raw", 907, "line", true],
      ["2 yellow onions, diced", "Onions, raw", 220, "list", true],
      ["4 cloves garlic, minced", "Garlic, raw", 12, "list", true],
      ["Salt and pepper to taste", "Salt, table", null, "none", false],
    ]);
  });

  it("matches by USDA's own name first, its notes in brackets aside, else the closest name", async () => {
    const id = await inTenant((tx) =>
      insertRecipe(
        tx,
        ctx,
        {
          ...emptyRecipe(),
          title: "Oat bake",
          yieldAmount: 4,
          yieldUnit: "servings",
          ingredients: ["1 lb ground beef", "1 tsp ground cumin", "1 cup shredded cheddar", "1/2 cup rolled oats"].map((text) => ({ text })),
        },
        null,
      ),
    );
    // Words that find the wrong food on their own (the drive's "rolled oats" found a branded oat bran): the name decides.
    const named = async () => ({
      items: [
        { line: 1, name: "Beef, ground, 85% lean meat / 15% fat, raw", search: "beef ground", grams: null, count: true },
        { line: 2, name: "Spices, cumin seed, ground", search: "cumin ground", grams: null, count: true },
        { line: 3, name: "Cheese, cheddar", search: "cheddar", grams: null, count: true },
        { line: 4, name: "Cereals, oats, regular and quick, not fortified, dry", search: "oats rolled dry", grams: null, count: true },
      ],
    });
    // The exact lookup on its own: the list's notes in brackets are not part of the name.
    expect((await inTenant((tx) => usdaByName(tx, "food_usda_ingredients", "cheese, cheddar")))?.name).toBe(
      "Cheese, cheddar (Includes foods for USDA's Food Distribution Program)",
    );
    expect(await inTenant((tx) => usdaByName(tx, "food_usda_ingredients", "cheese, cheddar, invented"))).toBeNull();
    const { lines } = await workOut(ctx, id, { model: named });
    expect(lines.map((l) => l.food?.name ?? null)).toEqual([
      "Beef, ground, 85% lean meat / 15% fat, raw (Includes foods for USDA's Food Distribution Program)",
      "Spices, cumin seed",
      "Cheese, cheddar (Includes foods for USDA's Food Distribution Program)",
      "Cereals, oats, regular and quick, not fortified, dry",
    ]);
  });

  it("says so when Claude cannot be reached, or the recipe has no lines", async () => {
    const id = await chili();
    await expect(
      workOut(ctx, id, {
        model: async () => {
          throw new Error("overloaded");
        },
      }),
    ).rejects.toMatchObject({ code: "NUTRITION_FAILED" });
    const empty = await inTenant((tx) => insertRecipe(tx, ctx, { ...emptyRecipe(), title: "Toast" }, null));
    await expect(workOut(ctx, empty, { model })).rejects.toMatchObject({ code: "NUTRITION_EMPTY" });
    await expect(workOut(ctx, randomUUID(), { model })).rejects.toMatchObject({ code: "RECIPE_MISSING" });
  });

  it("keeps what was checked, worked out again on the server, and counts it everywhere a recipe counts", async () => {
    const id = await chili();
    const { lines } = await workOut(ctx, id, { model });
    // The screen's grams for the onion are typed; the numbers are never taken from the screen.
    const checked = lines.map((l) => ({
      line: l.line,
      fdcId: l.food?.fdcId ?? null,
      grams: l.line.startsWith("2 yellow") ? 300 : l.grams,
      source: l.line.startsWith("2 yellow") ? ("typed" as const) : l.source,
      counted: l.counted,
    }));
    const { filled } = await saveWorked(ctx, { recipeId: id, lines: checked, fillPast: false }, NOW);
    expect(filled).toBe(0);

    const [row] = await withSystem((tx) =>
      tx.select({ worked: schema.foodRecipes.workedNutrition }).from(schema.foodRecipes).where(eq(schema.foodRecipes.id, id)),
    );
    const worked = row.worked;
    expect(worked?.lines.find((l) => l.line.startsWith("2 yellow"))).toMatchObject({ grams: 300, source: "typed", food: "Onions, raw" });
    // The whole pot: 2 lb of turkey and the onions.
    expect(worked?.whole.calories).toBeGreaterThan(1200);
    expect(worked?.whole.proteinG).toBeGreaterThan(160);

    const calories = perServingOf(worked!.whole, 4).calories as number;
    expect((await inTenant((tx) => recipeHit(tx, tenant.id, id)))?.perServing?.calories).toBe(calories);
    expect((await inTenant((tx) => searchRecipes(tx, tenant.id, "chili")))[0].perServing?.calories).toBe(calories);
    // The recipe card on Recipes shows the same serving (ADR 0132).
    expect((await inTenant((tx) => listRecipes(tx, tenant.id))).find((r) => r.id === id)?.perServing?.calories).toBe(calories);
    const eatenId = randomUUID();
    await inTenant((tx) => logRecipe(tx, ctx, { id: eatenId, day: TODAY, meal: "dinner", recipeId: id, servings: 2 }, NOW));
    const [eaten] = await withSystem((tx) => tx.select({ calories: schema.foodEaten.calories }).from(schema.foodEaten).where(eq(schema.foodEaten.id, eatenId)));
    expect(eaten.calories).toBe(calories * 2);
    await inTenant((tx) => planCook(tx, ctx, { id: randomUUID(), day: TODAY, meal: "dinner", recipeId: id, make: 4, eat: 1, leftovers: [] }, NOW));
    expect((await inTenant((tx) => planBetween(tx, tenant.id, TODAY, TODAY)))[0].perServing?.calories).toBe(calories);
  });

  it("divides by what the recipe makes now, so changing it leaves nothing out of date", async () => {
    const id = await chili();
    const { lines } = await workOut(ctx, id, { model });
    await saveWorked(
      ctx,
      { recipeId: id, lines: lines.map((l) => ({ line: l.line, fdcId: l.food?.fdcId ?? null, grams: l.grams, source: l.source, counted: l.counted })), fillPast: false },
      NOW,
    );
    const four = (await inTenant((tx) => recipeHit(tx, tenant.id, id)))?.perServing?.calories as number;
    await inTenant((tx) => tx.update(schema.foodRecipes).set({ yieldAmount: 8 }).where(eq(schema.foodRecipes.id, id)));
    const eight = (await inTenant((tx) => recipeHit(tx, tenant.id, id)))?.perServing?.calories as number;
    expect(Math.abs(eight * 2 - four)).toBeLessThanOrEqual(1);
  });

  it("puts the recipe's own numbers first, and works out only what it does not state", async () => {
    const id = await chili({ calories: 520, proteinG: 44 });
    const { lines } = await workOut(ctx, id, { model });
    await saveWorked(
      ctx,
      { recipeId: id, lines: lines.map((l) => ({ line: l.line, fdcId: l.food?.fdcId ?? null, grams: l.grams, source: l.source, counted: l.counted })), fillPast: false },
      NOW,
    );
    const hit = await inTenant((tx) => recipeHit(tx, tenant.id, id));
    expect(hit?.perServing?.calories).toBe(520);
    expect(hit?.perServing?.proteinG).toBe(44);
    expect(hit?.perServing?.fatG).toBeGreaterThan(0);
    const card = (await inTenant((tx) => listRecipes(tx, tenant.id))).find((r) => r.id === id);
    expect(card?.perServing).toEqual({ calories: 520, proteinG: 44 });
  });

  it("fills in what past logs lacked, and never a number already logged", async () => {
    const id = await chili({ calories: 520 });
    const without = randomUUID();
    const yesterday = randomUUID();
    await inTenant((tx) => logRecipe(tx, ctx, { id: without, day: TODAY, meal: "dinner", recipeId: id, servings: 2 }, NOW));
    await inTenant((tx) => logRecipe(tx, ctx, { id: yesterday, day: "2026-10-06", meal: "lunch", recipeId: id, servings: 1 }, NOW));
    expect(await inTenant((tx) => pastWithoutNumbers(tx, tenant.id, id))).toBe(2);

    const { lines } = await workOut(ctx, id, { model });
    const { filled } = await saveWorked(
      ctx,
      { recipeId: id, lines: lines.map((l) => ({ line: l.line, fdcId: l.food?.fdcId ?? null, grams: l.grams, source: l.source, counted: l.counted })), fillPast: true },
      NOW,
    );
    expect(filled).toBe(2);
    const rows = await withSystem((tx) =>
      tx
        .select({ id: schema.foodEaten.id, calories: schema.foodEaten.calories, proteinG: schema.foodEaten.proteinG })
        .from(schema.foodEaten)
        .where(and(eq(schema.foodEaten.tenantId, tenant.id), eq(schema.foodEaten.recipeId, id))),
    );
    const today = rows.find((r) => r.id === without);
    // Calories were logged from the recipe's own number and stay; protein was missing and is filled.
    expect(today?.calories).toBe(1040);
    expect(today?.proteinG).toBeGreaterThan(80);
    expect(rows.find((r) => r.id === yesterday)?.calories).toBe(520);
    expect(await inTenant((tx) => pastWithoutNumbers(tx, tenant.id, id))).toBe(0);
  });

  it("refuses a line the recipe no longer has", async () => {
    const id = await chili();
    await expect(
      saveWorked(
        ctx,
        { recipeId: id, lines: [{ line: "1 cup sugar", fdcId: null, grams: 200, source: "typed", counted: false }], fillPast: false },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "NUTRITION_CHANGED" });
  });
});
