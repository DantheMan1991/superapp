import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { withTenant } from "@/db";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
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
import { formatCents, groupByRate, payForWeek } from "@/modules/time/core/pay";
import { rulesetFor } from "@/modules/time/core/rulesets";
import { weekLabel } from "@/modules/time/core/week";
import { roleMayApprove, roleMayWrite } from "@/modules/time/core/errors";
import { ExportPayPeriodButton } from "@/modules/time/components/export-controls";
import {
  ApproveSheetButtons,
  PeriodLockButton,
  SubmitSheetButton,
} from "@/modules/time/components/sheet-controls";
import { listEntries, listEntryDimensions } from "@/modules/time/read";
import { getTimePrefs } from "@/modules/time/settings-ops";
import { listRates } from "@/modules/time/rate-ops";
import { getPeriodLock, listSheets } from "@/modules/time/sheet-ops";

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
/** "40h regular · 10h overtime", for the approve dialog and nothing else. */
function summarise(
  buckets: { regularMinutes: number; overtimeMinutes: number; doubleTimeMinutes: number },
  paidNotWorked: number,
): string {
  return [
    `${formatDuration(buckets.regularMinutes)} regular`,
    buckets.overtimeMinutes > 0
      ? `${formatDuration(buckets.overtimeMinutes)} overtime`
      : null,
    buckets.doubleTimeMinutes > 0
      ? `${formatDuration(buckets.doubleTimeMinutes)} double time`
      : null,
    paidNotWorked > 0 ? `${formatDuration(paidNotWorked)} paid leave` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Where one person's period has got to, and what can be done about it next.
 *
 * THE CONTROL IS DECIDED BY THE SAME PREDICATES THE ACTION'S GATE USES
 * (`roleMayWrite`, `roleMayApprove`), so a button is never drawn for somebody
 * whose press would be refused — the mistake the permissions sweep of
 * 2026-09-04 found on six screens.
 */
function SheetState({
  sheet,
  workerId,
  name,
  on,
  summary,
  canWrite,
  canApprove,
  isLocked,
}: {
  sheet: { id: string; version: number; approvedAt: Date | null } | undefined;
  workerId: string;
  name: string;
  on: string;
  summary: string;
  canWrite: boolean;
  canApprove: boolean;
  isLocked: boolean;
}) {
  if (sheet?.approvedAt) {
    return (
      <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] text-success-foreground">
        Approved
      </span>
    );
  }
  if (sheet) {
    return (
      <span className="flex items-center gap-2">
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning-foreground">
          Waiting for approval
        </span>
        {canApprove && (
          <ApproveSheetButtons
            sheetId={sheet.id}
            version={sheet.version}
            name={name}
            summary={summary}
          />
        )}
      </span>
    );
  }
  // Nothing submitted. A locked period is past the point of submitting.
  if (isLocked || !canWrite) return null;
  return <SubmitSheetButton workerId={workerId} on={on} name={name} />;
}

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

  const { prefs, rows, entryDimensions, sheets, lock, rates } = await withTenant(
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
      const rows = await listEntries(tx, ctx.tenant.id, { from, to });
      return {
        prefs,
        rows,
        entryDimensions: await listEntryDimensions(
          tx,
          ctx.tenant.id,
          rows.map((r) => r.id),
        ),
        sheets: await listSheets(tx, ctx.tenant.id, period),
        lock: await getPeriodLock(tx, ctx.tenant.id, period.start),
        // Empty unless the reader is an owner. The money column simply does not
        // appear for anybody else, which is the policy showing through rather
        // than a second check.
        rates: await listRates(tx, ctx.tenant.id),
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
  const canWrite = roleMayWrite(ctx.role);
  const canApprove = roleMayApprove(ctx.role);
  const isLocked = lock?.lockedAt != null;
  const sheetByWorker = new Map(sheets.map((s) => [s.workerId, s]));
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

      /*
       * MONEY IS WORKED OUT PER WEEK, like the overtime it prices: the regular
       * rate is a weighted average over ONE workweek, so a raise that landed
       * mid-fortnight has to be priced in the week it happened.
       */
      const theirRates = rates
        .filter((r) => r.workerId === workerId)
        .map((r) => ({
          effectiveOn: r.effectiveOn,
          payRateCents: r.payRateCents,
        }));
      const money =
        theirRates.length > 0
          ? payForWeek({
              worked: groupByRate(
                mine.filter((r) => countsAsWorked(r.payType)),
                theirRates,
              ),
              overtimeMinutes: buckets.overtimeMinutes,
              doubleTimeMinutes: buckets.doubleTimeMinutes,
              leave: groupByRate(
                mine.filter(
                  (r) => countsAsPaid(r.payType) && !countsAsWorked(r.payType),
                ),
                theirRates,
              ),
            })
          : null;
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
        money,
      };
    });
    return { week: w, workers: workers.filter((x) => x.buckets.workedMinutes > 0 || x.paidNotWorked > 0) };
  });

  /*
   * WHERE EACH PERSON'S SHEET CONTROL GOES. A sheet covers the whole period,
   * so the control must appear exactly once per person — but pinning it to the
   * first WEEK of the period hid it from anybody who only worked in the second,
   * which is how a fortnight's new starter would never have been able to submit
   * at all. Found by driving. It goes on the first week that person appears in.
   */
  const firstWeekFor = new Map<string, string>();
  for (const { week: w, workers } of perWeek) {
    for (const worker of workers) {
      if (!firstWeekFor.has(worker.workerId)) {
        firstWeekFor.set(worker.workerId, w.start);
      }
    }
  }

  /*
   * WHERE THE HOURS WENT. Worked minutes grouped by what each entry was booked
   * to, biggest first — the reason `time_entry_dimensions` exists and the first
   * place a business sees labour landing against a paddock or a line of
   * business. Slice 6 turns the same grouping into a cost in the P&L; this is
   * the hours behind it.
   *
   * Only WORKED minutes: paid leave is not labour on anything.
   */
  const minutesByMember = new Map<string, { name: string; minutes: number }>();
  let untaggedMinutes = 0;
  {
    const tagsFor = new Map<string, { memberId: string; name: string }[]>();
    for (const d of entryDimensions) {
      const list = tagsFor.get(d.entryId) ?? [];
      list.push({ memberId: d.memberId, name: d.name });
      tagsFor.set(d.entryId, list);
    }
    for (const row of rows) {
      if (!countsAsWorked(row.payType)) continue;
      const tags = tagsFor.get(row.id) ?? [];
      if (tags.length === 0) {
        untaggedMinutes += row.minutes;
        continue;
      }
      /*
       * AN ENTRY WITH TWO TAGS OF DIFFERENT KINDS COUNTS UNDER BOTH, and that
       * is right rather than double counting: an hour on the north paddock FOR
       * the beef enterprise genuinely belongs to each when you ask about that
       * kind. The totals are per kind, never summed across kinds, which is the
       * same rule the P&L's "Split by" already follows.
       */
      for (const tag of tags) {
        const seen = minutesByMember.get(tag.memberId);
        if (seen) seen.minutes += row.minutes;
        else minutesByMember.set(tag.memberId, { name: tag.name, minutes: row.minutes });
      }
    }
  }
  const whereHoursWent = [...minutesByMember.values()].sort(
    (a, b) => b.minutes - a.minutes,
  );

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/dashboard/m/time/pay?on=${adjacentPayPeriod(period, -1, settings).start}`}
            >
              ← Previous
            </Link>
          </Button>
          <span className="text-sm font-medium tracking-heading">
            {periodLabel(period)}
            {isThisPeriod && (
              <span className="ml-2 text-xs font-normal text-subtle-foreground">
                This period
              </span>
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
        <div className="flex items-center gap-2">
          {!isThisPeriod && (
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/m/time/pay">This period</Link>
            </Button>
          )}
          {canApprove && anyRows && (
            <ExportPayPeriodButton on={period.start} />
          )}
          {canApprove && anyRows && (
            <PeriodLockButton
              on={period.start}
              locked={isLocked}
              label={periodLabel(period)}
              postsLabor={prefs.postsLabor}
            />
          )}
        </div>
      </div>

      {/* Said once, at the top, because it explains every missing Edit button
          on the week screen as well as everything on this one. */}
      {isLocked && (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          This period is locked. Nothing in these dates can be changed — a
          mistake found now is put right by adding a correction in the open
          period, which leaves the original as your pay run saw it.
        </p>
      )}

      {/* Said plainly, because a reader has to be able to check it against what
          their payroll company does. */}
      <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        Overtime is worked out for each <strong>week</strong> on its own, then
        added up for the period — {ruleset.summary} A week that starts in one
        period and ends in another is paid in the period it ends in.
      </p>

      {whereHoursWent.length > 0 && (
        <Panel className="p-4">
          <h2 className="mb-3 text-sm font-medium tracking-heading">
            Where the hours went
          </h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {whereHoursWent.map((w) => (
              <li
                key={w.name}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="truncate">{w.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatDuration(w.minutes)}
                </span>
              </li>
            ))}
            {untaggedMinutes > 0 && (
              <li className="flex items-baseline justify-between gap-4 text-sm">
                <span className="truncate text-subtle-foreground">
                  Not booked to anything
                </span>
                <span className="tabular-nums text-subtle-foreground">
                  {formatDuration(untaggedMinutes)}
                </span>
              </li>
            )}
          </ul>
          <p className="mt-3 text-xs text-subtle-foreground">
            Counted per kind. An hour booked to both a field and a line of
            business appears under each, so these do not add up to the total.
          </p>
        </Panel>
      )}

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
            <Panel key={w.start}>
              <div className="flex items-center justify-between gap-4 border-b border-divider px-4 py-2.5">
                <h2 className="text-sm font-medium tracking-heading">
                  Week of {weekLabel(w.start)}
                </h2>
                <span className="text-xs text-subtle-foreground">
                  {workers.length === 0
                    ? "nothing logged"
                    : `${workers.length} ${workers.length === 1 ? "person" : "people"}`}
                </span>
              </div>
              {workers.length === 0 ? (
                <p className="px-4 py-2.5 text-sm text-muted-foreground">
                  Nothing was logged in this week.
                </p>
              ) : (
                <ul className="divide-y divide-divider">
                  {workers.map((w2) => (
                    <li
                      key={w2.workerId}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
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
                        <span className="tabular-nums text-warning-foreground">
                          {formatDuration(w2.buckets.doubleTimeMinutes)} double time
                        </span>
                      )}
                      {w2.paidNotWorked > 0 && (
                        <span className="tabular-nums text-muted-foreground">
                          {formatDuration(w2.paidNotWorked)} {w2.leaveKinds.join(", ").toLowerCase()}
                        </span>
                      )}
                      {!hasPremium(w2.buckets) && w2.buckets.workedMinutes > 0 && (
                        <span className="text-xs text-subtle-foreground">
                          no overtime
                        </span>
                      )}
                      {/* The figure only exists for a reader the rates policy
                          lets see rates, so there is nothing to hide here. */}
                      {w2.money && (
                        <span
                          className="tabular-nums font-medium"
                          title={
                            w2.money.overtimePremiumCents > 0
                              ? `${formatCents(w2.money.straightTimeCents)} straight time plus ${formatCents(w2.money.overtimePremiumCents + w2.money.doubleTimePremiumCents)} overtime premium`
                              : undefined
                          }
                        >
                          {formatCents(w2.money.grossCents)}
                        </span>
                      )}
                      {w2.money?.incomplete && (
                        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning-foreground">
                          some hours have no rate
                        </span>
                      )}
                      {/*
                        THE STATE AND THE VERB SIT TOGETHER, and only on the
                        first week of the period: a sheet covers the whole
                        period, not one week inside it, so repeating the button
                        on each week would offer the same act twice.
                      */}
                      {firstWeekFor.get(w2.workerId) === w.start && (
                        <SheetState
                          sheet={sheetByWorker.get(w2.workerId)}
                          workerId={w2.workerId}
                          name={w2.name}
                          on={period.start}
                          summary={summarise(w2.buckets, w2.paidNotWorked)}
                          canWrite={canWrite}
                          canApprove={canApprove}
                          isLocked={isLocked}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
