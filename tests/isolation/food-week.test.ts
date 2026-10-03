import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * FOOD'S WEEK (D2, docs/modules/food.md, ADR 0129): `food_plan` is an ordinary
 * tenant table, and this proves for it what core.test.ts proves for every
 * pair: neither person can read, change or delete the other's plan, nor write
 * one into the other's space; nor can a plan of their own point at the other's
 * recipe or cook, nor an eaten row of theirs at the other's plan.
 */

const STAMP = `iso-food-week-${process.pid}`;

let a: string;
let b: string;
const ids = { recipeA: "", recipeB: "", cookA: randomUUID(), leftA: randomUUID() };

function cookRow(tenantId: string, recipeId: string, change: object = {}) {
  return {
    id: randomUUID(),
    tenantId,
    plannedOn: "2026-10-07",
    meal: "dinner" as const,
    kind: "cook" as const,
    recipeId,
    servings: 1,
    make: 4,
    createdByClerkUserId: "user_planted",
    ...change,
  };
}

d("food week table (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-a`,
          name: "Personal",
          slug: `${STAMP}-a`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isofoodweeka${process.pid}`,
        })
        .returning();
      const [tb] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-b`,
          name: "Personal",
          slug: `${STAMP}-b`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isofoodweekb${process.pid}`,
        })
        .returning();
      a = ta.id;
      b = tb.id;
      const [ra] = await tx
        .insert(schema.foodRecipes)
        .values({ tenantId: a, title: "A's chili", createdByClerkUserId: `user_isofoodweeka${process.pid}` })
        .returning();
      const [rb] = await tx
        .insert(schema.foodRecipes)
        .values({ tenantId: b, title: "B's soup", createdByClerkUserId: `user_isofoodweekb${process.pid}` })
        .returning();
      ids.recipeA = ra.id;
      ids.recipeB = rb.id;
      await tx.insert(schema.foodPlan).values(cookRow(a, ra.id, { id: ids.cookA }));
      await tx.insert(schema.foodPlan).values({
        id: ids.leftA,
        tenantId: a,
        plannedOn: "2026-10-08",
        meal: "lunch",
        kind: "leftover",
        cookId: ids.cookA,
        servings: 1,
        createdByClerkUserId: "user_planted",
      });
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("A reads its own week", async () => {
    const seen = await withTenant(a, (tx) => tx.select({ id: schema.foodPlan.id }).from(schema.foodPlan));
    expect(seen.map((r) => r.id).sort()).toEqual([ids.cookA, ids.leftA].sort());
  });

  it("B cannot read A's week, even by id", async () => {
    const seen = await withTenant(b, (tx) => tx.select().from(schema.foodPlan).where(inArray(schema.foodPlan.id, [ids.cookA, ids.leftA])));
    expect(seen).toHaveLength(0);
  });

  it("B cannot change or delete A's plan", async () => {
    const changed = await withTenant(b, async (tx) => [
      ...(await tx.update(schema.foodPlan).set({ servings: 3 }).where(eq(schema.foodPlan.id, ids.cookA)).returning()),
      ...(await tx.delete(schema.foodPlan).where(eq(schema.foodPlan.id, ids.leftA)).returning()),
    ]);
    expect(changed).toHaveLength(0);
    const kept = await withSystem((tx) =>
      tx.select({ servings: schema.foodPlan.servings }).from(schema.foodPlan).where(inArray(schema.foodPlan.id, [ids.cookA, ids.leftA])),
    );
    expect(kept).toHaveLength(2);
    expect(kept.every((r) => r.servings === 1)).toBe(true);
  });

  it("B cannot write a plan into A's space", async () => {
    await expect(withTenant(b, (tx) => tx.insert(schema.foodPlan).values(cookRow(a, ids.recipeA)))).rejects.toThrow();
  });

  it("B's plan cannot cook A's recipe, nor eat A's leftovers", async () => {
    // B's own rows, aimed at A's recipe and A's cook: the composite keys refuse them.
    await expect(withTenant(b, (tx) => tx.insert(schema.foodPlan).values(cookRow(b, ids.recipeA)))).rejects.toThrow();
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.foodPlan).values({
          id: randomUUID(),
          tenantId: b,
          plannedOn: "2026-10-08",
          meal: "lunch",
          kind: "leftover",
          cookId: ids.cookA,
          servings: 1,
          createdByClerkUserId: "user_planted",
        }),
      ),
    ).rejects.toThrow();
    // B's own recipe is fine.
    const [own] = await withTenant(b, (tx) => tx.insert(schema.foodPlan).values(cookRow(b, ids.recipeB)).returning({ id: schema.foodPlan.id }));
    expect(own.id).toBeTruthy();
  });

  it("B's log cannot say it ate A's planned meal", async () => {
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.foodEaten).values({
          id: randomUUID(),
          tenantId: b,
          eatenOn: "2026-10-07",
          meal: "dinner",
          source: "recipe",
          recipeId: ids.recipeB,
          name: "B's soup",
          amount: 1,
          portion: "serving",
          planId: ids.cookA,
          createdByClerkUserId: "user_planted",
        }),
      ),
    ).rejects.toThrow();
  });

  it("an id from A's week is refused in B's, and A's row stands", async () => {
    const inserted = await withTenant(b, (tx) =>
      tx.insert(schema.foodPlan).values(cookRow(b, ids.recipeB, { id: ids.cookA })).onConflictDoNothing({ target: schema.foodPlan.id }).returning(),
    );
    expect(inserted).toEqual([]);
    const [kept] = await withSystem((tx) =>
      tx.select({ tenantId: schema.foodPlan.tenantId }).from(schema.foodPlan).where(eq(schema.foodPlan.id, ids.cookA)),
    );
    expect(kept).toEqual({ tenantId: a });
  });

  it("with no tenant at all, no one's week is visible", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", (tx) => tx.select().from(schema.foodPlan));
    expect(seen).toHaveLength(0);
  });
});
