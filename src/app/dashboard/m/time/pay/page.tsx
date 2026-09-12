import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { withTenant } from "@/db";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { addDays, isDateString, todayInTimezone } from "@/lib/timezone";
import { formatDuration } from "@/modules/time/core/duration";
import { countsAsPaid, countsAsWorked, payTypeLabel } from "@/modules/time/core/pay-types";
import {
  adjacentPayPeriod,
  payPeriodFor,
  periodLabel,
  workweeksPaidIn,
} from "@/modules/time/core/periods";
import { evaluateWeek, hasPremium } from "@/modules/time/core/overtime";
import { rulesetFor } from "@/modules/time/core/rulesets";
import { weekLabel } from "@/modules/time/core/week";
import { listEntries } from "@/modules/time/read";
import { getTimePrefs } from "@/modules/time/settings-ops";

export const dynamic = "force-dynamic";

/**
 * One pay period, and the workweeks inside it.
 *
 * THIS SCREEN EXISTS TO MAKE ONE DISTINCTION VISIBLE. The workweek is the unit
 * of overtime and the pay period is the unit of payment; on a fortnightly
 * payroll that means two separate weeks, each tested against 40 on its own. A
 * business looking at "80 hours this fortnight" cannot see the ten hours of
 * overtime hiding inside 30 + 50, and that averaging error is the most common
 * payroll violation there is. So a period is shown as its weeks, never as one
 * number.
 *
 * Everything here is DERIVED. There is no `time_periods` table yet and
 * deliberately so: a period is arithmetic over the settings until slice 3 gives
 * it approval state, which is the first fact about a period worth storing.
 */
