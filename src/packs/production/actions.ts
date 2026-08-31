"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { toResult } from "./action-errors";
import { todayInTimezone } from "@/lib/timezone";
import {
  addRunCarcass,
  addRunInput,
  addRunOutput,
  completeRun,
  removeRunCarcass,
  removeRunOutput,
  startRun,
  updateRunCarcass,
  updateRunOutput,
  type ProductionCtx,
} from "./ops";

/**
 * Production's write surface.
 *
 * `requireModuleEnabled` checks PRODUCTION and only production, even though
 * every action here writes through `inventory` and some of them through
 * `livestock`'s handler. That is the rule — the guard is the owning feature
 * (extension-model §4b) — and the dependency graph is what guarantees
 * `inventory` is on. `livestock` is deliberately NOT guaranteed and deliberately
 * not checked: a run that meets no animals never asks it anything.
 */

const PACK = "production";
const BASE = "/dashboard/m/production";

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const quantity = z.number().positive().max(100_000_000).multipleOf(0.0001);
const weight = z
  .number()
  .positive()
  .max(100_000_000)
  .multipleOf(0.0001)
  .nullable()
  .optional();

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): ProductionCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

export async function startRunAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      code: z.string().trim().min(1).max(120),
      runKind: z.string().min(1).max(63).optional(),
      startedOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
      /**
       * THE PROCESSING PATH. Null is on-farm and is a real answer, not a
       * missing one — see the column comment. Until this it could only arrive
       * from a booking, which left a run started any other way unable to carry
       * a cut sheet or a processing fee.
       */
      processorId: z.string().uuid().nullable().optional(),
      /**
       * **THE OVERRIDE, AND ONLY THE OVERRIDE.** A run's line of business is
       * normally derived from the batches that went into it, so this is left
       * null on nearly every run — see `enterpriseForRun`. It is here because
       * the derivation cannot settle a mixed one, and until this the column
       * slice 2 added could not be set from anywhere at all.
       */
      enterpriseId: z.string().uuid().nullable().optional(),
      performedBy: z.string().max(200).optional(),
      crewSize: z.number().int().positive().max(1000).nullable().optional(),
      labourHours: z
        .number()
        .positive()
        .max(100_000)
        .multipleOf(0.01)
        .nullable()
        .optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const run = await withTenant(
      ctx.tenant.id,
      (tx) => startRun(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.run.started",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_run",
      targetId: run.id,
      // The path goes in the log: it decides what the meat may be sold as, and
      // it is stamped onto every output's batch at completion.
      meta: {
        code: run.code,
        runKind: run.runKind,
        startedOn: run.startedOn,
        processorId: run.processorId,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, runId: run.id };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Put something into a run.
 *
 * **THIS IS THE ACTION THE WITHDRAWAL CLOCK REFUSES**, and the audit entry
 * matters for the same reason the treatment ones do: it is the record of what
 * left a pen on which day, and it is what a processor's paperwork has to agree
 * with.
 */
export async function addRunInputAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      runId: z.string().uuid(),
      itemId: z.string().uuid(),
      lotId: z.string().uuid(),
      quantity,
      weightLb: weight,
      occurredOn: requiredDate,
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const today = todayInTimezone(ctx.tenant.timezone);
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => addRunInput(tx, ctxOf(ctx), parsed.data, today),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.run.input_added",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_run",
      targetId: parsed.data.runId,
      // Identifiers and quantities, never the notes — those are free text about
      // an animal and belong only in the row.
      meta: {
        lotId: parsed.data.lotId,
        quantity: parsed.data.quantity,
        weightLb: parsed.data.weightLb ?? null,
        occurredOn: parsed.data.occurredOn,
      },
    });
    revalidatePath(BASE, "layout");
    // Stock left a shelf, and on a farm it left a pen as well.
    revalidatePath("/dashboard/m/inventory", "layout");
    revalidatePath("/dashboard/m/livestock", "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function addRunOutputAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      runId: z.string().uuid(),
      // Exactly one of these. `addRunOutput` enforces it rather than a Zod
      // union, so the rule has one home and the ops layer cannot be called past
      // it — the same arrangement `createLivestockLotAction` uses.
      itemId: z.string().uuid().optional(),
      newItemName: z.string().min(1).max(200).optional(),
      newItemUnit: z.string().min(1).max(63).optional(),
      newItemKind: z.string().min(1).max(63).optional(),
      quantity,
      weightLb: weight,
      lotCode: z.string().max(120).optional(),
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => addRunOutput(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateRunOutputAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      quantity: quantity.optional(),
      weightLb: weight,
      lotCode: z.string().max(120).optional(),
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => updateRunOutput(tx, ctxOf(ctx), id, patch),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeRunOutputAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => removeRunOutput(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * The kill sheet's write surface.
 *
 * **ALL THREE ARE AUDITED, INCLUDING THE EDITS, and outputs are not.** The
 * difference is what the row says. An output is a box of meat and the ledger is
 * its record; a carcass line is a statement about whether an animal was fit to
 * sell, made by a licensed plant and transcribed here. Removing one, or editing
 * a condemnation back to a pass, erases that statement — so the fact that
 * somebody did it is worth keeping even though the row is not.
 *
 * `disposition` goes in the meta and the reason does NOT: the cause is free text
 * off somebody else's paperwork, and the audit log takes identifiers, never
 * prose.
 */
const carcassFields = {
  tag: z.string().max(120).optional(),
  headCount: z.number().int().positive().max(1_000_000).optional(),
  liveLb: weight,
  hangingLb: weight,
  condemned: z.boolean().optional(),
  condemnReason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
};

export async function addRunCarcassAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      runId: z.string().uuid(),
      runInputId: z.string().uuid(),
      ...carcassFields,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => addRunCarcass(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.carcass.recorded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_run",
      targetId: parsed.data.runId,
      meta: {
        carcassId: row.id,
        runInputId: parsed.data.runInputId,
        headCount: row.headCount,
        disposition: row.disposition,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateRunCarcassAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ id: z.string().uuid(), ...carcassFields })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => updateRunCarcass(tx, ctxOf(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.carcass.corrected",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_run",
      targetId: row.runId,
      meta: {
        carcassId: row.id,
        headCount: row.headCount,
        disposition: row.disposition,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeRunCarcassAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const row = await withTenant(
      ctx.tenant.id,
      (tx) => removeRunCarcass(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.carcass.removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_run",
      targetId: row.runId,
      meta: {
        carcassId: row.id,
        headCount: row.headCount,
        disposition: row.disposition,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Finish the run and land everything.
 *
 * The result carries the numbers back so the toast can say what actually
 * happened — how it was split, and how much money went onto the shelf. A screen
 * that says "Saved" after the act that decides what a pound of pork chop cost is
 * the mistake `inventory` corrected on the page that never mentioned money.
 */
export async function completeRunAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      runId: z.string().uuid(),
      completedOn: requiredDate,
      /**
       * What the plant charged, in DOLLARS from the form. Absent and null both
       * mean nobody said — which is not zero, and the difference is the whole
       * reason this is nullable rather than defaulted.
       */
      processingFee: z
        .number()
        .min(0)
        .max(10_000_000)
        .multipleOf(0.01)
        .nullable()
        .optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const feeCents =
    parsed.data.processingFee === null ||
    parsed.data.processingFee === undefined
      ? null
      : Math.round(parsed.data.processingFee * 100);

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) =>
        completeRun(
          tx,
          ctxOf(ctx),
          parsed.data.runId,
          parsed.data.completedOn,
          feeCents,
        ),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.run.completed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_run",
      targetId: parsed.data.runId,
      meta: {
        completedOn: parsed.data.completedOn,
        costBasis: result.basis,
        potCents: result.potCents,
        // What the plant's share of that pot was. It reaches the ledger, so it
        // belongs in the log beside the pot it went into.
        processingFeeCents: result.processingFeeCents,
        landed: result.landed,
        unpricedInputs: result.unpricedInputs,
      },
    });
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/inventory", "layout");
    return {
      ok: true,
      basis: result.basis,
      potCents: result.potCents,
      processingFeeCents: result.processingFeeCents,
      landed: result.landed,
      unpricedInputs: result.unpricedInputs,
    };
  } catch (err) {
    return toResult(err);
  }
}
