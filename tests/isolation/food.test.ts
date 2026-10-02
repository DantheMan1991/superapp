import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * FOOD'S TABLES ARE ORDINARY TENANT TABLES (docs/modules/food.md): recipes,
 * the imports a recipe comes in through (D1), and the times one was cooked
 * (D1b).
 *
 * They only ever hold rows in a personal space, but to the database a personal
 * space is a tenant like any other (ADR 0111), so this proves what
 * core.test.ts proves for every pair: neither person can read, change or
 * delete the other's rows, nor write one into the other's space.
 */

const STAMP = `iso-food-${process.pid}`;

let a: string;
let b: string;
const ids = { recipe: "", import: "", cook: "" };

d("food tables (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-a`,
          name: "Personal",
          slug: `${STAMP}-a`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isofooda${process.pid}`,
        })
        .returning();
      const [tb] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-b`,
          name: "Personal",
          slug: `${STAMP}-b`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isofoodb${process.pid}`,
        })
        .returning();
      a = ta.id;
      b = tb.id;
      const [recipe] = await tx
        .insert(schema.foodRecipes)
        .values({
          tenantId: a,
          title: "A's soup",
          ingredients: [{ text: "1 onion" }],
          createdByClerkUserId: `user_isofooda${process.pid}`,
        })
        .returning();
      const [draft] = await tx
        .insert(schema.foodImports)
        .values({
          tenantId: a,
          kind: "link",
          sourceUrl: "https://recipes.example/soup",
          status: "draft",
          draft: { title: "A's draft" },
          createdByClerkUserId: `user_isofooda${process.pid}`,
        })
        .returning();
      const [cook] = await tx
        .insert(schema.foodCooks)
        .values({
          id: crypto.randomUUID(),
          tenantId: a,
          recipeId: recipe.id,
          madeOn: "2026-10-02",
          createdByClerkUserId: `user_isofooda${process.pid}`,
        })
        .returning();
      Object.assign(ids, { recipe: recipe.id, import: draft.id, cook: cook.id });
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("A reads its own recipe, draft and cook", async () => {
    const seen = await withTenant(a, async (tx) => ({
      recipes: await tx.select({ id: schema.foodRecipes.id }).from(schema.foodRecipes),
      imports: await tx.select({ id: schema.foodImports.id }).from(schema.foodImports),
      cooks: await tx.select({ id: schema.foodCooks.id }).from(schema.foodCooks),
    }));
    expect(seen.recipes.map((r) => r.id)).toEqual([ids.recipe]);
    expect(seen.imports.map((r) => r.id)).toEqual([ids.import]);
    expect(seen.cooks.map((r) => r.id)).toEqual([ids.cook]);
  });

  it("B cannot read any of A's rows, even by id", async () => {
    const seen = await withTenant(b, async (tx) => [
      ...(await tx.select().from(schema.foodRecipes).where(eq(schema.foodRecipes.id, ids.recipe))),
      ...(await tx.select().from(schema.foodImports).where(eq(schema.foodImports.id, ids.import))),
      ...(await tx.select().from(schema.foodCooks).where(eq(schema.foodCooks.id, ids.cook))),
    ]);
    expect(seen).toHaveLength(0);
  });

  it("B cannot change or delete A's rows", async () => {
    const changed = await withTenant(b, async (tx) => [
      ...(await tx
        .update(schema.foodRecipes)
        .set({ title: "Taken" })
        .where(eq(schema.foodRecipes.id, ids.recipe))
        .returning()),
      ...(await tx.delete(schema.foodImports).where(eq(schema.foodImports.id, ids.import)).returning()),
      ...(await tx.delete(schema.foodCooks).where(eq(schema.foodCooks.id, ids.cook)).returning()),
      ...(await tx.delete(schema.foodRecipes).where(eq(schema.foodRecipes.id, ids.recipe)).returning()),
    ]);
    expect(changed).toHaveLength(0);
    const [recipe] = await withSystem((tx) =>
      tx.select({ title: schema.foodRecipes.title }).from(schema.foodRecipes).where(eq(schema.foodRecipes.id, ids.recipe)),
    );
    expect(recipe.title).toBe("A's soup");
  });

  it("B cannot write a row into A's space", async () => {
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.foodRecipes).values({ tenantId: a, title: "Planted", createdByClerkUserId: "user_planted" }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.foodImports).values({ tenantId: a, kind: "text", createdByClerkUserId: "user_planted" }),
      ),
    ).rejects.toThrow();
  });

  it("a cook cannot point at another space's recipe", async () => {
    // B's own row, aimed at A's recipe: the composite key refuses it.
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.foodCooks).values({
          id: crypto.randomUUID(),
          tenantId: b,
          recipeId: ids.recipe,
          madeOn: "2026-10-02",
          createdByClerkUserId: "user_planted",
        }),
      ),
    ).rejects.toThrow();
  });

  it("with no tenant at all, nothing is visible", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", async (tx) => [
      ...(await tx.select().from(schema.foodRecipes)),
      ...(await tx.select().from(schema.foodImports)),
      ...(await tx.select().from(schema.foodCooks)),
    ]);
    expect(seen).toHaveLength(0);
  });
});
