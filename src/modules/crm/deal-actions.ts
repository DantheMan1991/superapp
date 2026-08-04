"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { parseMoneyToCents } from "@/lib/money";
import { CrmError, friendlyMessage } from "./core/errors";
import {
  DEAL_TITLE_MAX,
  PIPELINE_NAME_MAX,
  STAGE_NAME_MAX,
} from "./core/pipeline";
import type { CrmCtx } from "./core/types";
import {
  addDealStakeholder,
  createDeal,
  moveDealStage,
  removeDealStakeholder,
  updateDeal,
} from "./deal-ops";
import {
  createPipeline,
  createStage,
  reorderStages,
  setStageArchived,
  updateStage,
} from "./pipeline-ops";

/**
 * Deal and pipeline actions. Same canonical shape as the rest of the module:
 * gate → Zod → withTenant(core + audit) → revalidate, with `{ role: ctx.role }`
 * on every transaction because deals inherit the party's visibility.
 *
 * A separate file from `actions.ts` only because that one had grown past the
 * point where a reader could find anything in it. Same gate, same rules.
 */

const BASE = "/dashboard/m/crm";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { error: string; issues?: { fieldId: string; label: string; message: string }[] };

async function gate(opts?: { ownerOnly?: boolean }): Promise<CrmCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  if (ctx.role === "expert") {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  if (opts?.ownerOnly && ctx.role !== "owner") {
    throw new CrmError("FORBIDDEN", "owner role required");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string; issues?: CrmError["issues"] } {
  if (err instanceof CrmError) {
    return { error: friendlyMessage(err), ...(err.issues ? { issues: err.issues } : {}) };
  }
  console.error("crm deal action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidateBoard(dealId?: string, partyId?: string): void {
  revalidatePath(`${BASE}/deals`);
  if (dealId) revalidatePath(`${BASE}/deals/${dealId}`);
  if (partyId) revalidatePath(`${BASE}/records/${partyId}`);
}

/**
 * A typed money field, parsed by the one helper that owns cents.
 *
 * `parseMoneyToCents` returns null for anything unparseable, negative, over two
 * decimals or beyond the ceiling — so `null` here means BOTH "left blank" and
 * "not a number", and the empty-string case is separated out first to keep
 * those apart.
 */
const amountField = z
  .string()
  .max(30)
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw.trim() === "") return null;
    const cents = parseMoneyToCents(raw);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 1234.56" });
      return z.NEVER;
    }
    return cents;
  });

/* -- Deals ---------------------------------------------------------------- */

const createDealSchema = z.object({
  partyId: z.string().uuid(),
  title: z.string().min(1).max(DEAL_TITLE_MAX),
  pipelineId: z.string().uuid().optional(),
  amount: amountField,
  expectedCloseOn: z.string().date().nullable().optional(),
  primaryContactPartyId: z.string().uuid().nullable().optional(),
  ownerClerkUserId: z.string().max(120).nullable().optional(),
  custom: z.record(z.string().uuid(), z.unknown()).optional(),
});

export async function createDealAction(
  input: z.infer<typeof createDealSchema>,
): Promise<ActionResult<{ dealId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createDealSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const { amount, ...rest } = parsed.data;

    const dealId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const deal = await createDeal(tx, ctx, { ...rest, amountCents: amount });
        await logAuditInTx(tx, {
          action: "crm.deal_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_deal",
          targetId: deal.id,
          // No amount and no title: one is a balance, the other is a client's
          // own words. Identifiers and coarse metadata only (S9).
          meta: { pipelineId: deal.pipelineId, valued: deal.amountCents !== null },
        });
        return deal.id;
      },
      { role: ctx.role },
    );

    revalidateBoard(dealId, parsed.data.partyId);
    return { ok: true, data: { dealId } };
  } catch (err) {
    return fail(err);
  }
}

const updateDealSchema = z.object({
  dealId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  partyId: z.string().uuid(),
  title: z.string().min(1).max(DEAL_TITLE_MAX).optional(),
  amount: amountField,
  expectedCloseOn: z.string().date().nullable().optional(),
  primaryContactPartyId: z.string().uuid().nullable().optional(),
  ownerClerkUserId: z.string().max(120).nullable().optional(),
  custom: z.record(z.string().uuid(), z.unknown()).optional(),
});

