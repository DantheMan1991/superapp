import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, UtensilsCrossed } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { DayWatch } from "@/components/app/day-watch";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { addDays, localHourInTimezone, todayInTimezone } from "@/lib/timezone";
import { LOG_BACK_DAYS, mealAt } from "./core/eating";
import { dayEaten, getTargets } from "./eating-ops";
import { planOn } from "./plan-ops";
import { FOOD_HOME } from "./recipe-ops";
import { EatenDay } from "./components/eaten-day";
import { FoodNav } from "./components/food-nav";

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
 * FOOD, TODAY (D4a, docs/help/food/overview.md; the founder's calls
 * 2026-10-03): what was eaten on a day, its calories and macros, the targets,
 * and each meal; Log food to add. Food's front page since D4a; the recipes
 * moved one tab over (`/personal/m/food/recipes`). The last two weeks can be
 * stepped back through with `?day=`, to log a meal forgotten. A personal
 * tool: this only ever renders inside a personal space, behind
 * `requirePersonalSpace` and a module gate (ADR 0111).
 */
export async function FoodModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const today = todayInTimezone(ctx.tenant.timezone);
  const earliest = addDays(today, -LOG_BACK_DAYS);
  const asked = typeof searchParams?.day === "string" ? searchParams.day : null;
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today && asked >= earliest ? asked : today;
  const [entries, targets, planned] = await withTenant(
    ctx.tenant.id,
    async (tx) =>
      [await dayEaten(tx, ctx.tenant.id, day), await getTargets(tx, ctx.tenant.id), await planOn(tx, ctx.tenant.id, day)] as const,
    { role: ctx.role },
  );
  const meal = day === today ? mealAt(localHourInTimezone(ctx.tenant.timezone)) : "dinner";
  const dayHref = (d: string) => (d === today ? FOOD_HOME : `${FOOD_HOME}?day=${d}`);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {day === today && <DayWatch today={today} timeZone={ctx.tenant.timezone} />}
      <PageHeader
        title="Food"
        description="What you ate, the week ahead, and your recipes."
        icon={<UtensilsCrossed />}
        actions={
          <Button asChild size="sm">
            <Link href={`${FOOD_HOME}/log?meal=${meal}&day=${day}`}>
              <Plus aria-hidden /> Log food
            </Link>
          </Button>
        }
      />
      <FoodNav />

      <nav className="flex items-center justify-between gap-2" aria-label="Day">
        {day > earliest ? (
          <Button asChild variant="ghost" size="icon" aria-label="The day before">
            <Link href={dayHref(addDays(day, -1))}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="size-9" />
        )}
        <span className="font-medium">{dayWords(day, today)}</span>
        {day < today ? (
          <Button asChild variant="ghost" size="icon" aria-label="The day after">
            <Link href={dayHref(addDays(day, 1))}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="size-9" />
        )}
      </nav>

      <EatenDay
        key={day}
        day={day}
        targets={targets}
        planned={planned}
        entries={entries.map((e) => ({
          id: e.id,
          meal: e.meal,
          source: e.source,
          name: e.name,
          amount: e.amount,
          portion: e.portion,
          grams: e.grams,
          portions: e.portions,
          calories: e.calories,
          proteinG: e.proteinG,
          carbsG: e.carbsG,
          fatG: e.fatG,
          fiberG: e.fiberG,
          sugarG: e.sugarG,
          sodiumMg: e.sodiumMg,
        }))}
      />
    </div>
  );
}
