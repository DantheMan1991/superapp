import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  CrmDeal,
  CrmDealStageEvent,
  CrmPipelineStage,
  Party,
} from "@/db/schema";
import { CrmError } from "./core/errors";
import { runTrigger } from "./automation-ops";
import { closedAtFor, openingStage } from "./core/pipeline";
import {
  mergeCustomValues,
  missingRequired,
  sanitizeCustomValues,
  type CustomValue,
} from "./core/custom-fields";
import { listFieldDefs } from "./field-ops";
import { adoptRecord } from "./party-ops";
import { listStages, loadPipeline } from "./pipeline-ops";
import type { CrmCtx } from "./core/types";

/**
 * Deals, and the stage history that is the reason this slice ships a table
 * nothing reads yet.
 *
 * THE ONE RULE THAT HOLDS THE WHOLE THING TOGETHER: a deal's stage may only be
 * changed by `moveDealStage`, because that is the only path that writes a
 * `crm_deal_stage_events` row. A stray `update(crmDeals).set({ stageId })`
 * anywhere else would move the card and lose the fact that it moved — and
 * unlike almost every other bug in this module, that one cannot be repaired
 * afterwards. Velocity and win-rate reporting is exactly the history that would
 * be missing.
 */

export interface DealRow {
  deal: CrmDeal;
  party: Party;
  stage: CrmPipelineStage;
}

export interface DealDetail extends DealRow {
  primaryContact: Party | null;
  stakeholders: { id: string; role: string; party: Party }[];
  history: (CrmDealStageEvent & { toStageName: string; fromStageName: string | null })[];
}

/** Deals on one pipeline, with the party and stage resolved for the board. */
export async function listDealsForPipeline(
  tx: Tx,
  tenantId: string,
  pipelineId: string,
): Promise<DealRow[]> {
  const rows = await tx
    .select({
      deal: schema.crmDeals,
      party: schema.parties,
      stage: schema.crmPipelineStages,
    })
    .from(schema.crmDeals)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.crmDeals.tenantId),
        eq(schema.parties.id, schema.crmDeals.partyId),
      ),
    )
    .innerJoin(
      schema.crmPipelineStages,
      and(
        eq(schema.crmPipelineStages.tenantId, schema.crmDeals.tenantId),
        eq(schema.crmPipelineStages.id, schema.crmDeals.stageId),
      ),
    )
    .where(
      and(
        eq(schema.crmDeals.tenantId, tenantId),
        eq(schema.crmDeals.pipelineId, pipelineId),
      ),
    )
    .orderBy(desc(schema.crmDeals.updatedAt))
    .limit(1000);

  return rows;
}

/** Deals against one party — the "what are we working on here" panel. */
export async function listDealsForParty(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<DealRow[]> {
  return tx
    .select({
      deal: schema.crmDeals,
      party: schema.parties,
      stage: schema.crmPipelineStages,
    })
    .from(schema.crmDeals)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.crmDeals.tenantId),
        eq(schema.parties.id, schema.crmDeals.partyId),
      ),
    )
    .innerJoin(
      schema.crmPipelineStages,
      and(
        eq(schema.crmPipelineStages.tenantId, schema.crmDeals.tenantId),
        eq(schema.crmPipelineStages.id, schema.crmDeals.stageId),
      ),
    )
    .where(
      and(
        eq(schema.crmDeals.tenantId, tenantId),
        eq(schema.crmDeals.partyId, partyId),
      ),
    )
    .orderBy(desc(schema.crmDeals.updatedAt));
}

async function loadDealRow(
  tx: Tx,
  tenantId: string,
  dealId: string,
): Promise<DealRow> {
  const [row] = await tx
    .select({
      deal: schema.crmDeals,
      party: schema.parties,
      stage: schema.crmPipelineStages,
    })
    .from(schema.crmDeals)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.crmDeals.tenantId),
        eq(schema.parties.id, schema.crmDeals.partyId),
      ),
    )
    .innerJoin(
      schema.crmPipelineStages,
      and(
        eq(schema.crmPipelineStages.tenantId, schema.crmDeals.tenantId),
        eq(schema.crmPipelineStages.id, schema.crmDeals.stageId),
      ),
    )
    .where(
      and(eq(schema.crmDeals.tenantId, tenantId), eq(schema.crmDeals.id, dealId)),
    );
  // Absent because it does not exist, or because RLS removed it — the same
  // answer either way, which is what stops this being a probe.
  if (!row) throw new CrmError("DEAL_NOT_FOUND", `deal ${dealId} missing`);
  return row;
}

