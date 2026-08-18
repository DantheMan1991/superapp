"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { LedgerError, friendlyMessage } from "@/modules/accounting/core";
import {
  AssetError,
  createAsset,
  disposeAsset,
  getAsset,
  updateAsset,
  type AssetCtx,
} from "./ops";
import {
  postAllDepreciation,
  postDepreciation,
  postDisposal,
} from "./depreciation-ops";
import { todayInTimezone } from "@/lib/timezone";
import {
  createSchedule,
  raiseDueMaintenance,
  recordMeterReading,
  recordService,
} from "./maintenance-ops";

/**
 * This pack's Layer 3 tailoring, from `tenant_modules.config`.
 *
 * Read under the tenant's own context like everything else here. Returns
 * `undefined` rather than throwing when the row is missing — a tenant that has
 * never configured anything is the ordinary case, not an error.
 */
async function readPackConfig(tx: Tx, tenantId: string): Promise<unknown> {
  const row = await tx.query.tenantModules.findFirst({
    where: and(
      eq(schema.tenantModules.tenantId, tenantId),
      eq(schema.tenantModules.moduleId, "assets"),
    ),
    columns: { config: true },
  });
  return row?.config;
}

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
      case "NOT_DEPRECIABLE":
        return { error: "Set a method, in-service date, life and cost first." };
      case "DEPRECIATION_ACCOUNTS":
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
  model: z.string().max(200).optional(),
  acquiredOn: optionalDate,
  // Cents, so the ledger and this agree without a float ever existing.
  acquisitionCostCents: z.number().int().min(0).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  /**
   * Which company's books (ADR 0010). Absent or null means the tenant's
   * default, resolved by `createAsset` — a single-company tenant has no picker
   * to send one from. The composite FK refuses another tenant's company.
   */
  entityId: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).optional(),
  inServiceOn: optionalDate.nullable(),
  depreciationMethod: z.enum(["none", "straight_line"]).optional(),
  // 1 to 100 years. The upper bound is a typo guard, not a policy — nothing
  // a small business owns is written down over more than a century.
  usefulLifeMonths: z.number().int().min(1).max(1200).nullable().optional(),
  salvageValueCents: z.number().int().min(0).nullable().optional(),
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

const postDepreciationSchema = z.object({
  id: z.string().uuid(),
  /** `YYYY-MM`. Everything due up to and including this month gets posted. */
  through: z.string().regex(/^\d{4}-\d{2}$/),
});

/**
 * Post every depreciation period that is due, up to a month.
 *
 * Deliberately a manual action rather than a cron. Depreciation lands in a
 * period that a close can lock, and posting into someone's books on a schedule
 * they did not trigger is the kind of surprise an accountant should never get.
 * `postEntry` refuses a closed period anyway, and that refusal is surfaced.
 */
export async function postDepreciationAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = postDepreciationSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick a month to post through." };

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const asset = await getAsset(tx, ctx.tenant.id, parsed.data.id);
        if (!asset) throw new AssetError("NOT_FOUND", "asset not found");
        const config = await readPackConfig(tx, ctx.tenant.id);
        return postDepreciation(
          tx,
          assetCtx,
          asset,
          parsed.data.through,
          config,
        );
      },
      { role: ctx.role },
    );

    if (result.postedPeriods.length > 0) {
      await logAudit({
        action: "asset.depreciation_posted",
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        targetType: "asset",
        targetId: parsed.data.id,
        meta: {
          periods: result.postedPeriods,
          totalCents: result.totalCents,
        },
      });
    }
    revalidatePath(`/dashboard/m/assets/${parsed.data.id}`);
    revalidatePath("/dashboard/m/assets");
    return { ok: true, ...result };
  } catch (err) {
    // A closed period is a legitimate refusal from the ledger, not a bug —
    // say so in the ledger's own words rather than "something went wrong".
    if (err instanceof LedgerError) return { error: friendlyMessage(err) };
    return toResult(err);
  }
}

const postAllSchema = z.object({
  through: z.string().regex(/^\d{4}-\d{2}$/),
});

/**
 * Post depreciation for every depreciable asset at once.
 *
 * At three assets the per-asset button is fine. At a hundred it is a chore, and
 * month-end is exactly when nobody has an hour to spend clicking.
 */
export async function postAllDepreciationAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = postAllSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick a month to post through." };

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const config = await readPackConfig(tx, ctx.tenant.id);
        return postAllDepreciation(tx, assetCtx, parsed.data.through, config);
      },
      { role: ctx.role },
    );

    if (result.assetsPosted > 0) {
      await logAudit({
        action: "asset.depreciation_posted_bulk",
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        targetType: "asset",
        targetId: parsed.data.through,
        meta: {
          assets: result.assetsPosted,
          periods: result.periodsPosted,
          totalCents: result.totalCents,
          caughtUp: result.caughtUpCount,
        },
      });
    }
    revalidatePath("/dashboard/m/assets");
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof LedgerError) return { error: friendlyMessage(err) };
    return toResult(err);
  }
}

