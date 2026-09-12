import Link from "next/link";
import { Clock } from "lucide-react";
import { withTenant } from "@/db";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import type { TenantContext } from "@/lib/auth";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { todayInTimezone } from "@/lib/timezone";
import { roleMayWrite } from "./core/errors";
import { formatDuration } from "./core/duration";
import { countsAsPaid, countsAsWorked, payTypeLabel } from "./core/pay-types";
import {
  addDays,
  dayLabel,
  isDateString,
  startOfWeek,
  weekDays,
  weekLabel,
} from "./core/week";
import { EntryRow, type EntryView } from "./components/entry-row";
import { LogTimeForm } from "./components/log-time";
import { listEntries, listWorkers } from "./read";
import { getWeekStartsOn } from "./settings-ops";

/**
 * The module's home: one week of hours, by day.
 *
 * A WEEK RATHER THAN A LIST, because a week is the unit this whole module is
 * built around. From slice 2 it is the WORKWEEK — the fixed recurring period
 * overtime is computed over, which is not the pay period and need not line up
 * with it — so the page that people look at every day should already be showing
 * them the boundary that decides their overtime.
 *
 * THE WEEK IS THE URL (`?week=yyyy-mm-dd`, any day inside it), the arrangement
 * Work uses: a week somebody is looking at is a thing they can send to
 * somebody else, and back is the browser's back.
 *
 * ANCHORED ON THE TENANT'S TODAY, never the server's and never the browser's,
 * so two people in one workspace agree about which week is this one.
 */
