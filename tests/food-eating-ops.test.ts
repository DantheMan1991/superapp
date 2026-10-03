import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import type { Tenant } from "../src/db/schema";
import type { TenantContext } from "../src/lib/auth";
import { emptyRecipe } from "../src/modules/food/core/recipe";
import {
  changeEaten,
  dayEaten,
  deleteEaten,
  eatenBetween,
  getFood,
  getTargets,
  logFood,
  logPlate,
  logRecipe,
  recentEaten,
  searchFoods,
  searchRecipes,
  setTargets,
} from "../src/modules/food/eating-ops";
import { readPlate } from "../src/modules/food/plate-ops";
import { foodProgressSource } from "../src/modules/food/progress-source";
import { deleteRecipe, insertRecipe } from "../src/modules/food/recipe-ops";

/**
 * Food's eating log against a real database (docs/modules/food.md, D4a): the
 * food list searched as a person types, a food, a recipe and a plate logged
 * (each once however many times the phone sends it), changed and removed, a
 * deleted recipe leaving what was eaten as it was, the targets, and what Food
 * tells Health through the progress slot.
 *
 * The food list is the seed's (`npm run db:seed`, which CI runs before the
 * suite). The clock is fixed (noon in New York on 3 Oct 2026) and every day is
 * that day or before it.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `food-eating-${process.pid}`;
const NOW = new Date("2026-10-03T16:00:00Z");
const TODAY = "2026-10-03";
/** "Banana, raw" in FNDDS 2021-2023: 97 kcal per 100 g, "1 banana" is 126 g. */
const BANANA = 2709224;

let tenant: Tenant;
let ctx: TenantContext;

function inTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(tenant.id, fn, { role: "owner" });
}

async function aRecipe(title: string, nutrition: { calories?: number; proteinG?: number } | null): Promise<string> {
  return inTenant((tx) => insertRecipe(tx, ctx, { ...emptyRecipe(), title, yieldAmount: 4, yieldUnit: "servings", nutrition }, null));
}

