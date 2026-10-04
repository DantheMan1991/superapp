import Link from "next/link";
import { Plus, UtensilsCrossed } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { addDays, isDateString, localHourInTimezone, todayInTimezone } from "@/lib/timezone";
import { mealAt } from "@/modules/food/core/eating";
import { PLAN_BACK_WEEKS, mondayOf, weekInReach } from "@/modules/food/core/week";
import { getTargets } from "@/modules/food/eating-ops";
import { planBetween, weeksPlanned } from "@/modules/food/plan-ops";
import { FOOD_WEEK } from "@/modules/food/recipe-ops";
import { FoodNav } from "@/modules/food/components/food-nav";
import { WeekPlan } from "@/modules/food/components/week-plan";

export const dynamic = "force-dynamic";
/** Repeat a week names the new lines for the shopping list after it answers (`after`), in up to half a minute. */
export const maxDuration = 60;

/**
 * THE WEEK (D2, docs/help/food/week.md, ADR 0129): `?week=` any day of the
 * week to show, this week's without one; the twelve weeks before this one and
 * the next can be shown, and this week and the next changed. A personal tool:
 * this only ever renders inside a personal space (ADR 0111).
 */
export default async function FoodWeekPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const params = await searchParams;
  const today = todayInTimezone(ctx.tenant.timezone);
  const thisWeek = mondayOf(today);
  const asked = typeof params.week === "string" && isDateString(params.week) ? mondayOf(params.week) : thisWeek;
  const monday = weekInReach(asked, today) ? asked : thisWeek;

  const { items, targets, weeks } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      items: await planBetween(tx, ctx.tenant.id, monday, addDays(monday, 6)),
      targets: await getTargets(tx, ctx.tenant.id),
      weeks: await weeksPlanned(tx, ctx.tenant.id, addDays(thisWeek, -7 * PLAN_BACK_WEEKS), addDays(thisWeek, 13)),
    }),
    { role: ctx.role },
  );

  // Put on the week starts on today's next meal, or the shown week's Monday when that is next week.
  const startDay = monday > thisWeek ? monday : today;
  const startMeal = startDay === today ? mealAt(localHourInTimezone(ctx.tenant.timezone)) : "dinner";
  const changeable = monday >= thisWeek;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <PageHeader
        title="Food"
        description="What you ate, the week ahead, and your recipes."
        icon={<UtensilsCrossed />}
        actions={
          changeable ? (
            <Button asChild size="sm">
              <Link href={`${FOOD_WEEK}/add?day=${startDay}&meal=${startMeal}`}>
                <Plus aria-hidden /> Put on the week
              </Link>
            </Button>
          ) : undefined
        }
      />
      <FoodNav />
      <WeekPlan monday={monday} today={today} items={items} targets={targets} weeks={weeks} />
    </div>
  );
}
