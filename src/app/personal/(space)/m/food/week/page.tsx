import Link from "next/link";
import { Plus } from "lucide-react";
import { withTenant } from "@/db";
import { HelpButton } from "@/components/app/help-button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { addDays, isDateString, localHourInTimezone, todayInTimezone } from "@/lib/timezone";
import { mealAt } from "@/modules/food/core/eating";
import { PLAN_BACK_WEEKS, mondayOf, rangeWords, weekInReach, weekName } from "@/modules/food/core/week";
import { getTargets } from "@/modules/food/eating-ops";
import { listInput } from "@/modules/food/list-ops";
import { planBetween, weeksPlanned } from "@/modules/food/plan-ops";
import { FOOD_WEEK } from "@/modules/food/recipe-ops";
import { FoodHeader, FoodPager } from "@/modules/food/components/food-header";
import { FoodNav } from "@/modules/food/components/food-nav";
import { FoodPage } from "@/modules/food/components/food-page";
import { FOOD_PRIMARY, FOOD_SIZE } from "@/modules/food/components/food-styles";
import { WeekPlan } from "@/modules/food/components/week-plan";

export const dynamic = "force-dynamic";
/** Repeat a week names the new lines for the shopping list after it answers (`after`), in up to half a minute. */
export const maxDuration = 60;

function weekHref(monday: string, thisWeek: string): string {
  return monday === thisWeek ? FOOD_WEEK : `${FOOD_WEEK}?week=${monday}`;
}

/**
 * THE WEEK (D2, docs/help/food/week.md, ADR 0129; in the "Fresh Market" skin,
 * ADR 0132): `?week=` any day of the week to show, this week's without one;
 * the twelve weeks before this one and the next can be shown, and this week
 * and the next changed. The week's name is the title, its dates under it; Put
 * on the week sits in the header on a wide screen and in the week's card on a
 * phone. A personal tool: this only ever renders inside a personal space
 * (ADR 0111).
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

  const { items, targets, weeks, list } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      items: await planBetween(tx, ctx.tenant.id, monday, addDays(monday, 6)),
      targets: await getTargets(tx, ctx.tenant.id),
      weeks: await weeksPlanned(tx, ctx.tenant.id, addDays(thisWeek, -7 * PLAN_BACK_WEEKS), addDays(thisWeek, 13)),
      list: await listInput(tx, ctx.tenant.id, today),
    }),
    { role: ctx.role },
  );

  // Put on the week starts on today's next meal, or the shown week's Monday when that is next week.
  const startDay = monday > thisWeek ? monday : today;
  const startMeal = startDay === today ? mealAt(localHourInTimezone(ctx.tenant.timezone)) : "dinner";
  const changeable = monday >= thisWeek;
  const addHref = `${FOOD_WEEK}/add?day=${startDay}&meal=${startMeal}`;
  const name = weekName(monday, today);
  const range = rangeWords(monday);
  const before = addDays(monday, -7);
  const after = addDays(monday, 7);
  const listBadge = { tenantId: ctx.tenant.id, today, ...list };

  return (
    <FoodPage className="max-w-7xl space-y-5 @2xl:space-y-6">
      <FoodHeader
        phoneEyebrow={`Food · ${range}`}
        title={name ?? range}
        sub={`${range} · ${items.length === 0 ? "nothing planned" : `${items.length} ${items.length === 1 ? "meal" : "meals"} planned`}`}
        subOnPhone={false}
        actions={
          <>
            <HelpButton />
            <FoodPager
              ariaLabel="Week"
              label={name ?? range}
              before={weekInReach(before, today) ? weekHref(before, thisWeek) : null}
              after={weekInReach(after, today) ? weekHref(after, thisWeek) : null}
              beforeLabel="The week before"
              afterLabel="The week after"
            />
            {changeable && (
              <Link href={addHref} className={cn(FOOD_PRIMARY, FOOD_SIZE.md, "hidden @2xl:inline-flex")}>
                <Plus className="size-4" aria-hidden /> Put on the week
              </Link>
            )}
          </>
        }
      />
      <FoodNav list={listBadge} />
      <WeekPlan key={monday} monday={monday} today={today} items={items} targets={targets} weeks={weeks} list={listBadge} addHref={addHref} />
    </FoodPage>
  );
}
