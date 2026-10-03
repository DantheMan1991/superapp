import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { localHourInTimezone, todayInTimezone } from "@/lib/timezone";
import { MEALS, mealAt, type Meal } from "@/modules/food/core/eating";
import { daysToPlan, plannable } from "@/modules/food/core/week";
import { recentEaten, recipeHit, searchRecipes } from "@/modules/food/eating-ops";
import { takenSlots } from "@/modules/food/plan-ops";
import { PlanAdd } from "@/modules/food/components/plan-add";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * PUT ON THE WEEK (docs/help/food/week-add.md, D2): for a day and a meal, from
 * the week's Put on the week or a meal's plus, or from a recipe (`?recipe=`,
 * the recipe chosen already). Today to next week's Sunday can be planned.
 */
export default async function PlanAddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const params = await searchParams;
  const today = todayInTimezone(ctx.tenant.timezone);
  const days = daysToPlan(today);
  const askedDay = one(params.day);
  const day = askedDay && days.includes(askedDay) ? askedDay : today;
  const askedMeal = one(params.meal);
  const meal: Meal = MEALS.includes(askedMeal as Meal)
    ? (askedMeal as Meal)
    : day === today
      ? mealAt(localHourInTimezone(ctx.tenant.timezone))
      : "dinner";
  const askedRecipe = one(params.recipe);

  const { recent, recipes, initial, taken } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      recent: await recentEaten(tx, ctx.tenant.id),
      recipes: await searchRecipes(tx, ctx.tenant.id, "", 8),
      initial: askedRecipe && UUID.test(askedRecipe) ? await recipeHit(tx, ctx.tenant.id, askedRecipe) : null,
      taken: await takenSlots(tx, ctx.tenant.id, today, plannable(today).to),
    }),
    { role: ctx.role },
  );

  return (
    <PlanAdd
      today={today}
      days={days}
      initialDay={day}
      initialMeal={meal}
      recent={recent}
      recipes={recipes}
      initial={initial ? { kind: "recipe", recipe: initial } : null}
      taken={taken}
    />
  );
}
