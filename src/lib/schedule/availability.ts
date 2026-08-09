import "server-only";
import { inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { occupiesTime } from "./access";
import { listRange } from "./range";
import {
  addDays,
  dateInTimezone,
  datesBetween,
  zonedTimeToInstant,
} from "@/lib/timezone";

/**
 * Who is free, and when.
 *
 * THE NAMED SEAM the design promised a booking pack would call. Nothing
 * customer-facing ships yet, but the shape is the one a public booking page
 * needs: "given these people, this window and this duration, what slots are
 * open?" Building it as three separate pieces — merge, invert, query — is what
 * makes that possible without a rewrite.
 *
 * ── WHAT COUNTS AS BUSY ──────────────────────────────────────────────────────
 *
 * `show_as`, never mere existence. An all-day note, a blocked-out reminder, a
 * deadline somebody pinned to a Tuesday — all of those are events and none of
 * them means the person is unavailable. Availability that meant "a row overlaps
 * this range" would report everybody as booked solid, which is the bug
 * `show_as` was put on the item to prevent.
 *
 * ── AND WHAT YOU ARE ALLOWED TO SEE ─────────────────────────────────────────
 *
 * This reads through `listRange`, so it inherits the four access levels exactly:
 * a colleague who shared their calendar at `busy` contributes their times and
 * no titles, because the projection already nulled them. Somebody who shared
 * nothing contributes nothing and is reported as UNKNOWN rather than free —
 * see `BusyForPerson.visible`. Telling a booker that an unshared calendar is
 * empty would be the worst possible lie for this feature.
 */

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Overlapping and adjacent intervals collapsed into the fewest that cover the
 * same time.
 *
 * ADJACENT COUNTS. Two back-to-back meetings, 9–10 and 10–11, are one busy
 * block from 9 to 11 — leaving them separate would let a slot finder offer the
 * instant at 10:00 as free.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const out: Interval[] = [{ ...sorted[0] }];
  for (const next of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (next.startsAt.getTime() <= last.endsAt.getTime()) {
      if (next.endsAt.getTime() > last.endsAt.getTime()) {
        last.endsAt = next.endsAt;
      }
    } else {
      out.push({ ...next });
    }
  }
  return out;
}

/** Everything in `window` that `busy` does not cover. */
export function invertIntervals(
  busy: readonly Interval[],
  window: Interval,
): Interval[] {
  const merged = mergeIntervals(busy);
  const out: Interval[] = [];
  let cursor = window.startsAt;
  for (const block of merged) {
    if (block.endsAt <= window.startsAt) continue;
    if (block.startsAt >= window.endsAt) break;
    if (block.startsAt > cursor) {
      out.push({ startsAt: cursor, endsAt: block.startsAt });
    }
    if (block.endsAt > cursor) cursor = block.endsAt;
  }
  if (cursor < window.endsAt) {
    out.push({ startsAt: cursor, endsAt: window.endsAt });
  }
  return out;
}

export interface SlotSearch {
  busy: readonly Interval[];
  from: Date;
  to: Date;
  durationMinutes: number;
  timeZone: string;
  /** Local wall clock, `HH:mm`. Slots are only offered inside these. */
  dayStart: string;
  dayEnd: string;
  /** 0 = Sunday. Days not listed are never offered. */
  weekdays: readonly number[];
  /** Cap on how many to return, so a wide window cannot produce thousands. */
  limit?: number;
}

/**
 * Open slots of a given length.
 *
 * WORKING HOURS ARE APPLIED PER LOCAL DAY, not as a single UTC band, so "9 to 5"
 * stays 9 to 5 across a DST change and in whatever zone the workspace keeps.
 * That is the same rule recurrence follows and for the same reason.
 *
 * Slots are aligned to the top of the half hour rather than to the end of the
 * previous meeting: an opening offered at 10:47 is technically true and nobody
 * books it.
 */
