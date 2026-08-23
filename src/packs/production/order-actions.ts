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
  addOrderLine,
  createOrder,
  removeOrder,
  removeOrderLine,
  updateOrder,
  updateOrderLine,
} from "./order-ops";
import { PRICE_UNITS } from "./vocabulary";

/**
 * The cut sheet's write surface.
 *
 * **AUDITED, AND FOR A NARROWER REASON THAN THE PRICE LIST IS.** A price item is
 * the terms of a commercial relationship; a cut sheet is an instruction to a
 * third party about somebody's animal, and one line of it — the quoted price —
 * later becomes part of what a box of meat cost. What goes in the log is
 * identifiers and the figures a dispute would turn on. The INSTRUCTIONS stay in
 * the row: "grind the chuck" is prose about how a customer wants their beef,
 * and the same rule the condemn reason follows applies to it.
 *
 * **WRITES ARE MEMBER**, which is the opposite call from `processor-actions.ts`
 * and deliberate — see the header on `order-ops.ts`.
 */

const PACK = "production";
const BASE = "/dashboard/m/production";

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): ProductionCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

/** Dollars in, cents out — the conversion lives here, in one place. */
const dollars = z
  .number()
  .min(0)
  .max(1_000_000)
  .multipleOf(0.01)
  .nullable()
  .optional();

const toCents = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value * 100);

export async function createOrderAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      processorId: z.string().uuid(),
      bookingId: z.string().uuid().nullable().optional(),
      runId: z.string().uuid().nullable().optional(),
      title: z.string().max(200).optional(),
      kind: z.string().trim().max(63).optional(),
      headCount: z.number().int().positive().max(1_000_000).nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => createOrder(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.order.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_order",
      targetId: row.id,
      meta: {
        processorId: row.processorId,
        bookingId: row.bookingId,
        runId: row.runId,
        kind: row.kind,
        headCount: row.headCount,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: row.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateOrderAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      title: z.string().max(200).optional(),
      kind: z.string().trim().max(63).optional(),
      headCount: z.number().int().positive().max(1_000_000).nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => updateOrder(tx, ctxOf(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.order.updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_order",
      targetId: row.id,
      meta: { kind: row.kind, headCount: row.headCount },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeOrderAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => removeOrder(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.order.removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_order",
      targetId: row.id,
      meta: { processorId: row.processorId, runId: row.runId },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function addOrderLineAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      orderId: z.string().uuid(),
      priceItemId: z.string().uuid().nullable().optional(),
      category: z.string().trim().max(63).optional(),
      label: z.string().trim().max(200).optional(),
      /** Only sent when somebody is overriding what the sheet said. */
      unitPrice: dollars,
      unit: z.enum(PRICE_UNITS).nullable().optional(),
      minimum: dollars,
      quantity: z.number().positive().max(100_000_000).nullable().optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { orderId, unitPrice, minimum, ...rest } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) =>
        addOrderLine(tx, ctxOf(ctx), orderId, {
          ...rest,
          // `undefined` and `null` are different here and both are meaningful:
          // absent means "take the price item's figure", null means "no price".
          ...(unitPrice === undefined ? {} : { unitPriceCents: toCents(unitPrice) }),
          ...(minimum === undefined ? {} : { minimumCents: toCents(minimum) }),
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.order.line_added",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_order",
      targetId: orderId,
      // The unit travels with the price, for the reason `price_item_set` gives:
      // a bare figure could never say which of eight things it was per.
      meta: {
        lineId: row.id,
        priceItemId: row.priceItemId,
        label: row.label,
        unitPriceCents: row.unitPriceCents,
        unit: row.unit,
        quantity: row.quantity,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: row.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateOrderLineAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      quantity: z.number().positive().max(100_000_000).nullable().optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => updateOrderLine(tx, ctxOf(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.order.line_updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_order",
      targetId: row.orderId,
      meta: { lineId: row.id, label: row.label, quantity: row.quantity },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeOrderLineAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => removeOrderLine(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.order.line_removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_order",
      targetId: row.orderId,
      meta: {
        lineId: row.id,
        label: row.label,
        unitPriceCents: row.unitPriceCents,
        unit: row.unit,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