export async function loadDeal(
  tx: Tx,
  tenantId: string,
  dealId: string,
): Promise<DealDetail> {
  const row = await loadDealRow(tx, tenantId, dealId);

  const [contact, stakeholderRows, events, stages] = await Promise.all([
    row.deal.primaryContactPartyId
      ? tx.query.parties.findFirst({
          where: and(
            eq(schema.parties.tenantId, tenantId),
            eq(schema.parties.id, row.deal.primaryContactPartyId),
          ),
        })
      : Promise.resolve(undefined),
    tx
      .select({ link: schema.crmDealParties, party: schema.parties })
      .from(schema.crmDealParties)
      .innerJoin(
        schema.parties,
        and(
          eq(schema.parties.tenantId, schema.crmDealParties.tenantId),
          eq(schema.parties.id, schema.crmDealParties.partyId),
        ),
      )
      .where(
        and(
          eq(schema.crmDealParties.tenantId, tenantId),
          eq(schema.crmDealParties.dealId, dealId),
        ),
      )
      .orderBy(asc(schema.crmDealParties.createdAt)),
    tx.query.crmDealStageEvents.findMany({
      where: and(
        eq(schema.crmDealStageEvents.tenantId, tenantId),
        eq(schema.crmDealStageEvents.dealId, dealId),
      ),
      orderBy: [desc(schema.crmDealStageEvents.changedAt)],
    }),
    listStages(tx, tenantId, row.deal.pipelineId, { includeArchived: true }),
  ]);

  // Stage names resolved in memory rather than through two more joins — the
  // history is short and the stage list is already loaded.
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  return {
    ...row,
    primaryContact: contact ?? null,
    stakeholders: stakeholderRows.map((r) => ({
      id: r.link.id,
      role: r.link.role,
      party: r.party,
    })),
    history: events.map((e) => ({
      ...e,
      toStageName: stageName.get(e.toStageId) ?? "a removed stage",
      fromStageName: e.fromStageId
        ? (stageName.get(e.fromStageId) ?? "a removed stage")
        : null,
    })),
  };
}

async function validateDealCustom(
  tx: Tx,
  tenantId: string,
  incoming: Record<string, unknown> | undefined,
  requireComplete: boolean,
): Promise<{ defs: Awaited<ReturnType<typeof listFieldDefs>>; values: Record<string, CustomValue> }> {
  // `entity_type = 'deal'` — the open taxonomy slice 2 left room for, which is
  // why deals needed no migration to core to get custom fields.
  const defs = await listFieldDefs(tx, tenantId, "deal");
  const { values, issues } = sanitizeCustomValues(defs, incoming ?? {}, {
    requireComplete,
  });
  if (issues.length > 0) {
    throw new CrmError("CUSTOM_VALUES_INVALID", "custom field values rejected", issues);
  }
  return { defs, values };
}

export interface DealInput {
  partyId: string;
  title: string;
  pipelineId?: string;
  amountCents?: number | null;
  expectedCloseOn?: string | null;
  primaryContactPartyId?: string | null;
  ownerClerkUserId?: string | null;
  custom?: Record<string, unknown>;
}

/**
 * Create a deal in its pipeline's opening stage, and record that it started
 * there.
 *
 * The first stage event has a null `from_stage_id`, which is what makes "how
 * long has this been open" answerable without treating creation as a special
 * case everywhere downstream.
 */
