import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { occupiesTime } from "./access";
import { mergeIntervals, type Interval } from "./availability";
import { listRange } from "./range";

/**
 * The business's Bookings calendar — the first managed business calendar
 * (ADR 0025).
 *
 * Owned by the business (`owner_clerk_user_id` NULL), provisioned by the
 * Marketing module through the managed unique index
 * (`extension_slug` + `extension_key`, so it is made once), and SHARED WITH
 * EVERYONE AT `write`. That share is the whole mechanism: a booking from the
 * site is written as `staff` with no user, and `app_calendar_access` answers
 * `write` for it through the workspace-wide grant, so the same member
 * policies that bound a colleague bound the site. A page save puts the
 * share back at `write` if somebody lowered it; without it, bookings would
 * stop landing on the calendar and nothing would say why.
 */
export const BOOKINGS_CALENDAR = {
  extensionSlug: "marketing",
  extensionKey: "bookings",
  name: "Bookings",
  kind: "bookings",
  color: "green",
} as const;

export async function findBookingsCalendarId(tx: Tx, tenantId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.scheduleCalendars.id })
    .from(schema.scheduleCalendars)
    .where(
      and(
        eq(schema.scheduleCalendars.tenantId, tenantId),
        eq(schema.scheduleCalendars.extensionSlug, BOOKINGS_CALENDAR.extensionSlug),
        eq(schema.scheduleCalendars.extensionKey, BOOKINGS_CALENDAR.extensionKey),
      ),
    );
  return row?.id ?? null;
}

/** Made once, shared with everyone at `write`; an OWNER's context, since the business owns it. */
export async function ensureBookingsCalendar(tx: Tx, tenantId: string): Promise<string> {
  await tx
    .insert(schema.scheduleCalendars)
    .values({
      tenantId,
      ownerClerkUserId: null,
      name: BOOKINGS_CALENDAR.name,
      color: BOOKINGS_CALENDAR.color,
      kind: BOOKINGS_CALENDAR.kind,
      extensionSlug: BOOKINGS_CALENDAR.extensionSlug,
      extensionKey: BOOKINGS_CALENDAR.extensionKey,
    })
    .onConflictDoNothing();
  const id = await findBookingsCalendarId(tx, tenantId);
  if (!id) throw new Error("bookings calendar not created");
  await tx
    .insert(schema.scheduleShares)
    .values({ tenantId, calendarId: id, granteeClerkUserId: "", access: "write" })
    .onConflictDoUpdate({
      target: [schema.scheduleShares.tenantId, schema.scheduleShares.calendarId, schema.scheduleShares.granteeClerkUserId],
      set: { access: "write", updatedAt: new Date() },
    });
  return id;
}

/** What is taken on one calendar between two instants: `show_as`, never mere existence, merged. */
export async function busyOnCalendar(
  tx: Tx,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<Interval[]> {
  const items = await listRange(tx, from, to);
  return mergeIntervals(
    items
      .filter((item) => item.calendarId === calendarId && occupiesTime(item.showAs))
      .map((item) => ({ startsAt: item.startsAt, endsAt: item.endsAt })),
  );
}
