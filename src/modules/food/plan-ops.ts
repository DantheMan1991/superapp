import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Tx } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { addDays, todayInTimezone } from "@/lib/timezone";
import { FoodError } from "./core/errors";
import { MEALS, gramsFor, type Meal } from "./core/eating";
import {
  batchFits,
  canPlan,
  isAfter,
  mondayOf,
  repeatPlan,
  weekInReach,
  type AddLeftoversInput,
  type AteItInput,
  type ChangePlanInput,
  type MovePlanInput,
  type PlanCookInput,
  type PlanFoodInput,
  type PlanItem,
  type PlanRowLike,
  type RepeatWeekInput,
  type Slot,
} from "./core/week";
import { checkDay, getFood, insertEatenFood, insertEatenRecipe } from "./eating-ops";
import { effectiveNutrition } from "./core/nutrition";
import { recipePhotoOrNull } from "./core/photo-url";

/**
 * THE WEEK, KEPT (D2, docs/modules/food.md, ADR 0129): what is planned, put on
 * the week, moved, changed, taken off, repeated from a past week, and logged
 * from Today ("Ate it"). Every read and write takes the space's own
 * transaction, so RLS decides whose rows they are; the tenant in each `where`
 * is the second lock. The numbers are never kept here: a planned meal is
 * worked out from its recipe or the food list whenever it is read.
 */

const p = schema.foodPlan;
const mealOrder = sql`array_position(${sql.param([...MEALS])}::text[], ${p.meal}::text)`;

/** A day that can be planned or changed: this week and the next, as the space counts them. */
function checkPlanDay(day: string, timeZone: string, now: Date): void {
  if (!canPlan(day, todayInTimezone(timeZone, now))) throw new FoodError("PLAN_DAY");
}

function slotOf(row: { plannedOn: string; meal: Meal }): Slot {
  return { day: row.plannedOn, meal: row.meal };
}

/* -- reading --------------------------------------------------------------- */

/**
 * Every planned meal in a run of days, both ends included, in the order the
 * week shows them, with its recipe or food as they are now, whether it has
 * been eaten, a leftover's cook and a cook's leftovers (wherever they are).
 */
