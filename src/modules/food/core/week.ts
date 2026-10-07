import { z } from "zod";
import type { FoodNutrition, FoodPortion } from "@/db/schema";
import { addDays, startOfWeek } from "@/lib/timezone";
import {
  MEALS,
  MEAL_LABELS,
  NO_NUTRIENTS,
  amountWords,
  forGrams,
  forServings,
  totals,
  type DayTotals,
  type Meal,
  type NutrientKey,
  type Nutrients,
} from "./eating";
import { plainNumber, yieldWords } from "./recipe";

/**
 * THE WEEK (D2, docs/modules/food.md, ADR 0129; the founder's calls
 * 2026-10-03, from a mockup): recipes and foods put on days and meals; a
 * recipe COOKED ONCE AND EATEN AGAIN, its leftovers put on later meals so the
 * shopping list buys once for the batch; each day's calories and protein
 * against the targets; a past week repeated; and a planned meal logged from
 * Today with one tap ("Ate it"). Pure: the weeks, the meals in order, the
 * leftovers a cook can feed, the numbers, a week repeated, and the inputs.
 */

export const PLAN_KINDS = ["cook", "leftover", "food"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/* -- weeks ------------------------------------------------------------------ */

/** The Monday a day's week starts on: weeks run Monday to Sunday, as Workouts' and Health's do. */
export function mondayOf(day: string): string {
  return startOfWeek(day, 1);
}

/** A week's seven days, Monday first. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** How many weeks back a past week can be looked at, and repeated. */
export const PLAN_BACK_WEEKS = 12;

/** The days that can be planned or changed: this week's Monday to next week's Sunday, as the space counts them. */
export function plannable(today: string): { from: string; to: string } {
  const from = mondayOf(today);
  return { from, to: addDays(from, 13) };
}

export function canPlan(day: string, today: string): boolean {
  const { from, to } = plannable(today);
  return day >= from && day <= to;
}

/** The days Put on the week offers: today to next week's Sunday. */
export function daysToPlan(today: string): string[] {
  const { to } = plannable(today);
  const out: string[] = [];
  for (let day = today; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** The Mondays a week page can show: the PLAN_BACK_WEEKS before this one, this one, and the next. */
export function weekInReach(monday: string, today: string): boolean {
  const now = mondayOf(today);
  return monday >= addDays(now, -7 * PLAN_BACK_WEEKS) && monday <= addDays(now, 7);
}

/* -- meals in order --------------------------------------------------------- */

/** A meal on a day. */
export interface Slot {
  day: string;
  meal: Meal;
}

export function slotKey(slot: Slot): string {
  return `${slot.day}:${slot.meal}`;
}

/** Earlier first: by day, then breakfast, lunch, dinner and snacks. */
export function compareSlots(a: Slot, b: Slot): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal);
}

/** Whether `a` comes after `b`: a leftover must come after the meal it is cooked at. */
export function isAfter(a: Slot, b: Slot): boolean {
  return compareSlots(a, b) > 0;
}

/* -- leftovers ---------------------------------------------------------------- */

/** How many days after a cook its leftovers are offered: three or four days in the fridge is USDA's advice. */
export const LEFTOVER_DAYS = 4;

/**
 * The meals a cook's leftovers are offered for: lunch and dinner after it, up
 * to LEFTOVER_DAYS days on, inside what can be planned. Breakfast and snacks
 * are not offered (a leftover can still be moved there).
 */
export function leftoverChoices(cook: Slot, today: string): Slot[] {
  const { to } = plannable(today);
  const out: Slot[] = [];
  for (let i = 0; i <= LEFTOVER_DAYS; i++) {
    const day = addDays(cook.day, i);
    if (day > to) break;
    for (const meal of ["lunch", "dinner"] as const) {
      const slot = { day, meal };
      if (isAfter(slot, cook) && day >= today) out.push(slot);
    }
  }
  return out;
}

/** What one leftover is: as much as the person eats at the cook, or a serving when they eat none there. */
export function leftoverServings(eat: number): number {
  return eat > 0 ? eat : 1;
}

/** How many leftovers a batch has after the person's own: 4 made, 1 eaten, 3 left of 1. */
export function leftoverCount(make: number, eat: number): number {
  const rest = make - eat;
  return rest <= 0 ? 0 : Math.floor(rest / leftoverServings(eat) + 1e-9);
}

/**
 * The leftovers put on first, as drawn: the next free lunches, then the next
 * free dinners, `count` of them, earliest first. A meal with something planned
 * already is not free.
 */
export function firstLeftovers(choices: readonly Slot[], count: number, taken: ReadonlySet<string>): Slot[] {
  const free = choices.filter((slot) => !taken.has(slotKey(slot)));
  const picked = free.filter((slot) => slot.meal === "lunch").slice(0, count);
  if (picked.length < count) picked.push(...free.filter((slot) => slot.meal === "dinner").slice(0, count - picked.length));
  return picked.sort(compareSlots);
}

/** What is left of a batch once the person's own and its leftovers are taken: never below 0 by more than a rounding. */
export function batchLeft(make: number, eat: number, leftovers: readonly number[]): number {
  return make - eat - leftovers.reduce((sum, n) => sum + n, 0);
}

/** Whether what is eaten from a batch fits in it. */
export function batchFits(make: number, eat: number, leftovers: readonly number[]): boolean {
  return batchLeft(make, eat, leftovers) >= -1e-9;
}

/* -- words ----------------------------------------------------------------- */

function utc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Mon". */
export function shortDay(day: string): string {
  return utc(day).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

/** "Mon, Oct 6". */
export function dayTitle(day: string): string {
  return utc(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Tue lunch", or "Today's lunch" / "Tomorrow's dinner" near today. */
export function slotWords(slot: Slot, today: string): string {
  const meal = MEAL_LABELS[slot.meal].toLowerCase();
  if (slot.day === today) return `Today's ${meal}`;
  if (slot.day === addDays(today, 1)) return `Tomorrow's ${meal}`;
  return `${shortDay(slot.day)} ${meal}`;
}

/** "Oct 6 to 12", or "Sep 29 to Oct 5" across a month. */
export function rangeWords(monday: string): string {
  const sunday = addDays(monday, 6);
  const month = (day: string) => utc(day).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const date = (day: string) => utc(day).getUTCDate();
  return month(monday) === month(sunday)
    ? `${month(monday)} ${date(monday)} to ${date(sunday)}`
    : `${month(monday)} ${date(monday)} to ${month(sunday)} ${date(sunday)}`;
}

/** "This week, Oct 6 to 12", "Next week, …", "Last week, …", or the dates alone. */
export function weekWords(monday: string, today: string): string {
  const now = mondayOf(today);
  const name = monday === now ? "This week" : monday === addDays(now, 7) ? "Next week" : monday === addDays(now, -7) ? "Last week" : null;
  return name ? `${name}, ${rangeWords(monday)}` : rangeWords(monday);
}

/* -- what a planned meal is ----------------------------------------------- */

/** A planned meal, as the week and Today show it. */
export interface PlanItem extends Slot {
  id: string;
  kind: PlanKind;
  /** The recipe's (a leftover's through its cook), or null for a food. */
  recipeId: string | null;
  /** A leftover's cook. */
  cookId: string | null;
  /** A food's place on the list, or null (a recipe, or a food gone from the list). */
  fdcId: number | null;
  /** The recipe's title, or the food's name. */
  name: string;
  /** What the person eats here: a cook's or a leftover's servings; null for a food. */
  servings: number | null;
  /** What a cook makes. */
  make: number | null;
  /** The recipe's own unit for what it makes ("servings", "cookies"), or null. */
  yieldUnit: string | null;
  /** A food's amount, portion and grams, as Log food has them, and its own portions on the list. */
  amount: number | null;
  portion: string | null;
  grams: number | null;
  portions: FoodPortion[] | null;
  /** The recipe's nutrition per serving as it states it now, or null. */
  perServing: FoodNutrition | null;
  /** A food's numbers per 100 g on the list now, or null when it has gone from the list. */
  per100g: Record<NutrientKey, number> | null;
  /** The eaten row it became ("Ate it"), or null while it is only planned. */
  eatenId: string | null;
  /** A leftover's cook, where it is. */
  cookSlot: Slot | null;
  /** A cook's leftovers, wherever they are, earliest first. */
  leftovers: { id: string; day: string; meal: Meal; servings: number }[];
  /** The recipe's photo, for Today's Up next and its rows (the redesign); null or absent without one. */
  photoUrl?: string | null;
  /** A food's USDA category, for its icon; null or absent for a recipe. */
  category?: string | null;
}

/** What a planned meal comes to, worked out now: a recipe's servings, or a food's grams. */
export function planNumbers(item: Pick<PlanItem, "kind" | "servings" | "perServing" | "grams" | "per100g">): Nutrients {
  if (item.kind === "food") {
    return item.grams !== null && item.per100g !== null ? forGrams(item.per100g, item.grams) : { ...NO_NUTRIENTS };
  }
  return forServings(item.perServing, item.servings ?? 0);
}

/** Whether a planned meal has anything for the person to eat: a batch made ahead has none at its cook. */
export function eatsHere(item: Pick<PlanItem, "kind" | "servings">): boolean {
  return item.kind === "food" || (item.servings ?? 0) > 0;
}

/** A day of the plan added up: what the person eats there, a cook made ahead counting nothing. */
export function planTotals(items: readonly PlanItem[]): DayTotals {
  return totals(items.filter(eatsHere).map(planNumbers));
}

/** A week's days averaged: only the days with something planned, as a week of eating averages the days logged. */
export function weekAverage(days: readonly DayTotals[]): { calories: number | null; proteinG: number | null; days: number } {
  const planned = days.filter((day) => day.count > 0);
  const average = (key: "calories" | "proteinG") => {
    const known = planned.map((day) => day[key]).filter((n): n is number => n !== null);
    return known.length === 0 ? null : known.reduce((sum, n) => sum + n, 0) / known.length;
  };
  return { calories: average("calories"), proteinG: average("proteinG"), days: planned.length };
}

/** The line under a planned meal's name: "Cook 4, eat 1", "Cook 4 servings, eat none", "1 serving", "1 cup". */
export function planAmountWords(item: Pick<PlanItem, "kind" | "servings" | "make" | "yieldUnit" | "amount" | "portion">): string {
  if (item.kind === "food") return item.amount !== null && item.portion !== null ? amountWords(item.amount, item.portion) : "";
  if (item.kind === "leftover") return `Leftovers · ${yieldWords(item.servings ?? 0, item.yieldUnit)}`;
  const eat = item.servings ?? 0;
  return `Cook ${yieldWords(item.make ?? 0, item.yieldUnit)}, ${eat > 0 ? `eat ${plainNumber(eat)}` : "eat none here"}`;
}

/* -- a week repeated ---------------------------------------------------------- */

/** A planned row as it is written: what Repeat a week copies. */
export interface PlanRowLike extends Slot {
  id: string;
  kind: PlanKind;
  recipeId: string | null;
  cookId: string | null;
  servings: number | null;
  make: number | null;
  fdcId: number | null;
  name: string | null;
  amount: number | null;
  portion: string | null;
  grams: number | null;
}

/**
 * A past week's plan on another week: each meal on the same weekday, a day
 * already gone left out (Today's days are the first copied), a leftover
 * following its cook to the new week and left out when its cook is. A food no
 * longer on the list is left out. New ids from `newId`, cooks before their
 * leftovers.
 */
export function repeatPlan(rows: readonly PlanRowLike[], from: string, to: string, today: string, newId: () => string): PlanRowLike[] {
  const offset = Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
  const moved = (row: PlanRowLike) => addDays(row.day, offset);
  const keep = (row: PlanRowLike) => {
    const day = moved(row);
    return day >= today && canPlan(day, today);
  };
  const cooks = new Map<string, string>();
  const out: PlanRowLike[] = [];
  for (const row of [...rows].sort((a, b) => compareSlots(a, b))) {
    if (row.kind !== "cook" || !keep(row)) continue;
    const id = newId();
    cooks.set(row.id, id);
    out.push({ ...row, id, day: moved(row) });
  }
  for (const row of [...rows].sort((a, b) => compareSlots(a, b))) {
    if (row.kind === "cook" || !keep(row)) continue;
    if (row.kind === "leftover") {
      const cookId = row.cookId === null ? undefined : cooks.get(row.cookId);
      if (!cookId) continue;
      out.push({ ...row, id: newId(), day: moved(row), cookId });
    } else if (row.fdcId !== null) {
      out.push({ ...row, id: newId(), day: moved(row) });
    }
  }
  return out.sort(compareSlots);
}

/* -- inputs ------------------------------------------------------------------- */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const meal = z.enum(MEALS);
const servings = z.number().positive().max(999);

const leftoverInput = z.object({ id: z.string().uuid(), day, meal, servings });

/** Put a recipe on the week: cooked at a meal, `make` servings, `eat` of them there, and its leftovers. */
export const planCookSchema = z.object({
  id: z.string().uuid(),
  day,
  meal,
  recipeId: z.string().uuid(),
  make: servings,
  eat: z.number().min(0).max(999),
  leftovers: z.array(leftoverInput).max(20),
});
export type PlanCookInput = z.infer<typeof planCookSchema>;

/** Put a food from the list on the week, by its amount. */
export const planFoodSchema = z.object({
  id: z.string().uuid(),
  day,
  meal,
  fdcId: z.number().int().positive(),
  amount: z.number().positive().max(100_000),
  portion: z.string().trim().min(1).max(120),
});
export type PlanFoodInput = z.infer<typeof planFoodSchema>;

/** More leftovers of a cook already on the week. */
export const addLeftoversSchema = z.object({
  cookId: z.string().uuid(),
  leftovers: z.array(leftoverInput).min(1).max(20),
});
export type AddLeftoversInput = z.infer<typeof addLeftoversSchema>;

/** Move a planned meal to another day or meal. */
export const movePlanSchema = z.object({ id: z.string().uuid(), day, meal });
export type MovePlanInput = z.infer<typeof movePlanSchema>;

/**
 * Change how much: a cook's batch and what is eaten there, a leftover's
 * servings, or a food's amount (and portion).
 */
export const changePlanSchema = z.object({
  id: z.string().uuid(),
  make: servings.optional(),
  servings: z.number().min(0).max(999).optional(),
  amount: z.number().positive().max(100_000).optional(),
  portion: z.string().trim().min(1).max(120).optional(),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

/** "Ate it": a planned meal logged as it was planned, the eaten row's id the phone's. */
export const ateItSchema = z.object({ planId: z.string().uuid(), eatenId: z.string().uuid() });
export type AteItInput = z.infer<typeof ateItSchema>;

/** Repeat a past week on this week or the next. */
export const repeatWeekSchema = z.object({ from: day, to: day });
export type RepeatWeekInput = z.infer<typeof repeatWeekSchema>;