export async function createDeal(
  tx: Tx,
  ctx: CrmCtx,
  input: DealInput,
): Promise<CrmDeal> {
  if (input.title.trim().length === 0) {
    throw new CrmError("DEAL_TITLE_REQUIRED", "deal needs a title");
  }

  // The deal's RLS policy resolves through `crm_party_details`, so a party CRM
  // has never been asked about would make the row invisible the moment it was
  // written. Adopting first turns that into ordinary behaviour.
  await adoptRecord(tx, ctx, input.partyId);

  const pipelineId =
    input.pipelineId ??
    (
      await tx.query.crmPipelines.findFirst({
        where: and(
          eq(schema.crmPipelines.tenantId, ctx.tenantId),
          eq(schema.crmPipelines.isDefault, true),
        ),
      })
    )?.id;
  if (!pipelineId) {
    throw new CrmError("PIPELINE_NOT_FOUND", "no default pipeline");
  }

  const { stages } = await loadPipeline(tx, ctx.tenantId, pipelineId);
  const opening = openingStage(stages);
  if (!opening) {
    throw new CrmError(
      "PIPELINE_HAS_NO_OPEN_STAGE",
      "pipeline has no open stage to start in",
    );
  }

  const { values } = await validateDealCustom(tx, ctx.tenantId, input.custom, false);

  const [deal] = await tx
    .insert(schema.crmDeals)
    .values({
      tenantId: ctx.tenantId,
      partyId: input.partyId,
      primaryContactPartyId: input.primaryContactPartyId ?? null,
      pipelineId,
      stageId: opening.id,
      title: input.title.trim(),
      amountCents: input.amountCents ?? null,
      expectedCloseOn: input.expectedCloseOn ?? null,
      ownerClerkUserId: input.ownerClerkUserId ?? null,
      custom: values,
    })
    .returning();

  await tx.insert(schema.crmDealStageEvents).values({
    tenantId: ctx.tenantId,
    dealId: deal.id,
    fromStageId: null,
    toStageId: opening.id,
    changedByClerkUserId: ctx.userId,
  });

  return deal;
}

/**
 * Move a deal to another stage. THE ONLY PATH THAT MAY CHANGE `stage_id`.
 *
 * Three things happen together, in one transaction, and none of them is
 * optional: the deal moves, `closed_at` is recomputed from the destination's
 * outcome, and the move is recorded. `now` is passed in so the stamping rule
 * stays testable.
 */
export async function moveDealStage(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    dealId: string;
    expectedVersion: number;
    toStageId: string;
    now?: Date;
  },
): Promise<CrmDeal> {
  const { deal } = await loadDealRow(tx, ctx.tenantId, args.dealId);

  const toStage = await tx.query.crmPipelineStages.findFirst({
    where: and(
      eq(schema.crmPipelineStages.tenantId, ctx.tenantId),
      eq(schema.crmPipelineStages.id, args.toStageId),
    ),
  });
  if (!toStage) throw new CrmError("STAGE_NOT_FOUND", "stage missing");
  // A cross-pipeline move would leave the card on a board that does not draw
  // its column. Moving pipelines is a different, deliberate operation.
  if (toStage.pipelineId !== deal.pipelineId) {
    throw new CrmError("STAGE_WRONG_PIPELINE", "stage is on another pipeline");
  }

  // Reaching a terminal stage is this module's equivalent of a lifecycle
  // transition, so it is where required custom fields bite. The narrow check,
  // for the reason `missingRequired` exists.
  if (toStage.outcome !== "open") {
    const defs = await listFieldDefs(tx, ctx.tenantId, "deal");
    const issues = missingRequired(defs, deal.custom);
    if (issues.length > 0) {
      throw new CrmError("CUSTOM_VALUES_INVALID", "required fields unanswered", issues);
    }
  }

  if (toStage.id === deal.stageId) return deal;

  const rows = await tx
    .update(schema.crmDeals)
    .set({
      stageId: toStage.id,
      closedAt: closedAtFor(deal.closedAt, toStage, args.now ?? new Date()),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmDeals.tenantId, ctx.tenantId),
        eq(schema.crmDeals.id, args.dealId),
        eq(schema.crmDeals.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "deal changed since loaded");
  }

  // Written AFTER the update succeeded, in the same transaction: a history row
  // for a move that lost a version race would be a record of something that
  // never happened.
  await tx.insert(schema.crmDealStageEvents).values({
    tenantId: ctx.tenantId,
    dealId: args.dealId,
    fromStageId: deal.stageId,
    toStageId: toStage.id,
    changedByClerkUserId: ctx.userId,
  });

  // TRIGGERS, after the history row, so a rule can never fire for a move that
  // lost a version race. `deal_won` and `deal_lost` are separate triggers as
  // well as being stage changes, because "when a deal is won" is the rule
  // somebody actually wants to write and making them filter for it would mean
  // knowing which stage names count — which is a per-tenant fact the rule
  // should not have to hard-code.
  const triggerCtx = {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    partyId: deal.partyId,
  };
  await runTrigger(tx, triggerCtx, "deal_stage_changed");
  if (toStage.outcome === "won") await runTrigger(tx, triggerCtx, "deal_won");
  if (toStage.outcome === "lost") await runTrigger(tx, triggerCtx, "deal_lost");

  return rows[0];
}

