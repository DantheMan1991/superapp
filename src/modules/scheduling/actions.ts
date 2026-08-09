"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { withSchedule } from "@/lib/schedule/with-schedule";
import { SCHEDULE_ACCESS_LEVELS } from "@/lib/schedule/access";
import {
  SchedulingError,
  createCalendar,
  grantShare,
  revokeShare,
  setCalendarArchived,
  updateCalendar,
  type SchedulingCtx,
} from "./calendar-ops";

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

async function gate(): Promise<SchedulingCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "scheduling");
  // Fail closed for the accountant role, as CRM and Documents do. There is no
  // read-only-safe write in this module, so there is nothing to opt into.
  if (ctx.role === "expert") {
    throw new SchedulingError("FORBIDDEN", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof SchedulingError) return { error: err.message };
  console.error("scheduling action failed", err);
  return { error: "Something went wrong." };
}

/**
 * A colour is one of a fixed set, validated server-side.
 *
 * Free-form would let a caller put anything in a string the UI drops into a
 * style attribute. The column is deliberately open text so a palette can change
 * without a migration; the ENUM lives here, at the boundary, which is where
 * "what may be written" belongs.
 */
export const CALENDAR_COLORS = [
  "slate",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
] as const;

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