export async function planBetween(tx: Tx, tenantId: string, from: string, to: string): Promise<PlanItem[]> {
  const cook = alias(schema.foodPlan, "cook");
  const r = schema.foodRecipes;
  const f = schema.foodUsdaFoods;
  const e = schema.foodEaten;
  const rows = await tx
    .select({
      id: p.id,
      plannedOn: p.plannedOn,
      meal: p.meal,
      kind: p.kind,
      recipeId: sql<string | null>`coalesce(${p.recipeId}, ${cook.recipeId})`,
      cookId: p.cookId,
      cookOn: cook.plannedOn,
      cookMeal: cook.meal,
      servings: p.servings,
      make: p.make,
      foodId: p.fdcId,
      name: p.name,
      amount: p.amount,
      portion: p.portion,
      grams: p.grams,
      title: r.title,
      yieldUnit: r.yieldUnit,
      yieldAmount: r.yieldAmount,
      nutrition: r.nutrition,
      worked: r.workedNutrition,
      photo: r.photoPathname,
      fdcId: f.fdcId,
      category: f.category,
      portions: f.portions,
      calories: f.calories,
      proteinG: f.proteinG,
      carbsG: f.carbsG,
      fatG: f.fatG,
      fiberG: f.fiberG,
      sugarG: f.sugarG,
      sodiumMg: f.sodiumMg,
      eatenId: e.id,
    })
    .from(p)
    .leftJoin(cook, and(eq(cook.tenantId, p.tenantId), eq(cook.id, p.cookId)))
    .leftJoin(r, and(eq(r.tenantId, p.tenantId), eq(r.id, sql`coalesce(${p.recipeId}, ${cook.recipeId})`)))
    .leftJoin(f, eq(f.fdcId, p.fdcId))
    .leftJoin(e, and(eq(e.tenantId, p.tenantId), eq(e.planId, p.id)))
    .where(and(eq(p.tenantId, tenantId), gte(p.plannedOn, from), lte(p.plannedOn, to)))
    .orderBy(asc(p.plannedOn), mealOrder, asc(p.createdAt));

  const cookIds = rows.filter((row) => row.kind === "cook").map((row) => row.id);
  const leftovers =
    cookIds.length === 0
      ? []
      : await tx
          .select({ id: p.id, cookId: p.cookId, plannedOn: p.plannedOn, meal: p.meal, servings: p.servings })
          .from(p)
          .where(and(eq(p.tenantId, tenantId), inArray(p.cookId, cookIds)))
          .orderBy(asc(p.plannedOn), mealOrder, asc(p.createdAt));
  const byCook = new Map<string, PlanItem["leftovers"]>();
  for (const left of leftovers) {
    if (!left.cookId) continue;
    const list = byCook.get(left.cookId) ?? [];
    list.push({ id: left.id, day: left.plannedOn, meal: left.meal, servings: left.servings ?? 0 });
    byCook.set(left.cookId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    day: row.plannedOn,
    meal: row.meal,
    kind: row.kind,
    recipeId: row.kind === "food" ? null : row.recipeId,
    cookId: row.cookId,
    fdcId: row.foodId,
    name: row.kind === "food" ? (row.name ?? "") : (row.title ?? ""),
    servings: row.servings,
    make: row.make,
    yieldUnit: row.kind === "food" ? null : (row.yieldUnit ?? null),
    amount: row.amount,
    portion: row.portion,
    grams: row.grams,
    portions: row.kind === "food" ? (row.portions ?? null) : null,
    // The recipe's own numbers first, worked out for the rest (D4).
    perServing: row.kind === "food" ? null : effectiveNutrition(row.nutrition, row.worked, row.yieldAmount),
    per100g:
      row.kind === "food" && row.fdcId !== null
        ? {
            calories: row.calories as number,
            proteinG: row.proteinG as number,
            carbsG: row.carbsG as number,
            fatG: row.fatG as number,
            fiberG: row.fiberG as number,
            sugarG: row.sugarG as number,
            sodiumMg: row.sodiumMg as number,
          }
        : null,
    eatenId: row.eatenId,
    cookSlot: row.kind === "leftover" && row.cookOn && row.cookMeal ? { day: row.cookOn, meal: row.cookMeal } : null,
    leftovers: row.kind === "cook" ? (byCook.get(row.id) ?? []) : [],
    photoUrl: row.kind === "food" ? null : recipePhotoOrNull(row.recipeId, row.photo),
    category: row.kind === "food" ? (row.category ?? null) : null,
  }));
}

/** One planned meal, as the week shows it, or null when it is not on the week. */
export async function planItem(tx: Tx, tenantId: string, id: string): Promise<PlanItem | null> {
  const [row] = await tx
    .select({ plannedOn: p.plannedOn })
    .from(p)
    .where(and(eq(p.tenantId, tenantId), eq(p.id, id)))
    .limit(1);
  if (!row) return null;
  return (await planBetween(tx, tenantId, row.plannedOn, row.plannedOn)).find((item) => item.id === id) ?? null;
}

/** One day's plan: what Today shows under each meal. */
export function planOn(tx: Tx, tenantId: string, day: string): Promise<PlanItem[]> {
  return planBetween(tx, tenantId, day, day);
}

/** The meals with something planned in a run of days ("Tue:lunch"), for the leftovers Put on the week offers first. */
export async function takenSlots(tx: Tx, tenantId: string, from: string, to: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ plannedOn: p.plannedOn, meal: p.meal })
    .from(p)
    .where(and(eq(p.tenantId, tenantId), gte(p.plannedOn, from), lte(p.plannedOn, to)));
  return rows.map((row) => `${row.plannedOn}:${row.meal}`);
}

/** The weeks in a run with anything planned, the latest first, and how many meals each has: Repeat a week's choices. */
export async function weeksPlanned(tx: Tx, tenantId: string, from: string, to: string): Promise<{ monday: string; count: number }[]> {
  const monday = sql<string>`to_char(date_trunc('week', ${p.plannedOn}::timestamp), 'YYYY-MM-DD')`;
  const rows = await tx
    .select({ monday, count: sql<number>`count(*)::int` })
    .from(p)
    .where(and(eq(p.tenantId, tenantId), gte(p.plannedOn, from), lte(p.plannedOn, to)))
    .groupBy(monday)
    .orderBy(desc(monday));
  return rows.map((row) => ({ monday: String(row.monday), count: Number(row.count) }));
}