const disposeSchema = z.object({
  id: z.string().uuid(),
  disposedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proceedsCents: z.number().int().min(0).default(0),
  proceedsAccountId: z.string().uuid().nullable().optional(),
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
    // The status change and the journal entry are ONE transaction. A disposed
    // asset whose cost is still on the balance sheet, or a settled balance
    // sheet with an asset still marked active, are both states nobody can
    // reason about — and the second is the one that gets found in an audit.
    const posting = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const asset = await getAsset(tx, ctx.tenant.id, parsed.data.id);
        if (!asset) throw new AssetError("NOT_FOUND", "asset not found");
        const config = await readPackConfig(tx, ctx.tenant.id);
        const result = await postDisposal(
          tx,
          assetCtx,
          asset,
          {
            disposedOn: parsed.data.disposedOn,
            proceedsCents: parsed.data.proceedsCents,
            proceedsAccountId: parsed.data.proceedsAccountId ?? null,
          },
          config,
        );
        await disposeAsset(tx, assetCtx, parsed.data.id, parsed.data.disposedOn);
        return result;
      },
      { role: ctx.role },
    );

    await logAudit({
      action: "asset.disposed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "asset",
      targetId: parsed.data.id,
      meta: {
        disposedOn: parsed.data.disposedOn,
        proceedsCents: parsed.data.proceedsCents,
        settled: posting.posted,
        ...(posting.posted
          ? { gainCents: posting.gainCents }
          : { notSettled: posting.reason }),
      },
    });
    revalidatePath(`/dashboard/m/assets/${parsed.data.id}`);
    revalidatePath("/dashboard/m/assets");
    return { ok: true, ...posting };
  } catch (err) {
    if (err instanceof LedgerError) return { error: friendlyMessage(err) };
    return toResult(err);
  }
}

/* ------------------------------------------------------------------------
 * Maintenance.
 *
 * Raising work is a BUTTON, not a cron — the same call depreciation makes and
 * for a related reason: a work item lands on somebody's list, and putting one
 * there on a schedule nobody triggered is how a to-do list stops being trusted.
 * ---------------------------------------------------------------------- */

const scheduleSchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().min(1).max(200),
  kind: z.enum(["calendar", "meter"]),
  intervalMonths: z.number().int().min(1).max(600).nullable().optional(),
  intervalMeter: z.number().int().min(1).max(1_000_000).nullable().optional(),
  meterUnit: z.string().max(20).optional(),
});

export async function addMaintenanceScheduleAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the schedule details." };
  const { assetId, ...spec } = parsed.data;

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => createSchedule(tx, assetCtx, assetId, spec),
      { role: ctx.role },
    );
    revalidatePath(`/dashboard/m/assets/${assetId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

const readingSchema = z.object({
  assetId: z.string().uuid(),
  readOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reading: z.number().int().min(0),
  unit: z.string().max(20).optional(),
});

export async function recordMeterReadingAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = readingSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a whole number." };

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        recordMeterReading(tx, assetCtx, parsed.data.assetId, {
          readOn: parsed.data.readOn,
          reading: parsed.data.reading,
          unit: parsed.data.unit,
        }),
      { role: ctx.role },
    );
    revalidatePath(`/dashboard/m/assets/${parsed.data.assetId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

const serviceSchema = z.object({
  assetId: z.string().uuid(),
  scheduleId: z.string().uuid().nullable().optional(),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meterReading: z.number().int().min(0).nullable().optional(),
  description: z.string().max(2000).optional(),
});

export async function recordServiceAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the service details." };

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        recordService(tx, assetCtx, parsed.data.assetId, {
          scheduleId: parsed.data.scheduleId ?? null,
          performedOn: parsed.data.performedOn,
          meterReading: parsed.data.meterReading ?? null,
          description: parsed.data.description,
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "asset.service_recorded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "asset",
      targetId: parsed.data.assetId,
      meta: { performedOn: parsed.data.performedOn },
    });
    revalidatePath(`/dashboard/m/assets/${parsed.data.assetId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

const raiseSchema = z.object({ assetId: z.string().uuid() });

export async function raiseMaintenanceWorkAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = raiseSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not raise that." };

  const assetCtx: AssetCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };
  const today = todayInTimezone(ctx.tenant.timezone);
  try {
    const result = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const asset = await getAsset(tx, ctx.tenant.id, parsed.data.assetId);
        if (!asset) throw new AssetError("NOT_FOUND", "asset not found");
        return raiseDueMaintenance(tx, assetCtx, asset, today);
      },
      { role: ctx.role },
    );
    if (result.raised.length > 0) {
      await logAudit({
        action: "asset.maintenance_raised",
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        targetType: "asset",
        targetId: parsed.data.assetId,
        meta: { count: result.raised.length },
      });
    }
    revalidatePath(`/dashboard/m/assets/${parsed.data.assetId}`);
    return { ok: true, raised: result.raised.length };
  } catch (err) {
    return toResult(err);
  }
}
