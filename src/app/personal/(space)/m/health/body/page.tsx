import Link from "next/link";
import { ArrowLeft, Ruler, Settings2, Weight } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { allMeasurements, allWeighins, getWeightGoal, listMeasures, type MeasurementRow, type MeasureRow } from "@/modules/health/body-ops";
import { inchesChange, inchesWords, measureSpan } from "@/modules/health/core/body";
import { dayName, shortDay } from "@/modules/health/core/days";
import { HEALTH_HOME } from "@/modules/health/log-ops";
import { BodyView } from "@/modules/health/components/body-view";

export const dynamic = "force-dynamic";

/** How many measured days are listed to open again. */
const DAYS_LISTED = 8;

/**
 * BODY (docs/help/health/body.md, H2; the founder's calls from a mockup,
 * 2026-10-03): the weigh-ins and the trend through them, the goal, and the
 * tape measures.
 */
export default async function BodyPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  const today = todayInTimezone(ctx.tenant.timezone);
  const { weighins, goal, measures, measurements } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      weighins: await allWeighins(tx, ctx.tenant.id),
      goal: await getWeightGoal(tx, ctx.tenant.id),
      measures: await listMeasures(tx, ctx.tenant.id),
      measurements: await allMeasurements(tx, ctx.tenant.id),
    }),
    { role: ctx.role },
  );
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={HEALTH_HOME}>
          <ArrowLeft aria-hidden /> Health
        </Link>
      </Button>
      <PageHeader title="Body" description="Your weigh-ins, the trend through them, your goal and your tape measures." icon={<Weight />} />
      <BodyView
        today={today}
        weighins={weighins}
        goal={goal}
        measures={<TapeMeasures today={today} measures={measures} measurements={measurements} />}
      />
    </div>
  );
}

/** Each tape measure's latest and how it has moved since the first; the days measured, to open again. */
function TapeMeasures({ today, measures, measurements }: { today: string; measures: MeasureRow[]; measurements: MeasurementRow[] }) {
  const days = [...new Set(measurements.map((m) => m.day))].sort().reverse();
  return (
    <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Ruler className="size-4 text-module-accent" aria-hidden /> Tape measures
        </h2>
        <div className="flex gap-1">
          {measures.length > 0 && (
            <Button asChild size="sm" variant="outline">
              <Link href={`${HEALTH_HOME}/body/measure`}>Measure</Link>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <Link href={`${HEALTH_HOME}/body/measures`}>
              <Settings2 aria-hidden /> {measures.length === 0 ? "Choose" : "Change"}
            </Link>
          </Button>
        </div>
      </div>
      {measures.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Choose what you measure, such as your waist, and take them whenever you like. Once a week is plenty.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {measures.map((measure) => {
            const span = measureSpan(measurements.filter((m) => m.measureId === measure.id));
            const moved = span ? span.latest.cm - span.first.cm : 0;
            const better =
              (measure.better === "smaller" && moved < 0) || (measure.better === "bigger" && moved > 0);
            return (
              <li key={measure.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{measure.name}</span>
                {span ? (
                  <span className="text-right">
                    {`${inchesWords(span.latest.cm)}, ${shortDay(span.latest.day, today)}`}
                    {span.first.day !== span.latest.day && (
                      <span className={cn("block text-sm text-muted-foreground", better && "text-module-accent")}>
                        {`${inchesChange(moved)} since ${shortDay(span.first.day, today)}`}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Not taken yet</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {days.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          <p className="text-sm text-muted-foreground">Days measured. Open one to change or take off what was kept.</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {days.slice(0, DAYS_LISTED).map((day) => (
              <li key={day}>
                <Link className="text-module-accent underline" href={`${HEALTH_HOME}/body/measure?day=${day}`}>
                  {dayName(day)}
                </Link>
              </li>
            ))}
            {days.length > DAYS_LISTED && <li className="text-muted-foreground">{`and ${days.length - DAYS_LISTED} before`}</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
