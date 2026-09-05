import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { occupiesTime } from "./access";
import { mergeIntervals, type Interval } from "./availability";
import { listRange, type ScheduleRangeItem } from "./range";

/**
 * The business calendars the platform provisions for the website (ADR
 * 0025): `Bookings`, where a visitor's booking lands, and `Events`, whose
 * upcoming items a page lists.
 *
 * Each is owned by the business (`owner_clerk_user_id` NULL), made once
 * through the managed unique index (`extension_slug` + `extension_key`),
 * and SHARED WITH EVERYONE AT `write`. That share is the whole mechanism: a
 * public page reads and a booking writes as `staff` with no user, and
 * `app_calendar_access` answers `write` for the workspace-wide grant, so
 * the same member policies that bound a colleague bound the site. A page
 * save puts the share back at `write` if somebody lowered it; without it
 * the site would stop seeing the calendar and nothing would say why.
 */
const EXTENSION_SLUG = "marketing";

export const MANAGED_CALENDARS = {
  bookings: { extensionKey: "bookings", name: "Bookings", kind: "bookings", color: "green" },
  events: { extensionKey: "events", name: "Events", kind: "events", color: "amber" },
} as const;
export type ManagedCalendarKey = keyof typeof MANAGED_CALENDARS;
export const MANAGED_CALENDAR_KEYS = Object.keys(MANAGED_CALENDARS) as ManagedCalendarKey[];

export async function findManagedCalendarId(
  tx: Tx,
  tenantId: string,
  key: ManagedCalendarKey,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.scheduleCalendars.id })
    .from(schema.scheduleCalendars)
    .where(
      and(
        eq(schema.scheduleCalendars.tenantId, tenantId),
        eq(schema.scheduleCalendars.extensionSlug, EXTENSION_SLUG),
        eq(schema.scheduleCalendars.extensionKey, MANAGED_CALENDARS[key].extensionKey),
      ),
    );
  return row?.id ?? null;
}

/** Made once, shared with everyone at `write`; an OWNER's context, since the business owns it. */
export async function ensureManagedCalendar(
  tx: Tx,
  tenantId: string,
  key: ManagedCalendarKey,
): Promise<string> {
  const spec = MANAGED_CALENDARS[key];
  await tx
    .insert(schema.scheduleCalendars)
    .values({
      tenantId,
      ownerClerkUserId: null,
      name: spec.name,
      color: spec.color,
      kind: spec.kind,
      extensionSlug: EXTENSION_SLUG,
      extensionKey: spec.extensionKey,
    })
    .onConflictDoNothing();
  const id = await findManagedCalendarId(tx, tenantId, key);
  if (!id) throw new Error(`${spec.name} calendar not created`);
  await tx
    .insert(schema.scheduleShares)
    .values({ tenantId, calendarId: id, granteeClerkUserId: "", access: "write" })
    .onConflictDoUpdate({
      target: [schema.scheduleShares.tenantId, schema.scheduleShares.calendarId, schema.scheduleShares.granteeClerkUserId],
      set: { access: "write", updatedAt: new Date() },
    });
  return id;
}

/** What is on one calendar between two instants, occurrences expanded, cancelled ones gone, soonest first. */
export async function itemsOnCalendar(
  tx: Tx,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<ScheduleRangeItem[]> {
  const items = await listRange(tx, from, to);
  return items
    .filter((item) => item.calendarId === calendarId)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** What is taken on one calendar: `show_as`, never mere existence, merged. */
export async function busyOnCalendar(
  tx: Tx,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<Interval[]> {
  const items = await itemsOnCalendar(tx, calendarId, from, to);
  return mergeIntervals(
    items.filter((item) => occupiesTime(item.showAs)).map((item) => ({ startsAt: item.startsAt, endsAt: item.endsAt })),
  );
}
