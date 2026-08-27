"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { LedgerError, friendlyMessage } from "@/modules/accounting/core";
import { allowsWrite } from "@/lib/packs/authorize";
import { friendlyMessage as friendlyDocsMessage } from "@/modules/documents/core/errors";
import {
  detachDocumentFromRecord,
  registerAttachedPhoto,
  setPrimaryAttachment,
} from "@/modules/documents/attachments";
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
  // Photos are Documents' rows, so its refusals arrive here already written
  // for a person — "Only a photo can be the picture", not a code.
  if (err instanceof Error && err.name === "DocsError") {
    return { error: friendlyDocsMessage(err) };
  }
  console.error("assets action failed", err);
  return { error: "Something went wrong saving that." };
}

/**
 * Photos of a thing the business owns. Livestock slice 4b's Layer 0 half,
 * arriving here at the same time because `assets` has carried the identical
 * open item since 2026-08-15 — the founder asked for a picture per asset then.
 *
 * **THE PACK OWNS THESE ACTIONS AND CORE OWNS THE TABLE**, which is the whole
 * shape of the seam: `document_attachments` is polymorphic and names no pack, so
 * the code that DOES name one is here, where `assets` is a fact rather than a
 * string the browser sent.
 *
 * **AND BECAUSE THERE IS NO FOREIGN KEY, THIS IS THE ONLY THING THAT PROVES THE
 * ASSET EXISTS.** A polymorphic reference cannot be policed by Postgres — the
 * trade the schema comment sets out — so `assertAsset` is the compensating
 * control, not a nicety. Without it a photo could be hung on any UUID at all,
 * including one belonging to another tenant's record, and nothing would object.
 */
const PHOTO_ENTITY = "asset";

const photoTarget = (assetId: string) => ({
  extensionSlug: PACK,
  entityType: PHOTO_ENTITY,
  entityId: assetId,
});

const photoInput = z.object({
  entityId: z.string().uuid(),
  pathname: z.string().min(1).max(500),
});

const photoRef = z.object({
  entityId: z.string().uuid(),
  documentId: z.string().uuid(),
});

/**
 * Both modules, both gates. `assets` because the record is this pack's, and
 * `documents` because the FILE is the DMS's — a business that has not switched
 * Documents on has nowhere to put a photo, and the page says so rather than
 * offering a button that fails.
 */
async function photoGate() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  await requireModuleEnabled(ctx.tenant.id, "documents");
  // Photographing a tractor is a chore — `member` — even though EDITING the
  // asset is owner-only: a picture is a record of what is there, not a
  // decision about what the business owns or what it is worth. The accountant role is read-only everywhere.
  if (!allowsWrite(ctx.role, "member")) {
    throw new AssetError("FORBIDDEN", "cannot write here");
  }
  return ctx;
}

async function assertAsset(
  ctx: Awaited<ReturnType<typeof requireTenant>>,
  assetId: string,
): Promise<void> {
  const asset = await withTenant(
    ctx.tenant.id,
    (tx) => getAsset(tx, ctx.tenant.id, assetId),
    { role: ctx.role },
  );
  if (!asset) throw new AssetError("NOT_FOUND", `asset ${assetId}`);
}

export async function attachAssetPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoInput.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    await assertAsset(ctx, parsed.data.entityId);

    const result = await registerAttachedPhoto(
      { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
      {
        pathname: parsed.data.pathname,
        target: photoTarget(parsed.data.entityId),
      },
    );
    revalidatePath("/dashboard/m/assets");
    return { ok: true as const, documentId: result.documentId };
  } catch (err) {
    return toResult(err);
  }
}

export async function setAssetPhotoPrimaryAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    await assertAsset(ctx, parsed.data.entityId);

    await withTenant(
      ctx.tenant.id,
      (tx) =>
        setPrimaryAttachment(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId },
          {
            documentId: parsed.data.documentId,
            target: photoTarget(parsed.data.entityId),
          },
        ),
      { role: ctx.role },
    );
    revalidatePath("/dashboard/m/assets");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function detachAssetPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    await assertAsset(ctx, parsed.data.entityId);

    await withTenant(
      ctx.tenant.id,
      (tx) =>
        detachDocumentFromRecord(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId },
          {
            documentId: parsed.data.documentId,
            target: photoTarget(parsed.data.entityId),
          },
        ),
      { role: ctx.role },
    );
    // The FILE is untouched and stays in the cabinet. Removing a photo from an
    // asset and deleting a photo are different acts.
    revalidatePath("/dashboard/m/assets");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
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
  /**
   * Which fixed-asset account already carries this asset's cost.
   *
   * MISSING FROM THIS SCHEMA UNTIL 2026-08-18, and zod strips what it does not
   * declare — so the Edit dialog's "Cost sits in" picker sent the value, the
   * boundary dropped it silently, and `updateAsset` (which handles it
   * perfectly) never saw it. The field could not be set from the UI at all.
   *
   * That is the explanation for the anomaly this dossier recorded on
   * 2026-08-15: an asset with 6,706.78 of accumulated depreciation against a
   * cost sitting on no account. It was not a nullable column nobody had filled
   * in; it was a column nobody COULD fill in.
   */
  assetAccountId: z.string().uuid().nullable().optional(),
  /** A place things are kept — `inventory` reads this for its location picker. */
  isStorageLocation: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
  inServiceOn: optionalDate.nullable(),
  depreciationMethod: z.enum(["none", "straight_line"]).optional(),
  // 1 to 100 years. The upper bound is a typo guard, not a policy — nothing
  // a small business owns is written down over more than a century.
  usefulLifeMonths: z.number().int().min(1).max(1200).nullable().optional(),
  salvageValueCents: z.number().int().min(0).nullable().optional(),
})
  /**
   * STRICT, so the next dropped field is a refusal rather than a silence.
   *
   * Zod's default is to strip unknown keys, which is what let "Cost sits in"
   * fail quietly for days: the form was right, the ops layer was right, and the
   * value evaporated in between with nothing to grep for. A rejected payload
   * says "Check the details and try again" — unhelpful, but it says SOMETHING,
   * and it fails on the first click rather than on a balance sheet months
   * later.
   */
  .strict();

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
