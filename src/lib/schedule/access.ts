/**
 * Access levels, and the one comparison everything else is built on.
 *
 * Pure — no database, no server-only. It is imported by the read path, by
 * server actions, and by renderers deciding whether to offer an edit button, so
 * it must be safe on both sides of the boundary.
 *
 * Read docs/modules/scheduling.md §Decisions before adding a level. The two
 * things that make this list more than a string union:
 *
 *  1. **The ORDER IS LOAD-BEARING.** `schedule_access` is a Postgres enum, and
 *     the policies compare with `>=`, which uses declaration order. This array
 *     must stay in the same order as the enum in drizzle/0096, or TypeScript
 *     and the database will disagree about who may see what — silently, and in
 *     the permissive direction on one side of the boundary or the other.
 *
 *  2. **`busy` and `titles` are PROJECTIONS, not grants.** They do not make a
 *     row visible; they make a subset of its columns available through
 *     `app_schedule_range()`. Nothing in application code redacts anything, and
 *     nothing should start.
 */

/** Least to most. Same order as the `schedule_access` enum — see above. */
export const SCHEDULE_ACCESS_LEVELS = [
  "busy",
  "titles",
  "details",
  "write",
] as const;

export type ScheduleAccessLevel = (typeof SCHEDULE_ACCESS_LEVELS)[number];

/** How an item's owner appears to somebody checking availability. */
export type ScheduleShowAs = "free" | "busy" | "tentative" | "away";

/**
 * Does `level` reach `required`?
 *
 * `null` means no access at all, and returns false for every requirement —
 * "not shared with me" is not a level, it is the absence of one, and folding it
 * into the enum would make the lowest level mean two different things.
 */
export function accessAtLeast(
  level: ScheduleAccessLevel | null,
  required: ScheduleAccessLevel,
): boolean {
  if (level === null) return false;
  return (
    SCHEDULE_ACCESS_LEVELS.indexOf(level) >=
    SCHEDULE_ACCESS_LEVELS.indexOf(required)
  );
}

/**
 * Whether a level carries the item's own words — its title and location.
 *
 * Named for the question rather than the level so call sites read as intent.
 * The renderer that asks this is deciding between showing "Site meeting" and
 * showing "Busy", which is the whole point of the middle tier existing.
 */
export function carriesTitle(level: ScheduleAccessLevel | null): boolean {
  return accessAtLeast(level, "titles");
}

/** Whether a level carries the body, the kind and the extension bag. */
export function carriesDetail(level: ScheduleAccessLevel | null): boolean {
  return accessAtLeast(level, "details");
}

/** Whether a level may change anything on the calendar. */
export function carriesWrite(level: ScheduleAccessLevel | null): boolean {
  return accessAtLeast(level, "write");
}

/**
 * The roles `requireTenant()` resolves. Inlined to keep this file import-free —
 * `@/lib/auth` is `server-only` and a client renderer imports this one. Same
 * reasoning as `src/lib/packs/authorize.ts`.
 */
export type ScheduleRole = "owner" | "staff" | "expert";

/**
 * **May this ROLE write to the schedule at all**, before any per-calendar level
 * is consulted?
 *
 * `expert` — the platform's own bookkeeper working inside a client workspace —
 * is read-only here, as it is in CRM, Documents and Work. There is no
 * read-only-safe write in this module, so there is nothing to opt into.
 *
 * **THIS IS A ROLE RULE, AND `app_calendar_access` IS A GRANT RULE.** They are
 * different questions and both have to be asked. The database answers "does
 * this person's grant on this calendar reach `write`" — and an accountant is
 * PROVISIONED a primary calendar like everybody else (`lib/schedule/provision.ts`
 * is role-blind, deliberately: a calendar is the unit of sharing and a person
 * without one cannot be shown a week), so it answers `write` for them and is
 * right to. Nothing in the database says the accountant may not use it. That
 * sentence lives here, and `gate()` is not the only place allowed to read it:
 * until 2026-09-03 it was, and both screens rendered every control enabled and
 * refused every press.
 */
export function roleMayWrite(role: ScheduleRole): boolean {
  return role !== "expert";
}

/**
 * Does this item make its owner look unavailable?
 *
 * `show_as` is a property of the ITEM, deliberately: availability that meant
 * "an item exists in this range" would make every all-day note and blocked-out
 * reminder read as booked solid. Slice 9 is the first real caller; it lives here
 * so the rule has one home rather than being re-decided there.
 */
export function occupiesTime(showAs: ScheduleShowAs): boolean {
  return showAs !== "free";
}
