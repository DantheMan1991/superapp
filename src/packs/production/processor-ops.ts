import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  ProductionProcessor,
  ProductionProcessorCut,
  ProductionProcessorHandle,
} from "@/db/schema";
import { createPartyForRole } from "@/lib/parties/role-sync";
import { loadParty, updateParty } from "@/lib/parties";
import { ProductionError, type ProductionCtx, requireWrite } from "./ops";
import { INSPECTIONS, LABELLING_OPTIONS, isValidSlug } from "./vocabulary";

/**
 * The processor directory — who does the part of a run this business does not
 * do itself, and everything needed to choose between two of them.
 *
 * **SPLIT FROM `ops.ts` FOR THE SAME REASON `inventory` SPLIT `ledger-ops.ts`:**
 * nothing here touches a run, a movement or a cost. A processor is a standing
 * fact about the world that stays true between runs, and mixing it into the file
 * that lands stock would put two lifetimes in one place.
 *
 * **THE NAME IS NOT HERE, AND THAT IS THE POINT.** It lives on the party, and
 * this table holds only what a party row cannot say. `customers` and `vendors`
 * still carry their own `name` beside the party's — `src/lib/parties/role-sync.ts`
 * calls that the "both exist" stage of an expand/deploy/contract it has not
 * finished — and there is no reason to open a third copy of that problem. A
 * rename here is an update to the party and nothing else, so it cannot diverge.
 *
 * **WRITES ARE OWNER.** Unlike the kill sheet, which is a chore and is MEMBER,
 * choosing a processor and recording what it charges is a decision: the fees are
 * the terms of a commercial relationship, `rating` and `good_at` are the farm's
 * candid view of a business it has to keep working with, and the inspection
 * status is what will later decide whether a sale is legal. That is the pack
 * rule from `src/lib/packs/authorize.ts` applied the other way from slice 1a,
 * and the contrast is deliberate.
 */

export interface ProcessorInput {
  name: string;
  inspection?: string;
  establishmentNumber?: string;
  customLabelling?: string;
  labellingNotes?: string;
  leadTimeDays?: number | null;
  rating?: number | null;
  goodAt?: string;
  notes?: string;
}

export type ProcessorPatch = Partial<ProcessorInput> & { isActive?: boolean };

export interface HandleInput {
  kind: string;
  capacityPerDay?: number | null;
  killFeeCents?: number | null;
  cutWrapCentsPerLb?: number | null;
  priceNotes?: string;
}

export interface CutInput {
  kind?: string;
  name: string;
  notes?: string;
}

/** A processor with everything hanging off it, for a screen. */
export interface ProcessorDetail {
  processor: ProductionProcessor;
  name: string;
  handles: ProductionProcessorHandle[];
  cuts: ProductionProcessorCut[];
}

/**
 * Both closed sets are checked HERE as well as by the CHECK constraints.
 *
 * Not belt and braces: a constraint violation surfaces as a Postgres error with
 * a constraint name in it, which the action layer would have to turn back into
 * a sentence. Refusing in words at the boundary means the person gets told what
 * is wrong, and the constraint stays what it is for — the thing that is true
 * even if this function is ever bypassed.
 */
function validateEnums(input: {
  inspection?: string;
  customLabelling?: string;
  rating?: number | null;
  leadTimeDays?: number | null;
}): void {
  if (
    input.inspection !== undefined &&
    !(INSPECTIONS as readonly string[]).includes(input.inspection)
  ) {
    throw new ProductionError(
      "PROCESSOR_INVALID",
      "that is not a kind of inspection this app knows about",
    );
  }
  if (
    input.customLabelling !== undefined &&
    !(LABELLING_OPTIONS as readonly string[]).includes(input.customLabelling)
  ) {
    throw new ProductionError(
      "PROCESSOR_INVALID",
      "say whether they will use your label, will not, or nobody has asked",
    );
  }
  if (
    input.rating !== undefined &&
    input.rating !== null &&
    (input.rating < 1 || input.rating > 5 || !Number.isInteger(input.rating))
  ) {
    throw new ProductionError("PROCESSOR_INVALID", "a rating is 1 to 5");
  }
  if (
    input.leadTimeDays !== undefined &&
    input.leadTimeDays !== null &&
    (input.leadTimeDays <= 0 || !Number.isInteger(input.leadTimeDays))
  ) {
    throw new ProductionError(
      "PROCESSOR_INVALID",
      "how far ahead they book is a whole number of days",
    );
  }
}