export function findFreeSlots(search: SlotSearch): Interval[] {
  const {
    busy,
    from,
    to,
    durationMinutes,
    timeZone,
    dayStart,
    dayEnd,
    weekdays,
    limit = 50,
  } = search;
  const durationMs = durationMinutes * 60_000;
  const STEP_MS = 30 * 60_000;
  const merged = mergeIntervals(busy);
  const out: Interval[] = [];

  const days = datesBetween(
    dateInTimezone(from, timeZone),
    dateInTimezone(new Date(to.getTime() - 1), timeZone),
  );

  for (const date of days) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!weekdays.includes(dow)) continue;

    const windowStart = zonedTimeToInstant(date, dayStart, timeZone);
    const windowEnd = zonedTimeToInstant(date, dayEnd, timeZone);
    const free = invertIntervals(merged, {
      startsAt: new Date(Math.max(windowStart.getTime(), from.getTime())),
      endsAt: new Date(Math.min(windowEnd.getTime(), to.getTime())),
    });

    for (const gap of free) {
      // Align forward to the next half hour so the offer reads like a time
      // somebody would say out loud.
      let cursor = Math.ceil(gap.startsAt.getTime() / STEP_MS) * STEP_MS;
      while (cursor + durationMs <= gap.endsAt.getTime()) {
        out.push({
          startsAt: new Date(cursor),
          endsAt: new Date(cursor + durationMs),
        });
        if (out.length >= limit) return out;
        cursor += STEP_MS;
      }
    }
  }
  return out;
}

export interface BusyForPerson {
  clerkUserId: string;
  /**
   * False when this person has shared nothing with the caller.
   *
   * The distinction is the whole point: an empty `busy` list with
   * `visible: false` means "we cannot see", and rendering that as "free" would
   * be the worst lie this feature could tell. Every caller has to decide what
   * to say, which is why it is not just an empty array.
   */
  visible: boolean;
  busy: Interval[];
}

/**
 * Merged busy time for a set of people, in the caller's own visibility.
 *
 * Reads through `listRange`, so recurring events are already expanded and the
 * access levels already applied. A calendar shared at `busy` contributes its
 * times with no titles — which is exactly what this needs and nothing more.
 */
export async function busyForPeople(
  tx: Tx,
  input: { clerkUserIds: readonly string[]; from: Date; to: Date },
): Promise<BusyForPerson[]> {
  if (input.clerkUserIds.length === 0) return [];

  // RLS narrows this to calendars the caller may see at all.
  const calendars = await tx
    .select({
      id: schema.scheduleCalendars.id,
      ownerClerkUserId: schema.scheduleCalendars.ownerClerkUserId,
    })
    .from(schema.scheduleCalendars)
    .where(
      inArray(schema.scheduleCalendars.ownerClerkUserId, [...input.clerkUserIds]),
    );

  const ownerOf = new Map(calendars.map((c) => [c.id, c.ownerClerkUserId!]));
  const items = await listRange(tx, input.from, input.to);

  const byPerson = new Map<string, Interval[]>();
  for (const item of items) {
    const owner = ownerOf.get(item.calendarId);
    if (!owner) continue;
    // `show_as`, not existence. See the module header.
    if (!occupiesTime(item.showAs)) continue;
    const list = byPerson.get(owner) ?? [];
    list.push({ startsAt: item.startsAt, endsAt: item.endsAt });
    byPerson.set(owner, list);
  }

  const seen = new Set(calendars.map((c) => c.ownerClerkUserId!));
  return input.clerkUserIds.map((clerkUserId) => ({
    clerkUserId,
    visible: seen.has(clerkUserId),
    busy: mergeIntervals(byPerson.get(clerkUserId) ?? []),
  }));
}

/** Anybody busy at this exact time? Used to flag conflicts on an event form. */
export function conflictsWith(
  people: readonly BusyForPerson[],
  candidate: Interval,
): string[] {
  return people
    .filter((person) =>
      person.busy.some(
        (block) =>
          block.startsAt < candidate.endsAt && candidate.startsAt < block.endsAt,
      ),
    )
    .map((person) => person.clerkUserId);
}

/** The default working window, until a tenant setting exists to override it. */
export const DEFAULT_WORKING_HOURS = {
  dayStart: "09:00",
  dayEnd: "17:00",
  weekdays: [1, 2, 3, 4, 5],
} as const;

/** Convenience for a booking pack: the next N open slots from a day. */
export function slotsForDay(
  busy: readonly Interval[],
  date: string,
  timeZone: string,
  durationMinutes: number,
): Interval[] {
  return findFreeSlots({
    busy,
    from: zonedTimeToInstant(date, "00:00", timeZone),
    to: zonedTimeToInstant(addDays(date, 1), "00:00", timeZone),
    durationMinutes,
    timeZone,
    ...DEFAULT_WORKING_HOURS,
  });
}
