import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { SHARE_EVERYONE } from "@/db/schema/scheduling";
import type { ScheduleAccessLevel } from "@/lib/schedule/access";

/**
 * Calendars and who they are shared with.
 *
 * Every function here takes the CALLER'S `tx` and never opens its own, never
 * calls `withSystem`. What it can find and change is exactly what RLS allows the
 * person asking — invariant S12 as a signature. The checks below are therefore
 * NOT the security boundary; drizzle/0097 is. They exist so that a refused
 * action says why instead of reporting that nothing happened, which is the
 * distinction CRM's `gate()` draws in its own comment.
 */

export type SchedulingErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "PRIMARY_IS_PERMANENT"
  | "POINTLESS_GRANT"
  | "INVALID";

export class SchedulingError extends Error {
  constructor(
    readonly code: SchedulingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SchedulingError";
  }
}

export interface SchedulingCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/**
 * Which heading a calendar renders under.
 *
 * Derived from ownership rather than stored, and the three groups are the ones
 * Outlook shows: your own, the ones people shared with you, and the ones the
 * business owns. A pack's calendars land in `business` because they have no
 * person owner — which is also why the UI can group them without knowing any
 * pack exists.
 */
export type CalendarGroup = "mine" | "shared" | "business";

export interface CalendarSummary {
  id: string;
  name: string;
  color: string;
  kind: string;
  isPrimary: boolean;
  archivedAt: Date | null;
  ownerClerkUserId: string | null;
  extensionSlug: string | null;
  /** The caller's level. `write` whenever they administer it. */
  access: ScheduleAccessLevel;
  group: CalendarGroup;
}

function groupOf(
  ownerClerkUserId: string | null,
  userId: string,
): CalendarGroup {
  if (ownerClerkUserId === null) return "business";
  return ownerClerkUserId === userId ? "mine" : "shared";
}

/**
 * Every calendar the caller can see.
 *
 * RLS decides membership of this list; nothing here filters on visibility. The
 * `access` column comes from `app_calendar_access`, computed per row rather than
 * stored, because the level is a fact about the READER — caching it on the
 * calendar is how the two drift apart.
 */
export async function listCalendars(
  tx: Tx,
  ctx: SchedulingCtx,
  opts?: { includeArchived?: boolean },
): Promise<CalendarSummary[]> {
  const rows = await tx
    .select({
      id: schema.scheduleCalendars.id,
      name: schema.scheduleCalendars.name,
      color: schema.scheduleCalendars.color,
      kind: schema.scheduleCalendars.kind,
      isPrimary: schema.scheduleCalendars.isPrimary,
      archivedAt: schema.scheduleCalendars.archivedAt,
      ownerClerkUserId: schema.scheduleCalendars.ownerClerkUserId,
      extensionSlug: schema.scheduleCalendars.extensionSlug,
      access: sql<ScheduleAccessLevel>`app_calendar_access(${schema.scheduleCalendars.id})`,
    })
    .from(schema.scheduleCalendars)
    .orderBy(
      // Primary first, then by name. Somebody's own calendar is the one they
      // look for, and it is the one anything lands on by default.
      sql`${schema.scheduleCalendars.isPrimary} desc`,
      asc(schema.scheduleCalendars.name),
    );

  return rows
    .filter((r) => opts?.includeArchived || r.archivedAt === null)
    .map((r) => ({ ...r, group: groupOf(r.ownerClerkUserId, ctx.userId) }));
}

async function loadCalendar(tx: Tx, calendarId: string) {
  const [row] = await tx
    .select()
    .from(schema.scheduleCalendars)
    .where(eq(schema.scheduleCalendars.id, calendarId));
  if (!row) {
    // Invisible and non-existent are the same answer on purpose: a distinct
    // "you may not see this" would confirm the calendar exists to somebody
    // probing for it.
    throw new SchedulingError("NOT_FOUND", "calendar not found");
  }
  return row;
}

/** Mine to administer? Mirrors `app_can_admin_calendar` exactly. */
function canAdmin(
  row: { ownerClerkUserId: string | null },
  ctx: SchedulingCtx,
): boolean {
  if (row.ownerClerkUserId === null) return ctx.role === "owner";
  return row.ownerClerkUserId === ctx.userId;
}

export async function createCalendar(
  tx: Tx,
  ctx: SchedulingCtx,
  input: { name: string; color: string },
): Promise<string> {
  const [row] = await tx
    .insert(schema.scheduleCalendars)
    .values({
      tenantId: ctx.tenantId,
      ownerClerkUserId: ctx.userId,
      name: input.name,
      color: input.color,
      kind: "personal",
    })
    .returning({ id: schema.scheduleCalendars.id });
  return row.id;
}

