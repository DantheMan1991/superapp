"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { withSystem, schema } from "@/db";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isValidIsoDate } from "@/modules/accounting/lib/money";
import {
  currentMonth,
  elapsedMinutes,
  todayInRetainerTz,
} from "@/lib/retainer-core";

/**
 * Retainer time tracking — platform-level (superadmin) mutations. Every
 * action re-verifies superadmin server-side. Tenants can never write these
 * tables (member_read RLS); credits are handled by retainer-billing only.
 */

function revalidate(tenantId: string) {
  revalidatePath("/admin/retainers");
  revalidatePath(`/admin/tenants/${tenantId}`);
}

/** Ensure the tenant's retainers row exists (lazy creation). */
async function ensureRetainerRow(tenantId: string) {
  await withSystem((tx) =>
    tx
      .insert(schema.retainers)
      .values({ tenantId })
      .onConflictDoNothing({ target: schema.retainers.tenantId }),
  );
}

const allotmentSchema = z.object({
  tenantId: z.string().uuid(),
  includedHours: z.coerce.number().min(0).max(500),
});

/**
 * Set the monthly included hours. Applies to the WHOLE current month and
 * onward (history row upserted on the current month); past months keep the
 * allotment they had — their overage never rewrites.
 */
export async function setRetainerAllotment(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = allotmentSchema.safeParse({
    tenantId: formData.get("tenantId"),
    includedHours: formData.get("includedHours"),
  });
  if (!parsed.success) return { error: "Invalid allotment" };
  const { tenantId, includedHours } = parsed.data;
  const includedMinutes = Math.round(includedHours * 60);
  const month = currentMonth();

  await withSystem(async (tx) => {
    await tx
      .insert(schema.retainers)
      .values({ tenantId, includedMinutesMonthly: includedMinutes })
      .onConflictDoUpdate({
        target: schema.retainers.tenantId,
        set: { includedMinutesMonthly: includedMinutes, updatedAt: new Date() },
      });
    await tx
      .insert(schema.retainerAllotments)
      .values({ tenantId, effectiveMonth: month, includedMinutes })
      .onConflictDoUpdate({
        target: [
          schema.retainerAllotments.tenantId,
          schema.retainerAllotments.effectiveMonth,
        ],
        set: { includedMinutes },
      });
  });

  await logAudit({
    action: "retainer.allotment_changed",
    tenantId,
    actorClerkUserId: userId,
    meta: { includedMinutes, month },
  });
  revalidate(tenantId);
  return { ok: true };
}

const startTimerSchema = z.object({
  tenantId: z.string().uuid(),
  note: z.string().trim().max(2000).optional(),
});

export async function startTimer(input: z.infer<typeof startTimerSchema>) {
  const { userId } = await requireSuperAdmin();
  const parsed = startTimerSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { tenantId, note } = parsed.data;

  await ensureRetainerRow(tenantId);
  const rows = await withSystem((tx) =>
    tx
      .update(schema.retainers)
      .set({
        timerStartedAt: new Date(),
        timerNote: note ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.retainers.tenantId, tenantId),
          isNull(schema.retainers.timerStartedAt),
        ),
      )
      .returning({ id: schema.retainers.id }),
  );
  if (rows.length === 0) {
    return { error: "A timer is already running for this client." };
  }

  await logAudit({
    action: "retainer.timer_started",
    tenantId,
    actorClerkUserId: userId,
  });
  revalidate(tenantId);
  return { ok: true };
}

const stopTimerSchema = z.object({
  tenantId: z.string().uuid(),
  note: z.string().trim().min(1).max(2000),
});

/** Stop the timer and log the entry. The note is required — it's what the
 * client reads on their work log. */
