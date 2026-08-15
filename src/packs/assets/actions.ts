"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import {
  AssetError,
  createAsset,
  disposeAsset,
  updateAsset,
  type AssetCtx,
} from "./ops";

/**
 * Asset write surface.
 *
 * Every action does the three things AGENTS.md requires of a pack: it
 * re-verifies the tenant server-side, checks the pack is switched ON for that
 * tenant, and does its work inside `withTenant` so RLS is in force. The third
 * is not belt-and-braces — `withSystem` would bypass the policy entirely, and
 * a pack has no business running as the god view.
 *
 * `{ role: ctx.role }` is passed through so `app.tenant_role` reflects the
 * actual caller. It defaults to `staff`, the least privileged value, and must
 * never be handed a role that did not come from `requireTenant()`.
 */

const PACK = "assets";

/** Turn a thrown AssetError into the flat shape every form here returns. */
function toResult(err: unknown): { error: string } {
  if (err instanceof AssetError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change what the business owns." };
      case "NOT_FOUND":
        return { error: "That asset no longer exists." };
      case "INVALID_KIND":
        return {
          error: "A kind must be lowercase letters, numbers and underscores.",
        };
      case "PARENT_INVALID":
        return { error: "That container does not exist." };
      case "PARENT_CYCLE":
        return { error: err.message };
    }
  }
  console.error("assets action failed", err);
  return { error: "Something went wrong saving that." };
}

/** Empty string from a form field means "not set", not an empty value. */
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

const createSchema = z.object({
  kind: z.string().min(1).max(63),
  name: z.string().min(1).max(200),
  identifier: z.string().max(200).optional(),
  acquiredOn: optionalDate,
  // Cents, so the ledger and this agree without a float ever existing.
  acquisitionCostCents: z.number().int().min(0).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).optional(),
});

export async function createAssetAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  try {
    const asset = await withTenant(
      ctx.tenant.id,
      (tx) => createAsset(tx, assetCtx, parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "asset.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "asset",
      targetId: asset.id,
      meta: { kind: asset.kind },
    });
    revalidatePath("/dashboard/m/assets");
    return { ok: true, id: asset.id };
  } catch (err) {
    return toResult(err);
  }
}

const updateSchema = createSchema.partial().extend({
  id: z.string().uuid(),
});

export async function updateAssetAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { id, ...patch } = parsed.data;

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => updateAsset(tx, assetCtx, id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "asset.updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "asset",
      targetId: id,
      meta: { fields: Object.keys(patch) },
    });
    revalidatePath("/dashboard/m/assets");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

const disposeSchema = z.object({
  id: z.string().uuid(),
  disposedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function disposeAssetAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = disposeSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick a disposal date." };

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => disposeAsset(tx, assetCtx, parsed.data.id, parsed.data.disposedOn),
      { role: ctx.role },
    );
    await logAudit({
      action: "asset.disposed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "asset",
      targetId: parsed.data.id,
      meta: { disposedOn: parsed.data.disposedOn },
    });
    revalidatePath("/dashboard/m/assets");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
