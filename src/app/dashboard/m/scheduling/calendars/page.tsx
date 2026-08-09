import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listAssignableMembers } from "@/lib/team";
import { withSchedule } from "@/lib/schedule/with-schedule";
import {
  listCalendars,
  listShares,
  type ShareRow,
} from "@/modules/scheduling/calendar-ops";
import { listFeedTokens } from "@/modules/scheduling/feed-ops";
import { CalendarManager } from "@/modules/scheduling/components/calendar-manager";
import { FeedSubscription } from "@/modules/scheduling/components/feed-subscription";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/scheduling";

/**
 * Managing calendars, which was the module's home in slice 1.
 *
 * Slice 2 gave the home to the week view, because that is what somebody opens a
 * calendar to look at. This is the settings surface behind it — reached often
 * enough to deserve a page, not often enough to be the front door.
 */
export default async function CalendarsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "scheduling");

  const schedulingCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  const { calendars, members, shares, tokens } = await withSchedule(
    schedulingCtx,
    async (tx) => {
      const calendars = await listCalendars(tx, schedulingCtx, {
        includeArchived: true,
      });
      const members = await listAssignableMembers(tx, ctx.tenant.id);
      // Scoped to the caller by policy, not by a predicate here — see
      // listFeedTokens.
      const tokens = await listFeedTokens(tx);
      const administrable = calendars.filter(
        (c) =>
          c.group === "mine" || (c.group === "business" && ctx.role === "owner"),
      );
      const shares: Record<string, ShareRow[]> = {};
      for (const calendar of administrable) {
        shares[calendar.id] = await listShares(tx, calendar.id);
      }
      return { calendars, members, shares, tokens };
    },
  );

  return (
    <div className="space-y-4">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back to the calendar
      </Link>
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
      <FeedSubscription tokens={tokens} />
    </div>
  );
}