export async function updateCalendar(
  tx: Tx,
  ctx: SchedulingCtx,
  input: { calendarId: string; name?: string; color?: string },
): Promise<void> {
  const row = await loadCalendar(tx, input.calendarId);
  if (!canAdmin(row, ctx)) {
    throw new SchedulingError("FORBIDDEN", "only its owner can change this calendar");
  }
  await tx
    .update(schema.scheduleCalendars)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.color === undefined ? {} : { color: input.color }),
      updatedAt: new Date(),
    })
    .where(eq(schema.scheduleCalendars.id, input.calendarId));
}

/**
 * Archive, never delete.
 *
 * A deleted calendar takes its items with it by FK cascade, and "where did the
 * whole of last year go" is not a question anybody should be able to ask by
 * accident. Archiving hides it and keeps the history; the row can come back.
 *
 * THE PRIMARY CANNOT BE ARCHIVED. It is where anything lands when nobody chose
 * a calendar, so a person without one is a person nothing can be scheduled for.
 * The database does not enforce this — it is a product rule, not an invariant,
 * and it is enforced here where the message can explain itself.
 */
export async function setCalendarArchived(
  tx: Tx,
  ctx: SchedulingCtx,
  input: { calendarId: string; archived: boolean },
): Promise<void> {
  const row = await loadCalendar(tx, input.calendarId);
  if (!canAdmin(row, ctx)) {
    throw new SchedulingError("FORBIDDEN", "only its owner can archive this calendar");
  }
  if (row.isPrimary && input.archived) {
    throw new SchedulingError(
      "PRIMARY_IS_PERMANENT",
      "your main calendar cannot be archived",
    );
  }
  await tx
    .update(schema.scheduleCalendars)
    .set({ archivedAt: input.archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.scheduleCalendars.id, input.calendarId));
}

/* -- Sharing ------------------------------------------------------------- */

export interface ShareRow {
  id: string;
  granteeClerkUserId: string;
  access: ScheduleAccessLevel;
  /** True for the one row that means "everyone in this workspace". */
  isEveryone: boolean;
}

export async function listShares(
  tx: Tx,
  calendarId: string,
): Promise<ShareRow[]> {
  const rows = await tx
    .select({
      id: schema.scheduleShares.id,
      granteeClerkUserId: schema.scheduleShares.granteeClerkUserId,
      access: schema.scheduleShares.access,
      createdAt: schema.scheduleShares.createdAt,
    })
    .from(schema.scheduleShares)
    .where(eq(schema.scheduleShares.calendarId, calendarId))
    .orderBy(asc(schema.scheduleShares.createdAt));
  return rows.map((r) => ({
    id: r.id,
    granteeClerkUserId: r.granteeClerkUserId,
    access: r.access,
    isEveryone: r.granteeClerkUserId === SHARE_EVERYONE,
  }));
}

/**
 * Grant, or change an existing grant. One row per grantee per calendar, so
 * changing somebody's level is an update rather than a second row that has to
 * be reconciled against the first.
 *
 * `granteeClerkUserId` of `SHARE_EVERYONE` is the workspace-wide grant, which is
 * the same mechanism and the same control as a person — see the schema.
 */
export async function grantShare(
  tx: Tx,
  ctx: SchedulingCtx,
  input: {
    calendarId: string;
    granteeClerkUserId: string;
    access: ScheduleAccessLevel;
  },
): Promise<void> {
  const row = await loadCalendar(tx, input.calendarId);
  if (!canAdmin(row, ctx)) {
    throw new SchedulingError("FORBIDDEN", "only its owner can share this calendar");
  }
  // Granting yourself access to your own calendar does nothing — you already
  // administer it, and app_calendar_access short-circuits to `write` before it
  // looks at shares at all. Refusing beats writing a row that means nothing.
  if (input.granteeClerkUserId === row.ownerClerkUserId) {
    throw new SchedulingError(
      "POINTLESS_GRANT",
      "this is already your calendar",
    );
  }
  await tx
    .insert(schema.scheduleShares)
    .values({
      tenantId: ctx.tenantId,
      calendarId: input.calendarId,
      granteeClerkUserId: input.granteeClerkUserId,
      access: input.access,
      grantedByClerkUserId: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.scheduleShares.tenantId,
        schema.scheduleShares.calendarId,
        schema.scheduleShares.granteeClerkUserId,
      ],
      set: {
        access: input.access,
        grantedByClerkUserId: ctx.userId,
        updatedAt: new Date(),
      },
    });
}

export async function revokeShare(
  tx: Tx,
  ctx: SchedulingCtx,
  input: { calendarId: string; shareId: string },
): Promise<void> {
  const row = await loadCalendar(tx, input.calendarId);
  if (!canAdmin(row, ctx)) {
    throw new SchedulingError("FORBIDDEN", "only its owner can change sharing");
  }
  await tx
    .delete(schema.scheduleShares)
    .where(
      and(
        eq(schema.scheduleShares.id, input.shareId),
        eq(schema.scheduleShares.calendarId, input.calendarId),
      ),
    );
}
