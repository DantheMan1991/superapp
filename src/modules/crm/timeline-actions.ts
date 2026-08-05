"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { CrmError, friendlyMessage } from "./core/errors";
import {
  ACTIVITY_BODY_MAX,
  ACTIVITY_SUBJECT_MAX,
  TASK_NOTES_MAX,
  TASK_TITLE_MAX,
} from "./core/timeline";
import type { CrmCtx } from "./core/types";
import {
  createTask,
  deleteActivity,
  deleteTask,
  logActivity,
  setTaskComplete,
  updateActivity,
  updateTask,
} from "./timeline-ops";

/**
 * Activity and follow-up actions. Same shape as the rest of the module, and
 * `{ role: ctx.role }` on every transaction because both tables inherit the
 * record's visibility.
 */

const BASE = "/dashboard/m/crm";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<CrmCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  if (ctx.role === "expert") {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof CrmError) return { error: friendlyMessage(err) };
  console.error("crm timeline action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidateFor(partyId?: string | null, dealId?: string | null): void {
  revalidatePath(`${BASE}/tasks`);
  if (partyId) revalidatePath(`${BASE}/records/${partyId}`);
  if (dealId) revalidatePath(`${BASE}/deals/${dealId}`);
}

/* -- Activity ------------------------------------------------------------- */

const logSchema = z.object({
  partyId: z.string().uuid(),
  dealId: z.string().uuid().nullable().optional(),
  kind: z.enum(["note", "call", "meeting"]),
  subject: z.string().max(ACTIVITY_SUBJECT_MAX).optional(),
  body: z.string().max(ACTIVITY_BODY_MAX).optional(),
  /**
   * A date, not a timestamp — the composer offers a day, because "when did this
   * happen" is answered in days and asking for a time would be asking somebody
   * to invent one.
   */
  occurredOn: z.string().date().optional(),
});

export async function logActivityAction(
  input: z.infer<typeof logSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = logSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { occurredOn, ...rest } = parsed.data;

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await logActivity(tx, ctx, {
          ...rest,
          // Midday UTC for a chosen day, so the entry does not slip to the
          // previous date when rendered west of Greenwich. Omitted means now.
          occurredAt: occurredOn ? new Date(`${occurredOn}T12:00:00Z`) : undefined,
        });
        await logAuditInTx(tx, {
          action: "crm.activity_logged",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_activity",
          targetId: row.id,
          // The KIND only. A note's text is a client's own words about their
          // own business and does not belong in a superadmin-visible log (S9).
          meta: { kind: row.kind },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFor(parsed.data.partyId, parsed.data.dealId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const editActivitySchema = z.object({
  activityId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  partyId: z.string().uuid(),
  subject: z.string().max(ACTIVITY_SUBJECT_MAX).optional(),
  body: z.string().max(ACTIVITY_BODY_MAX).optional(),
  occurredOn: z.string().date().optional(),
});

export async function updateActivityAction(
  input: z.infer<typeof editActivitySchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = editActivitySchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { activityId, expectedVersion, partyId, occurredOn, ...patch } = parsed.data;

    await withTenant(
      ctx.tenantId,
      (tx) =>
        updateActivity(tx, ctx, {
          activityId,
          expectedVersion,
          patch: {
            ...patch,
            ...(occurredOn ? { occurredAt: new Date(`${occurredOn}T12:00:00Z`) } : {}),
          },
        }),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFor(partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const deleteActivitySchema = z.object({
  activityId: z.string().uuid(),
  partyId: z.string().uuid(),
});

export async function deleteActivityAction(
  input: z.infer<typeof deleteActivitySchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = deleteActivitySchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await deleteActivity(tx, ctx, parsed.data.activityId);
        await logAuditInTx(tx, {
          action: "crm.activity_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_activity",
          targetId: parsed.data.activityId,
          meta: {},
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFor(parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- Tasks ---------------------------------------------------------------- */

const createTaskSchema = z.object({
  partyId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(TASK_TITLE_MAX),
  notes: z.string().max(TASK_NOTES_MAX).optional(),
  dueOn: z.string().date().nullable().optional(),
  assigneeClerkUserId: z.string().max(120).nullable().optional(),
});

export async function createTaskAction(
  input: z.infer<typeof createTaskSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = createTaskSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await createTask(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "crm.task_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_task",
          targetId: row.id,
          meta: { attached: row.partyId !== null, dated: row.dueOn !== null },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFor(parsed.data.partyId, parsed.data.dealId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const editTaskSchema = z.object({
  taskId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  partyId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(TASK_TITLE_MAX).optional(),
  notes: z.string().max(TASK_NOTES_MAX).optional(),
  dueOn: z.string().date().nullable().optional(),
  assigneeClerkUserId: z.string().max(120).nullable().optional(),
});

export async function updateTaskAction(
  input: z.infer<typeof editTaskSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = editTaskSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { taskId, expectedVersion, partyId, ...patch } = parsed.data;

    await withTenant(
      ctx.tenantId,
      (tx) => updateTask(tx, ctx, { taskId, expectedVersion, patch }),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFor(partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const completeSchema = z.object({
  taskId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  complete: z.boolean(),
  partyId: z.string().uuid().nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
});

export async function setTaskCompleteAction(
  input: z.infer<typeof completeSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = completeSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => setTaskComplete(tx, ctx, parsed.data),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidateFor(parsed.data.partyId, parsed.data.dealId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const deleteTaskSchema = z.object({
  taskId: z.string().uuid(),
  partyId: z.string().uuid().nullable().optional(),
});

export async function deleteTaskAction(
  input: z.infer<typeof deleteTaskSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = deleteTaskSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(ctx.tenantId, (tx) => deleteTask(tx, ctx, parsed.data.taskId), {
      role: ctx.role,
    });

    revalidateFor(parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
