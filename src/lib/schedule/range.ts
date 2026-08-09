import "server-only";
import { and, gt, isNull, lt, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { ScheduleAccessLevel, ScheduleShowAs } from "./access";

/**
 * THE read path. Every surface goes through `listRange`.
 *
 * It looks like ceremony while it is two queries against four tables. It stops
 * looking like ceremony at slice 8, when a recurring item has to be expanded
 * across the requested window on the way out — expand-on-read cannot be
 * retrofitted across a dozen call sites that each grew their own query, and
 * this is the file where it will happen exactly once.
 *
 * ── WHY TWO QUERIES ─────────────────────────────────────────────────────────
 *
 * The four access levels split across two mechanisms, because RLS can grant or
 * refuse a row but cannot return a redacted one:
 *
 *   details, write  →  an ordinary RLS-scoped SELECT. Full rows.
 *   busy, titles    →  app_schedule_range(), which returns a PROJECTION with
 *                      the columns that level does not carry already NULL.
 *
 * So neither query redacts anything and no application code does either. The
 * merge below concatenates two disjoint sets — the SQL function stops at
 * `access < 'details'` precisely so nothing appears in both.
 *
 * Items somebody sees by being an ATTENDEE come back on the first query, from
 * the policy's attendee term, even when the calendar itself is invisible to
 * them. Those rows have a null `access`, which is not a gap — see the field.
 */

export interface ScheduleRangeItem {
  id: string;
  calendarId: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  showAs: ScheduleShowAs;
  /**
   * The caller's level on this item's calendar, or NULL.
   *
   * NULL means "you can see this because you are ON it, not because the
   * calendar is shared with you" — an invitation to a meeting on somebody's
   * private calendar. Renderers should treat it as read-only and must not
   * offer to open the surrounding calendar, because there isn't one to open.
   */
  access: ScheduleAccessLevel | null;
  /** NULL below `titles`. The null IS the answer: show "Busy". */
  title: string | null;
  location: string | null;
  /** NULL below `details`. */
  description: string | null;
  kind: string | null;
}

interface OverlayRow {
  id: string;
  calendar_id: string;
  starts_at: string | Date;
  ends_at: string | Date;
  all_day: boolean;
  show_as: ScheduleShowAs;
  access: ScheduleAccessLevel;
  title: string | null;
  location: string | null;
}

/**
 * Everything the caller may know about between `from` and `to`.
 *
 * Half-open on both ends the way calendars are: an item counts when it overlaps
 * the window at all, so a three-day item is returned on the middle day even
 * though it neither starts nor ends there.
 *
 * Takes the CALLER'S `tx` rather than opening its own, so what it can find is
 * exactly what the person asking may see — invariant S12 as a signature. Get the
 * tx from `withSchedule`, which is what sets the identity every policy reads.
 */
export async function listRange(
  tx: Tx,
  from: Date,
  to: Date,
): Promise<ScheduleRangeItem[]> {
  const overlaps = and(
    isNull(schema.scheduleItems.cancelledAt),
    lt(schema.scheduleItems.startsAt, to),
    gt(schema.scheduleItems.endsAt, from),
  );

  const full = await tx
    .select({
      id: schema.scheduleItems.id,
      calendarId: schema.scheduleItems.calendarId,
      startsAt: schema.scheduleItems.startsAt,
      endsAt: schema.scheduleItems.endsAt,
      allDay: schema.scheduleItems.allDay,
      showAs: schema.scheduleItems.showAs,
      title: schema.scheduleItems.title,
      location: schema.scheduleItems.location,
      description: schema.scheduleItems.description,
      kind: schema.scheduleItems.kind,
      // Computed rather than stored: the level is a fact about the reader, not
      // about the row, and caching it on the row is how the two drift.
      access: sql<
        ScheduleAccessLevel | null
      >`app_calendar_access(${schema.scheduleItems.calendarId})`,
    })
    .from(schema.scheduleItems)
    .where(overlaps);

  const overlay = (await tx.execute(
    sql`select * from app_schedule_range(${from}, ${to})`,
  )) as unknown as { rows: OverlayRow[] };

  const projected: ScheduleRangeItem[] = overlay.rows.map((r) => ({
    id: r.id,
    calendarId: r.calendar_id,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    allDay: r.all_day,
    showAs: r.show_as,
    access: r.access,
    title: r.title,
    location: r.location,
    // Below `details` by construction — the function does not select them.
    description: null,
    kind: null,
  }));

  return [...full, ...projected].sort(compareForDisplay);
}

/**
 * Start, then id.
 *
 * The id tiebreak is not decoration: two runs over unchanged data must produce
 * a byte-identical list, for the same reason the digest's ordering is fixed —
 * an order that changes for reasons the reader cannot predict destroys the
 * trust the surface runs on. Two items starting at the same instant is the
 * common case, not the edge case, at 9am on a Monday.
 */
function compareForDisplay(a: ScheduleRangeItem, b: ScheduleRangeItem): number {
  const byStart = a.startsAt.getTime() - b.startsAt.getTime();
  if (byStart !== 0) return byStart;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
