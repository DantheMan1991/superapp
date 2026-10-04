import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * FOOD'S SHOPPING LIST (D3, docs/modules/food.md, ADR 0130):
 * `food_line_names` (what each line buys) and `food_staples` (what the person
 * always has) are ordinary tenant tables, and this proves for them what
 * core.test.ts proves for every pair: neither person can read, change or
 * delete the other's rows, nor write one into the other's space. A line
 * named the same in both spaces is two rows, one each.
 */

const STAMP = `iso-food-list-${process.pid}`;

let a: string;
let b: string;
let nameA = "";

d("food shopping list tables (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-a`, name: "Personal", slug: `${STAMP}-a`, kind: "personal", personalOwnerClerkUserId: `user_isofoodlista${process.pid}` })
        .returning();
      const [tb] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-b`, name: "Personal", slug: `${STAMP}-b`, kind: "personal", personalOwnerClerkUserId: `user_isofoodlistb${process.pid}` })
        .returning();
      a = ta.id;
      b = tb.id;
      const [row] = await tx
        .insert(schema.foodLineNames)
        .values({ tenantId: a, line: "2 lb ground turkey", item: "ground turkey", aisle: "meat" })
        .returning();
      nameA = row.id;
      await tx.insert(schema.foodStaples).values({ tenantId: a, item: "salt" });
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("A reads its own names and staples", async () => {
    const seen = await withTenant(a, async (tx) => ({
      names: await tx.select({ item: schema.foodLineNames.item }).from(schema.foodLineNames),
      staples: await tx.select({ item: schema.foodStaples.item }).from(schema.foodStaples),
    }));
    expect(seen).toEqual({ names: [{ item: "ground turkey" }], staples: [{ item: "salt" }] });
  });

  it("B cannot read A's names or staples", async () => {
    const seen = await withTenant(b, async (tx) => [
      ...(await tx.select().from(schema.foodLineNames).where(eq(schema.foodLineNames.id, nameA))),
      ...(await tx.select().from(schema.foodStaples).where(eq(schema.foodStaples.tenantId, a))),
    ]);
    expect(seen).toHaveLength(0);
  });

  it("B cannot change or delete A's rows", async () => {
    const changed = await withTenant(b, async (tx) => [
      ...(await tx.update(schema.foodLineNames).set({ item: "stolen" }).where(eq(schema.foodLineNames.id, nameA)).returning()),
      ...(await tx.delete(schema.foodLineNames).where(eq(schema.foodLineNames.id, nameA)).returning()),
      ...(await tx.delete(schema.foodStaples).where(eq(schema.foodStaples.tenantId, a)).returning()),
    ]);
    expect(changed).toHaveLength(0);
    const kept = await withSystem(async (tx) => ({
      names: await tx.select({ item: schema.foodLineNames.item }).from(schema.foodLineNames).where(eq(schema.foodLineNames.id, nameA)),
      staples: await tx.select({ item: schema.foodStaples.item }).from(schema.foodStaples).where(eq(schema.foodStaples.tenantId, a)),
    }));
    expect(kept).toEqual({ names: [{ item: "ground turkey" }], staples: [{ item: "salt" }] });
  });

  it("B cannot write into A's space, and the same line in B's is B's own row", async () => {
    await expect(
      withTenant(b, (tx) => tx.insert(schema.foodLineNames).values({ tenantId: a, line: "1 cup rice", item: "rice", aisle: "pantry" })),
    ).rejects.toThrow();
    await expect(withTenant(b, (tx) => tx.insert(schema.foodStaples).values({ tenantId: a, item: "pepper" }))).rejects.toThrow();
    const [own] = await withTenant(b, (tx) =>
      tx.insert(schema.foodLineNames).values({ tenantId: b, line: "2 lb ground turkey", item: "turkey", aisle: "meat" }).returning(),
    );
    expect(own.tenantId).toBe(b);
    const [kept] = await withSystem((tx) => tx.select({ item: schema.foodLineNames.item }).from(schema.foodLineNames).where(eq(schema.foodLineNames.id, nameA)));
    expect(kept).toEqual({ item: "ground turkey" });
  });

  it("with no tenant at all, no one's names or staples are visible", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", async (tx) => [
      ...(await tx.select().from(schema.foodLineNames)),
      ...(await tx.select().from(schema.foodStaples)),
    ]);
    expect(seen).toHaveLength(0);
  });
});
