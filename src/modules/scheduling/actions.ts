"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { appUrl } from "@/lib/stripe-customer";
import { withSchedule } from "@/lib/schedule/with-schedule";
import { SCHEDULE_ACCESS_LEVELS } from "@/lib/schedule/access";
import {
  addDays,
  dateInTimezone,
  startOfDayInTimezone,
  timeOfDayInTimezone,
  zonedTimeToInstant,
} from "@/lib/timezone";
// A colour is one of a fixed set, validated server-side: free-form would let a
// caller put anything into a string the UI drops into a style attribute. The
// COLUMN stays open text so a palette can change without a migration; the enum
// is the boundary check. It cannot be declared in this file — see colors.ts.
import { CALENDAR_COLORS } from "./core/colors";
import {
  SchedulingError,
  createCalendar,
  grantShare,
  revokeShare,
  setCalendarArchived,
  updateCalendar,
  type SchedulingCtx,
} from "./calendar-ops";
import {
  cancelItem,
  createItem,
  getItemDetail,
  overrideOccurrence,
  respondToItem,
  updateItem,
} from "./item-ops";
import {
  attachLink,
  detachLink,
  resolveLinks,
  searchLinkTargets,
  type LinkTargetGroup,
} from "./link-ops";
import { mintFeedToken, revokeFeedToken } from "./feed-ops";

/**
 * Server actions for scheduling. Canonical shape, the same one CRM uses:
 * gate → Zod → withSchedule (work + audit in one transaction) → revalidate.
 *
 * EVERY call goes through `withSchedule` rather than `withTenant`, and that is
 * not a style preference: every policy in drizzle/0097 reads
 * `app_current_user()`, so a call that forgot the user id would make somebody's
 * own calendar vanish. The wrapper is what makes forgetting impossible — see
 * its header for why CRM's 49 call sites are the cautionary tale.
 *
 * AUDIT WRITES INSIDE THE TRANSACTION. A grant that succeeded and an audit row
 * that did not would leave somebody with access nobody can account for, which
 * is the one thing an audit log exists to prevent.
 */

const BASE = "/dashboard/m/scheduling";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

/**
 * The gate also carries the tenant's ZONE, because every time this module
 * accepts is a wall clock and a wall clock without a zone is not a time.
 *
 * It comes from `ctx.tenant.timezone` — the request's own tenant row — never
 * from the browser and never from the server's clock. Per-user zones are
 * deliberately not a thing here; see src/lib/timezone.ts.
 */
async function gate(): Promise<SchedulingCtx & { timeZone: string }> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "scheduling");
  // Fail closed for the accountant role, as CRM and Documents do. There is no
  // read-only-safe write in this module, so there is nothing to opt into.
  if (ctx.role === "expert") {
    throw new SchedulingError("FORBIDDEN", "accountant access is read-only");
  }
  return {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
    timeZone: ctx.tenant.timezone,
  };
}

function fail(err: unknown): { error: string } {
  if (err instanceof SchedulingError) return { error: err.message };
  console.error("scheduling action failed", err);
  return { error: "Something went wrong." };
}

const nameSchema = z.string().trim().min(1).max(80);
const colorSchema = z.enum(CALENDAR_COLORS);

const createSchema = z.object({
  name: nameSchema,
  color: colorSchema,
});

export async function createCalendarAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ calendarId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const calendarId = await withSchedule(ctx, async (tx) => {
      const id = await createCalendar(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "scheduling.calendar_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_calendar",
        targetId: id,
        // Identifiers only — never the contents of anybody's calendar.
        meta: { name: parsed.data.name },
      });
      return id;
    });

    revalidatePath(BASE);
    return { ok: true, data: { calendarId } };
  } catch (err) {
    return fail(err);
  }
}

const updateSchema = z.object({
  calendarId: z.string().uuid(),
  name: nameSchema.optional(),
  color: colorSchema.optional(),
});

