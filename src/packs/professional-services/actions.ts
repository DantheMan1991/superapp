"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { todayInTimezone } from "@/lib/timezone";
import { monthOf } from "@/lib/retainer-core";
import { startOnboarding } from "./onboarding-ops";
import {
  createEngagement,
  deleteTimeEntry,
  EngagementError,
  logTime,
  PACK,
  setEngagementStatus,
  updateEngagement,
  updateTimeEntry,
  type EngagementCtx,
} from "./ops";

/**
 * The engagement write surface.
 *
 * Every action does the three things AGENTS.md requires of a pack: it
 * re-verifies the tenant server-side, checks the pack is switched ON, and
 * works inside `withTenant` with the caller's own role so RLS and the
 * pack's own decision-or-chore rule both apply.
 *
 * **THE TENANT'S TODAY, NEVER THE SERVER'S.** A month is a calendar month in
 * the tenant's timezone, and it decides which allotment an edit lands in and
 * which month the meter reports. Resolved here, at the edge, and passed down
 * — `ops.ts` never asks what day it is.
 */

const BASE = "/dashboard/m/professional-services";

async function gate(): Promise<{ ctx: EngagementCtx; today: string }> {
  const tenant = await requireTenant();
  await requireModuleEnabled(tenant.tenant.id, PACK);
  return {
    ctx: { tenantId: tenant.tenant.id, userId: tenant.userId, role: tenant.role },
    today: todayInTimezone(tenant.tenant.timezone),
  };
}

/** An EngagementError as the flat shape every form here returns. */
function toResult(err: unknown): { error: string } {
  if (err instanceof EngagementError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change an engagement." };
      case "NOT_FOUND":
        return { error: "That engagement no longer exists." };
      case "INVALID_KIND":
        return { error: "A kind must be lowercase letters, numbers and underscores." };
      case "INVALID_DATE":
        return { error: "Check the dates. An engagement cannot end before it starts." };
      case "CLIENT_REQUIRED":
        return { error: "Pick a client, or type a new one." };
      case "CLIENT_INVALID":
        return { error: "That client no longer exists. Reload and pick again." };
      case "INVALID_STATUS":
        return { error: "That is not something this engagement can do next." };
      case "ENDED":
        return { error: "That engagement has ended. Reopen it to log time against it." };
      case "INVALID_MINUTES":
        return { error: "Log between 1 minute and 24 hours." };
      case "VERSION_CONFLICT":
        return { error: "Somebody changed this while you had it open. Reload and try again." };
    }
  }
  console.error("professional-services action failed", err);
  return { error: "Something went wrong saving that." };
}

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const money = z.number().int().min(0).max(1_000_000_000).nullable().optional();

const createSchema = z.object({
  partyId: z.string().uuid().nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  name: z.string().min(1).max(200),
  kind: z.string().min(1).max(63),
  scope: z.string().max(5000).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: optionalDate,
  feeCents: money,
  rateCents: money,
  retainerMinutesMonthly: z.number().int().min(0).max(100_000).optional(),
  notes: z.string().max(5000).optional(),
});

export async function createEngagementAction(input: unknown) {
  try {
    const { ctx } = await gate();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const engagement = await createEngagement(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "engagement.created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "engagement",
          targetId: engagement.id,
          meta: {
            kind: engagement.kind,
            retainerMinutesMonthly: engagement.retainerMinutesMonthly,
          },
        });
        return engagement;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(BASE);
    return { ok: true as const, engagementId: row.id };
  } catch (err) {
    return toResult(err);
  }
}

const updateSchema = z.object({
  engagementId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  name: z.string().min(1).max(200),
  kind: z.string().min(1).max(63),
  scope: z.string().max(5000).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: optionalDate,
  feeCents: money,
  rateCents: money,
  retainerMinutesMonthly: z.number().int().min(0).max(100_000).optional(),
  notes: z.string().max(5000).optional(),
});

export async function updateEngagementAction(input: unknown) {
  try {
    const { ctx, today } = await gate();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    const { engagementId, expectedVersion, ...patch } = parsed.data;

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const after = await updateEngagement(tx, ctx, {
          engagementId,
          expectedVersion,
          patch,
          // A changed retainer takes effect THIS month and leaves every
          // earlier one at what was agreed then.
          allotmentMonth: monthOf(today),
        });
        await logAuditInTx(tx, {
          action: "engagement.updated",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "engagement",
          targetId: after.id,
          meta: { retainerMinutesMonthly: after.retainerMinutesMonthly },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${engagementId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const statusSchema = z.object({
  engagementId: z.string().uuid(),
  status: z.enum(["proposed", "active", "paused", "ended"]),
});

export async function setEngagementStatusAction(input: unknown) {
  try {
    const { ctx, today } = await gate();
    const parsed = statusSchema.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const after = await setEngagementStatus(tx, ctx, { ...parsed.data, today });
        await logAuditInTx(tx, {
          action: "engagement.status_changed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "engagement",
          targetId: after.id,
          meta: { status: after.status },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${parsed.data.engagementId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const logSchema = z.object({
  engagementId: z.string().uuid(),
  minutes: z.number().int().min(1).max(1440),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(1000).optional(),
});

export async function logTimeAction(input: unknown) {
  try {
    const { ctx } = await gate();
    const parsed = logSchema.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const entry = await logTime(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "engagement.time_logged",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "engagement",
          targetId: entry.engagementId,
          meta: { minutes: entry.minutes, workDate: entry.workDate },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${parsed.data.engagementId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const editEntrySchema = z.object({
  entryId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  minutes: z.number().int().min(1).max(1440),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(1000),
});

export async function updateTimeEntryAction(input: unknown) {
  try {
    const { ctx } = await gate();
    const parsed = editEntrySchema.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    const engagementId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const after = await updateTimeEntry(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "engagement.time_edited",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "engagement",
          targetId: after.engagementId,
          meta: { minutes: after.minutes, workDate: after.workDate },
        });
        return after.engagementId;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(`${BASE}/${engagementId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Raise whatever the installed profile says a new engagement of this kind
 * starts with (back-office slice 7c). Additive and re-runnable — pressing it
 * twice adds nothing the second time, and a step added to the profile later
 * arrives by pressing it again. Owner-level: it puts work on other people's
 * lists.
 */
export async function startOnboardingAction(input: unknown) {
  try {
    const { ctx, today } = await gate();
    const parsed = z.object({ engagementId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    const raised = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const result = await startOnboarding(tx, ctx, {
          engagementId: parsed.data.engagementId,
          today,
        });
        if (result.raised.length > 0) {
          await logAuditInTx(tx, {
            action: "engagement.onboarding_started",
            tenantId: ctx.tenantId,
            actorClerkUserId: ctx.userId,
            targetType: "engagement",
            targetId: parsed.data.engagementId,
            meta: { steps: result.raised.length },
          });
        }
        return result.raised.length;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(`${BASE}/${parsed.data.engagementId}`);
    return { ok: true as const, raised };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteTimeEntryAction(input: unknown) {
  try {
    const { ctx } = await gate();
    const parsed = z.object({ entryId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    const engagementId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const gone = await deleteTimeEntry(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "engagement.time_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "engagement",
          targetId: gone.engagementId,
          meta: { minutes: gone.minutes, workDate: gone.workDate },
        });
        return gone.engagementId;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(`${BASE}/${engagementId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}