export async function stopTimer(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = stopTimerSchema.safeParse({
    tenantId: formData.get("tenantId"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { error: "A note is required to log the time." };
  const { tenantId, note } = parsed.data;

  const minutes = await withSystem(async (tx) => {
    // Guarded clear: double-click / two tabs can't double-log.
    const cleared = await tx
      .update(schema.retainers)
      .set({ timerStartedAt: null, timerNote: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.retainers.tenantId, tenantId),
          isNotNull(schema.retainers.timerStartedAt),
        ),
      )
      .returning({ startedAt: schema.retainers.timerStartedAt });
    if (cleared.length === 0 || !cleared[0].startedAt) return null;

    const mins = elapsedMinutes(cleared[0].startedAt, new Date());
    await tx.insert(schema.retainerTimeEntries).values({
      tenantId,
      minutes: mins,
      workDate: todayInRetainerTz(),
      note,
      source: "timer",
      actorClerkUserId: userId,
    });
    return mins;
  });
  if (minutes === null) return { error: "No timer is running." };

  await logAudit({
    action: "retainer.time_logged",
    tenantId,
    actorClerkUserId: userId,
    meta: { minutes, source: "timer" },
  });
  revalidate(tenantId);
  return { ok: true };
}

const cancelTimerSchema = z.object({ tenantId: z.string().uuid() });

/** Discard a running timer without logging anything (forgot-to-stop escape). */
export async function cancelTimer(input: z.infer<typeof cancelTimerSchema>) {
  const { userId } = await requireSuperAdmin();
  const parsed = cancelTimerSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { tenantId } = parsed.data;

  const rows = await withSystem((tx) =>
    tx
      .update(schema.retainers)
      .set({ timerStartedAt: null, timerNote: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.retainers.tenantId, tenantId),
          isNotNull(schema.retainers.timerStartedAt),
        ),
      )
      .returning({ id: schema.retainers.id }),
  );
  if (rows.length === 0) return { error: "No timer is running." };

  await logAudit({
    action: "retainer.timer_canceled",
    tenantId,
    actorClerkUserId: userId,
  });
  revalidate(tenantId);
  return { ok: true };
}

const manualLogSchema = z.object({
  tenantId: z.string().uuid(),
  hours: z.coerce.number().positive().max(24),
  workDate: z
    .string()
    .refine(isValidIsoDate, "Invalid date")
    .refine((d) => d <= todayInRetainerTz(), "Date is in the future"),
  note: z.string().trim().min(1).max(2000),
});

export async function logManualTime(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = manualLogSchema.safeParse({
    tenantId: formData.get("tenantId"),
    hours: formData.get("hours"),
    workDate: formData.get("workDate"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid entry",
    };
  }
  const { tenantId, hours, workDate, note } = parsed.data;

  await ensureRetainerRow(tenantId);
  await withSystem((tx) =>
    tx.insert(schema.retainerTimeEntries).values({
      tenantId,
      minutes: Math.round(hours * 60),
      workDate,
      note,
      source: "manual",
      actorClerkUserId: userId,
    }),
  );

  await logAudit({
    action: "retainer.time_logged",
    tenantId,
    actorClerkUserId: userId,
    meta: { minutes: Math.round(hours * 60), workDate, source: "manual" },
  });
  revalidate(tenantId);
  return { ok: true };
}

const updateEntrySchema = manualLogSchema.extend({
  entryId: z.string().uuid(),
});

export async function updateTimeEntry(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = updateEntrySchema.safeParse({
    entryId: formData.get("entryId"),
    tenantId: formData.get("tenantId"),
    hours: formData.get("hours"),
    workDate: formData.get("workDate"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid entry" };
  }
  const { entryId, tenantId, hours, workDate, note } = parsed.data;
  const minutes = Math.round(hours * 60);

  const rows = await withSystem((tx) =>
    tx
      .update(schema.retainerTimeEntries)
      .set({ minutes, workDate, note })
      .where(
        and(
          eq(schema.retainerTimeEntries.id, entryId),
          eq(schema.retainerTimeEntries.tenantId, tenantId),
        ),
      )
      .returning({
        beforeMinutes: schema.retainerTimeEntries.minutes,
      }),
  );
  if (rows.length === 0) return { error: "Entry not found" };

  await logAudit({
    action: "retainer.entry_updated",
    tenantId,
    actorClerkUserId: userId,
    targetType: "retainer_time_entry",
    targetId: entryId,
    meta: { minutes, workDate },
  });
  revalidate(tenantId);
  return { ok: true };
}

const deleteEntrySchema = z.object({
  entryId: z.string().uuid(),
  tenantId: z.string().uuid(),
});

export async function deleteTimeEntry(
  input: z.infer<typeof deleteEntrySchema>,
) {
  const { userId } = await requireSuperAdmin();
  const parsed = deleteEntrySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { entryId, tenantId } = parsed.data;

  const rows = await withSystem((tx) =>
    tx
      .delete(schema.retainerTimeEntries)
      .where(
        and(
          eq(schema.retainerTimeEntries.id, entryId),
          eq(schema.retainerTimeEntries.tenantId, tenantId),
        ),
      )
      .returning({
        minutes: schema.retainerTimeEntries.minutes,
        workDate: schema.retainerTimeEntries.workDate,
        note: schema.retainerTimeEntries.note,
      }),
  );
  if (rows.length === 0) return { error: "Entry not found" };

  await logAudit({
    action: "retainer.entry_deleted",
    tenantId,
    actorClerkUserId: userId,
    targetType: "retainer_time_entry",
    targetId: entryId,
    meta: rows[0],
  });
  revalidate(tenantId);
  return { ok: true };
}
