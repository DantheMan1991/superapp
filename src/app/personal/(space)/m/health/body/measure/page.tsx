import Link from "next/link";
import { ArrowLeft, Ruler } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { listMeasures, measurementsBetween } from "@/modules/health/body-ops";
import { DAY, dayWords, inReach } from "@/modules/health/core/days";
import { shiftDay } from "@/modules/health/core/progress";
import { HEALTH_HOME } from "@/modules/health/log-ops";
import { DayWatch } from "@/components/app/day-watch";
import { MeasureForm } from "@/modules/health/components/measure-form";

export const dynamic = "force-dynamic";

/**
 * MEASURE (docs/help/health/measure.md, H2): a day's tape measures, typed in
 * together. Today, a day of the two weeks before it (from Today's day
 * switcher), or a day already measured (from Body, to change what was kept).
 */
export default async function MeasurePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  const today = todayInTimezone(ctx.tenant.timezone);
  const search = await searchParams;
  const asked = typeof search.day === "string" && DAY.test(search.day) && search.day <= today ? search.day : today;
  const { day, measures, values, before } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const askedValues = await measurementsBetween(tx, ctx.tenant.id, asked, asked);
      // A day out of reach opens only when it was measured: there is something to change.
      const opened = inReach(asked, today) || askedValues.length > 0 ? asked : today;
      return {
        day: opened,
        measures: await listMeasures(tx, ctx.tenant.id),
        values: opened === asked ? askedValues : await measurementsBetween(tx, ctx.tenant.id, opened, opened),
        // Everything before that day, oldest first: the latest of each is "Last: 36.5 in, Sep 28".
        before: await measurementsBetween(tx, ctx.tenant.id, "1900-01-01", shiftDay(opened, -1)),
      };
    },
    { role: ctx.role },
  );
  const last: Record<string, { day: string; cm: number }> = {};
  for (const m of before) last[m.measureId] = { day: m.day, cm: m.cm };

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      {day === today && <DayWatch today={today} timeZone={ctx.tenant.timezone} />}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`${HEALTH_HOME}/body`}>
          <ArrowLeft aria-hidden /> Body
        </Link>
      </Button>
      <PageHeader title="Measure" description={dayWords(day, today)} icon={<Ruler />} />
      <MeasureForm
        key={day}
        day={day}
        today={today}
        asToday={day === today}
        measures={measures}
        values={Object.fromEntries(values.map((v) => [v.measureId, v.cm]))}
        last={last}
      />
    </div>
  );
}
