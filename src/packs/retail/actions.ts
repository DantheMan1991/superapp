"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import {
  RetailError,
  createChannel,
  moveStockToTruck,
  recordMarketDay,
  recordSale,
  recordStockout,
  removeMarketDay,
  removePrice,
  removeStockout,
  returnStockFromTruck,
  setPrice,
  updateChannel,
  updateMarketDay,
  voidSale,
  type RetailCtx,
} from "./ops";

/**
 * Retail's write surface.
 *
 * `requireModuleEnabled` checks RETAIL and only retail, even though every price
 * points at an `inventory` item. That is the rule — the guard is the owning
 * feature (extension-model §4b) — and the dependency graph is what guarantees
 * `inventory` is switched on.
 */

const PACK = "retail";
const BASE = "/dashboard/m/retail";

function toResult(err: unknown): { error: string } {
  if (err instanceof RetailError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change channels or prices." };
      case "NOT_FOUND":
        return { error: "That no longer exists." };
      case "INVALID_KIND":
        return { error: "Use lowercase letters, numbers and underscores." };
      case "INVALID_PRICE":
        return { error: "A price cannot be negative." };
      case "CHANNEL_INVALID":
      case "ITEM_INVALID":
      case "MARKET_DAY_INVALID":
      case "SALE_INVALID":
      case "NO_LINES":
        return { error: err.message };
    }
  }
  if (err instanceof Error && err.name === "InventoryError") {
    return { error: err.message };
  }
  console.error("retail action failed", err);
  return { error: "Something went wrong saving that." };
}

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Integer cents. The boundary is integer-only; dollars are converted in the form. */
const cents = z.number().int().min(0).max(10_000_000_000);

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): RetailCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