export async function updateDealAction(
  input: z.infer<typeof updateDealSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateDealSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const { dealId, expectedVersion, partyId, amount, ...patch } = parsed.data;

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await updateDeal(tx, ctx, {
          dealId,
          expectedVersion,
          patch: { ...patch, amountCents: amount },
        });
        await logAuditInTx(tx, {
          action: "crm.deal_updated",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_deal",
          targetId: dealId,
          meta: { fields: Object.keys(patch).sort() },
        });
      },
      { role: ctx.role },
    );

    revalidateBoard(dealId, partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const moveSchema = z.object({
  dealId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  toStageId: z.string().uuid(),
  partyId: z.string().uuid().optional(),
});

/** The ONLY action that changes a deal's stage — see deal-ops.ts. */
export async function moveDealStageAction(
  input: z.infer<typeof moveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const deal = await moveDealStage(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "crm.deal_stage_moved",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_deal",
          targetId: parsed.data.dealId,
          meta: { toStageId: parsed.data.toStageId, closed: deal.closedAt !== null },
        });
      },
      { role: ctx.role },
    );

    revalidateBoard(parsed.data.dealId, parsed.data.partyId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const stakeholderSchema = z.object({
  dealId: z.string().uuid(),
  partyId: z.string().uuid(),
  role: z.string().max(80).optional(),
});

export async function addDealStakeholderAction(
  input: z.infer<typeof stakeholderSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = stakeholderSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(ctx.tenantId, (tx) => addDealStakeholder(tx, ctx, parsed.data), {
      role: ctx.role,
    });

    revalidateBoard(parsed.data.dealId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const removeStakeholderSchema = z.object({
  dealPartyId: z.string().uuid(),
  dealId: z.string().uuid(),
});

export async function removeDealStakeholderAction(
  input: z.infer<typeof removeStakeholderSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = removeStakeholderSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => removeDealStakeholder(tx, ctx, parsed.data),
      { role: ctx.role },
    );

    revalidateBoard(parsed.data.dealId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- Pipelines and stages (owner-only) ------------------------------------ */

const createPipelineSchema = z.object({
  name: z.string().min(1).max(PIPELINE_NAME_MAX),
});

export async function createPipelineAction(
  input: z.infer<typeof createPipelineSchema>,
): Promise<ActionResult<{ pipelineId: string }>> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = createPipelineSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const pipelineId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const { pipeline } = await createPipeline(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "crm.pipeline_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "crm_pipeline",
          targetId: pipeline.id,
          meta: {},
        });
        return pipeline.id;
      },
      { role: ctx.role },
    );

    revalidatePath(`${BASE}/pipelines`);
    revalidateBoard();
    return { ok: true, data: { pipelineId } };
  } catch (err) {
    return fail(err);
  }
}

const createStageSchema = z.object({
  pipelineId: z.string().uuid(),
  name: z.string().min(1).max(STAGE_NAME_MAX),
  probability: z.number().int().min(0).max(100).optional(),
  outcome: z.enum(["open", "won", "lost"]).optional(),
});

export async function createStageAction(
  input: z.infer<typeof createStageSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = createStageSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(ctx.tenantId, (tx) => createStage(tx, ctx, parsed.data), {
      role: ctx.role,
    });

    revalidatePath(`${BASE}/pipelines`);
    revalidateBoard();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const updateStageSchema = z.object({
  stageId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  name: z.string().min(1).max(STAGE_NAME_MAX).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  outcome: z.enum(["open", "won", "lost"]).optional(),
});

export async function updateStageAction(
  input: z.infer<typeof updateStageSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = updateStageSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { stageId, expectedVersion, ...patch } = parsed.data;

    await withTenant(
      ctx.tenantId,
      (tx) => updateStage(tx, ctx, { stageId, expectedVersion, patch }),
      { role: ctx.role },
    );

    revalidatePath(`${BASE}/pipelines`);
    revalidateBoard();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const archiveStageSchema = z.object({
  stageId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  archived: z.boolean(),
});

export async function setStageArchivedAction(
  input: z.infer<typeof archiveStageSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = archiveStageSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(ctx.tenantId, (tx) => setStageArchived(tx, ctx, parsed.data), {
      role: ctx.role,
    });

    revalidatePath(`${BASE}/pipelines`);
    revalidateBoard();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const reorderStagesSchema = z.object({
  stageIds: z.array(z.string().uuid()).max(100),
});

export async function reorderStagesAction(
  input: z.infer<typeof reorderStagesSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate({ ownerOnly: true });
    const parsed = reorderStagesSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(ctx.tenantId, (tx) => reorderStages(tx, ctx, parsed.data.stageIds), {
      role: ctx.role,
    });

    revalidatePath(`${BASE}/pipelines`);
    revalidateBoard();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