export async function TimeModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const today = todayInTimezone(ctx.tenant.timezone);
  const canWrite = roleMayWrite(ctx.role);

  const rawWeek = searchParams["week"];
  const asked = Array.isArray(rawWeek) ? rawWeek[0] : rawWeek;
  // A hand-edited query string is the only way this is not a real day, and
  // landing on this week beats an error page.
  const anchor = asked && isDateString(asked) ? asked : today;

  /*
   * ONE TRANSACTION, and the week boundary is resolved inside it. The entry
   * read needs the week start, which needs the setting — sequential rather than
   * parallel, but a second `withTenant` would be a second BEGIN and a second
   * round of context statements to Neon for a lookup that returns one integer.
   */
  const { weekStartsOn, weekStart, rows, workers, members } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const weekStartsOn = await getWeekStartsOn(tx, ctx.tenant.id);
      const weekStart = startOfWeek(anchor, weekStartsOn);
      return {
        weekStartsOn,
        weekStart,
        rows: await listEntries(tx, ctx.tenant.id, {
          from: weekStart,
          to: addDays(weekStart, 6),
        }),
        workers: await listWorkers(tx, ctx.tenant.id),
        members: await listAssignableMembers(tx, ctx.tenant.id),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  const labelByUser = new Map(
    members.map((member) => [member.clerkUserId, memberLabel(member)]),
  );

  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byDay.get(row.workDate) ?? [];
    list.push(row);
    byDay.set(row.workDate, list);
  }

  const workedMinutes = rows
    .filter((r) => countsAsWorked(r.payType))
    .reduce((sum, r) => sum + r.minutes, 0);
  const paidMinutes = rows
    .filter((r) => countsAsPaid(r.payType))
    .reduce((sum, r) => sum + r.minutes, 0);

  const perWorker = [...workers]
    .map((worker) => ({
      name: worker.name,
      minutes: rows
        .filter((r) => r.workerId === worker.id && countsAsWorked(r.payType))
        .reduce((sum, r) => sum + r.minutes, 0),
    }))
    .filter((w) => w.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const activeWorkers = workers
    .filter((w) => w.isActive)
    .map((w) => ({ id: w.id, name: w.name }));
  const mine = workers.find((w) => w.clerkUserId === ctx.userId) ?? null;

  const isThisWeek = weekStart === startOfWeek(today, weekStartsOn);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Time"
        description={
          rows.length === 0
            ? "What everybody worked, week by week."
            : `${formatDuration(workedMinutes)} worked${
                paidMinutes > workedMinutes
                  ? ` · ${formatDuration(paidMinutes - workedMinutes)} paid but not worked`
                  : ""
              }`
        }
        icon={<Clock />}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/m/time/people">People</Link>
            </Button>
            {canWrite && (
              <LogTimeForm
                workers={activeWorkers}
                defaultWorkerId={mine?.id ?? null}
                today={today}
              />
            )}
          </div>
        }
      />

      {/* Said once, above the week, rather than as a disabled control on every
          row. An accountant who can see the page and is told why is better
          served than one who presses something and is refused. */}
      {!canWrite && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Accountant access is read-only. You can see every hour logged and
          nothing here can be changed.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/dashboard/m/time?week=${addDays(weekStart, -7)}`}>
              ← Previous
            </Link>
          </Button>
          <span className="text-sm font-medium">
            {weekLabel(weekStart)}
            {isThisWeek && (
              <span className="ml-2 text-xs text-muted-foreground">
                This week
              </span>
            )}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/dashboard/m/time?week=${addDays(weekStart, 7)}`}>
              Next →
            </Link>
          </Button>
        </div>
        {!isThisWeek && (
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/m/time">This week</Link>
          </Button>
        )}
      </div>

      {workers.length === 0 ? (
        <EmptyState
          panel
          icon={<Clock />}
          title="Nobody can have time logged yet"
          description="Add the people whose hours you want to keep. They do not need to be able to sign in — a seasonal hand counts."
          action={
            canWrite ? (
              <Button asChild>
                <Link href="/dashboard/m/time/people">Add someone</Link>
              </Button>
            ) : undefined
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          panel
          icon={<Clock />}
          title="No hours this week"
          description={
            isThisWeek
              ? "Log what has been worked so far, or move back a week to see what was."
              : "Nothing was logged in this week."
          }
        />
      ) : (
        <div className="space-y-4">
          {perWorker.length > 1 && (
            <div className="rounded-lg border p-3">
              <h2 className="mb-2 text-sm font-medium">Worked this week</h2>
              <ul className="grid gap-1 sm:grid-cols-2">
                {perWorker.map((w) => (
                  <li
                    key={w.name}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="truncate">{w.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatDuration(w.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Newest day first, and only days with something on them: seven
              headings for one Tuesday's work is a page you have to read past. */}
          {weekDays(weekStart)
            .slice()
            .reverse()
            .filter((day) => (byDay.get(day)?.length ?? 0) > 0)
            .map((day) => {
              const dayRows = byDay.get(day) ?? [];
              const dayMinutes = dayRows.reduce((s, r) => s + r.minutes, 0);
              return (
                <div key={day} className="rounded-lg border">
                  <div className="flex items-center justify-between gap-4 border-b px-3 py-2">
                    <h2 className="text-sm font-medium">{dayLabel(day)}</h2>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {formatDuration(dayMinutes)}
                    </span>
                  </div>
                  <ul className="divide-y">
                    {dayRows.map((row) => {
                      const view: EntryView = {
                        id: row.id,
                        version: row.version,
                        minutes: row.minutes,
                        workDate: row.workDate,
                        payType: row.payType,
                        note: row.note,
                        workerName: row.workerName,
                        enteredBy:
                          row.enteredByClerkUserId === ctx.userId
                            ? null
                            : (labelByUser.get(row.enteredByClerkUserId) ??
                              "Someone who has left"),
                      };
                      return (
                        <li
                          key={row.id}
                          className="flex items-center gap-3 px-3 py-2 text-sm"
                        >
                          <span className="w-40 shrink-0 truncate font-medium">
                            {row.workerName}
                          </span>
                          <span className="w-20 shrink-0 tabular-nums">
                            {formatDuration(row.minutes)}
                          </span>
                          {!countsAsWorked(row.payType) && (
                            <span className="shrink-0 rounded-full bg-module-accent/10 px-2 py-0.5 text-[11px] text-module-accent">
                              {payTypeLabel(row.payType)}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {row.note}
                          </span>
                          {canWrite && <EntryRow entry={view} today={today} />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