export async function createChannelAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(200),
      channelKind: z.string().min(1).max(63).optional(),
      location: z.string().max(300).optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const channel = await withTenant(
      ctx.tenant.id,
      (tx) => createChannel(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true, channelId: channel.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateChannelAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(200).optional(),
      channelKind: z.string().min(1).max(63).optional(),
      location: z.string().max(300).optional(),
      status: z.enum(["active", "closed"]).optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => updateChannel(tx, ctxOf(ctx), id, patch),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Set what an item costs in a channel.
 *
 * **AUDITED, and it is the one write in this pack that has to be.** A price is
 * the number the whole business turns on; who changed it, to what, and from when
 * is exactly the question somebody asks three months later when the margin looks
 * wrong. The audit log renders the move since 2026-08-20.
 */
export async function setPriceAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      channelId: z.string().uuid(),
      itemId: z.string().uuid(),
      priceCents: cents,
      effectiveFrom: requiredDate,
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const price = await withTenant(
      ctx.tenant.id,
      (tx) => setPrice(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "retail.price.set",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "retail_channel",
      targetId: parsed.data.channelId,
      // Identifiers and the figure, never the notes.
      meta: {
        itemId: price.itemId,
        priceCents: price.priceCents,
        effectiveFrom: price.effectiveFrom,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removePriceAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const price = await withTenant(
      ctx.tenant.id,
      (tx) => removePrice(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "retail.price.removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "retail_channel",
      targetId: price.channelId,
      meta: {
        itemId: price.itemId,
        priceCents: price.priceCents,
        effectiveFrom: price.effectiveFrom,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

const marketDayFields = {
  heldOn: requiredDate,
  stallFeeCents: cents.nullable().optional(),
  travelCents: cents.nullable().optional(),
  crewSize: z.number().int().positive().max(1000).nullable().optional(),
  hours: z
    .number()
    .positive()
    .max(100_000)
    .multipleOf(0.01)
    .nullable()
    .optional(),
  openingFloatCents: cents.nullable().optional(),
  cashCountedCents: cents.nullable().optional(),
  weather: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
};

export async function recordMarketDayAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ channelId: z.string().uuid(), ...marketDayFields })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => recordMarketDay(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateMarketDayAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ id: z.string().uuid(), ...marketDayFields })
    .partial({ heldOn: true })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => updateMarketDay(tx, ctxOf(ctx), id, patch),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeMarketDayAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => removeMarketDay(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
// ------------------------------------------------------------- the truck ---

const truckMove = {
  itemId: z.string().uuid(),
  lotId: z.string().uuid().nullable().optional(),
  quantity: z.number().positive().max(100_000_000).multipleOf(0.0001),
  occurredOn: requiredDate,
  notes: z.string().max(2000).optional(),
};

export async function loadTruckAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      ...truckMove,
      truckAssetId: z.string().uuid(),
      fromLocationAssetId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => moveStockToTruck(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    // Stock left a shelf; the item page has to agree.
    revalidatePath("/dashboard/m/inventory", "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function unloadTruckAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      ...truckMove,
      truckAssetId: z.string().uuid(),
      toLocationAssetId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => returnStockFromTruck(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/inventory", "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// ---------------------------------------------------------------- selling ---

/**
 * Take a sale.
 *
 * **SAFE TO CALL TWICE WITH THE SAME `clientRef`, and the client depends on it.**
 * A till that queued a sale at a signal-less market has no way of knowing
 * whether a request that timed out arrived; its only safe move is to send it
 * again, and this returns `alreadyPosted` rather than taking the money twice.
 *
 * The result carries the total back so the screen can show what was rung up —
 * and `alreadyPosted` so a flush can report "5 sent, 1 was already in" instead
 * of silently double-counting its own success.
 */
export async function recordSaleAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      // A uuid from the till. Bounded and format-checked like anything else
      // crossing the boundary — it is client input, however friendly.
      clientRef: z.string().min(8).max(64).nullable().optional(),
      channelId: z.string().uuid(),
      marketDayId: z.string().uuid().nullable().optional(),
      soldAt: z.string().datetime(),
      paymentMethod: z.string().min(1).max(63).optional(),
      locationAssetId: z.string().uuid().nullable().optional(),
      lines: z
        .array(
          z.object({
            itemId: z.string().uuid(),
            lotId: z.string().uuid().nullable().optional(),
            quantity: z.number().positive().max(1_000_000).multipleOf(0.0001),
            unitPriceCents: cents,
          }),
        )
        .min(1)
        .max(200),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) =>
        recordSale(tx, ctxOf(ctx), {
          ...parsed.data,
          soldAt: new Date(parsed.data.soldAt),
        }),
      { role: ctx.role },
    );
    // Only audit what actually happened. A replay wrote nothing and an audit
    // entry claiming otherwise would be the log lying about the ledger.
    if (!result.alreadyPosted) {
      await logAudit({
        action: "retail.sale.recorded",
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        targetType: "retail_channel",
        targetId: parsed.data.channelId,
        meta: {
          saleId: result.sale.id,
          totalCents: result.totalCents,
          lines: result.lines.length,
          paymentMethod: result.sale.paymentMethod,
        },
      });
    }
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/inventory", "layout");
    return {
      ok: true,
      saleId: result.sale.id,
      totalCents: result.totalCents,
      alreadyPosted: result.alreadyPosted,
    };
  } catch (err) {
    return toResult(err);
  }
}

export async function voidSaleAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const sale = await withTenant(
      ctx.tenant.id,
      (tx) => voidSale(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "retail.sale.voided",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "retail_channel",
      targetId: sale.channelId,
      meta: { saleId: sale.id, soldAt: sale.soldAt.toISOString() },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// -------------------------------------------------------------- stockouts ---

export async function recordStockoutAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      marketDayId: z.string().uuid(),
      itemId: z.string().uuid(),
      noticedAt: z.string().datetime(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        recordStockout(tx, ctxOf(ctx), {
          ...parsed.data,
          noticedAt: new Date(parsed.data.noticedAt),
        }),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeStockoutAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => removeStockout(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
