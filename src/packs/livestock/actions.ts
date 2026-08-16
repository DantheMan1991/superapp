"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import {
  LivestockError,
  addIdentifier,
  createLivestockLot,
  moveLotToZone,
  placeHead,
  removeHead,
  retireIdentifier,
  splitLivestockLot,
  type LivestockCtx,
} from "./ops";

/**
 * Livestock write surface.
 *
 * `requireModuleEnabled` checks LIVESTOCK, and only livestock — even though
 * every action here also writes through `inventory` and some through `land`.
 * That is correct: the guard is the owning feature (extension-model §4b), and
 * the dependency graph is what guarantees the others are switched on. A pack
 * cannot be enabled with a requirement missing, so re-checking them here would
 * be belt on top of a belt.
 */

const PACK = "livestock";
const BASE = "/dashboard/m/livestock";

function toResult(err: unknown): { error: string } {
  if (err instanceof LivestockError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change animal records." };
      case "NOT_FOUND":
        return { error: "That no longer exists." };
      case "INVALID_SPECIES":
        return { error: "Use lowercase letters, numbers and underscores." };
      case "INVALID_SEX":
        return { error: "Pick male, female or mixed." };
      case "INVALID_IDENTIFIER":
        return { error: "A tag kind must be lowercase letters and underscores." };
      case "LOT_INVALID":
        return { error: err.message };
    }
  }
  // Errors thrown by the packs this one composes reach here too, and their
  // messages are already written for a person.
  if (err instanceof Error && err.name === "InventoryError") {
    return { error: err.message };
  }
  if (err instanceof Error && err.name === "LandError") {
    return { error: err.message };
  }
  console.error("livestock action failed", err);
  return { error: "Something went wrong saving that." };
}

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = requiredDate
  .optional()
  .or(z.literal("").transform(() => undefined));
const head = z.number().positive().max(1_000_000).multipleOf(0.0001);

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): LivestockCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

export async function createLivestockLotAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      code: z.string().min(1).max(120),
      species: z.string().min(1).max(63),
      sex: z.enum(["male", "female", "mixed"]).nullable().optional(),
      breed: z.string().max(200).optional(),
      bornOn: optionalDate.nullable(),
      source: z.enum(["purchased", "raised", "produced"]).optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => createLivestockLot(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.lot.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: result.lot.id,
      meta: { species: result.lot.species, inventoryLotId: result.inventoryLotId },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: result.lot.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function placeHeadAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      inventoryLotId: z.string().uuid(),
      head,
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => placeHead(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.head.placed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_lot",
      targetId: parsed.data.inventoryLotId,
      meta: { occurredOn: parsed.data.occurredOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeHeadAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      inventoryLotId: z.string().uuid(),
      head,
      reason: z.enum(["death", "cull", "sold_live"]),
      occurredOn: requiredDate,
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => removeHead(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.head.removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_lot",
      targetId: parsed.data.inventoryLotId,
      meta: { reason: parsed.data.reason, occurredOn: parsed.data.occurredOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function splitLivestockLotAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      head,
      newCode: z.string().min(1).max(120),
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => splitLivestockLot(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.lot.split",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: { childId: result.lot.id },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: result.lot.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function moveLotToZoneAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      zoneId: z.string().uuid(),
      startedOn: requiredDate,
      endedOn: optionalDate.nullable(),
      areaAcres: z.number().positive().multipleOf(0.0001).nullable().optional(),
      structureAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => moveLotToZone(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.lot.moved",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: { zoneId: parsed.data.zoneId, startedOn: parsed.data.startedOn },
    });
    // Land's pages read this record too, so both trees are revalidated.
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/land", "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function addIdentifierAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      identifierKind: z.string().min(1).max(63),
      value: z.string().min(1).max(200),
      appliedOn: optionalDate.nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const identifier = await withTenant(
      ctx.tenant.id,
      (tx) => addIdentifier(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.identifier.added",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      // The kind, never the value — a tag number identifies an animal and
      // there is no reason for the audit log to carry it.
      meta: { kind: identifier.identifierKind },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function retireIdentifierAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ id: z.string().uuid(), removedOn: requiredDate })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => retireIdentifier(tx, ctxOf(ctx), parsed.data.id, parsed.data.removedOn),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.identifier.retired",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_identifier",
      targetId: parsed.data.id,
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