/* -- writing -------------------------------------------------------------- */

async function loadRow(tx: Tx, tenantId: string, id: string) {
  const [row] = await tx
    .select()
    .from(p)
    .where(and(eq(p.tenantId, tenantId), eq(p.id, id)))
    .limit(1);
  if (!row) throw new FoodError("PLAN_MISSING");
  return row;
}

async function leftoversOf(tx: Tx, tenantId: string, cookId: string) {
  return tx
    .select({ id: p.id, plannedOn: p.plannedOn, meal: p.meal, servings: p.servings })
    .from(p)
    .where(and(eq(p.tenantId, tenantId), eq(p.cookId, cookId)));
}

/**
 * Put a recipe on the week: cooked at a meal, `make` servings, `eat` of them
 * there, and its leftovers on later meals, all or none. The ids are the
 * phone's, so a Put on the week sent twice is one plan.
 */
export async function planCook(tx: Tx, ctx: TenantContext, input: PlanCookInput, now: Date = new Date()): Promise<void> {
  const tz = ctx.tenant.timezone;
  checkPlanDay(input.day, tz, now);
  for (const left of input.leftovers) {
    checkPlanDay(left.day, tz, now);
    if (!isAfter(left, input)) throw new FoodError("PLAN_ORDER");
  }
  if (
    input.eat > input.make + 1e-9 ||
    !batchFits(
      input.make,
      input.eat,
      input.leftovers.map((left) => left.servings),
    )
  ) {
    throw new FoodError("PLAN_BATCH");
  }
  const r = schema.foodRecipes;
  const [recipe] = await tx
    .select({ id: r.id })
    .from(r)
    .where(and(eq(r.tenantId, ctx.tenant.id), eq(r.id, input.recipeId)))
    .limit(1);
  if (!recipe) throw new FoodError("RECIPE_MISSING");

  await tx
    .insert(p)
    .values({
      id: input.id,
      tenantId: ctx.tenant.id,
      plannedOn: input.day,
      meal: input.meal,
      kind: "cook",
      recipeId: input.recipeId,
      servings: input.eat,
      make: input.make,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing({ target: p.id });
  if (input.leftovers.length > 0) {
    await tx
      .insert(p)
      .values(
        input.leftovers.map((left) => ({
          id: left.id,
          tenantId: ctx.tenant.id,
          plannedOn: left.day,
          meal: left.meal,
          kind: "leftover" as const,
          cookId: input.id,
          servings: left.servings,
          createdByClerkUserId: ctx.userId,
        })),
      )
      .onConflictDoNothing({ target: p.id });
  }
}

/** Put a food from the list on the week, by its amount, as Log food has it. */
export async function planFood(tx: Tx, ctx: TenantContext, input: PlanFoodInput, now: Date = new Date()): Promise<void> {
  checkPlanDay(input.day, ctx.tenant.timezone, now);
  const food = await getFood(tx, input.fdcId);
  if (!food) throw new FoodError("FOOD_MISSING");
  const grams = gramsFor(input.amount, input.portion, food.portions);
  if (grams === null || grams <= 0) throw new FoodError("PORTION");
  await tx
    .insert(p)
    .values({
      id: input.id,
      tenantId: ctx.tenant.id,
      plannedOn: input.day,
      meal: input.meal,
      kind: "food",
      fdcId: food.fdcId,
      name: food.name,
      amount: input.amount,
      portion: input.portion,
      grams,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing({ target: p.id });
}

/** More leftovers of a cook on the week, as long as the batch has them. */
export async function addLeftovers(tx: Tx, ctx: TenantContext, input: AddLeftoversInput, now: Date = new Date()): Promise<void> {
  const cook = await loadRow(tx, ctx.tenant.id, input.cookId);
  if (cook.kind !== "cook") throw new FoodError("PLAN_MISSING");
  for (const left of input.leftovers) {
    checkPlanDay(left.day, ctx.tenant.timezone, now);
    if (!isAfter(left, slotOf(cook))) throw new FoodError("PLAN_ORDER");
  }
  const existing = await leftoversOf(tx, ctx.tenant.id, cook.id);
  const fresh = input.leftovers.filter((left) => !existing.some((row) => row.id === left.id));
  if (
    !batchFits(cook.make ?? 0, cook.servings ?? 0, [
      ...existing.map((row) => row.servings ?? 0),
      ...fresh.map((left) => left.servings),
    ])
  ) {
    throw new FoodError("PLAN_BATCH");
  }
  if (fresh.length === 0) return;
  await tx
    .insert(p)
    .values(
      fresh.map((left) => ({
        id: left.id,
        tenantId: ctx.tenant.id,
        plannedOn: left.day,
        meal: left.meal,
        kind: "leftover" as const,
        cookId: cook.id,
        servings: left.servings,
        createdByClerkUserId: ctx.userId,
      })),
    )
    .onConflictDoNothing({ target: p.id });
}

/**
 * Move a planned meal to another day or meal, inside what can be planned. A
 * leftover stays after its cook, and a cook before all its leftovers.
 */
export async function movePlan(tx: Tx, ctx: TenantContext, input: MovePlanInput, now: Date = new Date()): Promise<void> {
  const row = await loadRow(tx, ctx.tenant.id, input.id);
  checkPlanDay(row.plannedOn, ctx.tenant.timezone, now);
  checkPlanDay(input.day, ctx.tenant.timezone, now);
  const to: Slot = { day: input.day, meal: input.meal };
  if (row.kind === "leftover" && row.cookId) {
    const cook = await loadRow(tx, ctx.tenant.id, row.cookId);
    if (!isAfter(to, slotOf(cook))) throw new FoodError("PLAN_ORDER");
  }
  if (row.kind === "cook") {
    const leftovers = await leftoversOf(tx, ctx.tenant.id, row.id);
    if (leftovers.some((left) => !isAfter(slotOf(left), to))) throw new FoodError("PLAN_ORDER");
  }
  await tx
    .update(p)
    .set({ plannedOn: input.day, meal: input.meal, updatedAt: now })
    .where(and(eq(p.tenantId, ctx.tenant.id), eq(p.id, row.id)));
}

/**
 * Change how much: a cook's batch and what is eaten there (never less than its
 * leftovers take), a leftover's servings (never more than its batch has), or a
 * food's amount and portion.
 */
export async function changePlan(tx: Tx, ctx: TenantContext, input: ChangePlanInput, now: Date = new Date()): Promise<void> {
  const row = await loadRow(tx, ctx.tenant.id, input.id);
  checkPlanDay(row.plannedOn, ctx.tenant.timezone, now);
  const where = and(eq(p.tenantId, ctx.tenant.id), eq(p.id, row.id));

  if (row.kind === "cook") {
    const make = input.make ?? row.make ?? 0;
    const eat = input.servings ?? row.servings ?? 0;
    const leftovers = await leftoversOf(tx, ctx.tenant.id, row.id);
    if (
      eat > make + 1e-9 ||
      !batchFits(
        make,
        eat,
        leftovers.map((left) => left.servings ?? 0),
      )
    ) {
      throw new FoodError("PLAN_BATCH");
    }
    await tx.update(p).set({ make, servings: eat, updatedAt: now }).where(where);
    return;
  }

  if (row.kind === "leftover") {
    const servings = input.servings;
    if (servings === undefined || servings <= 0 || !row.cookId) throw new FoodError("INVALID");
    const cook = await loadRow(tx, ctx.tenant.id, row.cookId);
    const leftovers = await leftoversOf(tx, ctx.tenant.id, cook.id);
    const taken = leftovers.map((left) => (left.id === row.id ? servings : (left.servings ?? 0)));
    if (!batchFits(cook.make ?? 0, cook.servings ?? 0, taken)) throw new FoodError("PLAN_BATCH");
    await tx.update(p).set({ servings, updatedAt: now }).where(where);
    return;
  }

  const amount = input.amount ?? row.amount ?? 0;
  const portion = input.portion ?? row.portion ?? "g";
  // A food gone from the list keeps grams and ounces.
  const food = row.fdcId === null ? null : await getFood(tx, row.fdcId);
  const grams = gramsFor(amount, portion, food?.portions ?? []);
  if (grams === null || grams <= 0) throw new FoodError("PORTION");
  await tx.update(p).set({ amount, portion, grams, updatedAt: now }).where(where);
}

/**
 * Take a planned meal off the week; a cook takes its leftovers with it (the
 * key cascades). What was eaten stays eaten. Already gone is fine: the person
 * wanted it gone.
 */
export async function removePlan(tx: Tx, tenantId: string, id: string): Promise<void> {
  await tx.delete(p).where(and(eq(p.tenantId, tenantId), eq(p.id, id)));
}

/**
 * "Ate it" on Today: the planned meal logged as it was planned, in its meal,
 * on its day (today, or the two weeks before), once. The eaten row keeps the
 * numbers it comes to now, as every eaten row does.
 */
export async function ateIt(tx: Tx, ctx: TenantContext, input: AteItInput, now: Date = new Date()): Promise<void> {
  const row = await loadRow(tx, ctx.tenant.id, input.planId);
  checkDay(row.plannedOn, ctx.tenant.timezone, now);
  if (row.kind === "food") {
    if (row.fdcId === null || row.amount === null || row.portion === null) throw new FoodError("FOOD_MISSING");
    await insertEatenFood(
      tx,
      ctx,
      {
        id: input.eatenId,
        day: row.plannedOn,
        meal: row.meal,
        fdcId: row.fdcId,
        amount: row.amount,
        portion: row.portion,
        planId: row.id,
      },
      "food",
    );
    return;
  }
  const servings = row.servings ?? 0;
  if (servings <= 0) throw new FoodError("PLAN_NOTHING");
  const recipeId = row.kind === "cook" ? row.recipeId : row.cookId ? (await loadRow(tx, ctx.tenant.id, row.cookId)).recipeId : null;
  if (!recipeId) throw new FoodError("RECIPE_MISSING");
  await insertEatenRecipe(tx, ctx, {
    id: input.eatenId,
    day: row.plannedOn,
    meal: row.meal,
    recipeId,
    servings,
    planId: row.id,
  });
}

/**
 * Repeat a week on this week or the next: each planned meal on the same
 * weekday, the days already gone left out, leftovers following their cooks
 * (`repeatPlan`). It adds to what the week has. How many meals it put on.
 */
export async function repeatWeek(tx: Tx, ctx: TenantContext, input: RepeatWeekInput, now: Date = new Date()): Promise<number> {
  const today = todayInTimezone(ctx.tenant.timezone, now);
  const thisWeek = mondayOf(today);
  if (
    mondayOf(input.from) !== input.from ||
    !weekInReach(input.from, today) ||
    (input.to !== thisWeek && input.to !== addDays(thisWeek, 7)) ||
    input.from >= input.to
  ) {
    throw new FoodError("PLAN_WEEK");
  }
  const rows = await tx
    .select()
    .from(p)
    .where(and(eq(p.tenantId, ctx.tenant.id), gte(p.plannedOn, input.from), lte(p.plannedOn, addDays(input.from, 6))));
  const source: PlanRowLike[] = rows.map((row) => ({
    id: row.id,
    day: row.plannedOn,
    meal: row.meal,
    kind: row.kind,
    recipeId: row.recipeId,
    cookId: row.cookId,
    servings: row.servings,
    make: row.make,
    fdcId: row.fdcId,
    name: row.name,
    amount: row.amount,
    portion: row.portion,
    grams: row.grams,
  }));
  const copies = repeatPlan(source, input.from, input.to, today, randomUUID);
  const values = (kind: "cook" | "rest") =>
    copies
      .filter((row) => (kind === "cook" ? row.kind === "cook" : row.kind !== "cook"))
      .map((row) => ({
        id: row.id,
        tenantId: ctx.tenant.id,
        plannedOn: row.day,
        meal: row.meal,
        kind: row.kind,
        recipeId: row.recipeId,
        cookId: row.cookId,
        servings: row.servings,
        make: row.make,
        fdcId: row.fdcId,
        name: row.name,
        amount: row.amount,
        portion: row.portion,
        grams: row.grams,
        createdByClerkUserId: ctx.userId,
      }));
  // Cooks first: a leftover's key points at its cook.
  const cooks = values("cook");
  const rest = values("rest");
  if (cooks.length > 0) await tx.insert(p).values(cooks);
  if (rest.length > 0) await tx.insert(p).values(rest);
  return copies.length;
}
