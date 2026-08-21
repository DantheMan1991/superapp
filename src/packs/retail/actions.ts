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
  recordMarketDay,
  removeMarketDay,
  removePrice,
  setPrice,
  updateChannel,
  updateMarketDay,
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
