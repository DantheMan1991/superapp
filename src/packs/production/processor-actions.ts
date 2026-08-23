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
  addCut,
  clearPriceItems,
  createProcessor,
  removeCut,
  removeHandle,
  removePriceItem,
  removePriceItems,
  setHandle,
  setPriceItem,
  setPriceItemKind,
  updateProcessor,
} from "./processor-ops";
import { INSPECTIONS, LABELLING_OPTIONS, PRICE_UNITS } from "./vocabulary";

/**
 * The processor directory's write surface.
 *
 * **EVERY WRITE HERE IS AUDITED, and the reason is not the usual one.** An
 * output is a box of meat and the ledger is its record; these rows are the terms
 * of a commercial relationship — what a plant quoted, whether it is inspected,
 * and one person's candid view of a named local business. Changing a fee after a
 * bill arrives, or quietly downgrading an inspection status, is the kind of edit
 * somebody will later need to be able to reconstruct.
 *
 * **THE PROSE IS NEVER IN THE META.** `good_at`, `notes`, `labelling_notes` and
 * `price_notes` are all free text about a third party and stay in the row, the
 * same rule the kill sheet's condemn reason follows. What goes in the audit log
 * is identifiers and the values a dispute would turn on: the fee, the inspection
 * status, the rating.
 */

const PACK = "production";
const BASE = "/dashboard/m/production";

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): ProductionCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

/**
 * Money arrives as dollars from a form and is stored as cents.
 *
 * `.multipleOf(0.01)` rather than rounding: a fee typed as `1.005` is somebody
 * mistyping, and silently accepting it as `$1.01` would put a number in the
 * record that nobody entered. The refusal is the honest answer.
 */
const dollars = z
  .number()
  .min(0)
  .max(1_000_000)
  .multipleOf(0.01)
  .nullable()
  .optional();

const toCents = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value * 100);

const processorFields = {
  inspection: z.enum(INSPECTIONS).optional(),
  establishmentNumber: z.string().max(60).optional(),
  customLabelling: z.enum(LABELLING_OPTIONS).optional(),
  labellingNotes: z.string().max(2000).optional(),
  leadTimeDays: z.number().int().positive().max(3650).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  goodAt: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
};

export async function createProcessorAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ name: z.string().trim().min(1).max(200), ...processorFields })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => createProcessor(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.added",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: row.id,
      meta: {
        partyId: row.partyId,
        inspection: row.inspection,
        establishmentNumber: row.establishmentNumber,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: row.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateProcessorAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(200).optional(),
      isActive: z.boolean().optional(),
      ...processorFields,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => updateProcessor(tx, ctxOf(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.changed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: row.id,
      meta: {
        inspection: row.inspection,
        establishmentNumber: row.establishmentNumber,
        customLabelling: row.customLabelling,
        rating: row.rating,
        isActive: row.isActive,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function setHandleAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      processorId: z.string().uuid(),
      kind: z.string().trim().min(1).max(63),
      capacityPerDay: z.number().int().positive().max(1_000_000).nullable().optional(),
      priceNotes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { processorId, ...rest } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => setHandle(tx, ctxOf(ctx), processorId, rest),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.handle_set",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: processorId,
      // What they take and how many a day. The PRICES moved to their own rows
      // and are audited by `price_item_set`, which carries the unit beside the
      // figure — `105` in this entry could never have said which.
      meta: {
        handleId: row.id,
        kind: row.kind,
        capacityPerDay: row.capacityPerDay,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeHandleAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => removeHandle(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.handle_removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: row.processorId,
      meta: { handleId: row.id, kind: row.kind },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function setPriceItemAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      processorId: z.string().uuid(),
      kind: z.string().trim().max(63).optional(),
      category: z.string().trim().max(63).optional(),
      label: z.string().trim().min(1).max(200),
      price: dollars,
      unit: z.enum(PRICE_UNITS),
      minimum: dollars,
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { processorId, price, minimum, ...rest } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) =>
        setPriceItem(tx, ctxOf(ctx), processorId, {
          ...rest,
          priceCents: toCents(price),
          minimumCents: toCents(minimum),
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.price_item_set",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: processorId,
      /**
       * **THE UNIT GOES IN THE LOG BESIDE THE PRICE, and it is not padding.**
       * `105` on its own is unreconstructable: it is $1.05 a bird or $1.05 a
       * pound, and those are the two numbers a dispute about a butcher's bill
       * turns on. The label goes in for the same reason — it is what was
       * priced, not prose about a third party.
       */
      meta: {
        priceItemId: row.id,
        kind: row.kind,
        category: row.category,
        label: row.label,
        priceCents: row.priceCents,
        unit: row.unit,
        minimumCents: row.minimumCents,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: row.id };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Clear a processor's whole price list.
 *
 * **THE CONFIRM SAYS HOW MANY, and the count comes back for the toast**, which
 * is the only thing that makes an action like this safe to put on a screen.
 */
export async function clearPriceItemsAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ processorId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const removed = await withTenant(
      ctx.tenant.id,
      (tx) => clearPriceItems(tx, ctxOf(ctx), parsed.data.processorId),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.price_list_cleared",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: parsed.data.processorId,
      // HOW MANY went is the whole record here — the rows themselves are gone
      // and each one's own removal is not separately logged.
      meta: { removed },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, removed };
  } catch (err) {
    return toResult(err);
  }
}

/** Put the same animal on many rows at once. */
export async function setPriceItemKindAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      ids: z.array(z.string().uuid()).min(1).max(500),
      kind: z.string().trim().max(63),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => setPriceItemKind(tx, ctxOf(ctx), parsed.data.ids, parsed.data.kind),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.price_items_rekinded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: parsed.data.ids[0],
      meta: {
        kind: parsed.data.kind,
        asked: parsed.data.ids.length,
        moved: result.moved,
        clashed: result.clashed.length,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, ...result };
  } catch (err) {
    return toResult(err);
  }
}

/** Take many prices off at once. */
export async function removePriceItemsAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ ids: z.array(z.string().uuid()).min(1).max(500) })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const removed = await withTenant(
      ctx.tenant.id,
      (tx) => removePriceItems(tx, ctxOf(ctx), parsed.data.ids),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.price_items_removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: parsed.data.ids[0],
      meta: { asked: parsed.data.ids.length, removed },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, removed };
  } catch (err) {
    return toResult(err);
  }
}

export async function removePriceItemAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => removePriceItem(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.processor.price_item_removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: row.processorId,
      meta: {
        priceItemId: row.id,
        kind: row.kind,
        label: row.label,
        priceCents: row.priceCents,
        unit: row.unit,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function addCutAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      processorId: z.string().uuid(),
      kind: z.string().trim().max(63).optional(),
      name: z.string().trim().min(1).max(200),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { processorId, ...rest } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => addCut(tx, ctxOf(ctx), processorId, rest),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true, id: row.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeCutAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => removeCut(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
