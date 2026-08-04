import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CrmPipeline, CrmPipelineStage, CrmDealOutcome } from "@/db/schema";
import { CrmError } from "./core/errors";
import { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from "./core/pipeline";
import type { CrmCtx } from "./core/types";

/**
 * Pipelines and their stages — configuration, owned by tenant owners.
 *
 * Reading is open to every member because a board cannot draw its columns
 * otherwise; writing is owner-only in RLS (drizzle/0069) and re-checked in the
 * action layer so the message says "you need to be an owner" rather than
 * "nothing happened".
 */

export interface PipelineWithStages {
  pipeline: CrmPipeline;
  stages: CrmPipelineStage[];
}

export async function listPipelines(
  tx: Tx,
  tenantId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<CrmPipeline[]> {
  return tx.query.crmPipelines.findMany({
    where: and(
      eq(schema.crmPipelines.tenantId, tenantId),
      ...(opts.includeArchived ? [] : [isNull(schema.crmPipelines.archivedAt)]),
    ),
    orderBy: [asc(schema.crmPipelines.sortOrder), asc(schema.crmPipelines.name)],
  });
}

export async function listStages(
  tx: Tx,
  tenantId: string,
  pipelineId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<CrmPipelineStage[]> {
  return tx.query.crmPipelineStages.findMany({
    where: and(
      eq(schema.crmPipelineStages.tenantId, tenantId),
      eq(schema.crmPipelineStages.pipelineId, pipelineId),
      ...(opts.includeArchived
        ? []
        : [isNull(schema.crmPipelineStages.archivedAt)]),
    ),
    orderBy: [asc(schema.crmPipelineStages.sortOrder)],
  });
}

/**
 * The tenant's default pipeline with its stages, PROVISIONING ONE IF THERE IS
 * NONE.
 *
 * Lazy rather than provisioned at module-enable time, and the difference
 * matters for tenants who already have CRM switched on: accounting's chart of
 * accounts is created before the module is enabled because a ledger is useless
 * without one, but a CRM is perfectly usable for contacts alone. Making the
 * board create its own pipeline on first visit means slice 3 needs no backfill
 * and no change to `toggleModule`.
 *
 * Idempotent by the partial unique on `is_default` — two concurrent first
 * visits cannot both win, and the loser reads the winner's row.
 */
export async function ensureDefaultPipeline(
  tx: Tx,
  ctx: CrmCtx,
): Promise<PipelineWithStages> {
  const existing = await tx.query.crmPipelines.findFirst({
    where: and(
      eq(schema.crmPipelines.tenantId, ctx.tenantId),
      eq(schema.crmPipelines.isDefault, true),
      isNull(schema.crmPipelines.archivedAt),
    ),
  });
  if (existing) {
    return {
      pipeline: existing,
      stages: await listStages(tx, ctx.tenantId, existing.id),
    };
  }

  // Only an owner can create configuration, and RLS would refuse anyway — but
  // saying so is better than a board that renders empty for staff with no
  // explanation.
  if (ctx.role !== "owner") {
    throw new CrmError(
      "FORBIDDEN",
      "an owner needs to set up the first pipeline",
    );
  }

  const [pipeline] = await tx
    .insert(schema.crmPipelines)
    .values({
      tenantId: ctx.tenantId,
      name: DEFAULT_PIPELINE_NAME,
      isDefault: true,
      sortOrder: 0,
    })
    .returning();

  const stages = await tx
    .insert(schema.crmPipelineStages)
    .values(
      DEFAULT_STAGES.map((s, index) => ({
        tenantId: ctx.tenantId,
        pipelineId: pipeline.id,
        name: s.name,
        sortOrder: index,
        probability: s.probability,
        outcome: s.outcome,
      })),
    )
    .returning();

  return { pipeline, stages: stages.sort((a, b) => a.sortOrder - b.sortOrder) };
}

export async function loadPipeline(
  tx: Tx,
  tenantId: string,
  pipelineId: string,
): Promise<PipelineWithStages> {
  const pipeline = await tx.query.crmPipelines.findFirst({
    where: and(
      eq(schema.crmPipelines.tenantId, tenantId),
      eq(schema.crmPipelines.id, pipelineId),
    ),
  });
  if (!pipeline) {
    throw new CrmError("PIPELINE_NOT_FOUND", `pipeline ${pipelineId} missing`);
  }
  return { pipeline, stages: await listStages(tx, tenantId, pipelineId) };
}

export async function createPipeline(
  tx: Tx,
  ctx: CrmCtx,
  input: { name: string },
): Promise<PipelineWithStages> {
  const [{ next }] = await tx
    .select({
      next: sql<number>`coalesce(max(${schema.crmPipelines.sortOrder}), -1) + 1`,
    })
    .from(schema.crmPipelines)
    .where(eq(schema.crmPipelines.tenantId, ctx.tenantId));

  const [pipeline] = await tx
    .insert(schema.crmPipelines)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      // Never the default. Promoting one is its own deliberate act, and a new
      // pipeline silently stealing the default would move every future deal.
      isDefault: false,
      sortOrder: next,
    })
    .returning();

  const stages = await tx
    .insert(schema.crmPipelineStages)
    .values(
      DEFAULT_STAGES.map((s, index) => ({
        tenantId: ctx.tenantId,
        pipelineId: pipeline.id,
        name: s.name,
        sortOrder: index,
        probability: s.probability,
        outcome: s.outcome,
      })),
    )
    .returning();

  return { pipeline, stages: stages.sort((a, b) => a.sortOrder - b.sortOrder) };
}

export async function createStage(
  tx: Tx,
  ctx: CrmCtx,
  input: {
    pipelineId: string;
    name: string;
    probability?: number;
    outcome?: CrmDealOutcome;
  },
): Promise<CrmPipelineStage> {
  // Confirms the pipeline is this tenant's before anything hangs off it. The
  // composite FK makes a cross-tenant reference impossible anyway; this turns
  // that into a message instead of a constraint error.
  await loadPipeline(tx, ctx.tenantId, input.pipelineId);

  const [{ next }] = await tx
    .select({
      next: sql<number>`coalesce(max(${schema.crmPipelineStages.sortOrder}), -1) + 1`,
    })
    .from(schema.crmPipelineStages)
    .where(
      and(
        eq(schema.crmPipelineStages.tenantId, ctx.tenantId),
        eq(schema.crmPipelineStages.pipelineId, input.pipelineId),
      ),
    );

  const [row] = await tx
    .insert(schema.crmPipelineStages)
    .values({
      tenantId: ctx.tenantId,
      pipelineId: input.pipelineId,
      name: input.name,
      sortOrder: next,
      probability: input.probability ?? 0,
      outcome: input.outcome ?? "open",
    })
    .returning();
  return row;
}

export async function updateStage(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    stageId: string;
    expectedVersion: number;
    patch: { name?: string; probability?: number; outcome?: CrmDealOutcome };
  },
): Promise<CrmPipelineStage> {
  const rows = await tx
    .update(schema.crmPipelineStages)
    .set({
      ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
      ...(args.patch.probability !== undefined
        ? { probability: args.patch.probability }
        : {}),
      ...(args.patch.outcome !== undefined ? { outcome: args.patch.outcome } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmPipelineStages.tenantId, ctx.tenantId),
        eq(schema.crmPipelineStages.id, args.stageId),
        eq(schema.crmPipelineStages.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "stage changed since loaded");
  }
  return rows[0];
}

/**
 * Archive or restore a stage.
 *
 * REFUSES TO ARCHIVE A STAGE THAT STILL HOLDS DEALS, and that refusal is the
 * point. `crm_deals.stage_id` is a NO ACTION foreign key, so the row would
 * survive — the deals would simply sit in a column the board no longer draws,
 * invisible and unreachable, which is a worse outcome than being told to empty
 * it first.
 */
export async function setStageArchived(
  tx: Tx,
  ctx: CrmCtx,
  args: { stageId: string; expectedVersion: number; archived: boolean },
): Promise<CrmPipelineStage> {
  if (args.archived) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.crmDeals)
      .where(
        and(
          eq(schema.crmDeals.tenantId, ctx.tenantId),
          eq(schema.crmDeals.stageId, args.stageId),
        ),
      );
    if (n > 0) {
      throw new CrmError(
        "STAGE_NOT_EMPTY",
        `stage still holds ${n} deal${n === 1 ? "" : "s"}`,
      );
    }
  }

  const rows = await tx
    .update(schema.crmPipelineStages)
    .set({
      archivedAt: args.archived ? new Date() : null,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmPipelineStages.tenantId, ctx.tenantId),
        eq(schema.crmPipelineStages.id, args.stageId),
        eq(schema.crmPipelineStages.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "stage changed since loaded");
  }
  return rows[0];
}

/** Reorder stages by listing ids. Ids not listed keep their place. */
export async function reorderStages(
  tx: Tx,
  ctx: CrmCtx,
  stageIds: string[],
): Promise<void> {
  for (const [index, stageId] of stageIds.entries()) {
    await tx
      .update(schema.crmPipelineStages)
      .set({ sortOrder: index, updatedAt: new Date() })
      .where(
        and(
          eq(schema.crmPipelineStages.tenantId, ctx.tenantId),
          eq(schema.crmPipelineStages.id, stageId),
        ),
      );
  }
}
