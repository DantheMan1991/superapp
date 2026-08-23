"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { toResult } from "./action-errors";
import type { ProductionCtx } from "./ops";
import {
  createBooking,
  removeBooking,
  startRunFromBooking,
  updateBooking,
} from "./booking-ops";
import { BOOKING_STATUSES } from "./vocabulary";

/**
 * The booking write surface.
 *
 * **AUDITED, INCLUDING THE DEPOSIT AND THE DATE.** A booking is a commercial
 * commitment: the date is the scarce thing, the deposit is money at risk, and a
 * date quietly moved is the kind of change somebody will later need to
 * reconstruct — especially when a plant and a farm remember it differently. The
 * notes are free text about somebody else's business and stay in the row, the
 * same rule the condemn reason and `good_at` follow.
 */

const PACK = "production";
const BASE = "/dashboard/m/production";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Dollars in, cents stored — the conversion lives here, in one place. */
const dollars = z
  .number()
  .min(0)
  .max(1_000_000)
  .multipleOf(0.01)
  .nullable()
  .optional();

const toCents = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value * 100);

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): ProductionCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

const bookingFields = {
  bookedFor: isoDate,
  kind: z.string().trim().max(63).optional(),
  headCount: z.number().int().positive().max(1_000_000).nullable().optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  reference: z.string().max(120).optional(),
  deposit: dollars,
  depositPaidOn: isoDate.nullable().optional(),
  notes: z.string().max(5000).optional(),
};

export async function createBookingAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ processorId: z.string().uuid(), ...bookingFields })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { deposit, ...rest } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) =>
        createBooking(tx, ctxOf(ctx), {
          ...rest,
          depositCents: toCents(deposit),
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.booking.made",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_booking",
      targetId: row.id,
      meta: {
        processorId: row.processorId,
        bookedFor: row.bookedFor,
        kind: row.kind,
        headCount: row.headCount,
        status: row.status,
        depositCents: row.depositCents,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: row.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateBookingAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      ...bookingFields,
      bookedFor: isoDate.optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, deposit, ...rest } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) =>
        updateBooking(tx, ctxOf(ctx), id, {
          ...rest,
          ...(deposit !== undefined ? { depositCents: toCents(deposit) } : {}),
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.booking.changed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_booking",
      targetId: row.id,
      meta: {
        bookedFor: row.bookedFor,
        status: row.status,
        headCount: row.headCount,
        depositCents: row.depositCents,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeBookingAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => removeBooking(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.booking.removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_booking",
      targetId: row.id,
      meta: { processorId: row.processorId, bookedFor: row.bookedFor },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * The day arrived. Start the run and record what the booking became.
 *
 * Revalidates `inventory` as well, because a run existing is the first half of
 * stock moving and the run page is where somebody goes next.
 */
export async function startRunFromBookingAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      bookingId: z.string().uuid(),
      code: z.string().trim().min(1).max(120),
      runKind: z.string().min(1).max(63).optional(),
      startedOn: isoDate,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { bookingId, ...args } = parsed.data;
  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => startRunFromBooking(tx, ctxOf(ctx), bookingId, args),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.booking.became_run",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_booking",
      targetId: bookingId,
      meta: {
        runId: result.runId,
        processorId: result.booking.processorId,
        bookedFor: result.booking.bookedFor,
      },
    });
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/inventory", "layout");
    return { ok: true, runId: result.runId };
  } catch (err) {
    return toResult(err);
  }
}