d("food: eating (db)", () => {
  beforeAll(async () => {
    tenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Personal",
          slug: `${STAMP}-slug`,
          kind: "personal",
          personalOwnerClerkUserId: `user_foodeating${process.pid}`,
          timezone: "America/New_York",
        })
        .returning();
      return row;
    });
    ctx = { tenant, userId: `user_foodeating${process.pid}`, role: "owner", support: null };
  });

  afterAll(async () => {
    if (tenant) await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)));
  });

  // The scenarios share one space: each starts from an empty log.
  beforeEach(async () => {
    if (!tenant) return;
    await withSystem(async (tx) => {
      await tx.delete(schema.foodEaten).where(eq(schema.foodEaten.tenantId, tenant.id));
      await tx.delete(schema.foodTargets).where(eq(schema.foodTargets.tenantId, tenant.id));
      await tx.delete(schema.foodRecipes).where(eq(schema.foodRecipes.tenantId, tenant.id));
    });
  });

  describe("the food list", () => {
    it("is loaded, and a member of any space can read it", async () => {
      const banana = await inTenant((tx) => getFood(tx, BANANA));
      expect(banana).toMatchObject({ name: "Banana, raw", category: "Bananas" });
      expect(banana?.per100g.calories).toBe(97);
      expect(banana?.portions[0]).toEqual({ label: "1 banana", grams: 126 });
    });

    it("finds a food as it is typed, the plain food first", async () => {
      const search = (q: string) => inTenant((tx) => searchFoods(tx, q, 5));
      expect((await search("banana"))[0].name).toBe("Banana, raw");
      expect((await search("rice"))[0].name).toMatch(/^Rice, /);
      expect((await search("salmon"))[0].name).toMatch(/^Fish, salmon/);
      // Every word is a prefix: "chick" finds chicken.
      expect((await search("chick brea"))[0].name).toMatch(/^Chicken breast/);
      // No food has every word: the ones with the most come first (a plate's words, the D4a drive).
      expect((await search("butter on toast"))[0].name).toMatch(/^Butter, /);
      expect((await search("grilled chicken breast sliced"))[0].name).toMatch(/^Chicken breast, grilled/);
      expect((await search("bacon strips cooked"))[0].name).toMatch(/bacon.*cooked/i);
      // Nothing but punctuation, or only words the index ignores, finds nothing and breaks nothing.
      expect(await search("!!! ''")).toEqual([]);
      expect(await search("the")).toEqual([]);
    });

    it("finds the person's own recipes by every word, the ones cooked lately first", async () => {
      await aRecipe("Lemon chicken", { calories: 420 });
      await aRecipe("Skillet cornbread", null);
      const hits = await inTenant((tx) => searchRecipes(tx, tenant.id, "chicken lem"));
      expect(hits.map((h) => h.title)).toEqual(["Lemon chicken"]);
      expect(hits[0].perServing).toEqual({ calories: 420 });
      expect((await inTenant((tx) => searchRecipes(tx, tenant.id, ""))).map((h) => h.title)).toEqual([
        "Lemon chicken",
        "Skillet cornbread",
      ]);
    });
  });

  describe("logging", () => {
    it("keeps a food's numbers for its amount, once however many times it is sent", async () => {
      const id = randomUUID();
      const entry = { id, day: TODAY, meal: "breakfast" as const, fdcId: BANANA, amount: 1, portion: "1 banana" };
      await inTenant((tx) => logFood(tx, ctx, entry, NOW));
      await inTenant((tx) => logFood(tx, ctx, { ...entry, amount: 5 }, NOW));
      const [row] = await inTenant((tx) => dayEaten(tx, tenant.id, TODAY));
      expect(row).toMatchObject({ id, source: "food", name: "Banana, raw", amount: 1, portion: "1 banana", grams: 126 });
      expect(row.calories).toBeCloseTo(122.22);
      expect(row.portions?.[0]).toEqual({ label: "1 banana", grams: 126 });
      expect(await inTenant((tx) => dayEaten(tx, tenant.id, TODAY))).toHaveLength(1);
    });

    it("refuses a day ahead, one more than two weeks back, a portion the food lacks, and a food not on the list", async () => {
      const entry = (change: object) => ({ id: randomUUID(), day: TODAY, meal: "lunch" as const, fdcId: BANANA, amount: 1, portion: "1 banana", ...change });
      for (const [change, code] of [
        [{ day: "2026-10-04" }, "DAY"],
        [{ day: "2026-09-18" }, "DAY"],
        [{ portion: "1 slice of pie" }, "PORTION"],
        [{ fdcId: 1 }, "FOOD_MISSING"],
      ] as const) {
        await expect(inTenant((tx) => logFood(tx, ctx, entry(change), NOW))).rejects.toMatchObject({ code });
      }
      // Fourteen days back is allowed, in grams or ounces.
      await inTenant((tx) => logFood(tx, ctx, entry({ day: "2026-09-19", amount: 100, portion: "g" }), NOW));
      expect(await inTenant((tx) => dayEaten(tx, tenant.id, "2026-09-19"))).toHaveLength(1);
    });

    it("keeps a recipe's stated numbers for the servings, and none for a recipe that states none", async () => {
      const lemon = await aRecipe("Lemon chicken", { calories: 420, proteinG: 38 });
      const bread = await aRecipe("Skillet cornbread", null);
      await inTenant(async (tx) => {
        await logRecipe(tx, ctx, { id: randomUUID(), day: TODAY, meal: "dinner", recipeId: lemon, servings: 1.5 }, NOW);
        await logRecipe(tx, ctx, { id: randomUUID(), day: TODAY, meal: "dinner", recipeId: bread, servings: 1 }, NOW);
      });
      const rows = await inTenant((tx) => dayEaten(tx, tenant.id, TODAY));
      expect(rows.map((r) => [r.name, r.portion, r.grams, r.calories, r.proteinG, r.carbsG])).toEqual([
        ["Lemon chicken", "serving", null, 630, 57, null],
        ["Skillet cornbread", "serving", null, null, null, null],
      ]);
      await expect(
        inTenant((tx) => logRecipe(tx, ctx, { id: randomUUID(), day: TODAY, meal: "dinner", recipeId: randomUUID(), servings: 1 }, NOW)),
      ).rejects.toMatchObject({ code: "RECIPE_MISSING" });
    });

    it("logs a plate all or none", async () => {
      const good = { id: randomUUID(), fdcId: BANANA, amount: 120, portion: "g" };
      await expect(
        inTenant((tx) =>
          logPlate(tx, ctx, { day: TODAY, meal: "lunch", items: [good, { id: randomUUID(), fdcId: BANANA, amount: 1, portion: "1 bowl" }] }, NOW),
        ),
      ).rejects.toMatchObject({ code: "PORTION" });
      expect(await inTenant((tx) => dayEaten(tx, tenant.id, TODAY))).toEqual([]);
      await inTenant((tx) => logPlate(tx, ctx, { day: TODAY, meal: "lunch", items: [good] }, NOW));
      expect(await inTenant((tx) => dayEaten(tx, tenant.id, TODAY))).toMatchObject([{ source: "photo", grams: 120 }]);
    });

    it("lists a day meal by meal, in the order things were logged", async () => {
      await inTenant(async (tx) => {
        for (const meal of ["snack", "dinner", "breakfast", "lunch"] as const) {
          await logFood(tx, ctx, { id: randomUUID(), day: TODAY, meal, fdcId: BANANA, amount: 1, portion: "1 banana" }, NOW);
        }
      });
      const rows = await inTenant((tx) => dayEaten(tx, tenant.id, TODAY));
      expect(rows.map((r) => r.meal)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
    });
  });

  describe("changing and removing", () => {
    it("scales a food's kept numbers to a new amount or portion, and moves it to another meal", async () => {
      const id = randomUUID();
      await inTenant((tx) => logFood(tx, ctx, { id, day: TODAY, meal: "breakfast", fdcId: BANANA, amount: 1, portion: "1 banana" }, NOW));
      await inTenant((tx) => changeEaten(tx, ctx, { id, meal: "snack", amount: 252, portion: "g" }, NOW));
      const [row] = await inTenant((tx) => dayEaten(tx, tenant.id, TODAY));
      expect(row).toMatchObject({ meal: "snack", amount: 252, portion: "g", grams: 252 });
      expect(row.calories).toBeCloseTo(244.44);
      await expect(
        inTenant((tx) => changeEaten(tx, ctx, { id, meal: "snack", amount: 1, portion: "1 slice of pie" }, NOW)),
      ).rejects.toMatchObject({ code: "PORTION" });
      await expect(
        inTenant((tx) => changeEaten(tx, ctx, { id: randomUUID(), meal: "snack", amount: 1 }, NOW)),
      ).rejects.toMatchObject({ code: "EATEN_MISSING" });
    });

    it("scales a recipe by its servings, from the numbers it was logged with, even after the recipe changes", async () => {
      const lemon = await aRecipe("Lemon chicken", { calories: 420, proteinG: 38 });
      const id = randomUUID();
      await inTenant((tx) => logRecipe(tx, ctx, { id, day: TODAY, meal: "dinner", recipeId: lemon, servings: 1 }, NOW));
      await withSystem((tx) => tx.update(schema.foodRecipes).set({ nutrition: { calories: 9_999 } }).where(eq(schema.foodRecipes.id, lemon)));
      await inTenant((tx) => changeEaten(tx, ctx, { id, meal: "dinner", amount: 2 }, NOW));
      const [row] = await inTenant((tx) => dayEaten(tx, tenant.id, TODAY));
      expect(row).toMatchObject({ amount: 2, portion: "serving", calories: 840, proteinG: 76 });
    });

    it("keeps what was eaten, its name and numbers, when the recipe is deleted", async () => {
      const lemon = await aRecipe("Lemon chicken", { calories: 420 });
      const id = randomUUID();
      await inTenant((tx) => logRecipe(tx, ctx, { id, day: TODAY, meal: "dinner", recipeId: lemon, servings: 1 }, NOW));
      await inTenant((tx) => deleteRecipe(tx, tenant.id, lemon));
      expect(await inTenant((tx) => dayEaten(tx, tenant.id, TODAY))).toMatchObject([
        { id, recipeId: null, name: "Lemon chicken", calories: 420 },
      ]);
    });

    it("removes a thing, twice without complaint", async () => {
      const id = randomUUID();
      await inTenant((tx) => logFood(tx, ctx, { id, day: TODAY, meal: "lunch", fdcId: BANANA, amount: 1, portion: "1 banana" }, NOW));
      await inTenant((tx) => deleteEaten(tx, tenant.id, id));
      await inTenant((tx) => deleteEaten(tx, tenant.id, id));
      expect(await inTenant((tx) => dayEaten(tx, tenant.id, TODAY))).toEqual([]);
    });
  });

  describe("recent, targets and progress", () => {
    it("offers what was logged lately once each, with the amount last had", async () => {
      const lemon = await aRecipe("Lemon chicken", { calories: 420 });
      await inTenant(async (tx) => {
        await logFood(tx, ctx, { id: randomUUID(), day: "2026-10-01", meal: "lunch", fdcId: BANANA, amount: 1, portion: "1 banana" }, NOW);
        await logRecipe(tx, ctx, { id: randomUUID(), day: "2026-10-02", meal: "dinner", recipeId: lemon, servings: 1 }, NOW);
        await logFood(tx, ctx, { id: randomUUID(), day: TODAY, meal: "breakfast", fdcId: BANANA, amount: 2, portion: "1 cup" }, NOW);
      });
      const recent = await inTenant((tx) => recentEaten(tx, tenant.id));
      expect(recent.map((r) => [r.key, r.amount, r.portion, r.food?.name ?? r.recipe?.title])).toEqual([
        [`f:${BANANA}`, 2, "1 cup", "Banana, raw"],
        [`r:${lemon}`, 1, "serving", "Lemon chicken"],
      ]);
    });

    it("keeps targets, and clears one", async () => {
      expect(await inTenant((tx) => getTargets(tx, tenant.id))).toEqual({ calories: null, proteinG: null });
      await inTenant((tx) => setTargets(tx, tenant.id, { calories: 2_200, proteinG: 150 }, NOW));
      await inTenant((tx) => setTargets(tx, tenant.id, { calories: null, proteinG: 160 }, NOW));
      expect(await inTenant((tx) => getTargets(tx, tenant.id))).toEqual({ calories: null, proteinG: 160 });
    });

    it("tells Health the week's numbers and today's card", async () => {
      await inTenant(async (tx) => {
        // 1,400 g of banana is 10.36 g of protein: a day on a 10 g target. 100 g is not.
        await setTargets(tx, tenant.id, { calories: null, proteinG: 10 }, NOW);
        await logFood(tx, ctx, { id: randomUUID(), day: "2026-10-01", meal: "lunch", fdcId: BANANA, amount: 1_400, portion: "g" }, NOW);
        await logFood(tx, ctx, { id: randomUUID(), day: TODAY, meal: "lunch", fdcId: BANANA, amount: 100, portion: "g" }, NOW);
      });
      const windows = [{ from: "2026-09-27", to: TODAY }];
      const rows = await inTenant((tx) => foodProgressSource.rows(tx, tenant.id, windows));
      expect(Object.fromEntries(rows.map((r) => [r.key, r.values[0]]))).toMatchObject({
        "food.calories": (1_358 + 97) / 2,
        "food.protein-target": 1,
      });
      const card = await inTenant((tx) => foodProgressSource.today(tx, tenant.id, TODAY));
      expect(card?.lines[0]).toBe("97 kcal · protein 0.7 g · carbs 23 g · fat 0.3 g");
      expect(await inTenant((tx) => eatenBetween(tx, tenant.id, "2026-09-27", TODAY))).toHaveLength(2);
    });
  });

  describe("a photo of the plate", () => {
    it("matches each food Claude names on the list, and keeps nothing", async () => {
      const items = await readPlate(ctx, "A".repeat(200), {
        model: async () => ({
          found: true,
          items: [
            { name: "a banana", search: "banana raw", grams: 118 },
            { name: "something unheard of", search: "zzqx", grams: 50 },
          ],
        }),
      });
      expect(items.map((i) => [i.seen, i.grams, i.match?.name ?? null])).toEqual([
        ["a banana", 118, "Banana, raw"],
        ["something unheard of", 50, null],
      ]);
      expect(await inTenant((tx) => dayEaten(tx, tenant.id, TODAY))).toEqual([]);
    });

    it("says when the photo shows no food, and when the read fails", async () => {
      await expect(readPlate(ctx, "A".repeat(200), { model: async () => ({ found: false, items: [] }) })).rejects.toMatchObject({
        code: "PLATE_EMPTY",
      });
      await expect(
        readPlate(ctx, "A".repeat(200), {
          model: async () => {
            throw new Error("overloaded");
          },
        }),
      ).rejects.toMatchObject({ code: "PLATE_FAILED" });
    });
  });
});
