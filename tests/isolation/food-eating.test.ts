import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * FOOD'S EATING LOG (D4a, docs/modules/food.md): `food_eaten` and
 * `food_targets` are ordinary tenant tables, and this proves for them what
 * core.test.ts proves for every pair: neither person can read, change or
 * delete the other's rows, nor write one into the other's space, nor point a
 * row of their own at the other's recipe.
 *
 * `food_usda_foods` is the other kind: reference data with no tenant, the same
 * in every space, under the `modules` table's policies. Any member reads it;
 * no member can change it.
 */

const STAMP = `iso-food-eating-${process.pid}`;
const BANANA = 2709224;

let a: string;
let b: string;
const ids = { recipe: "", eaten: randomUUID() };

function eatenRow(tenantId: string, change: object = {}) {
  return {
    id: randomUUID(),
    tenantId,
    eatenOn: "2026-10-03",
    meal: "lunch" as const,
    source: "food" as const,
    fdcId: BANANA,
    name: "Banana, raw",
    amount: 1,
    portion: "1 banana",
    grams: 126,
    calories: 122,
    createdByClerkUserId: "user_planted",
    ...change,
  };
}

d("food eating tables (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-a`,
          name: "Personal",
          slug: `${STAMP}-a`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isofoodeatinga${process.pid}`,
        })
        .returning();
      const [tb] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-b`,
          name: "Personal",
          slug: `${STAMP}-b`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isofoodeatingb${process.pid}`,
        })
        .returning();
      a = ta.id;
      b = tb.id;
      const [recipe] = await tx
        .insert(schema.foodRecipes)
        .values({ tenantId: a, title: "A's soup", createdByClerkUserId: `user_isofoodeatinga${process.pid}` })
        .returning();
      ids.recipe = recipe.id;
      await tx.insert(schema.foodEaten).values({ ...eatenRow(a), id: ids.eaten });
      await tx.insert(schema.foodTargets).values({ tenantId: a, calories: 2_200, proteinG: 150 });
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("A reads its own log and targets", async () => {
    const seen = await withTenant(a, async (tx) => ({
      eaten: await tx.select({ id: schema.foodEaten.id }).from(schema.foodEaten),
      targets: await tx.select({ calories: schema.foodTargets.calories }).from(schema.foodTargets),
    }));
    expect(seen).toEqual({ eaten: [{ id: ids.eaten }], targets: [{ calories: 2_200 }] });
  });

  it("B cannot read A's log or targets, even by id", async () => {
    const seen = await withTenant(b, async (tx) => [
      ...(await tx.select().from(schema.foodEaten).where(eq(schema.foodEaten.id, ids.eaten))),
      ...(await tx.select().from(schema.foodTargets).where(eq(schema.foodTargets.tenantId, a))),
    ]);
    expect(seen).toHaveLength(0);
  });

  it("B cannot change or delete A's rows", async () => {
    const changed = await withTenant(b, async (tx) => [
      ...(await tx.update(schema.foodEaten).set({ amount: 9 }).where(eq(schema.foodEaten.id, ids.eaten)).returning()),
      ...(await tx.update(schema.foodTargets).set({ calories: 9_000 }).where(eq(schema.foodTargets.tenantId, a)).returning()),
      ...(await tx.delete(schema.foodEaten).where(eq(schema.foodEaten.id, ids.eaten)).returning()),
      ...(await tx.delete(schema.foodTargets).where(eq(schema.foodTargets.tenantId, a)).returning()),
    ]);
    expect(changed).toHaveLength(0);
    const kept = await withSystem(async (tx) => ({
      eaten: await tx.select({ amount: schema.foodEaten.amount }).from(schema.foodEaten).where(eq(schema.foodEaten.id, ids.eaten)),
      targets: await tx.select({ calories: schema.foodTargets.calories }).from(schema.foodTargets).where(eq(schema.foodTargets.tenantId, a)),
    }));
    expect(kept).toEqual({ eaten: [{ amount: 1 }], targets: [{ calories: 2_200 }] });
  });

  it("B cannot write a row into A's space", async () => {
    await expect(withTenant(b, (tx) => tx.insert(schema.foodEaten).values(eatenRow(a)))).rejects.toThrow();
    await expect(
      withTenant(b, (tx) => tx.insert(schema.foodTargets).values({ tenantId: a, calories: 1_000, proteinG: null })),
    ).rejects.toThrow();
  });

  it("B's log cannot point at A's recipe", async () => {
    // B's own row, aimed at A's recipe: the composite key refuses it.
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.foodEaten).values(
          eatenRow(b, { source: "recipe", fdcId: null, recipeId: ids.recipe, name: "Taken soup", portion: "serving", grams: null }),
        ),
      ),
    ).rejects.toThrow();
  });

  it("an id from A's log is refused in B's, and A's row stands", async () => {
    await expect(withTenant(b, (tx) => tx.insert(schema.foodEaten).values({ ...eatenRow(b), id: ids.eaten }))).rejects.toThrow();
    const inserted = await withTenant(b, (tx) =>
      tx.insert(schema.foodEaten).values({ ...eatenRow(b), id: ids.eaten }).onConflictDoNothing({ target: schema.foodEaten.id }).returning(),
    );
    expect(inserted).toEqual([]);
    const [kept] = await withSystem((tx) =>
      tx.select({ tenantId: schema.foodEaten.tenantId }).from(schema.foodEaten).where(eq(schema.foodEaten.id, ids.eaten)),
    );
    expect(kept).toEqual({ tenantId: a });
  });

  it("the food list is the same for every member, and no member can change it", async () => {
    const [{ n }] = await withTenant(b, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(schema.foodUsdaFoods));
    expect(n).toBeGreaterThan(5_000);
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.foodUsdaFoods).values({
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
      ...(await tx.update(schema.foodUsdaFoods).set({ calories: 1 }).where(eq(schema.foodUsdaFoods.fdcId, BANANA)).returning()),
      ...(await tx.delete(schema.foodUsdaFoods).where(eq(schema.foodUsdaFoods.fdcId, BANANA)).returning()),
    ]);
    expect(changed).toHaveLength(0);
  });

  it("with no tenant at all, no one's log or targets are visible", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", async (tx) => [
      ...(await tx.select().from(schema.foodEaten)),
      ...(await tx.select().from(schema.foodTargets)),
    ]);
    expect(seen).toHaveLength(0);
  });
});
