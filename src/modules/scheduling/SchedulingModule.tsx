import type { TenantContext } from "@/lib/auth";
import { listAssignableMembers } from "@/lib/team";
import { withSchedule } from "@/lib/schedule/with-schedule";
import { listRange } from "@/lib/schedule/range";
import { roleMayWrite } from "@/lib/schedule/access";
import { addDays, startOfDayInTimezone, todayInTimezone } from "@/lib/timezone";
import { listCalendars } from "./calendar-ops";
import { CalendarView } from "./components/calendar-view";
import { resolveViewRange, type ScheduleViewMode } from "./core/range";

/**
 * The module's home: the calendar.
 *
 * URL-DRIVEN, which is the house pattern — `?view=week&date=2026-08-10`. It
 * makes a particular week linkable, survives a refresh, and means the server
 * fetches exactly the range being looked at rather than shipping a year to the
 * browser and filtering there.
 *
 * ANCHORED ON THE TENANT'S TODAY, never the server's and never the browser's.
 * A workspace in New York looks at the same week whoever opens it.
 */
export async function SchedulingModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const timeZone = ctx.tenant.timezone;
  const schedulingCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  const single = (key: string): string | undefined => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const mode = (["week", "day", "month"] as const).includes(
    single("view") as ScheduleViewMode,
  )
    ? (single("view") as ScheduleViewMode)
    : "week";

  const today = todayInTimezone(timeZone);
  const anchorParam = single("date");
  // A malformed ?date= falls back to today rather than 404ing. It arrives from
  // a hand-edited URL or a stale bookmark, and neither deserves an error page.
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorParam ?? "")
    ? (anchorParam as string)
    : today;

  const range = resolveViewRange(mode, anchor);

  const { items, calendars, members } = await withSchedule(
    schedulingCtx,
    async (tx) => {
      // The window is [local midnight of the first day, local midnight after
      // the last) — computed in the tenant's zone, so a week is seven local
      // days and not 168 hours from wherever the server happens to be.
      const from = startOfDayInTimezone(range.from, timeZone);
      const to = startOfDayInTimezone(addDays(range.to, 1), timeZone);
      return {
        items: await listRange(tx, from, to),
        calendars: await listCalendars(tx, schedulingCtx),
        members: await listAssignableMembers(tx, ctx.tenant.id),
      };
    },
  );

  return (
    <CalendarView
      mode={mode}
      anchor={anchor}
      today={today}
      range={range}
      timeZone={timeZone}
      items={items}
      calendars={calendars}
      members={members.map((m) => ({
        clerkUserId: m.clerkUserId,
        label: m.name?.trim() || m.email,
      }))}
      /* The same question `gate()` asks, so the page and the action cannot
         disagree. They did until 2026-09-03: every control here rendered
         enabled for an accountant and every press came back
         `accountant access is read-only`. */
      canWrite={roleMayWrite(ctx.role)}
    />
  );
}