export async function updateCalendarAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await updateCalendar(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "scheduling.calendar_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_calendar",
        targetId: parsed.data.calendarId,
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const archiveSchema = z.object({
  calendarId: z.string().uuid(),
  archived: z.boolean(),
});

export async function setCalendarArchivedAction(
  input: z.infer<typeof archiveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await setCalendarArchived(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.archived
          ? "scheduling.calendar_archived"
          : "scheduling.calendar_restored",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_calendar",
        targetId: parsed.data.calendarId,
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The empty string is the workspace-wide grantee, and it is allowed here on
 * purpose — it is the same mechanism as a person, which is what stops sharing
 * with everybody being a second code path. See SHARE_EVERYONE in the schema.
 */
const grantSchema = z.object({
  calendarId: z.string().uuid(),
  granteeClerkUserId: z.string().max(255),
  access: z.enum(SCHEDULE_ACCESS_LEVELS),
});

export async function grantShareAction(
  input: z.infer<typeof grantSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = grantSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await grantShare(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "scheduling.share_granted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_calendar",
        targetId: parsed.data.calendarId,
        // WHO and AT WHAT LEVEL, which is the whole point of auditing a grant.
        // Empty grantee means everyone; recorded as-is rather than translated.
        meta: {
          grantee: parsed.data.granteeClerkUserId,
          access: parsed.data.access,
        },
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const revokeSchema = z.object({
  calendarId: z.string().uuid(),
  shareId: z.string().uuid(),
});

export async function revokeShareAction(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await revokeShare(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "scheduling.share_revoked",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_calendar",
        targetId: parsed.data.calendarId,
        meta: { shareId: parsed.data.shareId },
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- Events ---------------------------------------------------------------- */

/**
 * A wall clock, as the form collects it.
 *
 * `date` and `time` stay separate strings all the way to the boundary, and the
 * conversion to an instant happens HERE, once, with the tenant's zone — never in
 * the browser, which knows only where the laptop is. Somebody in Denver editing
 * a New York workspace's calendar is entering New York times.
 */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const attendeeSchema = z
  .object({
    clerkUserId: z.string().max(255).optional(),
    externalEmail: z.string().email().max(320).optional(),
    externalName: z.string().trim().max(120).optional(),
    required: z.boolean().optional(),
  })
  // The database has this as a CHECK; refusing here means the message can say
  // which of the two is missing rather than surfacing a constraint name.
  .refine((a) => !!a.clerkUserId !== !!a.externalEmail, {
    message: "an attendee is either a colleague or an email address, not both",
  });

const eventFieldsSchema = z.object({
  calendarId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  location: z.string().max(200).optional(),
  startDate: dateSchema,
  startTime: timeSchema,
  endDate: dateSchema,
  endTime: timeSchema,
  allDay: z.boolean().optional(),
  showAs: z.enum(["free", "busy", "tentative", "away"]).optional(),
  sensitivity: z.enum(["normal", "private"]).optional(),
  // Shape-checked here; `item-ops` refuses anything the expander cannot honour.
  recurrenceRule: z.string().max(200).optional(),
  attendees: z.array(attendeeSchema).max(100).optional(),
});

type EventFields = z.infer<typeof eventFieldsSchema>;

/**
 * The two instants an event spans.
 *
 * An ALL-DAY event runs from local midnight to local midnight the following
 * day — end-exclusive, which is what makes a one-day event occupy exactly one
 * column and a three-day event exactly three. Storing 23:59 instead would leave
 * a one-minute hole that every overlap query would have to know about.
 */
function resolveSpan(fields: EventFields, timeZone: string) {
  if (fields.allDay) {
    return {
      startsAt: startOfDayInTimezone(fields.startDate, timeZone),
      endsAt: startOfDayInTimezone(addDays(fields.endDate, 1), timeZone),
    };
  }
  return {
    startsAt: zonedTimeToInstant(fields.startDate, fields.startTime, timeZone),
    endsAt: zonedTimeToInstant(fields.endDate, fields.endTime, timeZone),
  };
}

export async function createEventAction(
  input: EventFields,
): Promise<ActionResult<{ itemId: string }>> {
  try {
    const ctx = await gate();
    const parsed = eventFieldsSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const span = resolveSpan(parsed.data, ctx.timeZone);

    const itemId = await withSchedule(ctx, async (tx) => {
      const id = await createItem(tx, ctx, {
        ...parsed.data,
        ...span,
        timeZone: ctx.timeZone,
      });
      await logAuditInTx(tx, {
        action: "scheduling.event_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_item",
        targetId: id,
        // Identifiers and counts only — never the title, never who is on it.
        // An audit log that quoted an event would be a second copy of the
        // calendar, readable by people the calendar itself refuses.
        meta: {
          calendarId: parsed.data.calendarId,
          attendees: parsed.data.attendees?.length ?? 0,
        },
      });
      return id;
    });

    revalidatePath(BASE);
    return { ok: true, data: { itemId } };
  } catch (err) {
    return fail(err);
  }
}

const updateEventSchema = eventFieldsSchema.extend({
  itemId: z.string().uuid(),
});

export async function updateEventAction(
  input: z.infer<typeof updateEventSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateEventSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { itemId, ...fields } = parsed.data;
    const span = resolveSpan(fields, ctx.timeZone);

    await withSchedule(ctx, async (tx) => {
      await updateItem(tx, ctx, itemId, {
        ...fields,
        ...span,
        timeZone: ctx.timeZone,
      });
      await logAuditInTx(tx, {
        action: "scheduling.event_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_item",
        targetId: itemId,
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const itemIdSchema = z.object({ itemId: z.string().uuid() });

export async function cancelEventAction(
  input: z.infer<typeof itemIdSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = itemIdSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await cancelItem(tx, ctx, parsed.data.itemId);
      await logAuditInTx(tx, {
        action: "scheduling.event_cancelled",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_item",
        targetId: parsed.data.itemId,
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const respondSchema = z.object({
  itemId: z.string().uuid(),
  response: z.enum(["accepted", "declined", "tentative"]),
});

/**
 * Accept or decline. NOT audited, deliberately: a response is the attendee's
 * own row on their own invitation, it is visible on the event to everybody who
 * can see the event, and logging every tentative-then-accepted would bury the
 * grants and cancellations that the log exists for.
 */
export async function respondToEventAction(
  input: z.infer<typeof respondSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = respondSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, (tx) =>
      respondToItem(tx, ctx, parsed.data.itemId, parsed.data.response),
    );

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * One event, shaped for the form.
 *
 * An ACTION rather than props threaded down from the page, because the grid
 * renders a whole month of items and shipping every description and attendee
 * list to the browser to populate a dialog that may never open is a lot of
 * somebody's calendar sent for nothing. Fetched when the dialog opens.
 *
 * The instants are split into the date and time strings the form edits, HERE,
 * with the tenant's zone — the same conversion `resolveSpan` does in reverse,
 * kept on the same side of the boundary so the two cannot disagree.
 */
export async function getEventAction(
  input: z.infer<typeof itemIdSchema>,
): Promise<
  ActionResult<{
    itemId: string;
    calendarId: string;
    title: string;
    description: string;
    location: string;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    allDay: boolean;
    showAs: "free" | "busy" | "tentative" | "away";
    sensitivity: "normal" | "private";
    recurrenceRule: string;
    canEdit: boolean;
    myResponse: "needs_action" | "accepted" | "declined" | "tentative" | null;
    attendees: Array<{
      clerkUserId: string | null;
      externalEmail: string | null;
      externalName: string;
      response: "needs_action" | "accepted" | "declined" | "tentative";
    }>;
    links: Array<{
      linkId: string;
      entityType: string;
      /** Null when the record is gone or hidden from this reader. */
      label: string | null;
      sublabel?: string;
      href?: string;
    }>;
  }>
> {
  try {
    const ctx = await gate();
    const parsed = itemIdSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const data = await withSchedule(ctx, async (tx) => {
      const item = await getItemDetail(tx, parsed.data.itemId);
      const access = (await tx.execute(
        sql`select app_calendar_access(${item.calendarId}) as access`,
      )) as unknown as { rows: Array<{ access: string | null }> };

      // An all-day event is stored end-EXCLUSIVE (midnight to midnight), so the
      // form has to show the day before as its last day or a one-day event
      // reads as two.
      const endForForm = item.allDay
        ? addDays(dateInTimezone(item.endsAt, ctx.timeZone), -1)
        : dateInTimezone(item.endsAt, ctx.timeZone);

      return {
        itemId: item.id,
        calendarId: item.calendarId,
        title: item.title,
        description: item.description,
        location: item.location,
        startDate: dateInTimezone(item.startsAt, ctx.timeZone),
        startTime: timeOfDayInTimezone(item.startsAt, ctx.timeZone),
        endDate: endForForm,
        endTime: timeOfDayInTimezone(item.endsAt, ctx.timeZone),
        allDay: item.allDay,
        showAs: item.showAs,
        sensitivity: item.sensitivity,
        recurrenceRule: item.recurrenceRule,
        canEdit: access.rows[0]?.access === "write",
        myResponse:
          item.attendees.find((a) => a.clerkUserId === ctx.userId)?.response ??
          null,
        attendees: item.attendees.map((a) => ({
          clerkUserId: a.clerkUserId,
          externalEmail: a.externalEmail,
          externalName: a.externalName,
          response: a.response,
        })),
        // Resolved inside the CALLER'S transaction, so a record they may not
        // see comes back null and renders as a dangling link rather than
        // leaking its name. S12 doing the work — see 0099's header.
        links: (await resolveLinks(tx, ctx, [item.id])).map((l) => ({
          linkId: l.linkId,
          entityType: l.entityType,
          label: l.entity?.label ?? null,
          sublabel: l.entity?.sublabel,
          href: l.entity?.href,
        })),
      };
    });

    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

/* -- Links ----------------------------------------------------------------- */

/**
 * Which modules this tenant has switched on.
 *
 * Read inside the caller's transaction rather than through
 * `getActiveModules`, which opens its own — one round trip instead of two, and
 * it keeps the entitlement filter in the same snapshot as the search it gates.
 */
async function enabledModuleSlugs(tx: Tx, tenantId: string) {
  const rows = await tx
    .select({ moduleId: schema.tenantModules.moduleId })
    .from(schema.tenantModules)
    .where(
      and(
        eq(schema.tenantModules.tenantId, tenantId),
        eq(schema.tenantModules.enabled, true),
      ),
    );
  return new Set(rows.map((r) => r.moduleId));
}

const searchSchema = z.object({ query: z.string().max(200) });

export async function searchLinkTargetsAction(
  input: z.infer<typeof searchSchema>,
): Promise<ActionResult<{ groups: LinkTargetGroup[] }>> {
  try {
    const ctx = await gate();
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const groups = await withSchedule(ctx, async (tx) => {
      const enabled = await enabledModuleSlugs(tx, ctx.tenantId);
      return searchLinkTargets(tx, ctx, parsed.data.query, enabled);
    });

    return { ok: true, data: { groups } };
  } catch (err) {
    return fail(err);
  }
}

const attachSchema = z.object({
  itemId: z.string().uuid(),
  extensionSlug: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  entityId: z.string().uuid(),
});

export async function attachLinkAction(
  input: z.infer<typeof attachSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = attachSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await attachLink(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "scheduling.link_attached",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_item",
        targetId: parsed.data.itemId,
        // The KIND and the id, never the label — the label is the customer's
        // name, and an audit row is readable by people the record may not be.
        meta: {
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
        },
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const detachSchema = z.object({
  itemId: z.string().uuid(),
  linkId: z.string().uuid(),
});

export async function detachLinkAction(
  input: z.infer<typeof detachSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = detachSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await detachLink(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "scheduling.link_detached",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_item",
        targetId: parsed.data.itemId,
        meta: { linkId: parsed.data.linkId },
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- Subscribe feed -------------------------------------------------------- */

const mintSchema = z.object({ label: z.string().trim().max(60) });

/**
 * Mint a subscribe link and return it ONCE.
 *
 * The plaintext token is in this response and nowhere else — only its hash
 * reaches the database, so there is no second chance to show it. The UI has to
 * display it immediately and say so.
 *
 * Audited, because a new credential to somebody's calendar is exactly the kind
 * of thing an audit log exists for. THE TOKEN ITSELF IS NOT IN THE META: an
 * audit row that carried it would be a working feed link sitting in a table
 * that superadmins read.
 */
export async function mintFeedTokenAction(
  input: z.infer<typeof mintSchema>,
): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await gate();
    const parsed = mintSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const token = await withSchedule(ctx, async (tx) => {
      const minted = await mintFeedToken(tx, ctx, parsed.data.label);
      await logAuditInTx(tx, {
        action: "scheduling.feed_token_minted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_feed_token",
        meta: { label: parsed.data.label },
      });
      return minted;
    });

    revalidatePath(`${BASE}/calendars`);
    return { ok: true, data: { url: appUrl(`/api/schedule/feed/${token}`) } };
  } catch (err) {
    return fail(err);
  }
}

const revokeTokenSchema = z.object({ tokenId: z.string().uuid() });

export async function revokeFeedTokenAction(
  input: z.infer<typeof revokeTokenSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = revokeTokenSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await revokeFeedToken(tx, parsed.data.tokenId);
      await logAuditInTx(tx, {
        action: "scheduling.feed_token_revoked",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_feed_token",
        targetId: parsed.data.tokenId,
      });
    });

    revalidatePath(`${BASE}/calendars`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- One occurrence of a series -------------------------------------------- */

const occurrenceSchema = z.object({
  itemId: z.string().uuid(),
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Cancel a single occurrence, leaving the series alone.
 *
 * The commonest edit to a repeating event by a wide margin — "no standup on
 * Friday" — and the reason the override table exists at all.
 */
export async function cancelOccurrenceAction(
  input: z.infer<typeof occurrenceSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = occurrenceSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withSchedule(ctx, async (tx) => {
      await overrideOccurrence(tx, ctx, { ...parsed.data, cancelled: true });
      await logAuditInTx(tx, {
        action: "scheduling.occurrence_cancelled",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "schedule_item",
        targetId: parsed.data.itemId,
        meta: { occurrenceDate: parsed.data.occurrenceDate },
      });
    });

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
