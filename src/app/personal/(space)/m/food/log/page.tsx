import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { addDays, localHourInTimezone, todayInTimezone } from "@/lib/timezone";
import { LOG_BACK_DAYS, MEALS, mealAt, type Meal } from "@/modules/food/core/eating";
import { recentEaten, recipeHit, searchRecipes } from "@/modules/food/eating-ops";
import { FOOD_HOME } from "@/modules/food/recipe-ops";
import { LogFood } from "@/modules/food/components/log-food";

export const dynamic = "force-dynamic";
/** A photo of the plate is read by Claude in up to half a minute; its action runs here. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/** "Today", "Yesterday", or "Thursday, Oct 1". */
function dayWords(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * LOG FOOD (docs/help/food/log.md, D4a): for a day and a meal, from Today's
 * Log food or a meal's Add, or from a recipe (`?recipe=`, the recipe chosen
 * already). What was logged lately and the recipes cooked lately wait under
 * the search box, so a usual day is a couple of taps.
 */
export default async function LogFoodPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const params = await searchParams;
  const today = todayInTimezone(ctx.tenant.timezone);
  const askedDay = one(params.day);
  const day =
    askedDay && /^\d{4}-\d{2}-\d{2}$/.test(askedDay) && askedDay <= today && askedDay >= addDays(today, -LOG_BACK_DAYS)
      ? askedDay
      : today;
  const askedMeal = one(params.meal);
  const meal: Meal = MEALS.includes(askedMeal as Meal)
    ? (askedMeal as Meal)
    : day === today
      ? mealAt(localHourInTimezone(ctx.tenant.timezone))
      : "dinner";
  const askedRecipe = one(params.recipe);

  const { recent, recipes, initial } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      recent: await recentEaten(tx, ctx.tenant.id),
      recipes: await searchRecipes(tx, ctx.tenant.id, "", 5),
      initial: askedRecipe && UUID.test(askedRecipe) ? await recipeHit(tx, ctx.tenant.id, askedRecipe) : null,
    }),
    { role: ctx.role },
  );

  return (
    <LogFood
      day={day}
      dayLabel={dayWords(day, today)}
      backHref={day === today ? FOOD_HOME : `${FOOD_HOME}?day=${day}`}
      initialMeal={meal}
      recent={recent}
      recipes={recipes}
      initial={initial ? { kind: "recipe", recipe: initial } : null}
    />
  );
}
