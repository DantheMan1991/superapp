import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { ScheduleShowAs } from "@/lib/schedule/access";
import { parseRule } from "@/lib/schedule/recurrence";
import { SchedulingError, type SchedulingCtx } from "./calendar-ops";

/**
 * Events, and who is on them.
 *
 * Same contract as `calendar-ops`: takes the caller's `tx`, never opens its own,
 * never calls `withSystem`. The guards here produce MESSAGES; drizzle/0097 is
 * what actually decides. Where the two disagree, the ops tests catch it, because
 * they run as a person through real RLS.
 *
 * TIMES ARRIVE AS INSTANTS. The form collects a date, a time and the tenant's
 * zone; the ACTION converts them with `zonedTimeToInstant` and passes a `Date`.
 * Nothing here parses a wall clock, because a wall clock without a zone is not a
 * time and this layer has no business holding one.
 */

export interface AttendeeInput {
  /** Somebody in this workspace. Mutually exclusive with `externalEmail`. */
  clerkUserId?: string;
  externalEmail?: string;
  externalName?: string;
  required?: boolean;
}

export interface ItemInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  allDay?: boolean;
  /** The zone the wall clock was authored in — see the module header. */
  timeZone: string;
  showAs?: ScheduleShowAs;
  sensitivity?: "normal" | "private";
  kind?: string;
  /**
   * An RRULE value, or "" for a one-off. VALIDATED, not trusted: `parseRule`
   * refuses what it does not implement, and storing a rule the expander will
   * later refuse would show one event where somebody asked for a series.
   */
  recurrenceRule?: string;
  attendees?: AttendeeInput[];
}

export interface ItemDetail {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timeZone: string;
  showAs: ScheduleShowAs;
  sensitivity: "normal" | "private";
  kind: string;
  recurrenceRule: string;
  cancelledAt: Date | null;
  attendees: Array<{
    id: string;
    clerkUserId: string | null;
    externalEmail: string | null;
    externalName: string;
    required: boolean;
    response: "needs_action" | "accepted" | "declined" | "tentative";
  }>;
}

/**
 * `write` on the calendar. Mirrors `schedule_items_write`.
 *
 * Asks the database's own helper rather than re-deriving the answer, so this
 * cannot drift from the policy it is explaining. `app_calendar_access` returns
 * NULL for a calendar the caller cannot see AND for one in another tenant, which
 * is why "no access" and "no such calendar" collapse into one message here — the
 * same anti-probe rule the rest of the module follows.
 */
async function requireWritableCalendar(
  tx: Tx,
  calendarId: string,
): Promise<void> {
  const result = (await tx.execute(
    sql`select app_calendar_access(${calendarId}) as access`,
  )) as unknown as { rows: Array<{ access: string | null }> };
  const access = result.rows[0]?.access ?? null;
  if (access === null) {
    throw new SchedulingError("NOT_FOUND", "calendar not found");
  }
  if (access !== "write") {
    throw new SchedulingError(
      "FORBIDDEN",
      "you can look at this calendar but not change it",
    );
  }
}

/** Refuse a rule the expander cannot honour, at the boundary rather than later. */
function assertRule(rule: string | undefined): void {
  if (!rule) return;
  if (!parseRule(rule)) {
    throw new SchedulingError(
      "INVALID",
      "that repeat pattern is not supported yet",
    );
  }
}

function assertOrdered(startsAt: Date, endsAt: Date): void {
  // The database has this as a CHECK too. Here it can say which way round.
  if (endsAt.getTime() < startsAt.getTime()) {
    throw new SchedulingError("INVALID", "an event cannot end before it starts");
  }
}

