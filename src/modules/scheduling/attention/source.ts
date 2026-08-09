import "server-only";
import { and, eq, gt, isNull, lt, gte } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import {
  addDays,
  dateInTimezone,
  formatTimeInTimezone,
  startOfDayInTimezone,
} from "@/lib/timezone";

/**
 * What scheduling says needs you: invitations you have not answered, and what
 * is actually on today.
 *
 * IMPORTS `@/lib/attention-sources/types` AND NOTHING ELSE FROM `src/lib`
 * outside the db handle and the two shared date helpers — never the registry,
 * never another module. See that file's header for the dependency graph.
 *
 * ── TWO POPULATIONS, AND ONLY ONE OF THEM IS AN OBLIGATION ───────────────────
 *
 * `notifications.md` is strict that an item must SELF-CLEAR, or the channel
 * accumulates and gets muted. Both of these do, for different reasons:
 *
 *   • **An unanswered invitation** is a true obligation — you owe a reply, and
 *     answering makes it vanish. There is nothing to mark read.
 *   • **Today's schedule** is not something you owe; it clears because tomorrow
 *     arrives. Included anyway because it is the reason this feature is worth
 *     opening: "here is your day" beats a list of overdue invoices, and the
 *     dossier called scheduling the digest's strongest source before either
 *     existed.
 *
 * ── WHOSE DAY, EXACTLY ───────────────────────────────────────────────────────
 *
 * An event counts as YOURS when you are an ATTENDEE, or when it sits on a
 * calendar you OWN. Deliberately not "any calendar you can see": a workspace
 * calendar shared with everybody would otherwise put the whole company's week
 * in every person's morning email, which is precisely the untrustworthy noise
 * the derived-obligation design exists to avoid.
 *
 * That also means everything returned here is fully visible to the reader —
 * their own calendar or their own invitation — so the four access levels never
 * come into it and no title is ever redacted. A `busy`-level glimpse of
 * somebody else's afternoon is not an obligation.
 */

/** An invitation more than this far out is not this morning's problem. */
const INVITE_HORIZON_DAYS = 30;

function urgencyFor(
  eventDate: string,
  today: string,
): AttentionItem["urgency"] {
  if (eventDate < today) return "overdue";
  if (eventDate === today) return "today";
  return "soon";
}

/** "2:30 PM · Knox site office" — whatever of the two we have. */
function detailFor(
  startsAt: Date,
  allDay: boolean,
  location: string,
  timeZone: string,
): string | undefined {
  const when = allDay ? "All day" : formatTimeInTimezone(startsAt, timeZone);
  const parts = [when, location.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

async function collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
  // `AttentionCtx` carries `today` but not the zone, so it is read here from
  // the caller's own transaction. A tenant transaction can see its own row and
  // no other, which is exactly the scope wanted.
  const timeZone = await getTenantTimezone(tx, ctx.tenantId);
  const dayStart = startOfDayInTimezone(ctx.today, timeZone);
  const dayEnd = startOfDayInTimezone(addDays(ctx.today, 1), timeZone);
  const horizon = startOfDayInTimezone(
    addDays(ctx.today, INVITE_HORIZON_DAYS),
    timeZone,
  );

  const href = (startsAt: Date) =>
    `/dashboard/m/scheduling?view=day&date=${dateInTimezone(startsAt, timeZone)}`;

  /* 1. Invitations you have not answered. */
  const invitations = await tx
    .select({
      id: schema.scheduleItems.id,
      title: schema.scheduleItems.title,
      startsAt: schema.scheduleItems.startsAt,
      allDay: schema.scheduleItems.allDay,
      location: schema.scheduleItems.location,
    })
    .from(schema.scheduleItemAttendees)
    .innerJoin(
      schema.scheduleItems,
      and(
        eq(schema.scheduleItems.id, schema.scheduleItemAttendees.itemId),
        eq(schema.scheduleItems.tenantId, schema.scheduleItemAttendees.tenantId),
      ),
    )
    .where(
      and(
        eq(schema.scheduleItemAttendees.clerkUserId, ctx.userId),
        eq(schema.scheduleItemAttendees.response, "needs_action"),
        isNull(schema.scheduleItems.cancelledAt),
        // Still ahead of us, or happening now. An invitation to something that
        // finished last week is not a reply anybody needs.
        gte(schema.scheduleItems.endsAt, dayStart),
        lt(schema.scheduleItems.startsAt, horizon),
      ),
    );

  const items: AttentionItem[] = invitations.map((row) => {
    const eventDate = dateInTimezone(row.startsAt, timeZone);
    return {
      key: `schedule_invite:${row.id}`,
      title: `${row.title} — you have not replied`,
      detail: detailFor(row.startsAt, row.allDay, row.location, timeZone),
      urgency: urgencyFor(eventDate, ctx.today),
      dueOn: eventDate,
      href: href(row.startsAt),
    };
  });

  const invited = new Set(invitations.map((r) => r.id));

  /* 2. Today, on a calendar you own or an event you are on. */
  const overlapsToday = and(
    isNull(schema.scheduleItems.cancelledAt),
    lt(schema.scheduleItems.startsAt, dayEnd),
    gt(schema.scheduleItems.endsAt, dayStart),
  );

  const [onMyCalendars, imAttending] = await Promise.all([
    tx
      .select({
        id: schema.scheduleItems.id,
        title: schema.scheduleItems.title,
        startsAt: schema.scheduleItems.startsAt,
        allDay: schema.scheduleItems.allDay,
        location: schema.scheduleItems.location,
      })
      .from(schema.scheduleItems)
      .innerJoin(
        schema.scheduleCalendars,
        and(
          eq(schema.scheduleCalendars.id, schema.scheduleItems.calendarId),
          eq(schema.scheduleCalendars.tenantId, schema.scheduleItems.tenantId),
        ),
      )
      .where(
        and(
          overlapsToday,
          eq(schema.scheduleCalendars.ownerClerkUserId, ctx.userId),
        ),
      ),
    tx
      .select({
        id: schema.scheduleItems.id,
        title: schema.scheduleItems.title,
        startsAt: schema.scheduleItems.startsAt,
        allDay: schema.scheduleItems.allDay,
        location: schema.scheduleItems.location,
      })
      .from(schema.scheduleItems)
      .innerJoin(
        schema.scheduleItemAttendees,
        and(
          eq(schema.scheduleItemAttendees.itemId, schema.scheduleItems.id),
          eq(schema.scheduleItemAttendees.tenantId, schema.scheduleItems.tenantId),
        ),
      )
      .where(
        and(
          overlapsToday,
          eq(schema.scheduleItemAttendees.clerkUserId, ctx.userId),
        ),
      ),
  ]);

  // Two queries rather than one OR across a double join: the same event can
  // reach you both ways, and merging by id here is clearer than a DISTINCT
  // whose necessity is invisible six months later.
  const seen = new Set<string>();
  for (const row of [...onMyCalendars, ...imAttending]) {
    // An unanswered invitation is already reported, as the more actionable of
    // the two. Reporting it twice would make the count wrong, and "one number
    // everywhere" is what this feature trades on.
    if (invited.has(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    items.push({
      key: `schedule_event:${row.id}`,
      title: row.title,
      detail: detailFor(row.startsAt, row.allDay, row.location, timeZone),
      urgency: "today",
      dueOn: ctx.today,
      href: href(row.startsAt),
    });
  }

  return items;
}

export const schedulingAttentionSource: AttentionSource = {
  slug: "scheduling",
  moduleSlug: "scheduling",
  label: "Scheduling",
  collect,
};