/**
 * Edit everything about a deal EXCEPT its stage.
 *
 * The omission is the design — see `moveDealStage`. Accepting a `stageId` here
 * would give the codebase two ways to move a card, and one of them would not
 * write history.
 */
export async function updateDeal(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    dealId: string;
    expectedVersion: number;
    patch: Omit<Partial<DealInput>, "partyId" | "pipelineId">;
  },
): Promise<CrmDeal> {
  const { deal } = await loadDealRow(tx, ctx.tenantId, args.dealId);
  const { patch } = args;

  if (patch.title !== undefined && patch.title.trim().length === 0) {
    throw new CrmError("DEAL_TITLE_REQUIRED", "deal needs a title");
  }

  let nextCustom: Record<string, CustomValue> | undefined;
  if (patch.custom !== undefined) {
    const { defs, values } = await validateDealCustom(
      tx,
      ctx.tenantId,
      patch.custom,
      false,
    );
    nextCustom = mergeCustomValues(deal.custom, defs, values);
  }

  const rows = await tx
    .update(schema.crmDeals)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.amountCents !== undefined ? { amountCents: patch.amountCents } : {}),
      ...(patch.expectedCloseOn !== undefined
        ? { expectedCloseOn: patch.expectedCloseOn }
        : {}),
      ...(patch.primaryContactPartyId !== undefined
        ? { primaryContactPartyId: patch.primaryContactPartyId }
        : {}),
      ...(patch.ownerClerkUserId !== undefined
        ? { ownerClerkUserId: patch.ownerClerkUserId }
        : {}),
      ...(nextCustom !== undefined ? { custom: nextCustom } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmDeals.tenantId, ctx.tenantId),
        eq(schema.crmDeals.id, args.dealId),
        eq(schema.crmDeals.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "deal changed since loaded");
  }
  return rows[0];
}

export async function addDealStakeholder(
  tx: Tx,
  ctx: CrmCtx,
  args: { dealId: string; partyId: string; role?: string },
): Promise<void> {
  await loadDealRow(tx, ctx.tenantId, args.dealId);
  await adoptRecord(tx, ctx, args.partyId);
  await tx
    .insert(schema.crmDealParties)
    .values({
      tenantId: ctx.tenantId,
      dealId: args.dealId,
      partyId: args.partyId,
      role: args.role ?? "",
    })
    // Adding the same person twice is a double-click, not an error worth
    // reporting — the unique index makes it a no-op.
    .onConflictDoNothing();
}

export async function removeDealStakeholder(
  tx: Tx,
  ctx: CrmCtx,
  args: { dealPartyId: string },
): Promise<void> {
  await tx
    .delete(schema.crmDealParties)
    .where(
      and(
        eq(schema.crmDealParties.tenantId, ctx.tenantId),
        eq(schema.crmDealParties.id, args.dealPartyId),
      ),
    );
}

/** Resolve several parties at once, for pickers. */
export async function resolveParties(
  tx: Tx,
  tenantId: string,
  ids: string[],
): Promise<Map<string, Party>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.parties)
    .where(
      and(eq(schema.parties.tenantId, tenantId), inArray(schema.parties.id, ids)),
    );
  return new Map(rows.map((r) => [r.id, r]));
}