export async function listProcessors(
  tx: Tx,
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<ProcessorDetail[]> {
  const rows = await tx.query.productionProcessors.findMany({
    where: opts.includeInactive
      ? eq(schema.productionProcessors.tenantId, tenantId)
      : and(
          eq(schema.productionProcessors.tenantId, tenantId),
          eq(schema.productionProcessors.isActive, true),
        ),
  });
  if (rows.length === 0) return [];

  // Three reads, not one per processor. A farm has a handful of these, but the
  // N+1 would be in the page's critical path and it costs nothing to not write.
  const [parties, handles, cuts] = await Promise.all([
    tx.query.parties.findMany({
      where: eq(schema.parties.tenantId, tenantId),
    }),
    tx.query.productionProcessorHandles.findMany({
      where: eq(schema.productionProcessorHandles.tenantId, tenantId),
      orderBy: [asc(schema.productionProcessorHandles.kind)],
    }),
    tx.query.productionProcessorCuts.findMany({
      where: eq(schema.productionProcessorCuts.tenantId, tenantId),
      orderBy: [asc(schema.productionProcessorCuts.name)],
    }),
  ]);
  const nameById = new Map(parties.map((p) => [p.id, p.displayName]));

  return rows
    .map((processor) => ({
      processor,
      name: nameById.get(processor.partyId) ?? "",
      handles: handles.filter((h) => h.processorId === processor.id),
      cuts: cuts.filter((c) => c.processorId === processor.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProcessor(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<ProcessorDetail | null> {
  const processor = await tx.query.productionProcessors.findFirst({
    where: and(
      eq(schema.productionProcessors.tenantId, tenantId),
      eq(schema.productionProcessors.id, id),
    ),
  });
  if (!processor) return null;
  const [party, handles, cuts] = await Promise.all([
    loadParty(tx, tenantId, processor.partyId),
    tx.query.productionProcessorHandles.findMany({
      where: and(
        eq(schema.productionProcessorHandles.tenantId, tenantId),
        eq(schema.productionProcessorHandles.processorId, id),
      ),
      orderBy: [asc(schema.productionProcessorHandles.kind)],
    }),
    tx.query.productionProcessorCuts.findMany({
      where: and(
        eq(schema.productionProcessorCuts.tenantId, tenantId),
        eq(schema.productionProcessorCuts.processorId, id),
      ),
      orderBy: [asc(schema.productionProcessorCuts.name)],
    }),
  ]);
  return { processor, name: party?.displayName ?? "", handles, cuts };
}

/**
 * Add a processor, minting the party behind it.
 *
 * **A NEW PARTY EVERY TIME, DELIBERATELY, AND THE ALTERNATIVE IS WORSE.**
 * Matching on name to reuse an existing party would silently attach this
 * processor to whichever contact happened to be spelled the same — a customer
 * called "Miller's" becoming the plant called "Miller's" — and the failure is
 * invisible until somebody's invoice turns up on a butcher's page. Attaching an
 * EXISTING party is a real need (the plant you already buy from is already a
 * vendor), and it is a deliberate act on a later screen, not a guess made here.
 */
export async function createProcessor(
  tx: Tx,
  ctx: ProductionCtx,
  input: ProcessorInput,
): Promise<ProductionProcessor> {
  requireWrite(ctx, "owner");
  const name = input.name.trim();
  if (!name) {
    throw new ProductionError("PROCESSOR_INVALID", "give them a name");
  }
  validateEnums(input);

  const party = await createPartyForRole(tx, ctx.tenantId, name);
  const [row] = await tx
    .insert(schema.productionProcessors)
    .values({
      tenantId: ctx.tenantId,
      partyId: party.id,
      inspection: input.inspection ?? "unknown",
      establishmentNumber: (input.establishmentNumber ?? "").trim(),
      customLabelling: input.customLabelling ?? "unknown",
      labellingNotes: (input.labellingNotes ?? "").trim(),
      leadTimeDays: input.leadTimeDays ?? null,
      rating: input.rating ?? null,
      goodAt: (input.goodAt ?? "").trim(),
      notes: (input.notes ?? "").trim(),
    })
    .returning();
  return row;
}

export async function updateProcessor(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
  patch: ProcessorPatch,
): Promise<ProductionProcessor> {
  requireWrite(ctx, "owner");
  validateEnums(patch);

  const existing = await tx.query.productionProcessors.findFirst({
    where: and(
      eq(schema.productionProcessors.tenantId, ctx.tenantId),
      eq(schema.productionProcessors.id, id),
    ),
  });
  if (!existing) {
    throw new ProductionError("NOT_FOUND", "that processor is gone");
  }

  // The name is the party's. Updating it here rather than storing a second copy
  // is what keeps this table incapable of disagreeing with the rest of the app.
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) {
      throw new ProductionError("PROCESSOR_INVALID", "give them a name");
    }
    const party = await loadParty(tx, ctx.tenantId, existing.partyId);
    if (party.displayName !== name) {
      // The party's CURRENT version, read inside this transaction — the same
      // reasoning `syncPartyName` records: the person was editing a processor
      // and never saw the party, so the version they loaded is not a claim they
      // are entitled to make. Two concurrent renames still cannot both win.
      await updateParty(tx, ctx.tenantId, {
        partyId: existing.partyId,
        expectedVersion: party.version,
        patch: { displayName: name },
      });
    }
  }

  const [row] = await tx
    .update(schema.productionProcessors)
    .set({
      ...(patch.inspection !== undefined
        ? { inspection: patch.inspection }
        : {}),
      ...(patch.establishmentNumber !== undefined
        ? { establishmentNumber: patch.establishmentNumber.trim() }
        : {}),
      ...(patch.customLabelling !== undefined
        ? { customLabelling: patch.customLabelling }
        : {}),
      ...(patch.labellingNotes !== undefined
        ? { labellingNotes: patch.labellingNotes.trim() }
        : {}),
      ...(patch.leadTimeDays !== undefined
        ? { leadTimeDays: patch.leadTimeDays }
        : {}),
      ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
      ...(patch.goodAt !== undefined ? { goodAt: patch.goodAt.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.productionProcessors.tenantId, ctx.tenantId),
        eq(schema.productionProcessors.id, id),
      ),
    )
    .returning();
  return row;
}

/**
 * Record what a processor will take, or change the quote on something it
 * already takes.
 *
 * **AN UPSERT, BECAUSE THE UNIQUE INDEX SAYS ONE ROW PER KIND.** Two rows for
 * beef at one plant would be two prices for one animal with nothing to say which
 * is current, so asking again about a kind already recorded is a correction
 * rather than a second opinion.
 */
export async function setHandle(
  tx: Tx,
  ctx: ProductionCtx,
  processorId: string,
  input: HandleInput,
): Promise<ProductionProcessorHandle> {
  requireWrite(ctx, "owner");
  const kind = input.kind.trim().toLowerCase();
  if (!isValidSlug(kind)) {
    throw new ProductionError(
      "INVALID_KIND",
      "use lowercase letters, numbers and underscores",
    );
  }
  await requireProcessor(tx, ctx.tenantId, processorId);
  for (const [value, what] of [
    [input.capacityPerDay, "how many they can take in a day"],
    [input.killFeeCents, "the fee per head"],
    [input.cutWrapCentsPerLb, "the cut and wrap rate"],
  ] as const) {
    if (value !== undefined && value !== null && value < 0) {
      throw new ProductionError("PROCESSOR_INVALID", `${what} cannot be negative`);
    }
  }

  const [row] = await tx
    .insert(schema.productionProcessorHandles)
    .values({
      tenantId: ctx.tenantId,
      processorId,
      kind,
      capacityPerDay: input.capacityPerDay ?? null,
      killFeeCents: input.killFeeCents ?? null,
      cutWrapCentsPerLb: input.cutWrapCentsPerLb ?? null,
      priceNotes: (input.priceNotes ?? "").trim(),
    })
    .onConflictDoUpdate({
      target: [
        schema.productionProcessorHandles.tenantId,
        schema.productionProcessorHandles.processorId,
        schema.productionProcessorHandles.kind,
      ],
      set: {
        capacityPerDay: input.capacityPerDay ?? null,
        killFeeCents: input.killFeeCents ?? null,
        cutWrapCentsPerLb: input.cutWrapCentsPerLb ?? null,
        priceNotes: (input.priceNotes ?? "").trim(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function removeHandle(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
): Promise<ProductionProcessorHandle> {
  requireWrite(ctx, "owner");
  const [row] = await tx
    .delete(schema.productionProcessorHandles)
    .where(
      and(
        eq(schema.productionProcessorHandles.tenantId, ctx.tenantId),
        eq(schema.productionProcessorHandles.id, id),
      ),
    )
    .returning();
  if (!row) throw new ProductionError("NOT_FOUND", "that is already gone");
  return row;
}

export async function addCut(
  tx: Tx,
  ctx: ProductionCtx,
  processorId: string,
  input: CutInput,
): Promise<ProductionProcessorCut> {
  requireWrite(ctx, "owner");
  const name = input.name.trim();
  if (!name) {
    throw new ProductionError("PROCESSOR_INVALID", "name the cut");
  }
  const kind = (input.kind ?? "").trim().toLowerCase();
  if (kind !== "" && !isValidSlug(kind)) {
    throw new ProductionError(
      "INVALID_KIND",
      "use lowercase letters, numbers and underscores",
    );
  }
  await requireProcessor(tx, ctx.tenantId, processorId);

  const [row] = await tx
    .insert(schema.productionProcessorCuts)
    .values({
      tenantId: ctx.tenantId,
      processorId,
      kind,
      name,
      notes: (input.notes ?? "").trim(),
    })
    .returning();
  return row;
}

export async function removeCut(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
): Promise<ProductionProcessorCut> {
  requireWrite(ctx, "owner");
  const [row] = await tx
    .delete(schema.productionProcessorCuts)
    .where(
      and(
        eq(schema.productionProcessorCuts.tenantId, ctx.tenantId),
        eq(schema.productionProcessorCuts.id, id),
      ),
    )
    .returning();
  if (!row) throw new ProductionError("NOT_FOUND", "that is already gone");
  return row;
}

/**
 * The child writes check the parent EXISTS rather than relying on the foreign
 * key, so that a stale page adding a cut to a processor somebody just archived
 * gets a sentence instead of a constraint violation.
 */
async function requireProcessor(
  tx: Tx,
  tenantId: string,
  processorId: string,
): Promise<void> {
  const row = await tx.query.productionProcessors.findFirst({
    where: and(
      eq(schema.productionProcessors.tenantId, tenantId),
      eq(schema.productionProcessors.id, processorId),
    ),
  });
  if (!row) {
    throw new ProductionError("NOT_FOUND", "that processor is gone");
  }
}
