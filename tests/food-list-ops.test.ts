import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import type { Tenant } from "../src/db/schema";
import type { TenantContext } from "../src/lib/auth";
import { emptyRecipe } from "../src/modules/food/core/recipe";
import { buildList, listLines } from "../src/modules/food/core/list";
import { alwaysHave, knownItems, lineNames, nameLines, setAlwaysHave, shoppingPlan } from "../src/modules/food/list-ops";
import { planCook, planFood } from "../src/modules/food/plan-ops";
import { insertRecipe } from "../src/modules/food/recipe-ops";

/**
 * Food's shopping list against a real database (docs/modules/food.md, D3, ADR
 * 0130): the planned days read for the list (each cook's recipe lines, without
 * headings, and the planned foods), lines named once by a stand-in for Claude
 * (only the new ones, with the names already in use), a failed naming, and
 * what he always has. The clock is fixed: noon in New York on Wednesday
 * 7 Oct 2026, so the list reaches 5 to 18 October.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `food-list-${process.pid}`;
const NOW = new Date("2026-10-07T16:00:00Z");
const TODAY = "2026-10-07";
/** "Banana, raw" in FNDDS 2021-2023: "1 banana" is 126 g. */
const BANANA = 2709224;

let tenant: Tenant;
let ctx: TenantContext;

function inTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(tenant.id, fn, { role: "owner" });
}

async function chiliRecipe(): Promise<string> {
  return inTenant((tx) =>
    insertRecipe(
      tx,
      ctx,
      {
        ...emptyRecipe(),
        title: "Turkey chili",
        yieldAmount: 6,
        yieldUnit: "servings",
        ingredients: [
          { text: "For the chili", heading: true },
          { text: "2 lb ground turkey" },
          { text: "2 yellow onions, diced" },
          { text: "1 tsp salt" },
          { text: "1 cup water" },
        ],
      },
      null,
    ),
  );
}

/** A stand-in for Claude: names each line from a table, and keeps what it was asked. */
function fakeModel(table: Record<string, { item: string | null; aisle: string; staple: boolean }>) {
  const prompts: string[] = [];
  const model = async (prompt: string) => {
    prompts.push(prompt);
    const lines = prompt.split("The lines:\n")[1].split("\n");
    return {
      items: lines.flatMap((entry) => {
        const [, number, line] = /^(\d+)\. (.*)$/.exec(entry) ?? [];
        const named = table[line];
        return named ? [{ line: Number(number), ...named }] : [];
      }),
    };
  };
  return { model, prompts };
}

const TABLE = {
  "2 lb ground turkey": { item: "Ground Turkey", aisle: "meat", staple: false },
  "2 yellow onions, diced": { item: "yellow onions", aisle: "produce", staple: false },
  "1 tsp salt": { item: "salt", aisle: "pantry", staple: true },
  "1 cup water": { item: null, aisle: "other", staple: false },
  "Banana, raw": { item: "bananas", aisle: "produce", staple: false },
};

