"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import {
  InventoryError,
  archiveItem,
  closeLot,
  createItem,
  createLot,
  mergeLot,
  issueStock,
  receiveStock,
  recordMovement,
  splitLot,
  updateItem,
  type InventoryCtx,
} from "./ops";

/**
 * Inventory write surface.
 *
 * Every action re-verifies the tenant server-side, checks the pack is switched
 * ON, and works inside `withTenant` so RLS is in force — the three things
 * AGENTS.md requires of a pack. `{ role: ctx.role }` is passed through so
 * `app.tenant_role` reflects the actual caller and never more.
 *
 * QUANTITIES ARRIVE IN THE ITEM'S STOCKING UNIT. The form converts from a
 * purchase unit at the edge, because the stocking unit is a storage decision
 * and the boundary is the last place it can still be enforced.
 */

const PACK = "inventory";
const BASE = "/dashboard/m/inventory";

function toResult(err: unknown): { error: string } {
  if (err instanceof InventoryError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change stock records." };
      case "NOT_FOUND":
        return { error: "That no longer exists." };
      case "INVALID_KIND":
        return { error: "Use lowercase letters, numbers and underscores." };
      case "INVALID_UNIT":
        return { error: err.message };
      case "INVALID_SOURCE":
        return { error: "Pick bought, raised here or made here." };
      case "ITEM_INVALID":
        return { error: "That item does not exist." };
      case "LOT_INVALID":
        return { error: err.message };
      case "LOT_CYCLE":
        return { error: err.message };
      case "INVALID_COST":
        return { error: "A cost cannot be negative." };
      case "ZERO_QUANTITY":
        return { error: "Enter a quantity other than zero." };
      case "INSUFFICIENT":
        return { error: err.message };
    }
  }
  console.error("inventory action failed", err);
  return { error: "Something went wrong saving that." };
}

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = requiredDate
  .optional()
  .or(z.literal("").transform(() => undefined));

/** `numeric(18,4)`, enforced here so a value that would be silently rounded is refused. */
const quantity = z.number().finite().multipleOf(0.0001);

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): InventoryCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

// ------------------------------------------------------------------ items ---

const itemSchema = z.object({
  name: z.string().min(1).max(200),
  itemKind: z.string().min(1).max(63).optional(),
  stockingUnit: z.string().min(1).max(32),
  purchaseUnit: z.string().max(32).nullable().optional(),
  purchaseUnitQty: quantity.positive().nullable().optional(),
  storageRequirement: z.string().max(32).nullable().optional(),
  notes: z.string().max(5000).optional(),
});

export async function createItemAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const item = await withTenant(
      ctx.tenant.id,
      (tx) => createItem(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.item.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_item",
      targetId: item.id,
      meta: { kind: item.itemKind, unit: item.stockingUnit },
    });
    revalidatePath(BASE);
    return { ok: true, id: item.id };
  } catch (err) {
    return toResult(err);
  }
}

const updateItemSchema = itemSchema.partial().extend({ id: z.string().uuid() });

export async function updateItemAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = updateItemSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { id, ...patch } = parsed.data;

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => updateItem(tx, ctxOf(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.item.updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_item",
      targetId: id,
      meta: { fields: Object.keys(patch) },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function archiveItemAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => archiveItem(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.item.archived",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_item",
      targetId: parsed.data.id,
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// ------------------------------------------------------------------- lots ---

const lotSchema = z.object({
  itemId: z.string().uuid(),
  code: z.string().min(1).max(120),
  source: z.enum(["purchased", "raised", "produced"]).optional(),
  openedOn: optionalDate.nullable(),
  notes: z.string().max(5000).optional(),
});

export async function createLotAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = lotSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const lot = await withTenant(
      ctx.tenant.id,
      (tx) => createLot(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.lot.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_lot",
      targetId: lot.id,
      meta: { source: lot.source },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: lot.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function closeLotAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => closeLot(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.lot.closed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_lot",
      targetId: parsed.data.id,
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function splitLotAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      lotId: z.string().uuid(),
      quantity: quantity.positive(),
      newCode: z.string().min(1).max(120),
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => splitLot(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.lot.split",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_lot",
      targetId: parsed.data.lotId,
      meta: { childId: result.child.id },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: result.child.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function mergeLotAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      fromLotId: z.string().uuid(),
      intoLotId: z.string().uuid(),
      quantity: quantity.positive(),
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => mergeLot(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.lot.merged",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_lot",
      targetId: parsed.data.fromLotId,
      meta: { intoLotId: parsed.data.intoLotId },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// -------------------------------------------------------------- movements ---

export async function recordMovementAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      lotId: z.string().uuid().nullable().optional(),
      locationAssetId: z.string().uuid().nullable().optional(),
      quantity: quantity,
      movementKind: z.string().min(1).max(63),
      occurredOn: requiredDate,
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const movement = await withTenant(
      ctx.tenant.id,
      (tx) => recordMovement(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.movement.recorded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_item",
      targetId: parsed.data.itemId,
      // Identifiers and shape only — never the note, which is the tenant's words.
      meta: { kind: movement.movementKind, occurredOn: movement.occurredOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: movement.id };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Feed in — a delivery, with what it cost.
 *
 * `member`, because unloading a feed truck is a chore. Starting a NEW batch
 * inside it is owner-only and enforced one layer down by `createLot`, which is
 * where the rule belongs: a lot is a cost object.
 */
export async function receiveStockAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      lotId: z.string().uuid().optional(),
      newLotCode: z.string().min(1).max(120).optional(),
      quantity: z.number().positive().max(1_000_000_000),
      // Cents, and an integer: money that arrives as 12.5 cents is money that
      // has already been divided somewhere it should not have been.
      costCents: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => receiveStock(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.stock.received",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_item",
      targetId: parsed.data.itemId,
      meta: {
        quantity: parsed.data.quantity,
        costCents: parsed.data.costCents ?? null,
        lotId: result.lotId,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, lotId: result.lotId };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Feed out, and to which pen.
 *
 * The cost is NOT taken from the caller: it is stamped from the item's average
 * at this moment, inside the transaction. A client that could name the cost of
 * an issue could quietly rewrite what a pen cost.
 */
export async function issueStockAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      lotId: z.string().uuid().nullable().optional(),
      quantity: z.number().positive().max(1_000_000_000),
      issuedToLotId: z.string().uuid().nullable().optional(),
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const movement = await withTenant(
      ctx.tenant.id,
      (tx) => issueStock(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "inventory.stock.issued",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_item",
      targetId: parsed.data.itemId,
      meta: {
        quantity: parsed.data.quantity,
        issuedToLotId: parsed.data.issuedToLotId ?? null,
        costCents: movement.costCents,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, costCents: movement.costCents };
  } catch (err) {
    return toResult(err);
  }
}
