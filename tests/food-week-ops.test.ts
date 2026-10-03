import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import type { Tenant } from "../src/db/schema";
import type { TenantContext } from "../src/lib/auth";
import { emptyRecipe } from "../src/modules/food/core/recipe";
import { deleteEaten, logRecipe } from "../src/modules/food/eating-ops";
import {
  addLeftovers,
  ateIt,
  changePlan,
  movePlan,
  planBetween,
  planCook,
  planFood,
  planItem,
  removePlan,
  repeatWeek,
  takenSlots,
  weeksPlanned,
} from "../src/modules/food/plan-ops";
import { deleteRecipe, insertRecipe } from "../src/modules/food/recipe-ops";

/**
 * Food's week against a real database (docs/modules/food.md, D2, ADR 0129): a
 * recipe cooked once with its leftovers on later meals, a food by its amount,
 * the rules a plan keeps (this week and the next, leftovers after their cook,
 * never more than the batch), moving, changing and taking off, "Ate it" and
 * Change first logging a planned meal once, the log kept when the week is
 * cleared, and a week repeated.
 *
 * The clock is fixed: noon in New York on Wednesday 7 Oct 2026, so this week
 * runs 5 to 11 October and the next 12 to 18. The food list is the seed's.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `food-week-${process.pid}`;
const NOW = new Date("2026-10-07T16:00:00Z");
const TODAY = "2026-10-07";
/** "Banana, raw" in FNDDS 2021-2023: 97 kcal per 100 g, "1 banana" is 126 g. */
const BANANA = 2709224;

let tenant: Tenant;
let ctx: TenantContext;

function inTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(tenant.id, fn, { role: "owner" });
}

async function aRecipe(title: string, nutrition: { calories?: number; proteinG?: number } | null = { calories: 520, proteinG: 44 }) {
  return inTenant((tx) => insertRecipe(tx, ctx, { ...emptyRecipe(), title, yieldAmount: 6, yieldUnit: "servings", nutrition }, null));
}

function cook(recipeId: string, change: Partial<Parameters<typeof planCook>[2]> = {}) {
  return {
    id: randomUUID(),
    day: TODAY,
    meal: "dinner" as const,
    recipeId,
    make: 4,
    eat: 1,
    leftovers: [] as { id: string; day: string; meal: "breakfast" | "lunch" | "dinner" | "snack"; servings: number }[],
    ...change,
  };
}

function left(day: string, meal: "breakfast" | "lunch" | "dinner" | "snack" = "lunch", servings = 1) {
  return { id: randomUUID(), day, meal, servings };
}

async function eatenFor(planId: string) {
  return withSystem((tx) =>
    tx
      .select({ id: schema.foodEaten.id, recipeId: schema.foodEaten.recipeId, amount: schema.foodEaten.amount, calories: schema.foodEaten.calories, grams: schema.foodEaten.grams })
      .from(schema.foodEaten)
      .where(and(eq(schema.foodEaten.tenantId, tenant.id), eq(schema.foodEaten.planId, planId))),
  );
}

async function planRows() {
  return withSystem((tx) => tx.select().from(schema.foodPlan).where(eq(schema.foodPlan.tenantId, tenant.id)));
}