export default async function PayPeriodPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "time");

  const params = await searchParams;
  const raw = params["on"];
  const asked = Array.isArray(raw) ? raw[0] : raw;
  const today = todayInTimezone(ctx.tenant.timezone);
  const anchorDate = asked && isDateString(asked) ? asked : today;

  const { prefs, rows } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const prefs = await getTimePrefs(tx, ctx.tenant.id);
      const period = payPeriodFor(anchorDate, {
        frequency: prefs.payFrequency,
        weekStartsOn: prefs.weekStartsOn,
        anchor: prefs.periodAnchor,
      });
      const weeks = workweeksPaidIn(period, prefs.weekStartsOn);
      /*
       * Read the whole span the WEEKS cover, not the period: a week that ends
       * inside the period may have started before it, and dropping those days
       * would under-count the week that pays them.
       */
      const from = weeks[0]?.start ?? period.start;
      const to = weeks[weeks.length - 1]?.end ?? period.end;
      return {
        prefs,
        rows: await listEntries(tx, ctx.tenant.id, { from, to }),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  const settings = {
    frequency: prefs.payFrequency,
    weekStartsOn: prefs.weekStartsOn,
    anchor: prefs.periodAnchor,
  };
  const period = payPeriodFor(anchorDate, settings);
  const weeks = workweeksPaidIn(period, prefs.weekStartsOn);
  const ruleset = rulesetFor(prefs.overtimeRuleset);
  const isThisPeriod =
    today >= period.start && today <= period.end;

  /*
   * Aggregated HERE rather than in SQL, on purpose. Whether an hour counts
   * toward overtime is `countsAsWorked`, and a `filter (where pay_type = ...)`
   * in a query would be a second copy of that rule waiting to disagree with the
   * first. A pay period is at most a month of rows, so the cost is nothing.
   */
  const workerNames = new Map<string, string>();
  for (const row of rows) workerNames.set(row.workerId, row.workerName);

  const perWeek = weeks.map((w) => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(w.start, i));
    const workers = [...workerNames.keys()].map((workerId) => {
      const mine = rows.filter(
        (r) => r.workerId === workerId && r.workDate >= w.start && r.workDate <= w.end,
      );
      const buckets = evaluateWeek(
        days.map((date) => ({
          date,
          workedMinutes: mine
            .filter((r) => r.workDate === date && countsAsWorked(r.payType))
            .reduce((s, r) => s + r.minutes, 0),
        })),
        ruleset,
      );
      const paidNotWorked = mine
        .filter((r) => countsAsPaid(r.payType) && !countsAsWorked(r.payType))
        .reduce((s, r) => s + r.minutes, 0);
      const leaveKinds = [
        ...new Set(
          mine
            .filter((r) => countsAsPaid(r.payType) && !countsAsWorked(r.payType))
            .map((r) => payTypeLabel(r.payType)),
        ),
      ];
      return {
        workerId,
        name: workerNames.get(workerId) ?? "",
        buckets,
        paidNotWorked,
        leaveKinds,
      };
    });
    return { week: w, workers: workers.filter((x) => x.buckets.workedMinutes > 0 || x.paidNotWorked > 0) };
  });

  const anyRows = perWeek.some((p) => p.workers.length > 0);
  const totals = perWeek.flatMap((p) => p.workers).reduce(
    (acc, w) => ({
      regular: acc.regular + w.buckets.regularMinutes,
      overtime: acc.overtime + w.buckets.overtimeMinutes,
      doubleTime: acc.doubleTime + w.buckets.doubleTimeMinutes,
      paidNotWorked: acc.paidNotWorked + w.paidNotWorked,
    }),
    { regular: 0, overtime: 0, doubleTime: 0, paidNotWorked: 0 },
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pay period"
        description={
          anyRows
            ? `${formatDuration(totals.regular)} regular${
                totals.overtime > 0 ? ` · ${formatDuration(totals.overtime)} overtime` : ""
              }${
                totals.doubleTime > 0 ? ` · ${formatDuration(totals.doubleTime)} double time` : ""
              }${
                totals.paidNotWorked > 0
                  ? ` · ${formatDuration(totals.paidNotWorked)} paid but not worked`
                  : ""
              }`
            : "What each person worked, week by week, over one pay period."
        }
        icon={<CalendarDays />}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/m/time">Time</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/dashboard/m/time/pay?on=${adjacentPayPeriod(period, -1, settings).start}`}
            >
              ← Previous
            </Link>
          </Button>
          <span className="text-sm font-medium">
            {periodLabel(period)}
            {isThisPeriod && (
              <span className="ml-2 text-xs text-muted-foreground">This period</span>
            )}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/dashboard/m/time/pay?on=${adjacentPayPeriod(period, 1, settings).start}`}
            >
              Next →
            </Link>
          </Button>
        </div>
        {!isThisPeriod && (
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/m/time/pay">This period</Link>
          </Button>
        )}
      </div>

      {/* Said plainly, because a reader has to be able to check it against what
          their payroll company does. */}
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Overtime is worked out for each <strong>week</strong> on its own, then
        added up for the period — {ruleset.summary} A week that starts in one
        period and ends in another is paid in the period it ends in.
      </p>

      {!anyRows ? (
        <EmptyState
          panel
          icon={<CalendarDays />}
          title="Nothing in this period"
          description="No hours were logged between these dates."
        />
      ) : (
        <div className="space-y-4">
          {perWeek.map(({ week: w, workers }) => (
            <div key={w.start} className="rounded-lg border">
              <div className="flex items-center justify-between gap-4 border-b px-3 py-2">
                <h2 className="text-sm font-medium">
                  Week of {weekLabel(w.start)}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {workers.length === 0
                    ? "nothing logged"
                    : `${workers.length} ${workers.length === 1 ? "person" : "people"}`}
                </span>
              </div>
              {workers.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  Nothing was logged in this week.
                </p>
              ) : (
                <ul className="divide-y">
                  {workers.map((w2) => (
                    <li
                      key={w2.workerId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
                    >
                      <span className="w-40 shrink-0 truncate font-medium">
                        {w2.name}
                      </span>
                      <span className="tabular-nums">
                        {formatDuration(w2.buckets.regularMinutes)} regular
                      </span>
                      {w2.buckets.overtimeMinutes > 0 && (
                        <span className="tabular-nums text-module-accent">
                          {formatDuration(w2.buckets.overtimeMinutes)} overtime
                        </span>
                      )}
                      {w2.buckets.doubleTimeMinutes > 0 && (
                        <span className="tabular-nums text-destructive">
                          {formatDuration(w2.buckets.doubleTimeMinutes)} double time
                        </span>
                      )}
                      {w2.paidNotWorked > 0 && (
                        <span className="tabular-nums text-muted-foreground">
                          {formatDuration(w2.paidNotWorked)} {w2.leaveKinds.join(", ").toLowerCase()}
                        </span>
                      )}
                      {!hasPremium(w2.buckets) && w2.buckets.workedMinutes > 0 && (
                        <span className="text-xs text-muted-foreground">
                          no overtime
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
