import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { ChevronLeft, ChevronRight, UtensilsCrossed } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { DayWatch } from "@/components/app/day-watch";
import { HelpButton } from "@/components/app/help-button";
import { isServerSpeechConfigured } from "@/lib/speech/providers";
import { cn } from "@/lib/utils";
import { addDays, localHourInTimezone, todayInTimezone } from "@/lib/timezone";
import { LOG_BACK_DAYS, mealAt } from "./core/eating";
import { greetingFor, plannedWords, upNext } from "./core/today";
import { eatsHere } from "./core/week";
import { dayEaten, getTargets, recentEaten } from "./eating-ops";
import { listInput } from "./list-ops";
import { planOn } from "./plan-ops";
import { FOOD_HOME } from "./recipe-ops";
import { FoodNav } from "./components/food-nav";
import { FoodPage } from "./components/food-page";
import { FoodToday } from "./components/food-today";

/** "Saturday, Oct 3". */
function dateWords(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Today", "Yesterday", or "Thursday, Oct 1". */
function dayWords(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return dateWords(day);
}

const ARROW =
  "flex size-8 items-center justify-center rounded-full bg-card ring-1 ring-black/[0.06] hover:bg-food-field @2xl:bg-transparent @2xl:ring-0";

/**
 * FOOD, TODAY (D4a, docs/help/food/overview.md; redrawn in the founder's
 * "Fresh Market" design, 2026-10-06, ADR 0132): a greeting and the day, the
 * sections, the search bar (a floating bar on a phone), the day's numbers
 * against the targets, what is up next from the week, and each meal. Food's
 * front page since D4a. The last two weeks can be stepped back through with
 * `?day=`, to log a meal forgotten; an earlier day is titled by its date. A
 * personal tool: this only ever renders inside a personal space, behind
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
  const isToday = day === today;
  const hour = localHourInTimezone(ctx.tenant.timezone);
  const [{ entries, targets, planned, recent, list }, me] = await Promise.all([
    withTenant(
      ctx.tenant.id,
      async (tx) => ({
        entries: await dayEaten(tx, ctx.tenant.id, day),
        targets: await getTargets(tx, ctx.tenant.id),
        planned: await planOn(tx, ctx.tenant.id, day),
        recent: await recentEaten(tx, ctx.tenant.id, 4),
        list: await listInput(tx, ctx.tenant.id, today),
      }),
      { role: ctx.role },
    ),
    // Deduplicated with the shell's own call in the same request (Clerk fetches once).
    currentUser(),
  ]);
  const meal = isToday ? mealAt(hour) : "dinner";
  const next = isToday ? upNext(planned, hour, eatsHere) : null;
  const firstName = me?.firstName?.trim() || null;
  const dayHref = (d: string) => (d === today ? FOOD_HOME : `${FOOD_HOME}?day=${d}`);
  const before = day > earliest ? dayHref(addDays(day, -1)) : null;
  const after = day < today ? dayHref(addDays(day, 1)) : null;

  return (
    <FoodPage className="max-w-[62.5rem] space-y-5 pb-28 @2xl:space-y-6 @2xl:pb-0">
      {isToday && <DayWatch today={today} timeZone={ctx.tenant.timezone} />}
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold text-food-accent-ink @2xl:text-[13px]">
            <span className="hidden size-7 items-center justify-center rounded-md bg-food-tint @2xl:flex" aria-hidden>
              <UtensilsCrossed className="size-4" />
            </span>
            <span className="@2xl:hidden">{isToday ? `Food · ${dateWords(day)}` : "Food"}</span>
            <span className="hidden @2xl:inline">Food</span>
          </p>
          <h1 className="mt-1 font-food-display text-[28px] leading-[1.05] font-bold tracking-[-0.02em] @2xl:mt-2 @2xl:text-[38px] @2xl:tracking-[-0.03em]">
            {isToday ? (
              <>
                {greetingFor(hour)}
                {firstName && <span className="hidden @2xl:inline">{`, ${firstName}`}</span>}.
              </>
            ) : (
              dateWords(day)
            )}
          </h1>
          {isToday && (
            <p className="mt-1.5 hidden text-[15px] text-muted-foreground @2xl:block">
              {next ? `${dateWords(day)} · ${plannedWords(next.meal)}.` : dateWords(day)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <HelpButton />
          <nav
            aria-label="Day"
            className="flex items-center gap-1.5 @2xl:h-10 @2xl:gap-0 @2xl:rounded-full @2xl:bg-card @2xl:px-1 @2xl:ring-1 @2xl:ring-black/[0.06]"
          >
            {before ? (
              <Link href={before} aria-label="The day before" className={ARROW}>
                <ChevronLeft className="size-4" aria-hidden />
              </Link>
            ) : (
              <span className={cn(ARROW, "opacity-30")} aria-hidden>
                <ChevronLeft className="size-4" />
              </span>
            )}
            <span className="hidden px-2 text-sm font-semibold whitespace-nowrap @2xl:inline">{dayWords(day, today)}</span>
            {after ? (
              <Link href={after} aria-label="The day after" className={ARROW}>
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            ) : (
              <span className={cn(ARROW, "hidden opacity-30 @2xl:flex")} aria-hidden>
                <ChevronRight className="size-4" />
              </span>
            )}
          </nav>
        </div>
      </header>

      <FoodNav list={{ tenantId: ctx.tenant.id, today, ...list }} />

      <FoodToday
        key={day}
        day={day}
        isToday={isToday}
        hour={hour}
        meal={meal}
        targets={targets}
        planned={planned}
        recent={recent}
        speech={isServerSpeechConfigured()}
        entries={entries.map((e) => ({
          id: e.id,
          meal: e.meal,
          source: e.source,
          name: e.name,
          amount: e.amount,
          portion: e.portion,
          grams: e.grams,
          portions: e.portions,
          recipeId: e.recipeId,
          category: e.category,
          photoUrl: e.photoUrl,
          calories: e.calories,
          proteinG: e.proteinG,
          carbsG: e.carbsG,
          fatG: e.fatG,
          fiberG: e.fiberG,
          sugarG: e.sugarG,
          sodiumMg: e.sodiumMg,
        }))}
      />
    </FoodPage>
  );
}