export async function createItem(
  tx: Tx,
  ctx: SchedulingCtx,
  input: ItemInput,
): Promise<string> {
  await requireWritableCalendar(tx, input.calendarId);
  assertOrdered(input.startsAt, input.endsAt);
  assertRule(input.recurrenceRule);

  const [row] = await tx
    .insert(schema.scheduleItems)
    .values({
      tenantId: ctx.tenantId,
      calendarId: input.calendarId,
      title: input.title,
      description: input.description ?? "",
      location: input.location ?? "",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay ?? false,
      timeZone: input.timeZone,
      showAs: input.showAs ?? "busy",
      sensitivity: input.sensitivity ?? "normal",
      kind: input.kind ?? "",
      recurrenceRule: input.recurrenceRule ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning({ id: schema.scheduleItems.id });

  if (input.attendees?.length) {
    await replaceAttendees(tx, ctx, row.id, input.attendees);
  }
  return row.id;
}

export async function updateItem(
  tx: Tx,
  ctx: SchedulingCtx,
  itemId: string,
  input: Partial<Omit<ItemInput, "calendarId">> & { calendarId?: string },
): Promise<void> {
  const existing = await loadItem(tx, itemId);
  await requireWritableCalendar(tx, existing.calendarId);
  // MOVING an event between calendars needs write on BOTH: the one losing it
  // and the one gaining it. Checking only the destination would let somebody
  // with write on their own calendar pull an event off a colleague's.
  if (input.calendarId && input.calendarId !== existing.calendarId) {
    await requireWritableCalendar(tx, input.calendarId);
  }

  const startsAt = input.startsAt ?? existing.startsAt;
  const endsAt = input.endsAt ?? existing.endsAt;
  assertOrdered(startsAt, endsAt);
  assertRule(input.recurrenceRule);

  await tx
    .update(schema.scheduleItems)
    .set({
      ...(input.calendarId === undefined ? {} : { calendarId: input.calendarId }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.location === undefined ? {} : { location: input.location }),
      ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
      ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
      ...(input.allDay === undefined ? {} : { allDay: input.allDay }),
      ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      ...(input.showAs === undefined ? {} : { showAs: input.showAs }),
      ...(input.sensitivity === undefined ? {} : { sensitivity: input.sensitivity }),
      ...(input.recurrenceRule === undefined
        ? {}
        : { recurrenceRule: input.recurrenceRule }),
      updatedAt: new Date(),
    })
    .where(eq(schema.scheduleItems.id, itemId));

  if (input.attendees) {
    await replaceAttendees(tx, ctx, itemId, input.attendees);
  }
}

/**
 * Cancelled, not deleted.
 *
 * A meeting that disappears leaves everybody who was on it wondering whether it
 * moved. The row stays, `listRange` filters it out, and a later slice can show
 * "cancelled" to the people who were invited.
 */
export async function cancelItem(
  tx: Tx,
  _ctx: SchedulingCtx,
  itemId: string,
): Promise<void> {
  const existing = await loadItem(tx, itemId);
  await requireWritableCalendar(tx, existing.calendarId);
  await tx
    .update(schema.scheduleItems)
    .set({ cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.scheduleItems.id, itemId));
}

async function loadItem(tx: Tx, itemId: string) {
  const [row] = await tx
    .select()
    .from(schema.scheduleItems)
    .where(eq(schema.scheduleItems.id, itemId));
  if (!row) throw new SchedulingError("NOT_FOUND", "event not found");
  return row;
}

/**
 * The attendee list, set wholesale.
 *
 * A DIFF RATHER THAN DELETE-ALL-THEN-INSERT, and that is not an optimisation:
 * re-inserting a row resets its `response`, so saving an unrelated edit to the
 * title would silently un-accept everybody who had already replied.
 */
async function replaceAttendees(
  tx: Tx,
  ctx: SchedulingCtx,
  itemId: string,
  wanted: AttendeeInput[],
): Promise<void> {
  const existing = await tx
    .select()
    .from(schema.scheduleItemAttendees)
    .where(eq(schema.scheduleItemAttendees.itemId, itemId));

  const keyOf = (a: { clerkUserId?: string | null; externalEmail?: string | null }) =>
    a.clerkUserId ? `u:${a.clerkUserId}` : `e:${(a.externalEmail ?? "").toLowerCase()}`;

  const wantedKeys = new Set(wanted.map(keyOf));
  const existingKeys = new Set(existing.map(keyOf));

  const toRemove = existing.filter((row) => !wantedKeys.has(keyOf(row)));
  if (toRemove.length) {
    await tx.delete(schema.scheduleItemAttendees).where(
      inArray(
        schema.scheduleItemAttendees.id,
        toRemove.map((r) => r.id),
      ),
    );
  }

  const toAdd = wanted.filter((a) => !existingKeys.has(keyOf(a)));
  if (toAdd.length) {
    await tx.insert(schema.scheduleItemAttendees).values(
      toAdd.map((a) => ({
        tenantId: ctx.tenantId,
        itemId,
        clerkUserId: a.clerkUserId ?? null,
        externalEmail: a.externalEmail?.toLowerCase() ?? null,
        externalName: a.externalName ?? "",
        required: a.required ?? true,
      })),
    );
  }
}

/**
 * Accept, decline or tentatively accept an invitation.
 *
 * Deliberately NOT gated on calendar access: `schedule_item_attendees_write`
 * lets anybody update their OWN row, and an attendee usually has no write on the
 * calendar the event lives on. Responding to an invitation you can see is not a
 * write to somebody else's calendar.
 */
export async function respondToItem(
  tx: Tx,
  ctx: SchedulingCtx,
  itemId: string,
  response: "accepted" | "declined" | "tentative",
): Promise<void> {
  const updated = await tx
    .update(schema.scheduleItemAttendees)
    .set({ response })
    .where(
      and(
        eq(schema.scheduleItemAttendees.itemId, itemId),
        eq(schema.scheduleItemAttendees.clerkUserId, ctx.userId),
      ),
    )
    .returning({ id: schema.scheduleItemAttendees.id });
  if (updated.length === 0) {
    throw new SchedulingError("NOT_FOUND", "you are not on this event");
  }
}

/** One event with its attendees, for the edit form. RLS decides visibility. */
export async function getItemDetail(
  tx: Tx,
  itemId: string,
): Promise<ItemDetail> {
  const row = await loadItem(tx, itemId);
  const attendees = await tx
    .select()
    .from(schema.scheduleItemAttendees)
    .where(eq(schema.scheduleItemAttendees.itemId, itemId));
  return {
    id: row.id,
    calendarId: row.calendarId,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    timeZone: row.timeZone,
    showAs: row.showAs,
    sensitivity: row.sensitivity,
    kind: row.kind,
    recurrenceRule: row.recurrenceRule,
    cancelledAt: row.cancelledAt,
    attendees: attendees.map((a) => ({
      id: a.id,
      clerkUserId: a.clerkUserId,
      externalEmail: a.externalEmail,
      externalName: a.externalName,
      required: a.required,
      response: a.response,
    })),
  };
}

/* -- One occurrence of a series -------------------------------------------- */

/**
 * Change or call off a single occurrence.
 *
 * KEYED ON THE LOCAL DATE, not on an instant — the occurrence somebody edited
 * is "the one on the 12th", and it stays that occurrence even if the series is
 * later moved from 9am to 10am. Keying on the instant would orphan every
 * override the first time the rule changed.
 *
 * An upsert, so editing the same occurrence twice replaces rather than
 * accumulates.
 */
export async function overrideOccurrence(
  tx: Tx,
  ctx: SchedulingCtx,
  input: {
    itemId: string;
    occurrenceDate: string;
    cancelled: boolean;
    startsAt?: Date;
    endsAt?: Date;
  },
): Promise<void> {
  const existing = await loadItem(tx, input.itemId);
  await requireWritableCalendar(tx, existing.calendarId);
  if (existing.recurrenceRule === "") {
    throw new SchedulingError(
      "INVALID",
      "this event does not repeat, so there is no single occurrence to change",
    );
  }
  if (input.startsAt && input.endsAt) {
    assertOrdered(input.startsAt, input.endsAt);
  }

  await tx
    .insert(schema.scheduleItemOverrides)
    .values({
      tenantId: ctx.tenantId,
      itemId: input.itemId,
      occurrenceDate: input.occurrenceDate,
      cancelled: input.cancelled,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    })
    .onConflictDoUpdate({
      target: [
        schema.scheduleItemOverrides.tenantId,
        schema.scheduleItemOverrides.itemId,
        schema.scheduleItemOverrides.occurrenceDate,
      ],
      set: {
        cancelled: input.cancelled,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        updatedAt: new Date(),
      },
    });
}
