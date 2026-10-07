import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * A RECIPE'S NUTRITION, WORKED OUT (D4, docs/modules/food.md, ADR 0131):
 * `food_usda_ingredients` is reference data with no tenant, the same in every
 * space, under the `modules` table's policies, as the food list is: any member
 * reads it, no member can change it. A recipe's worked-out numbers live on
 * the recipe's own row, so the other space can neither read nor write them.
 */

const STAMP = `iso-food-nutrition-${process.pid}`;
/** "Garlic, raw" in SR Legacy. */
const GARLIC = 169230;

let a: string;
let b: string;
let recipeA = "";

d("food ingredient list and worked-out nutrition (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-a`, name: "Personal", slug: `${STAMP}-a`, kind: "personal", personalOwnerClerkUserId: `user_isofoodnutritiona${process.pid}` })
        .returning();
      const [tb] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-b`, name: "Personal", slug: `${STAMP}-b`, kind: "personal", personalOwnerClerkUserId: `user_isofoodnutritionb${process.pid}` })
        .returning();
      a = ta.id;
      b = tb.id;
      const [recipe] = await tx
        .insert(schema.foodRecipes)
        .values({
          tenantId: a,
          title: "A's soup",
          createdByClerkUserId: `user_isofoodnutritiona${process.pid}`,
          workedNutrition: { whole: { calories: 1200 }, lines: [], workedAt: "2026-10-03T00:00:00Z" },
        })
        .returning();
      recipeA = recipe.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("the ingredient list is the same for every member", async () => {
    const [{ n }] = await withTenant(b, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(schema.foodUsdaIngredients));
    expect(n).toBeGreaterThan(7_000);
    const [garlic] = await withTenant(a, (tx) =>
      tx.select({ name: schema.foodUsdaIngredients.name }).from(schema.foodUsdaIngredients).where(eq(schema.foodUsdaIngredients.fdcId, GARLIC)),
    );
    expect(garlic).toEqual({ name: "Garlic, raw" });
  });

  it("no member can change the ingredient list", async () => {
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.foodUsdaIngredients).values({
          fdcId: 1,
          name: "Planted food",
          category: "Planted",
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
          fiberG: 0,
          sugarG: 0,
          sodiumMg: 0,
          portions: [],
          release: "planted",
        }),
      ),
    ).rejects.toThrow();
    const changed = await withTenant(b, async (tx) => [
      ...(await tx.update(schema.foodUsdaIngredients).set({ calories: 1 }).where(eq(schema.foodUsdaIngredients.fdcId, GARLIC)).returning()),
      ...(await tx.delete(schema.foodUsdaIngredients).where(eq(schema.foodUsdaIngredients.fdcId, GARLIC)).returning()),
    ]);
    expect(changed).toHaveLength(0);
  });

  it("B can neither read nor change A's worked-out numbers", async () => {
    const seen = await withTenant(b, (tx) =>
      tx.select({ worked: schema.foodRecipes.workedNutrition }).from(schema.foodRecipes).where(eq(schema.foodRecipes.id, recipeA)),
    );
    expect(seen).toHaveLength(0);
    const changed = await withTenant(b, (tx) =>
      tx.update(schema.foodRecipes).set({ workedNutrition: null }).where(eq(schema.foodRecipes.id, recipeA)).returning(),
    );
    expect(changed).toHaveLength(0);
    const [kept] = await withSystem((tx) =>
      tx.select({ worked: schema.foodRecipes.workedNutrition }).from(schema.foodRecipes).where(eq(schema.foodRecipes.id, recipeA)),
    );
    expect(kept.worked?.whole.calories).toBe(1200);
  });

  it("with no tenant at all, no one's recipes are visible", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", (tx) => tx.select().from(schema.foodRecipes));
    expect(seen).toHaveLength(0);
  });
});
