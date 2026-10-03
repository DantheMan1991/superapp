import Link from "next/link";
import { createElement } from "react";
import { ChartColumn, HeartPulse } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { getIcon } from "@/components/app/icon-registry";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { contributedToday } from "@/lib/progress-sources/resolve";
import { todayInTimezone } from "@/lib/timezone";
import { clockOf, USUAL_NIGHT } from "./core/sleep";
import { HEALTH_HOME } from "./log-ops";
import { todayData } from "./progress-ops";
import { DayWatch } from "@/components/app/day-watch";
import { HabitChips } from "./components/habit-chips";
import { PlungeCard } from "./components/plunge-card";
import { SleepCard } from "./components/sleep-card";

/**
 * HEALTH, TODAY (H1, docs/help/health/overview.md; the founder's calls from a
 * mockup, 2026-10-02): last night's sleep, today's cold plunges, the workout
 * (from Workouts, through the progress slot), and the person's own habits to
 * mark, with Progress a tap away. A personal tool: this only ever renders in a
 * personal space, behind `requirePersonalSpace` and a module gate (ADR 0111).
 */
export async function HealthModule({ ctx }: { ctx: TenantContext }) {
  const today = todayInTimezone(ctx.tenant.timezone);
  const [data, others] = await Promise.all([
    withTenant(ctx.tenant.id, (tx) => todayData(tx, ctx.tenant.id, today), { role: ctx.role }),
    contributedToday(ctx.tenant.id, today, ctx.role),
  ]);

  // This morning's form starts from this morning's night, the last night kept, or a usual one.
  const from = data.night ?? data.lastNight;
  const start = from
    ? { bedTime: clockOf(from.bedTime), wokeTime: clockOf(from.wokeTime), rested: data.night?.rested ?? null }
    : { ...USUAL_NIGHT, rested: null };
  const done: Record<string, number | null> = {};
  for (const log of data.doneToday) done[log.habitId] = log.amount;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <DayWatch today={today} timeZone={ctx.tenant.timezone} />
      <PageHeader
        title="Health"
        description={dayWords(today)}
        icon={<HeartPulse />}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={`${HEALTH_HOME}/progress`}>
              <ChartColumn aria-hidden /> Progress
            </Link>
          </Button>
        }
      />

      <SleepCard
        today={today}
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

      <PlungeCard
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
        today={today}
        habits={data.habits.map((h) => ({ id: h.id, name: h.name, unit: h.unit }))}
        done={done}
      />
    </div>
  );
}

/** "Thursday, Oct 2": the space's today. */
function dayWords(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
