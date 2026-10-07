import { CALORIE_TOLERANCE, MEAL_LABELS, caloriesOnTarget, gramWords, proteinOnTarget, type Meal, type Nutrients } from "./eating";

/**
 * TODAY'S WORDS AND SHAPES (the Fresh Market redesign, docs/help/food/overview.md):
 * the greeting, what is up next, the line under the day's numbers and the
 * split of the day's calories. Pure, so the screen and the tests agree.
 */

/** "Good morning" from 4 to 11, "Good afternoon" to 5, "Good evening" to 4 in the morning (the design's hours). */
export function greetingFor(hour: number): string {
  if (hour >= 4 && hour < 11) return "Good morning";
  if (hour >= 11 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * When each meal is over, for what is up next: breakfast at 11, lunch at 3,
 * dinner at 10 at night, and a snack not before the day is (4 the next
 * morning, as hour 28). By these and not by `MEALS`' order, which puts the
 * snack last: at half past three, `mealAt` says snack and dinner is still to
 * come.
 */
const MEAL_ENDS: Record<Meal, number> = { breakfast: 11, lunch: 15, dinner: 22, snack: 28 };

/** The hour on a clock that runs past midnight to 4, so 1 in the morning is 25: still the day before. */
function dayHour(hour: number): number {
  return hour < 4 ? hour + 24 : hour;
}

/**
 * What is up next today: the first planned meal not yet eaten whose meal is
 * not over, earliest ending first. A batch cooked ahead (no servings eaten
 * there) has nothing to eat, so it is never up next.
 */
export function upNext<T extends { meal: Meal; eatenId: string | null }>(
  plans: readonly T[],
  hour: number,
  eatsHere: (plan: T) => boolean,
): T | null {
  const now = dayHour(hour);
  let best: T | null = null;
  for (const plan of plans) {
    if (plan.eatenId !== null || !eatsHere(plan) || MEAL_ENDS[plan.meal] <= now) continue;
    if (best === null || MEAL_ENDS[plan.meal] < MEAL_ENDS[best.meal]) best = plan;
  }
  return best;
}

/** "dinner's already planned", for the line under the greeting. */
export function plannedWords(meal: Meal): string {
  return meal === "snack" ? "a snack's already planned" : `${MEAL_LABELS[meal].toLowerCase()}'s already planned`;
}

/** One meal by name, as Up next says it: "Dinner", "Snack" (the meal's label is "Snacks", a part of the day). */
export function mealName(meal: Meal): string {
  return meal === "snack" ? "Snack" : MEAL_LABELS[meal];
}

export interface Targets {
  calories: number | null;
  proteinG: number | null;
}

/** How far round a ring is: the share of the target, 0 to 1. */
export function ringShare(value: number | null, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, (value ?? 0) / target));
}

/** The figure in the middle of the ring: calories left, or over. */
export function caloriesLeft(eaten: number | null, target: number): { amount: number; over: boolean } {
  const left = Math.round(target - (eaten ?? 0));
  return left >= 0 ? { amount: left, over: false } : { amount: -left, over: true };
}

/**
 * Where the day's calories came from: each macro's share of the energy in
 * them, protein and carbs at 4 kcal a gram and fat at 9. Null when nothing
 * with macros was eaten, so the bar is not drawn empty.
 */
export function energySplit(day: Pick<Nutrients, "proteinG" | "carbsG" | "fatG">): { protein: number; carbs: number; fat: number } | null {
  const protein = (day.proteinG ?? 0) * 4;
  const carbs = (day.carbsG ?? 0) * 4;
  const fat = (day.fatG ?? 0) * 9;
  const all = protein + carbs + fat;
  if (all <= 0) return null;
  return { protein: protein / all, carbs: carbs / all, fat: fat / all };
}

function percent(value: number, target: number): string {
  return `${Math.round((value / target) * 100)}%`;
}

function kcalNumber(calories: number): string {
  return `${Math.round(calories).toLocaleString("en-US")} kcal`;
}

/**
 * THE LINE UNDER THE DAY'S NUMBERS, encouraging and true. Before the meal up
 * next is eaten: where it takes the day ("Dinner gets you to 70% of calories
 * and 75% of protein."). Once nothing is up next: what is left to go, or that
 * the day is on target. A past day only says it was on target. Null with no
 * target, or with nothing true to say.
 */
export function cheerFor(input: {
  day: Pick<Nutrients, "calories" | "proteinG">;
  targets: Targets;
  /** The meal up next and its numbers, or null. */
  next: { meal: Meal; numbers: Pick<Nutrients, "calories" | "proteinG"> } | null;
  isToday: boolean;
}): string | null {
  const { day, targets, next, isToday } = input;
  const calorieTarget = targets.calories;
  const proteinTarget = targets.proteinG;
  if (calorieTarget === null && proteinTarget === null) return null;

  const eaten = day.calories ?? 0;
  const protein = day.proteinG ?? 0;
  const onTarget =
    (calorieTarget === null || caloriesOnTarget(eaten, calorieTarget) === true) &&
    (proteinTarget === null || proteinOnTarget(protein, proteinTarget) === true);
  const targetNames = [calorieTarget !== null ? "calories" : null, proteinTarget !== null ? "protein" : null].filter(Boolean).join(" and ");

  if (!isToday) return onTarget ? `On target for ${targetNames}.` : null;
  if (onTarget) return `On target for ${targetNames}. A good day.`;

  if (next && next.numbers.calories !== null) {
    const parts = [
      calorieTarget !== null ? `${percent(eaten + next.numbers.calories, calorieTarget)} of calories` : null,
      proteinTarget !== null && next.numbers.proteinG !== null ? `${percent(protein + next.numbers.proteinG, proteinTarget)} of protein` : null,
    ].filter(Boolean);
    if (parts.length > 0) return `${next.meal === "snack" ? "Your snack" : MEAL_LABELS[next.meal]} gets you to ${parts.join(" and ")}.`;
  }

  const over = calorieTarget !== null && eaten > calorieTarget * (1 + CALORIE_TOLERANCE);
  const toGo = [
    calorieTarget !== null && !over && eaten < calorieTarget ? kcalNumber(calorieTarget - eaten) : null,
    proteinTarget !== null && protein < proteinTarget ? `${gramWords(proteinTarget - protein)} protein` : null,
  ].filter(Boolean);
  if (over) {
    const overBy = `${kcalNumber(eaten - (calorieTarget as number))} over your calorie target`;
    return toGo.length > 0 ? `${overBy}, ${toGo.join(" and ")} to go.` : `${overBy}.`;
  }
  if (toGo.length === 0) return null;
  // Nothing eaten yet is the whole day to go, not a good day so far.
  return eaten > 0 ? `${toGo.join(" and ")} to go. A good day.` : `${toGo.join(" and ")} to go.`;
}