d("food: the week (db)", () => {
  beforeAll(async () => {
    tenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Personal",
          slug: `${STAMP}-slug`,
          kind: "personal",
          personalOwnerClerkUserId: `user_foodweek${process.pid}`,
          timezone: "America/New_York",
        })
        .returning();
      return row;
    });
    ctx = { tenant, userId: `user_foodweek${process.pid}`, role: "owner", support: null };
  });

  afterAll(async () => {
    if (tenant) await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)));
  });

  // The scenarios share one space: each starts from an empty week, log and recipe box.
  beforeEach(async () => {
    if (!tenant) return;
    await withSystem(async (tx) => {
      await tx.delete(schema.foodEaten).where(eq(schema.foodEaten.tenantId, tenant.id));
      await tx.delete(schema.foodPlan).where(eq(schema.foodPlan.tenantId, tenant.id));
      await tx.delete(schema.foodRecipes).where(eq(schema.foodRecipes.tenantId, tenant.id));
    });
  });

  it("puts a recipe on the week with its leftovers, once however many times it is sent", async () => {
    const chili = await aRecipe("Turkey chili");
    const input = cook(chili, { leftovers: [left("2026-10-08"), left("2026-10-09"), left("2026-10-10")] });
    await inTenant((tx) => planCook(tx, ctx, input, NOW));
    await inTenant((tx) => planCook(tx, ctx, input, NOW));
    expect(await planRows()).toHaveLength(4);

    const week = await inTenant((tx) => planBetween(tx, tenant.id, "2026-10-05", "2026-10-11"));
    expect(week.map((i) => [i.day, i.meal, i.kind])).toEqual([
      [TODAY, "dinner", "cook"],
      ["2026-10-08", "lunch", "leftover"],
      ["2026-10-09", "lunch", "leftover"],
      ["2026-10-10", "lunch", "leftover"],
    ]);
    const [made, firstLeft] = week;
    expect(made).toMatchObject({ name: "Turkey chili", make: 4, servings: 1, recipeId: chili, perServing: { calories: 520, proteinG: 44 } });
    expect(made.leftovers.map((l) => l.day)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(firstLeft).toMatchObject({ name: "Turkey chili", recipeId: chili, cookId: input.id, cookSlot: { day: TODAY, meal: "dinner" } });
  });

  it("refuses a day out of reach, a leftover before its cook, more than the batch, and a recipe not its own", async () => {
    const chili = await aRecipe("Turkey chili");
    const refused = (input: ReturnType<typeof cook>) => inTenant((tx) => planCook(tx, ctx, input, NOW));
    await expect(refused(cook(chili, { day: "2026-10-19" }))).rejects.toMatchObject({ code: "PLAN_DAY" });
    await expect(refused(cook(chili, { day: "2026-10-04" }))).rejects.toMatchObject({ code: "PLAN_DAY" });
    await expect(refused(cook(chili, { leftovers: [left(TODAY, "lunch")] }))).rejects.toMatchObject({ code: "PLAN_ORDER" });
    await expect(refused(cook(chili, { make: 2, leftovers: [left("2026-10-08"), left("2026-10-09")] }))).rejects.toMatchObject({
      code: "PLAN_BATCH",
    });
    await expect(refused(cook(chili, { make: 2, eat: 3 }))).rejects.toMatchObject({ code: "PLAN_BATCH" });
    await expect(refused(cook(randomUUID()))).rejects.toMatchObject({ code: "RECIPE_MISSING" });
    expect(await planRows()).toHaveLength(0);
  });

  it("plans a food from the list by its amount, worked out when it is read", async () => {
    const id = randomUUID();
    await inTenant((tx) => planFood(tx, ctx, { id, day: TODAY, meal: "snack", fdcId: BANANA, amount: 1, portion: "1 banana" }, NOW));
    const [banana] = await inTenant((tx) => planBetween(tx, tenant.id, TODAY, TODAY));
    expect(banana).toMatchObject({ kind: "food", fdcId: BANANA, amount: 1, portion: "1 banana", grams: 126 });
    expect(banana.per100g?.calories).toBeCloseTo(97, 0);
    expect(banana.portions?.some((p) => p.label === "1 banana")).toBe(true);
    await expect(
      inTenant((tx) => planFood(tx, ctx, { id: randomUUID(), day: TODAY, meal: "snack", fdcId: BANANA, amount: 1, portion: "1 bucket" }, NOW)),
    ).rejects.toMatchObject({ code: "PORTION" });
  });

  it("adds leftovers while the batch has them, after the cook", async () => {
    const chili = await aRecipe("Turkey chili");
    const input = cook(chili, { leftovers: [left("2026-10-08")] });
    await inTenant((tx) => planCook(tx, ctx, input, NOW));
    const more = [left("2026-10-09"), left("2026-10-10")];
    await inTenant((tx) => addLeftovers(tx, ctx, { cookId: input.id, leftovers: more }, NOW));
    await inTenant((tx) => addLeftovers(tx, ctx, { cookId: input.id, leftovers: more }, NOW));
    expect(await planRows()).toHaveLength(4);
    await expect(
      inTenant((tx) => addLeftovers(tx, ctx, { cookId: input.id, leftovers: [left("2026-10-11")] }, NOW)),
    ).rejects.toMatchObject({ code: "PLAN_BATCH" });
    await expect(
      inTenant((tx) => addLeftovers(tx, ctx, { cookId: input.id, leftovers: [left(TODAY, "lunch")] }, NOW)),
    ).rejects.toMatchObject({ code: "PLAN_ORDER" });
  });

  it("moves a meal inside the two weeks, keeping leftovers after their cook", async () => {
    const chili = await aRecipe("Turkey chili");
    const leftover = left("2026-10-08");
    const input = cook(chili, { leftovers: [leftover] });
    await inTenant((tx) => planCook(tx, ctx, input, NOW));
    const move = (id: string, day: string, meal: "lunch" | "dinner") => inTenant((tx) => movePlan(tx, ctx, { id, day, meal }, NOW));

    await expect(move(leftover.id, TODAY, "lunch")).rejects.toMatchObject({ code: "PLAN_ORDER" });
    await expect(move(input.id, "2026-10-09", "dinner")).rejects.toMatchObject({ code: "PLAN_ORDER" });
    await expect(move(input.id, "2026-10-19", "dinner")).rejects.toMatchObject({ code: "PLAN_DAY" });
    await move(input.id, TODAY, "lunch");
    await move(leftover.id, "2026-10-12", "dinner");
    const moved = await inTenant((tx) => planBetween(tx, tenant.id, "2026-10-05", "2026-10-18"));
    expect(moved.map((i) => [i.day, i.meal])).toEqual([
      [TODAY, "lunch"],
      ["2026-10-12", "dinner"],
    ]);
    expect(moved[1].cookSlot).toEqual({ day: TODAY, meal: "lunch" });
  });

  it("changes how much, never past the batch", async () => {
    const chili = await aRecipe("Turkey chili");
    const [a, b] = [left("2026-10-08"), left("2026-10-09")];
    const input = cook(chili, { leftovers: [a, b] });
    await inTenant((tx) => planCook(tx, ctx, input, NOW));
    const change = (patch: Parameters<typeof changePlan>[2]) => inTenant((tx) => changePlan(tx, ctx, patch, NOW));

    await expect(change({ id: input.id, make: 2 })).rejects.toMatchObject({ code: "PLAN_BATCH" });
    await change({ id: input.id, make: 3 });
    await expect(change({ id: a.id, servings: 2 })).rejects.toMatchObject({ code: "PLAN_BATCH" });
    await change({ id: input.id, make: 5, servings: 2 });
    await change({ id: a.id, servings: 1.5 });

    const fruit = randomUUID();
    await inTenant((tx) => planFood(tx, ctx, { id: fruit, day: TODAY, meal: "snack", fdcId: BANANA, amount: 1, portion: "1 banana" }, NOW));
    await change({ id: fruit, amount: 2 });
    await expect(change({ id: fruit, amount: 1, portion: "1 bucket" })).rejects.toMatchObject({ code: "PORTION" });

    const rows = await inTenant((tx) => planBetween(tx, tenant.id, TODAY, "2026-10-09"));
    expect(rows.find((r) => r.id === input.id)).toMatchObject({ make: 5, servings: 2 });
    expect(rows.find((r) => r.id === a.id)?.servings).toBe(1.5);
    expect(rows.find((r) => r.id === fruit)).toMatchObject({ amount: 2, grams: 252 });
  });

  it("takes a cook off with its leftovers, and a deleted recipe takes its plan", async () => {
    const chili = await aRecipe("Turkey chili");
    const input = cook(chili, { leftovers: [left("2026-10-08"), left("2026-10-09")] });
    await inTenant((tx) => planCook(tx, ctx, input, NOW));
    await inTenant((tx) => removePlan(tx, tenant.id, input.id));
    await inTenant((tx) => removePlan(tx, tenant.id, input.id));
    expect(await planRows()).toHaveLength(0);

    const soup = await aRecipe("Soup");
    await inTenant((tx) => planCook(tx, ctx, cook(soup, { leftovers: [left("2026-10-08")] }), NOW));
    await inTenant((tx) => deleteRecipe(tx, tenant.id, soup));
    expect(await planRows()).toHaveLength(0);
  });

  it("logs a planned meal with one tap, once, on its day", async () => {
    const chili = await aRecipe("Turkey chili");
    const later = left("2026-10-08");
    const input = cook(chili, { leftovers: [later] });
    await inTenant((tx) => planCook(tx, ctx, input, NOW));

    await inTenant((tx) => ateIt(tx, ctx, { planId: input.id, eatenId: randomUUID() }, NOW));
    await inTenant((tx) => ateIt(tx, ctx, { planId: input.id, eatenId: randomUUID() }, NOW));
    expect(await eatenFor(input.id)).toEqual([expect.objectContaining({ recipeId: chili, amount: 1, calories: 520, grams: null })]);
    const [planned] = await inTenant((tx) => planBetween(tx, tenant.id, TODAY, TODAY));
    expect(planned.eatenId).toBe((await eatenFor(input.id))[0].id);

    // Tomorrow's leftovers are not eaten yet; tomorrow they are, from the cook's recipe.
    await expect(inTenant((tx) => ateIt(tx, ctx, { planId: later.id, eatenId: randomUUID() }, NOW))).rejects.toMatchObject({ code: "DAY" });
    await inTenant((tx) => ateIt(tx, ctx, { planId: later.id, eatenId: randomUUID() }, new Date("2026-10-08T16:00:00Z")));
    expect(await eatenFor(later.id)).toEqual([expect.objectContaining({ recipeId: chili, amount: 1, calories: 520 })]);

    const fruit = randomUUID();
    await inTenant((tx) => planFood(tx, ctx, { id: fruit, day: TODAY, meal: "snack", fdcId: BANANA, amount: 1, portion: "1 banana" }, NOW));
    await inTenant((tx) => ateIt(tx, ctx, { planId: fruit, eatenId: randomUUID() }, NOW));
    expect(await eatenFor(fruit)).toEqual([expect.objectContaining({ grams: 126 })]);

    const ahead = cook(chili, { day: TODAY, meal: "lunch", eat: 0 });
    await inTenant((tx) => planCook(tx, ctx, ahead, NOW));
    await expect(inTenant((tx) => ateIt(tx, ctx, { planId: ahead.id, eatenId: randomUUID() }, NOW))).rejects.toMatchObject({
      code: "PLAN_NOTHING",
    });
  });

  it("logs a planned meal changed first through Log food, and keeps the log when the week is cleared", async () => {
    const chili = await aRecipe("Turkey chili");
    const input = cook(chili);
    await inTenant((tx) => planCook(tx, ctx, input, NOW));

    const eatenId = randomUUID();
    await inTenant((tx) =>
      logRecipe(tx, ctx, { id: eatenId, day: TODAY, meal: "dinner", recipeId: chili, servings: 2, planId: input.id }, NOW),
    );
    await inTenant((tx) => ateIt(tx, ctx, { planId: input.id, eatenId: randomUUID() }, NOW));
    expect(await eatenFor(input.id)).toEqual([expect.objectContaining({ id: eatenId, amount: 2, calories: 1040 })]);

    // Taken off the log, the planned meal is waiting again.
    await inTenant((tx) => deleteEaten(tx, tenant.id, eatenId));
    expect((await inTenant((tx) => planItem(tx, tenant.id, input.id)))?.eatenId).toBeNull();

    // Eaten, then the week cleared: what was eaten stays, no longer a plan's.
    const again = randomUUID();
    await inTenant((tx) => ateIt(tx, ctx, { planId: input.id, eatenId: again }, NOW));
    await inTenant((tx) => removePlan(tx, tenant.id, input.id));
    const [kept] = await withSystem((tx) =>
      tx.select({ planId: schema.foodEaten.planId, calories: schema.foodEaten.calories }).from(schema.foodEaten).where(eq(schema.foodEaten.id, again)),
    );
    expect(kept).toEqual({ planId: null, calories: 520 });

    await expect(
      inTenant((tx) =>
        logRecipe(tx, ctx, { id: randomUUID(), day: TODAY, meal: "dinner", recipeId: chili, servings: 1, planId: randomUUID() }, NOW),
      ),
    ).rejects.toMatchObject({ code: "PLAN_MISSING" });
  });

  it("repeats a week on the next, its leftovers following their cooks, and says which weeks have plans", async () => {
    const chili = await aRecipe("Turkey chili");
    const input = cook(chili, { leftovers: [left("2026-10-08")] });
    await inTenant((tx) => planCook(tx, ctx, input, NOW));
    await inTenant((tx) =>
      planFood(tx, ctx, { id: randomUUID(), day: "2026-10-09", meal: "breakfast", fdcId: BANANA, amount: 1, portion: "1 banana" }, NOW),
    );

    const added = await inTenant((tx) => repeatWeek(tx, ctx, { from: "2026-10-05", to: "2026-10-12" }, NOW));
    expect(added).toBe(3);
    const next = await inTenant((tx) => planBetween(tx, tenant.id, "2026-10-12", "2026-10-18"));
    expect(next.map((i) => [i.day, i.meal, i.kind])).toEqual([
      ["2026-10-14", "dinner", "cook"],
      ["2026-10-15", "lunch", "leftover"],
      ["2026-10-16", "breakfast", "food"],
    ]);
    expect(next[1].cookId).toBe(next[0].id);
    expect(next[0].id).not.toBe(input.id);

    for (const bad of [
      { from: "2026-10-12", to: "2026-10-12" },
      { from: "2026-10-05", to: "2026-10-19" },
      { from: "2026-10-06", to: "2026-10-12" },
      { from: "2026-06-29", to: "2026-10-12" },
    ]) {
      await expect(inTenant((tx) => repeatWeek(tx, ctx, bad, NOW))).rejects.toMatchObject({ code: "PLAN_WEEK" });
    }

    expect(await inTenant((tx) => weeksPlanned(tx, tenant.id, "2026-09-01", "2026-10-18"))).toEqual([
      { monday: "2026-10-12", count: 3 },
      { monday: "2026-10-05", count: 3 },
    ]);
    const taken = await inTenant((tx) => takenSlots(tx, tenant.id, TODAY, "2026-10-18"));
    expect(taken).toEqual(expect.arrayContaining([`${TODAY}:dinner`, "2026-10-08:lunch", "2026-10-16:breakfast"]));
    expect(taken).toHaveLength(6);
  });

  it("repeats last week on this one from today on, a day gone by left out", async () => {
    const chili = await aRecipe("Turkey chili");
    const monday = new Date("2026-09-28T16:00:00Z");
    // Planned last week, while it was this week: Monday's dinner, Thursday's dinner.
    await inTenant((tx) => planCook(tx, ctx, cook(chili, { day: "2026-09-28" }), monday));
    await inTenant((tx) => planCook(tx, ctx, cook(chili, { day: "2026-10-01" }), monday));
    const added = await inTenant((tx) => repeatWeek(tx, ctx, { from: "2026-09-28", to: "2026-10-05" }, NOW));
    expect(added).toBe(1);
    const week = await inTenant((tx) => planBetween(tx, tenant.id, "2026-10-05", "2026-10-11"));
    expect(week.map((i) => i.day)).toEqual(["2026-10-08"]);
  });
});
