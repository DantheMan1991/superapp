import "server-only";
import { and, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { dateInTimezone, timeOfDayInTimezone } from "@/lib/timezone";
import type { ScheduleAccessLevel, ScheduleShowAs } from "./access";
import { expandOccurrences, parseRule } from "./recurrence";

/**
 * THE read path. Every surface goes through `listRange`.
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
 * Neither query redacts anything and no application code does either. The SQL
 * function stops at `access < 'details'` so nothing appears in both.
 *
 * Items somebody sees by being an ATTENDEE come back on the first query, from
 * the policy's attendee term, even when the calendar itself is invisible. Those
 * rows have a null `access` — not a gap, see the field.
 *
 * ── AND WHY EXPANSION HAPPENS HERE, IN TYPESCRIPT ───────────────────────────
 *
 * A repeating event is ONE ROW. Expanding it means walking local dates and
 * converting each with the zone's offset at that instant — the reason
 * `zonedTimeToInstant` exists, and the reason a weekly 8am meeting stays 8am
 * across a DST change. Reimplementing that in SQL would be a second copy of the
 * hardest logic in the module, so `app_schedule_range` returns the series row
 * with its rule attached and BOTH sources are expanded by the same code below.
 * One expander, two sources.
 */

export interface ScheduleRangeItem {
  /** The ITEM's id. Every occurrence of a series shares it. */
  id: string;
  /**
   * The local date of this occurrence, for a repeating event; null for a
   * one-off.
   *
   * Together with `id` it is the occurrence's identity — what an override is
   * keyed on, and what an "edit just this one" has to name. A renderer keying
   * a list on `id` alone will collapse a whole series into one row.
   */
  occurrenceDate: string | null;
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
   * private calendar. Renderers should treat it as read-only.
   */
  access: ScheduleAccessLevel | null;
  /** NULL below `titles`. The null IS the answer: show "Busy". */
  title: string | null;
  location: string | null;
  /** NULL below `details`. */
  description: string | null;
  kind: string | null;
  /** True when this event repeats. Renderers show a marker. */
  repeats: boolean;
}

interface SourceRow {
  id: string;
  calendarId: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  showAs: ScheduleShowAs;
  access: ScheduleAccessLevel | null;
  title: string | null;
  location: string | null;
  description: string | null;
  kind: string | null;
  timeZone: string;
  recurrenceRule: string;
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
  time_zone: string;
  recurrence_rule: string;
}

/**
 * Everything the caller may know about between `from` and `to`.
 *
 * Half-open on both ends the way calendars are: an item counts when it overlaps
 * the window at all, so a three-day item is returned on the middle day even
 * though it neither starts nor ends there.
 *
 * Takes the CALLER'S `tx` rather than opening its own, so what it can find is
 * exactly what the person asking may see — invariant S12 as a signature.
 */
export async function listRange(
  tx: Tx,
  from: Date,
  to: Date,
): Promise<ScheduleRangeItem[]> {
  const inWindow = and(
    isNull(schema.scheduleItems.cancelledAt),
    lt(schema.scheduleItems.startsAt, to),
    // A REPEATING series whose first occurrence is long before the window must
    // still be selected, or the expander never sees it. The precise filtering
    // is done per-occurrence below.
    or(
      ne(schema.scheduleItems.recurrenceRule, ""),
      gt(schema.scheduleItems.endsAt, from),
    ),
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
      timeZone: schema.scheduleItems.timeZone,
      recurrenceRule: schema.scheduleItems.recurrenceRule,
      // Computed rather than stored: the level is a fact about the reader, not
      // about the row, and caching it on the row is how the two drift.
      access: sql<
        ScheduleAccessLevel | null
      >`app_calendar_access(${schema.scheduleItems.calendarId})`,
    })
    .from(schema.scheduleItems)
    .where(inWindow);

  const overlay = (await tx.execute(
    sql`select * from app_schedule_range(${from}, ${to})`,
  )) as unknown as { rows: OverlayRow[] };

  const sources: SourceRow[] = [
    ...full,
    ...overlay.rows.map((r) => ({
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
      timeZone: r.time_zone,
      recurrenceRule: r.recurrence_rule,
    })),
  ];

  const overrides = await loadOverrides(
    tx,
    sources.filter((s) => s.recurrenceRule !== "").map((s) => s.id),
  );

  const out: ScheduleRangeItem[] = [];
  for (const source of sources) {
    const rule = source.recurrenceRule ? parseRule(source.recurrenceRule) : null;

    // A rule the parser REFUSES is treated as a one-off rather than guessed at.
    // Refusing loudly is recurrence.ts's contract; honouring that here means an
    // unsupported rule shows one event on the right day instead of a series on
    // the wrong ones.
    if (!rule) {
      if (source.endsAt > from && source.startsAt < to) {
        out.push(toItem(source, null, source.startsAt, source.endsAt));
      }
      continue;
    }

    const occurrences = expandOccurrences({
      rule,
      startDate: dateInTimezone(source.startsAt, source.timeZone),
      timeOfDay: timeOfDayInTimezone(source.startsAt, source.timeZone),
      durationMs: source.endsAt.getTime() - source.startsAt.getTime(),
      timeZone: source.timeZone,
      from,
      to,
    });

    const forItem = overrides.get(source.id);
    for (const occurrence of occurrences) {
      const override = forItem?.get(occurrence.date);
      if (override?.cancelled) continue;
      const startsAt = override?.startsAt ?? occurrence.startsAt;
      const endsAt = override?.endsAt ?? occurrence.endsAt;
      // A MOVED occurrence can land outside the window it was generated for,
      // so the overlap test is re-applied after the override.
      if (endsAt <= from || startsAt >= to) continue;
      out.push(toItem(source, occurrence.date, startsAt, endsAt));
    }
  }

  return out.sort(compareForDisplay);
}