d("food: the shopping list (db)", () => {
  beforeAll(async () => {
    tenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Personal",
          slug: `${STAMP}-slug`,
          kind: "personal",
          personalOwnerClerkUserId: `user_foodlist${process.pid}`,
          timezone: "America/New_York",
        })
        .returning();
      return row;
    });
    ctx = { tenant, userId: `user_foodlist${process.pid}`, role: "owner", support: null };
  });

  afterAll(async () => {
    if (tenant) await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)));
  });

  // The scenarios share one space: each starts with no plan, no names and nothing always had.
  beforeEach(async () => {
    if (!tenant) return;
    await withSystem(async (tx) => {
      await tx.delete(schema.foodPlan).where(eq(schema.foodPlan.tenantId, tenant.id));
      await tx.delete(schema.foodRecipes).where(eq(schema.foodRecipes.tenantId, tenant.id));
      await tx.delete(schema.foodLineNames).where(eq(schema.foodLineNames.tenantId, tenant.id));
      await tx.delete(schema.foodStaples).where(eq(schema.foodStaples.tenantId, tenant.id));
    });
  });

  it("reads the planned days for the list: each cook's lines without headings, and the planned foods", async () => {
    const chili = await chiliRecipe();
    await inTenant((tx) => planCook(tx, ctx, { id: randomUUID(), day: TODAY, meal: "dinner", recipeId: chili, make: 4, eat: 1, leftovers: [] }, NOW));
    await inTenant((tx) => planCook(tx, ctx, { id: randomUUID(), day: "2026-10-16", meal: "dinner", recipeId: chili, make: 6, eat: 1, leftovers: [] }, NOW));
    await inTenant((tx) => planFood(tx, ctx, { id: randomUUID(), day: "2026-10-08", meal: "snack", fdcId: BANANA, amount: 2, portion: "1 banana" }, NOW));

    const plan = await inTenant((tx) => shoppingPlan(tx, tenant.id, TODAY, "2026-10-13"));
    expect(plan.cooks).toEqual([
      expect.objectContaining({ day: TODAY, title: "Turkey chili", yieldAmount: 6, make: 4, lines: ["2 lb ground turkey", "2 yellow onions, diced", "1 tsp salt", "1 cup water"] }),
    ]);
    expect(plan.foods).toEqual([expect.objectContaining({ day: "2026-10-08", name: "Banana, raw", amount: 2, portion: "1 banana", grams: 252 })]);
  });

  it("names only the new lines, once, with the names already in use, and leaves the unanswered to ask again", async () => {
    const chili = await chiliRecipe();
    await inTenant((tx) => planCook(tx, ctx, { id: randomUUID(), day: TODAY, meal: "dinner", recipeId: chili, make: 4, eat: 1, leftovers: [] }, NOW));
    await inTenant((tx) => planFood(tx, ctx, { id: randomUUID(), day: "2026-10-08", meal: "snack", fdcId: BANANA, amount: 2, portion: "1 banana" }, NOW));

    const partial = { ...TABLE } as Partial<typeof TABLE>;
    delete partial["Banana, raw"];
    const first = fakeModel(partial as typeof TABLE);
    expect(await nameLines(ctx, { model: first.model, now: NOW })).toEqual({ named: 4, left: 1 });
    expect(first.prompts[0]).toContain("already use: None yet.");

    const second = fakeModel(TABLE);
    expect(await nameLines(ctx, { model: second.model, now: NOW })).toEqual({ named: 1, left: 0 });
    // Only the banana was asked, with the names the space already uses.
    expect(second.prompts[0]).toContain("The lines:\n1. Banana, raw");
    expect(second.prompts[0].split("The lines:")[1]).not.toContain("turkey");
    expect(second.prompts[0]).toMatch(/already use: .*ground turkey/);

    const third = fakeModel(TABLE);
    expect(await nameLines(ctx, { model: third.model, now: NOW })).toEqual({ named: 0, left: 0 });
    expect(third.prompts).toHaveLength(0);

    const plan = await inTenant((tx) => shoppingPlan(tx, tenant.id, TODAY, "2026-10-13"));
    const names = await inTenant((tx) => lineNames(tx, tenant.id, listLines(plan.cooks, plan.foods)));
    expect(names["2 lb ground turkey"]).toEqual([{ item: "ground turkey", aisle: "meat", staple: false }]);
    expect(names["1 cup water"]).toEqual([{ item: null, aisle: "other", staple: false }]);
    expect(await inTenant((tx) => knownItems(tx, tenant.id))).toEqual(expect.arrayContaining(["ground turkey", "yellow onions", "salt", "bananas"]));

    const list = buildList({ cooks: plan.cooks, foods: plan.foods, names, always: [], from: TODAY, to: "2026-10-13" });
    expect(list.items.map((item) => [item.name, item.amount])).toEqual([
      ["Bananas", "2 × banana"],
      ["Yellow onions", "1 ⅓"],
      ["Ground turkey", "1 ⅓ lb"],
      ["Salt", "⅔ tsp"],
    ]);
  });

  it("keeps each thing a line buys, and 'buys nothing' once", async () => {
    const soup = await inTenant((tx) =>
      insertRecipe(
        tx,
        ctx,
        { ...emptyRecipe(), title: "Soup", yieldAmount: 4, yieldUnit: "servings", ingredients: [{ text: "Salt and pepper to taste" }, { text: "4 cups water" }] },
        null,
      ),
    );
    await inTenant((tx) => planCook(tx, ctx, { id: randomUUID(), day: TODAY, meal: "lunch", recipeId: soup, make: 4, eat: 1, leftovers: [] }, NOW));
    const model = async () => ({
      items: [
        { line: 1, item: "salt", aisle: "pantry", staple: true },
        { line: 1, item: "black pepper", aisle: "pantry", staple: true },
        { line: 2, item: null, aisle: "other", staple: false },
      ],
    });
    expect(await nameLines(ctx, { model, now: NOW })).toEqual({ named: 2, left: 0 });
    const names = await inTenant((tx) => lineNames(tx, tenant.id, ["Salt and pepper to taste", "4 cups water"]));
    expect(names["Salt and pepper to taste"].map((n) => n.item).sort()).toEqual(["black pepper", "salt"]);
    expect(names["4 cups water"]).toEqual([{ item: null, aisle: "other", staple: false }]);
    // A second "buys nothing" for the line is the same row (NULLS NOT DISTINCT).
    await withSystem((tx) =>
      tx
        .insert(schema.foodLineNames)
        .values({ tenantId: tenant.id, line: "4 cups water", item: null, aisle: "other" })
        .onConflictDoNothing(),
    );
    const rows = await withSystem((tx) => tx.select().from(schema.foodLineNames).where(eq(schema.foodLineNames.line, "4 cups water")));
    expect(rows.filter((row) => row.tenantId === tenant.id)).toHaveLength(1);
  });

  it("says so when Claude cannot be reached, and keeps nothing", async () => {
    const chili = await chiliRecipe();
    await inTenant((tx) => planCook(tx, ctx, { id: randomUUID(), day: TODAY, meal: "dinner", recipeId: chili, make: 4, eat: 1, leftovers: [] }, NOW));
    await expect(
      nameLines(ctx, {
        model: async () => {
          throw new Error("overloaded");
        },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "LIST_FAILED" });
    const kept = await withSystem((tx) => tx.select().from(schema.foodLineNames).where(eq(schema.foodLineNames.tenantId, tenant.id)));
    expect(kept).toHaveLength(0);
  });

  it("keeps what he always has, in lower case, once, until it is put back", async () => {
    await inTenant((tx) => setAlwaysHave(tx, tenant.id, "Salt", true));
    await inTenant((tx) => setAlwaysHave(tx, tenant.id, "salt", true));
    await inTenant((tx) => setAlwaysHave(tx, tenant.id, "black pepper", true));
    expect(await inTenant((tx) => alwaysHave(tx, tenant.id))).toEqual(["black pepper", "salt"]);
    await inTenant((tx) => setAlwaysHave(tx, tenant.id, "SALT", false));
    await inTenant((tx) => setAlwaysHave(tx, tenant.id, "salt", false));
    expect(await inTenant((tx) => alwaysHave(tx, tenant.id))).toEqual(["black pepper"]);
  });
});
