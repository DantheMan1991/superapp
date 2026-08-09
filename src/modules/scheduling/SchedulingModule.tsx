import type { TenantContext } from "@/lib/auth";
import { listAssignableMembers } from "@/lib/team";
import { withSchedule } from "@/lib/schedule/with-schedule";
import { listCalendars, listShares, type ShareRow } from "./calendar-ops";
import { CalendarManager } from "./components/calendar-manager";

/**
 * The module's home page, and for now it IS the calendar list.
 *
 * Slice 2 makes the week view the home and moves this to
 * `/dashboard/m/scheduling/calendars`. Until there is anything to look at, a
 * front door that only reported "you have 3 calendars" would be a dead end —
 * the same reason CRM's home is the records list rather than an overview.
 */
export async function SchedulingModule({ ctx }: { ctx: TenantContext }) {
  const schedulingCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  const { calendars, members, shares } = await withSchedule(
    schedulingCtx,
    async (tx) => {
      const calendars = await listCalendars(tx, schedulingCtx, {
        includeArchived: true,
      });

      // The roster is resolved from the CALLER'S transaction, so the picker
      // cannot name somebody they could not already find. Same property
      // CRM's RecordAccess relies on.
      const members = await listAssignableMembers(tx, ctx.tenant.id);

      // Shares are loaded only for calendars the caller administers, because
      // those are the only ones whose sharing they can open. Loading them all
      // up front costs one query at this scale and saves a round trip when the
      // dialog opens; it stops being the right trade if a workspace ever has
      // hundreds of calendars, which is noted in the dossier rather than
      // guessed at now.
      const administrable = calendars.filter(
        (c) => c.group === "mine" || (c.group === "business" && ctx.role === "owner"),
      );
      const shares: Record<string, ShareRow[]> = {};
      for (const calendar of administrable) {
        shares[calendar.id] = await listShares(tx, calendar.id);
      }

      return { calendars, members, shares };
    },
  );

  return (
    <CalendarManager
      calendars={calendars}
      members={members.map((m) => ({
        clerkUserId: m.clerkUserId,
        label: m.name?.trim() || m.email,
        role: m.role,
      }))}
      shares={shares}
      currentUserId={ctx.userId}
      isOwner={ctx.role === "owner"}
    />
  );
}
