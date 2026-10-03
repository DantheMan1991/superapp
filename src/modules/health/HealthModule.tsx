import Link from "next/link";
import { createElement } from "react";
import { ChartColumn, ChevronLeft, ChevronRight, HeartPulse } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { getIcon } from "@/components/app/icon-registry";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { contributedToday } from "@/lib/progress-sources/resolve";
import { todayInTimezone } from "@/lib/timezone";
import { askedDay, dayName, dayWords, FILL_BACK_DAYS } from "./core/days";
import { shiftDay } from "./core/progress";
import { clockOf, USUAL_NIGHT } from "./core/sleep";
import { HEALTH_HOME } from "./log-ops";
import { dayData } from "./progress-ops";
import { DayWatch } from "@/components/app/day-watch";
import { HabitChips } from "./components/habit-chips";
import { PlungeCard } from "./components/plunge-card";
import { SleepCard } from "./components/sleep-card";
import { WeightCard } from "./components/weight-card";

/**
 * HEALTH, TODAY (H1, H2; docs/help/health/overview.md; the founder's calls
 * from mockups, 2026-10-02 and 2026-10-03): last night's sleep, the morning's
 * weigh-in, today's cold plunges, the workout and what was eaten (from
 * Workouts and Food, through the progress slot), and the person's own habits
 * to mark, with Progress a tap away.
 *
 * The two weeks before today can be stepped back through with `?day=`, to
 * fill in a night, a weigh-in, a plunge or a habit forgotten (H2, as Food's
 * log): the slot's cards are left off there, since they speak of today. A
 * personal tool: this only ever renders in a personal space, behind
 * `requirePersonalSpace` and a module gate (ADR 0111).
 */
export async function HealthModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const today = todayInTimezone(ctx.tenant.timezone);
  const day = askedDay(typeof searchParams?.day === "string" ? searchParams.day : null, today);
  const asToday = day === today;
  const earliest = shiftDay(today, -FILL_BACK_DAYS);
  const [data, others] = await Promise.all([
    withTenant(ctx.tenant.id, (tx) => dayData(tx, ctx.tenant.id, day), { role: ctx.role }),
    asToday ? contributedToday(ctx.tenant.id, today, ctx.role) : Promise.resolve({ found: [], failed: [] }),
  ]);

  // The form starts from that morning's night, the last night kept before it, or a usual one.
  const from = data.night ?? data.lastNight;
  const start = from
    ? { bedTime: clockOf(from.bedTime), wokeTime: clockOf(from.wokeTime), rested: data.night?.rested ?? null }
    : { ...USUAL_NIGHT, rested: null };
  const done: Record<string, number | null> = {};
  for (const log of data.doneThatDay) done[log.habitId] = log.amount;
  const dayHref = (d: string) => (d === today ? HEALTH_HOME : `${HEALTH_HOME}?day=${d}`);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      {asToday && <DayWatch today={today} timeZone={ctx.tenant.timezone} />}
      <PageHeader
        title="Health"
        description={dayName(today)}
        icon={<HeartPulse />}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={`${HEALTH_HOME}/progress`}>
              <ChartColumn aria-hidden /> Progress
            </Link>
          </Button>
        }
      />

      <nav className="flex items-center justify-between gap-2" aria-label="Day">
        {day > earliest ? (
          <Button asChild variant="ghost" size="icon" aria-label="The day before">
            <Link href={dayHref(shiftDay(day, -1))}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="size-9" />
        )}
        <span className="font-medium">{dayWords(day, today)}</span>
        {day < today ? (
          <Button asChild variant="ghost" size="icon" aria-label="The day after">
            <Link href={dayHref(shiftDay(day, 1))}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="size-9" />
        )}
      </nav>

      <SleepCard
        key={`sleep-${day}`}
        day={day}
        asToday={asToday}
        title={asToday ? "Last night's sleep" : `The night before ${dayWords(day, today) === "Yesterday" ? "yesterday" : dayName(day)}`}
        night={
          data.night
            ? {
                bedTime: clockOf(data.night.bedTime),
                wokeTime: clockOf(data.night.wokeTime),
                minutes: data.night.minutes,
                rested: data.night.rested,
              }
            : null
        }
        start={start}
      />

      <WeightCard
        key={`weight-${day}`}
        owner={ctx.tenant.id}
        day={day}
        today={today}
        asToday={asToday}
        weighins={data.weighins}
        goal={data.goal}
        measures={{ count: data.measures.length, lastMeasured: data.lastMeasured }}
      />

      <PlungeCard
        key={`plunge-${day}`}
        day={day}
        asToday={asToday}
        plunges={data.plunges.map((p) => ({ id: p.id, seconds: p.seconds, waterF: p.waterF, feelAfter: p.feelAfter }))}
        thisWeek={data.plungesThisWeek}
      />

      {others.found.map((card) => (
        <section key={card.key} className="space-y-1 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-medium">
              {createElement(getIcon(card.icon), { className: "size-4 text-module-accent", "aria-hidden": true })} {card.title}
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href={card.href}>Open</Link>
            </Button>
          </div>
          {card.lines.map((line) => (
            <p key={line} className="text-sm first:text-base">
              {line}
            </p>
          ))}
        </section>
      ))}
      {others.failed.length > 0 && (
        <p className="text-sm text-muted-foreground">{`${others.failed.join(" and ")} could not be read just now. Reload the page to try again.`}</p>
      )}

      <HabitChips
        key={`habits-${day}`}
        day={day}
        asToday={asToday}
        habits={data.habits.map((h) => ({ id: h.id, name: h.name, unit: h.unit }))}
        done={done}
      />
    </div>
  );
}