function toItem(
  source: SourceRow,
  occurrenceDate: string | null,
  startsAt: Date,
  endsAt: Date,
): ScheduleRangeItem {
  return {
    id: source.id,
    occurrenceDate,
    calendarId: source.calendarId,
    startsAt,
    endsAt,
    allDay: source.allDay,
    showAs: source.showAs,
    access: source.access,
    title: source.title,
    location: source.location,
    description: source.description,
    kind: source.kind,
    repeats: source.recurrenceRule !== "",
  };
}

interface OverrideRow {
  cancelled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** itemId → occurrenceDate → override. One query for the whole page. */
async function loadOverrides(
  tx: Tx,
  itemIds: string[],
): Promise<Map<string, Map<string, OverrideRow>>> {
  const map = new Map<string, Map<string, OverrideRow>>();
  if (itemIds.length === 0) return map;

  const rows = await tx
    .select()
    .from(schema.scheduleItemOverrides)
    .where(inArray(schema.scheduleItemOverrides.itemId, itemIds));

  for (const row of rows) {
    const forItem = map.get(row.itemId) ?? new Map<string, OverrideRow>();
    forItem.set(row.occurrenceDate, {
      cancelled: row.cancelled,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    });
    map.set(row.itemId, forItem);
  }
  return map;
}

/**
 * Start, then id, then occurrence date.
 *
 * The tiebreaks are not decoration: two runs over unchanged data must produce a
 * byte-identical list, for the same reason the digest's ordering is fixed. Two
 * events starting at the same instant is the common case at 9am on a Monday,
 * and two occurrences of one series never share a start but may share an id.
 */
function compareForDisplay(a: ScheduleRangeItem, b: ScheduleRangeItem): number {
  const byStart = a.startsAt.getTime() - b.startsAt.getTime();
  if (byStart !== 0) return byStart;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return (a.occurrenceDate ?? "") < (b.occurrenceDate ?? "") ? -1 : 1;
}
