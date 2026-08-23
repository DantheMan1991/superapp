import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  InventoryItem,
  ProductionRun,
  ProductionRunCarcass,
  ProductionRunInput,
  ProductionRunOutput,
} from "@/db/schema";
import {
  balanceByLots,
  carriedCostByLot,
  createItem,
  getItem,
  getLot as getInventoryLot,
  issueStock,
  listItems,
  receiveStock,
  type InventoryCtx,
} from "@/packs/inventory/ops";
import { convert, getUnit, roundQuantity } from "@/packs/inventory/core/units";
import { hasRecordedCost } from "@/packs/inventory/core/valuation";
import { RUN_INPUT_HANDLERS } from "@/packs/run-handlers";
import type { RunInputBlock } from "./core/handler";
import { isValidSlug } from "./vocabulary";
import { runYield, type YieldResult } from "./core/yield";
import {
  cuttingYield,
  dressingPercentage,
  tallyCarcasses,
  type CarcassLine,
  type CarcassTally,
  type CuttingResult,
  type DressingResult,
  type SheetInput,
} from "./core/carcass";
import { lotShareCents, rollRun, type RollBasis } from "./core/roll";

/**
 * Production operations. Every function takes a `Tx` so the caller owns the
 * transaction — the house rule, and it matters more here than anywhere: a run
 * that lands six outputs writes six lots, six receipts and six row updates, and
 * a partial completion would leave meat on a shelf with no cost and a run that
 * still thinks it is holding it.
 *
 * **THIS FILE COMPOSES `inventory` AND NOTHING ELSE.** `production.requires =
 * ["inventory"]`, because outputs land there. It does NOT require `livestock`:
 * a bakery running production over purchased flour is a legitimate composition,
 * and a pack must not assume its neighbours. Where a run does meet animals, it
 * meets them through the declared slot in `core/handler.ts` — see
 * `src/packs/run-handlers.ts`.
 *
 * **NOTHING HERE STORES A YIELD, A COST TOTAL OR A RATIO.** The run tables hold
 * the join and the weights; every figure is folded from them and from
 * `inventory`'s ledger at read time, which is the same discipline the head count
 * and the feed cost already follow.
 */

export class ProductionError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_KIND"
      | "RUN_CLOSED"
      | "RUN_INVALID"
      | "ITEM_INVALID"
      | "LOT_REQUIRED"
      | "INPUT_BLOCKED"
      | "NOTHING_TO_LAND"
      | "CARCASS_INVALID"
      | "PROCESSOR_INVALID"
      | "BOOKING_INVALID"
      | "PAPERWORK_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ProductionError";
  }
}

export interface ProductionCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

const asInventory = (ctx: ProductionCtx): InventoryCtx => ctx;

/**
 * Who may write, and at which level — the pack rule from
 * `src/lib/packs/authorize.ts`: **is this a decision, or is it a chore?**
 *
 * `startRun` and `completeRun` are OWNER. Both create cost objects — completing
 * a run creates an output lot per output, and `upsertDimensionMember` requires
 * the owner role, so a staff completion would land stock whose cost object did
 * not exist and which no report could group by. Deciding to process a pen is
 * also the planning decision the design describes (*pre-orders + freezer
 * headroom*), which is squarely the owner's.
 *
 * `addInput`, `addOutput`, `updateOutput` and `removeOutput` are MEMBER. A
 * processing day is 2–3 people and none of them is necessarily the owner; the
 * whole point of recording boxes as they come off the line is that whoever is
 * holding the box can do it.
 *
 * The three carcass calls are MEMBER for a plainer reason still: transcribing a
 * kill sheet is copying somebody else's piece of paper into a form. It decides
 * nothing, and it creates no cost object.
 */
export function requireWrite(ctx: ProductionCtx, level: WriteLevel): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new ProductionError("FORBIDDEN", "only an owner can change this");
  }
}

// ------------------------------------------------------------------- runs ---

export interface RunInput {
  code: string;
  runKind?: string;
  startedOn: string;
  /**
   * Who is doing it, or absent for on-farm. THE PROCESSING PATH — see the
   * column comment on `production_runs.processor_id`. Usually arrives from a
   * booking rather than being picked here.
   */
  processorId?: string | null;
  locationAssetId?: string | null;
  performedBy?: string;
  crewSize?: number | null;
  labourHours?: number | null;
  notes?: string;
}

export async function startRun(
  tx: Tx,
  ctx: ProductionCtx,
  input: RunInput,
): Promise<ProductionRun> {
  requireWrite(ctx, "owner");
  const runKind = (input.runKind ?? "run").trim().toLowerCase();
  if (!isValidSlug(runKind)) {
    throw new ProductionError("INVALID_KIND", `invalid kind: ${input.runKind}`);
  }
  const rows = await tx
    .insert(schema.productionRuns)
    .values({
      tenantId: ctx.tenantId,
      code: input.code.trim(),
      runKind,
      startedOn: input.startedOn,
      processorId: input.processorId ?? null,
      locationAssetId: input.locationAssetId ?? null,
      performedBy: input.performedBy?.trim() ?? "",
      crewSize: input.crewSize ?? null,
      labourHours: input.labourHours ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

export async function listRuns(
  tx: Tx,
  tenantId: string,
  filter: { status?: string; runKind?: string } = {},
): Promise<ProductionRun[]> {
  const where = [eq(schema.productionRuns.tenantId, tenantId)];
  if (filter.status) where.push(eq(schema.productionRuns.status, filter.status));
  if (filter.runKind) {
    where.push(eq(schema.productionRuns.runKind, filter.runKind));
  }
  return tx.query.productionRuns.findMany({
    where: and(...where),
    orderBy: (r, { desc: byDesc }) => [byDesc(r.startedOn), byDesc(r.createdAt)],
  });
}

export async function getRun(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<ProductionRun | null> {
  const row = await tx.query.productionRuns.findFirst({
    where: and(
      eq(schema.productionRuns.tenantId, tenantId),
      eq(schema.productionRuns.id, id),
    ),
  });
  return row ?? null;
}

/** Kinds actually in use, for the filter. Same read `inventory` makes for items. */
export async function listKindsInUse(
  tx: Tx,
  tenantId: string,
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ runKind: schema.productionRuns.runKind })
    .from(schema.productionRuns)
    .where(eq(schema.productionRuns.tenantId, tenantId));
  return rows.map((r) => r.runKind).sort();
}

async function openRunOrThrow(
  tx: Tx,
  ctx: ProductionCtx,
  runId: string,
): Promise<ProductionRun> {
  const run = await getRun(tx, ctx.tenantId, runId);
  if (!run) throw new ProductionError("NOT_FOUND", "that run no longer exists");
  if (run.status !== "in_progress") {
    // A finished run has already stamped its costs on the ledger. Adding to it
    // would mean either restating movements that have happened or leaving a
    // cost roll that no longer covers everything it split.
    throw new ProductionError(
      "RUN_CLOSED",
      "this run is finished — its outputs are already in stock and their cost is stamped",
    );
  }
  return run;
}

// ----------------------------------------------------------------- inputs ---

/**
 * Anything that would stop these lots being consumed today, from every handler.
 *
 * Exposed as a READ as well as being enforced on the write, because a form that
 * lets somebody pick a blocked pen and then refuses them is a worse screen than
 * one that says why before they try.
 */
export async function inputBlocks(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
  today: string,
): Promise<Map<string, RunInputBlock>> {
  const out = new Map<string, RunInputBlock>();
  if (lotIds.length === 0) return out;
  for (const handler of RUN_INPUT_HANDLERS) {
    const claimed = await handler.claims(tx, tenantId, lotIds);
    if (claimed.size === 0) continue;
    const blocks = await handler.blocks(tx, tenantId, [...claimed], today);
    for (const [lotId, block] of blocks) out.set(lotId, block);
  }
  return out;
}

export interface AddInputArgs {
  runId: string;
  itemId: string;
  /**
   * REQUIRED, unlike everywhere else in `inventory`. A run consumes a BATCH: the
   * withdrawal clock is a property of a pen and the accumulated cost is a
   * property of a lot, and an input with no lot could be guarded by nothing and
   * costed by nothing.
   */
  lotId: string;
  /** Positive, in the item's stocking unit. */
  quantity: number;
  /** Total pounds for this row. Null when the item is already stocked by mass. */
  weightLb?: number | null;
  occurredOn: string;
  notes?: string;
}

/**
 * Put something into a run: take it out of stock, and record what it weighed.
 *
 * **THE THREE THINGS THAT HAPPEN HERE ARE THE SLICE.**
 *
 * 1. **The guard fires.** Every handler is asked whether it owns this lot and,
 *    if it does, whether anything should stop the run. A refusal carries the
 *    owning pack's own sentence and its clearing date — `livestock`'s withdrawal
 *    clock is the first, and it is the reason its slice 3 was built ahead of
 *    this one. There is no override.
 * 2. **The cost is worked out and STAMPED, never derived later.** A claimed lot
 *    carries its ACCUMULATED cost — chicks plus feed plus medicine, net of
 *    anything already processed out — pro-rated by the share of the lot being
 *    taken. Ordinary stock leaves at `inventory`'s average, exactly as a bag of
 *    feed does. Two bases, and they are different on purpose: pricing a bird at
 *    what the chick cost would throw away eight weeks of feed, which is the one
 *    number the enterprise is judged on.
 * 3. **The stock leaves through whoever owns it.** Head through
 *    `livestock.removeHead`, so the head ledger stays the one ledger and the
 *    count still reconciles. Everything else through `inventory.issueStock`.
 */
export async function addRunInput(
  tx: Tx,
  ctx: ProductionCtx,
  input: AddInputArgs,
  today: string,
): Promise<ProductionRunInput> {
  requireWrite(ctx, "member");
  const run = await openRunOrThrow(tx, ctx, input.runId);

  const item = await getItem(tx, ctx.tenantId, input.itemId);
  if (!item) {
    throw new ProductionError("ITEM_INVALID", "that item does not exist");
  }
  const lot = await getInventoryLot(tx, ctx.tenantId, input.lotId);
  if (!lot || lot.itemId !== input.itemId) {
    throw new ProductionError(
      "LOT_REQUIRED",
      "pick a batch of that item — a run consumes a batch, not a stock line",
    );
  }
  const quantity = roundQuantity(Math.abs(input.quantity));
  if (quantity <= 0) {
    throw new ProductionError("RUN_INVALID", "a run input has to be positive");
  }

  const handler = await handlerFor(tx, ctx.tenantId, input.lotId);
  if (handler) {
    const blocks = await handler.blocks(tx, ctx.tenantId, [input.lotId], today);
    const block = blocks.get(input.lotId);
    if (block) {
      throw new ProductionError(
        "INPUT_BLOCKED",
        `${lot.code} — ${block.reason}`,
      );
    }
  }

  let movementId: string;
  if (handler) {
    // The lot's own accumulated cost, pro-rated by what is being taken. Read
    // BEFORE the stock leaves, or the standing balance is already short.
    const [carried, standing] = await Promise.all([
      carriedCostByLot(tx, ctx.tenantId, [input.lotId]),
      balanceByLots(tx, ctx.tenantId, [input.lotId]),
    ]);
    const lotCost = carried.get(input.lotId);
    /**
     * **NOTHING RECORDED IS NULL, NOT ZERO — found by driving.** A pen with no
     * priced chicks and no feed issued against it has `remainingCents` of 0, and
     * stamping that says "these birds were free". They were not; nobody has said
     * what they cost. Null is the answer this pack already knows how to report
     * honestly — the Cost in card counts unpriced inputs and says they are real
     * stock with no invoice behind them, which is `inventory`'s own rule that a
     * model insisting every input has a price will be lied to.
     *
     * A genuine zero still gets through: a pen whose cost has ALREADY been
     * carried out by an earlier run has accumulated something and has nothing
     * left, and 0 is exactly right there.
     *
     * **THE TEST IS `inventory`'S OWN, NOT A COPY OF IT.** This used to read
     * `purchased + consumed === 0`, which was the same question the valuation
     * screen's `carriedValue` asks in a different shape — and two shapes of one
     * question is one that can be answered differently in two places. It duly
     * was: when `inventory_cost_adjustments` arrived, a batch costed ONLY by a
     * correction was invisible to both, so a kill day would have stamped NULL
     * on meat carrying real money while the valuation screen called the same
     * batch "No cost recorded". One predicate now, in the pack that owns the
     * fold.
     */
    const costCents =
      !lotCost || !hasRecordedCost(lotCost)
        ? null
        : lotShareCents(
            lotCost.remainingCents,
            quantity,
            standing.get(input.lotId) ?? 0,
          );
    movementId = await handler.consume(tx, ctx, {
      itemId: input.itemId,
      lotId: input.lotId,
      quantity,
      occurredOn: input.occurredOn,
      costCents,
      locationAssetId: null,
      notes: input.notes,
    });
  } else {
    const movement = await issueStock(tx, asInventory(ctx), {
      itemId: input.itemId,
      lotId: input.lotId,
      quantity,
      // NOT `issuedToLotId`. That column means "which lot ate it", and a run is
      // not a lot — the link from flour to the bread it became is this run, and
      // it is the row below.
      occurredOn: input.occurredOn,
      extensionSlug: "production",
      notes: input.notes,
    });
    movementId = movement.id;
  }

  const rows = await tx
    .insert(schema.productionRunInputs)
    .values({
      tenantId: ctx.tenantId,
      runId: run.id,
      inventoryMovementId: movementId,
      weightLb: input.weightLb ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

async function handlerFor(tx: Tx, tenantId: string, lotId: string) {
  for (const handler of RUN_INPUT_HANDLERS) {
    const claimed = await handler.claims(tx, tenantId, [lotId]);
    if (claimed.has(lotId)) return handler;
  }
  return null;
}

// ---------------------------------------------------------------- outputs ---

export interface AddOutputArgs {
  runId: string;
  /** An existing stock line, or `newItemName` to start one. Exactly one. */
  itemId?: string;
  /**
   * Create the stock line as part of recording the output: "Whole broilers",
   * "Sourdough".
   *
   * **WHY THIS EXISTS, and it is the same reason `createLivestockLot` has its
   * twin.** Found by driving: a farm's first kill day produces whole birds, and
   * a farm that has never sold meat has no meat item — so the picker offered
   * feed, chicks, pigs and penicillin, and the only way to land a bird was to
   * leave for Inventory, add an item, and come back. Livestock hit exactly this
   * with its first cattle and fixed it in the same slice.
   */
  newItemName?: string;
  /** The unit the new line's balance is kept in. Locks once anything moves. */
  newItemUnit?: string;
  newItemKind?: string;
  quantity: number;
  weightLb?: number | null;
  /** Defaults to the run's own code. */
  lotCode?: string;
  locationAssetId?: string | null;
  notes?: string;
}

/**
 * Record something the run produced. **It does not land in stock yet.**
 *
 * That is the WIP state the design asks for, and it is forced rather than
 * chosen: the cost split across the outputs cannot be known until they have all
 * come off the line, and `inventory` stamps a receipt's cost once, when it
 * happens. So boxes are recorded against the run as they appear and land
 * together when it is finished.
 */
export async function addRunOutput(
  tx: Tx,
  ctx: ProductionCtx,
  input: AddOutputArgs,
): Promise<ProductionRunOutput> {
  requireWrite(ctx, "member");
  const run = await openRunOrThrow(tx, ctx, input.runId);

  // Exactly one. Both would leave it ambiguous which line the stock lands in,
  // and neither is somebody forgetting the field rather than meaning "any".
  const newItemName = input.newItemName?.trim();
  if (!input.itemId === !newItemName) {
    throw new ProductionError(
      "ITEM_INVALID",
      "give either an existing item or a name for a new one",
    );
  }

  // `createItem` is owner-only because an item is a thing the business is made
  // of rather than a thing that happened to it. Recording a box against a line
  // that already exists stays a chore, which is the common case once a farm has
  // run one kill day.
  const itemId = newItemName
    ? (
        await createItem(tx, asInventory(ctx), {
          name: newItemName,
          stockingUnit: input.newItemUnit?.trim() || "lb",
          itemKind: input.newItemKind?.trim() || "produce",
        })
      ).id
    : input.itemId!;

  const item = await getItem(tx, ctx.tenantId, itemId);
  if (!item) {
    throw new ProductionError("ITEM_INVALID", "that item does not exist");
  }
  const quantity = roundQuantity(Math.abs(input.quantity));
  if (quantity <= 0) {
    throw new ProductionError("RUN_INVALID", "an output has to be positive");
  }

  const rows = await tx
    .insert(schema.productionRunOutputs)
    .values({
      tenantId: ctx.tenantId,
      runId: run.id,
      itemId,
      quantity,
      weightLb: input.weightLb ?? null,
      lotCode: (input.lotCode?.trim() || run.code).slice(0, 120),
      locationAssetId: input.locationAssetId ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/**
 * Correct an output before it lands.
 *
 * **THE SAME CALL `livestock` MADE FOR WEIGHTS AND TREATMENTS.** A box recorded
 * as 40 lb when the scale said 4 is not a ledger entry to be compensated for —
 * nothing has happened in `inventory` yet, so there is nothing to reverse and no
 * reason for a correcting row. Edit in place.
 *
 * Once the run is finished this refuses, and that is the other half of the same
 * rule: from then on the receipt is the fact.
 */
export async function updateRunOutput(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
  patch: {
    quantity?: number;
    weightLb?: number | null;
    lotCode?: string;
    locationAssetId?: string | null;
    notes?: string;
  },
): Promise<ProductionRunOutput> {
  requireWrite(ctx, "member");
  const existing = await tx.query.productionRunOutputs.findFirst({
    where: and(
      eq(schema.productionRunOutputs.tenantId, ctx.tenantId),
      eq(schema.productionRunOutputs.id, id),
    ),
  });
  if (!existing) throw new ProductionError("NOT_FOUND", "that output is gone");
  await openRunOrThrow(tx, ctx, existing.runId);

  const quantity =
    patch.quantity === undefined
      ? existing.quantity
      : roundQuantity(Math.abs(patch.quantity));
  if (quantity <= 0) {
    throw new ProductionError("RUN_INVALID", "an output has to be positive");
  }

  const rows = await tx
    .update(schema.productionRunOutputs)
    .set({
      quantity,
      weightLb: patch.weightLb === undefined ? existing.weightLb : patch.weightLb,
      lotCode: patch.lotCode?.trim() || existing.lotCode,
      locationAssetId:
        patch.locationAssetId === undefined
          ? existing.locationAssetId
          : patch.locationAssetId,
      notes: patch.notes === undefined ? existing.notes : patch.notes.trim(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.productionRunOutputs.tenantId, ctx.tenantId),
        eq(schema.productionRunOutputs.id, id),
      ),
    )
    .returning();
  return rows[0];
}

export async function removeRunOutput(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
): Promise<ProductionRunOutput> {
  requireWrite(ctx, "member");
  const existing = await tx.query.productionRunOutputs.findFirst({
    where: and(
      eq(schema.productionRunOutputs.tenantId, ctx.tenantId),
      eq(schema.productionRunOutputs.id, id),
    ),
  });
  if (!existing) throw new ProductionError("NOT_FOUND", "that output is gone");
  await openRunOrThrow(tx, ctx, existing.runId);

  const rows = await tx
    .delete(schema.productionRunOutputs)
    .where(
      and(
        eq(schema.productionRunOutputs.tenantId, ctx.tenantId),
        eq(schema.productionRunOutputs.id, id),
      ),
    )
    .returning();
  return rows[0];
}

// -------------------------------------------------------------- carcasses ---

export interface CarcassArgs {
  runId: string;
  /** Which input these came out of. Required — it is the traceability link. */
  runInputId: string;
  tag?: string;
  headCount?: number;
  liveLb?: number | null;
  hangingLb?: number | null;
  condemned?: boolean;
  condemnReason?: string;
  notes?: string;
}

/**
 * THE ONE THING ON THIS PACK A FINISHED RUN STILL ACCEPTS, and it is not an
 * oversight.
 *
 * Everything else here refuses once a run is complete, because everything else
 * has stamped something on the ledger and unwriting it would restate what
 * happened. **A carcass row stamps nothing.** It holds no quantity, no cost and
 * no movement — it is a transcription of a piece of paper, and the design says
 * plainly that the paper *arrives days after the run*, from a party who is not
 * this farm, sometimes by post. A sheet that could only be entered before the
 * boxes landed would be a sheet that was never entered.
 *
 * So this follows `livestock_weights` rather than `production_run_outputs`: a
 * measurement is not a ledger entry, a number typed wrong never happened, and it
 * is corrected in place. What it CANNOT do is move a figure that has already
 * been stamped — completing a run does not consult the sheet, and a sheet
 * entered afterwards changes no cost anywhere. It changes what the run can
 * explain about itself, which is the whole point of it.
 */
function carcassGuards(input: CarcassArgs): {
  headCount: number;
  liveLb: number | null;
  hangingLb: number | null;
  condemned: boolean;
  condemnReason: string;
} {
  const headCount = Math.trunc(input.headCount ?? 1);
  if (!Number.isFinite(headCount) || headCount <= 0) {
    throw new ProductionError(
      "CARCASS_INVALID",
      "a line has to cover at least one head",
    );
  }
  const condemned = input.condemned === true;
  const hangingLb = input.hangingLb ?? null;
  if (condemned && hangingLb !== null) {
    // Mirrors the CHECK, and the reason is worth throwing for rather than
    // letting Postgres phrase: a condemned carcass yields nothing sellable, so
    // pounds recorded against one would end up in a numerator that only
    // sellable meat belongs in.
    throw new ProductionError(
      "CARCASS_INVALID",
      "a condemned carcass has no hanging weight — nothing off it can be sold, so there are no pounds to record",
    );
  }
  const condemnReason = condemned ? (input.condemnReason?.trim() ?? "") : "";
  return {
    headCount,
    liveLb: input.liveLb ?? null,
    hangingLb,
    condemned,
    condemnReason,
  };
}

export async function addRunCarcass(
  tx: Tx,
  ctx: ProductionCtx,
  input: CarcassArgs,
): Promise<ProductionRunCarcass> {
  requireWrite(ctx, "member");
  // Deliberately NOT `openRunOrThrow` — see `carcassGuards` above.
  const run = await getRun(tx, ctx.tenantId, input.runId);
  if (!run) throw new ProductionError("NOT_FOUND", "that run no longer exists");

  const runInput = await tx.query.productionRunInputs.findFirst({
    where: and(
      eq(schema.productionRunInputs.tenantId, ctx.tenantId),
      eq(schema.productionRunInputs.id, input.runInputId),
    ),
  });
  // Checked here as well as by the FK, because the FK only says the input
  // exists. An input belonging to a DIFFERENT run would attribute this farm's
  // carcasses to the wrong pen, which is the one claim the chain exists to make
  // truthfully.
  if (!runInput || runInput.runId !== run.id) {
    throw new ProductionError(
      "CARCASS_INVALID",
      "pick which of this run's inputs the carcass came out of",
    );
  }

  const guarded = carcassGuards(input);
  const rows = await tx
    .insert(schema.productionRunCarcasses)
    .values({
      tenantId: ctx.tenantId,
      runId: run.id,
      runInputId: runInput.id,
      tag: input.tag?.trim().slice(0, 120) ?? "",
      headCount: guarded.headCount,
      liveLb: guarded.liveLb,
      hangingLb: guarded.hangingLb,
      disposition: guarded.condemned ? "condemned" : "passed",
      condemnReason: guarded.condemnReason,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/** Correct a transcribed line. In place — a number typed wrong never happened. */
export async function updateRunCarcass(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
  patch: Omit<CarcassArgs, "runId" | "runInputId">,
): Promise<ProductionRunCarcass> {
  requireWrite(ctx, "member");
  const existing = await tx.query.productionRunCarcasses.findFirst({
    where: and(
      eq(schema.productionRunCarcasses.tenantId, ctx.tenantId),
      eq(schema.productionRunCarcasses.id, id),
    ),
  });
  if (!existing) throw new ProductionError("NOT_FOUND", "that line is gone");

  /**
   * MERGED FIRST, VALIDATED AFTER — `livestock` learned this on treatments and
   * the trap is the same one. Clearing a condemnation without clearing its
   * hanging weight, or adding a hanging weight to a line that is still
   * condemned, are both reachable one field at a time, and validating the PATCH
   * rather than the resulting ROW would let either through.
   */
  const merged: CarcassArgs = {
    runId: existing.runId,
    runInputId: existing.runInputId,
    tag: patch.tag === undefined ? existing.tag : patch.tag,
    headCount: patch.headCount === undefined ? existing.headCount : patch.headCount,
    liveLb: patch.liveLb === undefined ? existing.liveLb : patch.liveLb,
    hangingLb:
      patch.hangingLb === undefined ? existing.hangingLb : patch.hangingLb,
    condemned:
      patch.condemned === undefined
        ? existing.disposition === "condemned"
        : patch.condemned,
    condemnReason:
      patch.condemnReason === undefined
        ? existing.condemnReason
        : patch.condemnReason,
    notes: patch.notes === undefined ? existing.notes : patch.notes,
  };
  const guarded = carcassGuards(merged);

  const rows = await tx
    .update(schema.productionRunCarcasses)
    .set({
      tag: merged.tag?.trim().slice(0, 120) ?? "",
      headCount: guarded.headCount,
      liveLb: guarded.liveLb,
      hangingLb: guarded.hangingLb,
      disposition: guarded.condemned ? "condemned" : "passed",
      condemnReason: guarded.condemnReason,
      notes: merged.notes?.trim() ?? "",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.productionRunCarcasses.tenantId, ctx.tenantId),
        eq(schema.productionRunCarcasses.id, id),
      ),
    )
    .returning();
  return rows[0];
}

export async function removeRunCarcass(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
): Promise<ProductionRunCarcass> {
  requireWrite(ctx, "member");
  const rows = await tx
    .delete(schema.productionRunCarcasses)
    .where(
      and(
        eq(schema.productionRunCarcasses.tenantId, ctx.tenantId),
        eq(schema.productionRunCarcasses.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new ProductionError("NOT_FOUND", "that line is gone");
  }
  return rows[0];
}

export async function listRunCarcasses(
  tx: Tx,
  tenantId: string,
  runId: string,
): Promise<ProductionRunCarcass[]> {
  return tx.query.productionRunCarcasses.findMany({
    where: and(
      eq(schema.productionRunCarcasses.tenantId, tenantId),
      eq(schema.productionRunCarcasses.runId, runId),
    ),
    // `id` breaks the tie because `now()` is TRANSACTION time in Postgres: two
    // lines transcribed in one transaction share a timestamp exactly, and the
    // row order of a kill sheet should not depend on which one the planner
    // happened to reach first.
    orderBy: (c, { asc: byAsc }) => [byAsc(c.createdAt), byAsc(c.id)],
  });
}

/**
 * The sheet's rows in the shape the fold wants.
 *
 * A thin mapping, and it lives here rather than in `core/carcass.ts` because the
 * core file must stay pure: it may not know what a drizzle row looks like, and
 * `disposition` is a string in the database and a boolean in the arithmetic.
 */
function carcassLines(rows: ProductionRunCarcass[]): CarcassLine[] {
  return rows.map((row) => ({
    key: row.id,
    inputKey: row.runInputId,
    headCount: row.headCount,
    liveLb: row.liveLb,
    hangingLb: row.hangingLb,
    condemned: row.disposition === "condemned",
    reason: row.condemnReason,
  }));
}

/**
 * What each input put in, for reconciling the sheet against it.
 *
 * **`headIn` IS THE COUNT DIMENSION'S BASE, NOT THE RAW QUANTITY.** Five dozen
 * is sixty, and a reconciliation that compared five against sixty carcasses
 * would refuse a sheet that was perfectly correct. `head` and `each` both convert
 * to themselves, so the ordinary case passes straight through.
 *
 * Anything not counted contributes null: a hundred pounds of flour has no head
 * to account for, and claiming a reconciliation over it would be inventing one.
 */
function sheetInputs(inputs: RunInputRow[]): SheetInput[] {
  return inputs.map((row) => {
    const dimension = getUnit(row.unit)?.dimension;
    return {
      key: row.id,
      headIn:
        dimension === "count" ? convert(row.quantity, row.unit, "each") : null,
      liveLb: weightLbOf(row.quantity, row.unit, row.weightLb),
    };
  });
}

// --------------------------------------------------------------- complete ---

export interface CompletionResult {
  run: ProductionRun;
  basis: RollBasis;
  /** What went in, in cents — the pot that was split. */
  potCents: number;
  /** Inputs whose movement carried no price at all. Reported, never guessed at. */
  unpricedInputs: number;
  landed: number;
}

/**
 * Finish the run: every output lands in `inventory`, carrying its share.
 *
 * **THIS IS THE SLICE'S POINT.** Until an output's receipt carries a cost that
 * came out of the pen, "what did this pen make" is not a question the app can
 * answer, and the profile's whole thesis — *every farm activity posts a cost to a
 * cost object* — describes nothing for meat.
 *
 * ONE TRANSACTION, ALL OUTPUTS. The pieces of a largest-remainder split only sum
 * to the pot if they all land; half a completion would put a different amount of
 * money on the shelf than the run took off it.
 *
 * Each output becomes a lot with `source = 'produced'`, which is the value
 * `inventory` has carried since its slice 0 and which its own column comment
 * says cannot be inferred retroactively.
 */
export async function completeRun(
  tx: Tx,
  ctx: ProductionCtx,
  runId: string,
  completedOn: string,
): Promise<CompletionResult> {
  requireWrite(ctx, "owner");
  const run = await openRunOrThrow(tx, ctx, runId);

  const outputs = await listRunOutputs(tx, ctx.tenantId, runId);
  if (outputs.length === 0) {
    throw new ProductionError(
      "NOTHING_TO_LAND",
      "record what came out before finishing the run — a run with no outputs has nothing to land",
    );
  }

  const inputs = await listRunInputs(tx, ctx.tenantId, runId);
  let potCents = 0;
  let unpricedInputs = 0;
  for (const row of inputs) {
    if (row.costCents === null) unpricedInputs += 1;
    else potCents += row.costCents;
  }

  const items = await itemsById(
    tx,
    ctx.tenantId,
    outputs.map((o) => o.itemId),
  );
  const roll = rollRun(
    potCents,
    outputs.map((o) => ({
      key: o.id,
      lb: outputWeightLb(o, items.get(o.itemId)),
      quantity: o.quantity,
      unit: items.get(o.itemId)?.stockingUnit ?? "each",
    })),
  );

  /**
   * HOW THIS RUN WAS INSPECTED, decided once, here, on the day the meat lands.
   *
   * A run with no processor was done on this farm and nothing inspected it. A
   * run with one inherits whatever that plant is inspected under RIGHT NOW —
   * and the value is then frozen on the run, because a plant's status can be
   * corrected, lapse or be upgraded later, and re-deriving this would silently
   * change what a box already in somebody's freezer may be sold as.
   */
  let inspection = "uninspected";
  if (run.processorId) {
    const processor = await tx.query.productionProcessors.findFirst({
      where: and(
        eq(schema.productionProcessors.tenantId, ctx.tenantId),
        eq(schema.productionProcessors.id, run.processorId),
      ),
    });
    inspection = processor?.inspection ?? "unknown";
  }

  for (const output of outputs) {
    const { movement, lotId } = await receiveStock(tx, asInventory(ctx), {
      itemId: output.itemId,
      newLotCode: output.lotCode,
      quantity: output.quantity,
      costCents: roll.byOutput.get(output.id) ?? null,
      occurredOn: completedOn,
      locationAssetId: output.locationAssetId,
      source: "produced",
      extensionSlug: "production",
      notes: output.notes,
    });
    /**
     * **THE LOT INHERITS THE ELIGIBILITY, AND THIS IS THE LINE THE DESIGN CALLS
     * EXISTENTIAL:** *"`retail` should refuse to list a lot into a channel that
     * is not legal for it. Selling uninspected product through the wrong
     * channel can end a poultry enterprise, and nothing on the market prevents
     * it."*
     *
     * Written into `inventory_lots.metadata`, the P2 extension bag, rather than
     * a column: `inventory` must not learn what an inspection is. It is
     * STAMPED rather than joined for the same reason it is stored on the run —
     * a box in a freezer is governed by what was true when it was packed, not
     * by what the plant's paperwork says next year.
     */
    // `receiveStock` only omits a lot when the item is not lot-tracked, and a
    // production output always is — but the type says nullable, and inventing
    // a non-null assertion on the line that stamps a legal eligibility is not
    // the place to be clever.
    if (lotId) {
      await tx
      .update(schema.inventoryLots)
      .set({
        metadata: sql`${schema.inventoryLots.metadata} || ${JSON.stringify({
          production: { inspection, runId: run.id },
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.inventoryLots.tenantId, ctx.tenantId),
          eq(schema.inventoryLots.id, lotId),
        ),
      );
    }
    await tx
      .update(schema.productionRunOutputs)
      .set({ lotId, inventoryMovementId: movement.id, updatedAt: new Date() })
      .where(
        and(
          eq(schema.productionRunOutputs.tenantId, ctx.tenantId),
          eq(schema.productionRunOutputs.id, output.id),
        ),
      );
  }

  const updated = await tx
    .update(schema.productionRuns)
    .set({
      status: "complete",
      completedOn,
      costBasis: roll.basis,
      inspection,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.productionRuns.tenantId, ctx.tenantId),
        eq(schema.productionRuns.id, run.id),
      ),
    )
    .returning();

  return {
    run: updated[0],
    basis: roll.basis,
    potCents,
    unpricedInputs,
    landed: outputs.length,
  };
}

// ------------------------------------------------------------------ reads ---

export interface RunInputRow {
  id: string;
  movementId: string;
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  lotCode: string | null;
  /** Positive, however the ledger signed it. What went in is not a negative. */
  quantity: number;
  costCents: number | null;
  occurredOn: string;
  movementKind: string;
  weightLb: number | null;
  notes: string;
}

/**
 * What went into a run, joined back to the ledger rows that hold the truth.
 *
 * `weight_lb` is the only column read from this pack's own table. Everything
 * else — the item, the batch, the quantity, the stamped cost — comes from
 * `inventory_movements`, because that is where it lives and a copy here would be
 * a second number to keep in step.
 */
export async function listRunInputs(
  tx: Tx,
  tenantId: string,
  runId: string,
): Promise<RunInputRow[]> {
  const rows = await tx
    .select({
      id: schema.productionRunInputs.id,
      weightLb: schema.productionRunInputs.weightLb,
      notes: schema.productionRunInputs.notes,
      movementId: schema.inventoryMovements.id,
      itemId: schema.inventoryMovements.itemId,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.stockingUnit,
      lotId: schema.inventoryMovements.lotId,
      lotCode: schema.inventoryLots.code,
      quantity: schema.inventoryMovements.quantity,
      costCents: schema.inventoryMovements.costCents,
      occurredOn: schema.inventoryMovements.occurredOn,
      movementKind: schema.inventoryMovements.movementKind,
    })
    .from(schema.productionRunInputs)
    .innerJoin(
      schema.inventoryMovements,
      and(
        eq(
          schema.inventoryMovements.tenantId,
          schema.productionRunInputs.tenantId,
        ),
        eq(
          schema.inventoryMovements.id,
          schema.productionRunInputs.inventoryMovementId,
        ),
      ),
    )
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryItems.id, schema.inventoryMovements.itemId),
      ),
    )
    .leftJoin(
      schema.inventoryLots,
      and(
        eq(schema.inventoryLots.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryLots.id, schema.inventoryMovements.lotId),
      ),
    )
    .where(
      and(
        eq(schema.productionRunInputs.tenantId, tenantId),
        eq(schema.productionRunInputs.runId, runId),
      ),
    )
    .orderBy(desc(schema.productionRunInputs.createdAt));

  return rows.map((r) => ({ ...r, quantity: Math.abs(r.quantity) }));
}

export async function listRunOutputs(
  tx: Tx,
  tenantId: string,
  runId: string,
): Promise<ProductionRunOutput[]> {
  return tx.query.productionRunOutputs.findMany({
    where: and(
      eq(schema.productionRunOutputs.tenantId, tenantId),
      eq(schema.productionRunOutputs.runId, runId),
    ),
    orderBy: (o, { asc: byAsc }) => [byAsc(o.createdAt)],
  });
}

async function itemsById(
  tx: Tx,
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, InventoryItem>> {
  const out = new Map<string, InventoryItem>();
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return out;
  const rows = await tx.query.inventoryItems.findMany({
    where: and(
      eq(schema.inventoryItems.tenantId, tenantId),
      inArray(schema.inventoryItems.id, unique),
    ),
  });
  for (const row of rows) out.set(row.id, row);
  return out;
}

/**
 * Pounds for one side of the scale.
 *
 * **DERIVED WHEN THE UNIT ALREADY IS A WEIGHT, ENTERED OTHERWISE, AND NEVER
 * BOTH.** 400 lb of ground beef is 400 lb; the row does not store that a second
 * time, because a stored copy is a number that can disagree with the quantity it
 * came from. 210 head is not a weight in any unit, so somebody has to have put
 * the pen on a scale — and when nobody did, this is null and the yield refuses
 * rather than guessing.
 *
 * Volume is deliberately not converted. There is no factor between gallons and
 * pounds that does not depend on what is in the bucket, which is `inventory`'s
 * own rule and is exactly as true for milk as for feed.
 */
function weightLbOf(
  quantity: number,
  unit: string | undefined,
  recorded: number | null,
): number | null {
  if (recorded !== null) return recorded;
  if (!unit) return null;
  const definition = getUnit(unit);
  if (!definition || definition.dimension !== "mass") return null;
  return convert(quantity, unit, "lb");
}

function outputWeightLb(
  output: ProductionRunOutput,
  item: InventoryItem | undefined,
): number | null {
  return weightLbOf(output.quantity, item?.stockingUnit, output.weightLb);
}

export interface RunOutputRow {
  output: ProductionRunOutput;
  itemName: string;
  unit: string;
  /** Pounds, derived or entered. Null when neither. */
  weightLb: number | null;
  /** What its receipt was stamped with. Null until the run is finished. */
  costCents: number | null;
}

export interface RunDetail {
  run: ProductionRun;
  /**
   * The name of the place that did it, or null for on-farm. Read alongside
   * `run.processorId` — which IS the processing path — so a screen never has to
   * join for a name it is about to print next to it.
   */
  processorName: string | null;
  inputs: RunInputRow[];
  outputs: RunOutputRow[];
  /** The kill sheet, line by line, oldest first. Empty on a run that has none. */
  carcasses: ProductionRunCarcass[];
  /** Head passed, head condemned, and the causes. Folded, never stored. */
  tally: CarcassTally;
  /** Live → hanging, or the reason there is not one. */
  dressing: DressingResult;
  /** Hanging → packaged, or the reason there is not one. */
  cutting: CuttingResult;
  /**
   * The OVERALL yield — packaged over everything that went in — or the reason
   * there is not one. Folded, never stored.
   *
   * **ITS DENOMINATOR IS UNCHANGED BY THE KILL SHEET AND THAT IS DELIBERATE.**
   * Slice 0 chose to state it plainly as *everything that went in* and refuse to
   * adjust it, so that a run which lost one to condemnation reads as a low yield
   * that is visible rather than a normal one with a hidden correction. The sheet
   * does not soften that number; it supplies the EXPLANATION that used to be
   * missing beside it, and the two stage ratios that say where the pounds went.
   */
  yieldResult: YieldResult;
  /** What went in, in cents. */
  potCents: number;
  /** Input movements that carried no price at all. */
  unpricedInputs: number;
  /** What the outputs actually landed carrying. Zero until the run is finished. */
  landedCents: number;
  blocks: Map<string, RunInputBlock>;
}

/**
 * Everything one run's page needs, folded rather than stored.
 *
 * Re-running this after a correction gives the corrected answer, which is the
 * property `livestock`'s feed report is built on and the reason neither pack
 * keeps a summary table.
 */
export async function runDetail(
  tx: Tx,
  tenantId: string,
  runId: string,
  today: string,
): Promise<RunDetail | null> {
  const run = await getRun(tx, tenantId, runId);
  if (!run) return null;

  const [inputs, outputs, carcasses] = await Promise.all([
    listRunInputs(tx, tenantId, runId),
    listRunOutputs(tx, tenantId, runId),
    listRunCarcasses(tx, tenantId, runId),
  ]);

  // The plant's name, for the screen. Two hops rather than one because the name
  // lives on the party — `production_processors` deliberately has no `name`
  // column, so it cannot disagree with the rest of the app.
  let processorName: string | null = null;
  if (run.processorId) {
    const row = await tx
      .select({ name: schema.parties.displayName })
      .from(schema.productionProcessors)
      .innerJoin(
        schema.parties,
        and(
          eq(schema.parties.tenantId, schema.productionProcessors.tenantId),
          eq(schema.parties.id, schema.productionProcessors.partyId),
        ),
      )
      .where(
        and(
          eq(schema.productionProcessors.tenantId, tenantId),
          eq(schema.productionProcessors.id, run.processorId),
        ),
      );
    processorName = row[0]?.name ?? null;
  }
  const items = await itemsById(
    tx,
    tenantId,
    outputs.map((o) => o.itemId),
  );

  const outputRows: RunOutputRow[] = outputs.map((output) => {
    const item = items.get(output.itemId);
    return {
      output,
      itemName: item?.name ?? "—",
      unit: item?.stockingUnit ?? "each",
      weightLb: outputWeightLb(output, item),
      costCents: null,
    };
  });

  // The landed cost is read back off the receipts, not recomputed from the
  // roll. What the shelf carries is what the ledger says it carries.
  const landedIds = outputs
    .map((o) => o.inventoryMovementId)
    .filter((id): id is string => id !== null);
  let landedCents = 0;
  if (landedIds.length > 0) {
    const receipts = await tx
      .select({
        id: schema.inventoryMovements.id,
        costCents: schema.inventoryMovements.costCents,
      })
      .from(schema.inventoryMovements)
      .where(
        and(
          eq(schema.inventoryMovements.tenantId, tenantId),
          inArray(schema.inventoryMovements.id, landedIds),
        ),
      );
    const byMovement = new Map(receipts.map((r) => [r.id, r.costCents]));
    for (const row of outputRows) {
      const movementId = row.output.inventoryMovementId;
      if (!movementId) continue;
      row.costCents = byMovement.get(movementId) ?? null;
      landedCents += row.costCents ?? 0;
    }
  }

  let potCents = 0;
  let unpricedInputs = 0;
  for (const row of inputs) {
    if (row.costCents === null) unpricedInputs += 1;
    else potCents += row.costCents;
  }

  const lotIds = inputs
    .map((i) => i.lotId)
    .filter((id): id is string => id !== null);

  // Folded once and handed to both stage ratios. Counting the sheet twice is how
  // a screen ends up saying "3 condemned" beside a ratio that used a different
  // three.
  const lines = carcassLines(carcasses);
  const sheet = sheetInputs(inputs);
  const tally = tallyCarcasses(lines, sheet);
  const outputWeights = outputRows.map((o) => ({
    key: o.output.id,
    lb: o.weightLb,
  }));

  return {
    run,
    processorName,
    inputs,
    outputs: outputRows,
    carcasses,
    tally,
    dressing: dressingPercentage(lines, sheet, tally),
    cutting: cuttingYield(lines, outputWeights, tally),
    yieldResult: runYield(
      inputs.map((i) => ({
        key: i.id,
        lb: weightLbOf(i.quantity, i.unit, i.weightLb),
      })),
      outputWeights,
    ),
    potCents,
    unpricedInputs,
    landedCents,
    // Shown on a FINISHED run too, because a withdrawal that was cleared at the
    // time is not what this says: it is where the pens stand today, and a lot
    // treated after the run is a different question from one treated before it.
    blocks: run.status === "in_progress"
      ? await inputBlocks(tx, tenantId, lotIds, today)
      : new Map(),
  };
}

export interface RunSummary {
  inputCount: number;
  outputCount: number;
  yieldResult: YieldResult;
  potCents: number;
  landedCents: number;
  /**
   * Head condemned across this run's kill sheet, and the head the sheet covers.
   *
   * **ON THE LIST BECAUSE THAT IS WHERE A PATTERN IS VISIBLE.** One run
   * condemning three birds is a fact; four runs in a row condemning three is the
   * thing worth acting on, and the design says exactly that about batch results
   * — the variance across runs is the learning. A per-run page can never show it.
   */
  headCondemned: number;
  headOnSheet: number;
}

/**
 * One line per run for the list page: how much went in, how much came out, and
 * the ratio between them.
 *
 * A FIXED NUMBER OF QUERIES whatever the run count — the same rule the livestock
 * list follows, because a page with twenty runs must not be a page with
 * twenty-one queries.
 */
export async function runSummaries(
  tx: Tx,
  tenantId: string,
  runIds: string[],
): Promise<Map<string, RunSummary>> {
  const out = new Map<string, RunSummary>();
  if (runIds.length === 0) return out;

  const [inputRows, outputRows, carcassRows] = await Promise.all([
    tx
      .select({
        runId: schema.productionRunInputs.runId,
        id: schema.productionRunInputs.id,
        weightLb: schema.productionRunInputs.weightLb,
        quantity: schema.inventoryMovements.quantity,
        costCents: schema.inventoryMovements.costCents,
        unit: schema.inventoryItems.stockingUnit,
      })
      .from(schema.productionRunInputs)
      .innerJoin(
        schema.inventoryMovements,
        and(
          eq(
            schema.inventoryMovements.tenantId,
            schema.productionRunInputs.tenantId,
          ),
          eq(
            schema.inventoryMovements.id,
            schema.productionRunInputs.inventoryMovementId,
          ),
        ),
      )
      .innerJoin(
        schema.inventoryItems,
        and(
          eq(schema.inventoryItems.tenantId, schema.inventoryMovements.tenantId),
          eq(schema.inventoryItems.id, schema.inventoryMovements.itemId),
        ),
      )
      .where(
        and(
          eq(schema.productionRunInputs.tenantId, tenantId),
          inArray(schema.productionRunInputs.runId, runIds),
        ),
      ),
    tx
      .select({
        runId: schema.productionRunOutputs.runId,
        id: schema.productionRunOutputs.id,
        weightLb: schema.productionRunOutputs.weightLb,
        quantity: schema.productionRunOutputs.quantity,
        unit: schema.inventoryItems.stockingUnit,
        movementId: schema.productionRunOutputs.inventoryMovementId,
        costCents: schema.inventoryMovements.costCents,
      })
      .from(schema.productionRunOutputs)
      .innerJoin(
        schema.inventoryItems,
        and(
          eq(schema.inventoryItems.tenantId, schema.productionRunOutputs.tenantId),
          eq(schema.inventoryItems.id, schema.productionRunOutputs.itemId),
        ),
      )
      .leftJoin(
        schema.inventoryMovements,
        and(
          eq(
            schema.inventoryMovements.tenantId,
            schema.productionRunOutputs.tenantId,
          ),
          eq(
            schema.inventoryMovements.id,
            schema.productionRunOutputs.inventoryMovementId,
          ),
        ),
      )
      .where(
        and(
          eq(schema.productionRunOutputs.tenantId, tenantId),
          inArray(schema.productionRunOutputs.runId, runIds),
        ),
      ),
    tx
      .select({
        runId: schema.productionRunCarcasses.runId,
        headCount: schema.productionRunCarcasses.headCount,
        disposition: schema.productionRunCarcasses.disposition,
      })
      .from(schema.productionRunCarcasses)
      .where(
        and(
          eq(schema.productionRunCarcasses.tenantId, tenantId),
          inArray(schema.productionRunCarcasses.runId, runIds),
        ),
      ),
  ]);

  for (const runId of runIds) {
    const ins = inputRows.filter((r) => r.runId === runId);
    const outs = outputRows.filter((r) => r.runId === runId);
    const sheet = carcassRows.filter((r) => r.runId === runId);
    out.set(runId, {
      inputCount: ins.length,
      outputCount: outs.length,
      headCondemned: sheet
        .filter((r) => r.disposition === "condemned")
        .reduce((total, r) => total + r.headCount, 0),
      headOnSheet: sheet.reduce((total, r) => total + r.headCount, 0),
      yieldResult: runYield(
        ins.map((r) => ({
          key: r.id,
          lb: weightLbOf(Math.abs(r.quantity), r.unit, r.weightLb),
        })),
        outs.map((r) => ({
          key: r.id,
          lb: weightLbOf(r.quantity, r.unit, r.weightLb),
        })),
      ),
      potCents: ins.reduce((sum, r) => sum + (r.costCents ?? 0), 0),
      landedCents: outs.reduce((sum, r) => sum + (r.costCents ?? 0), 0),
    });
  }
  return out;
}

/** Items a run can produce or consume. Archived ones are not on offer. */
export async function listRunItems(
  tx: Tx,
  tenantId: string,
): Promise<InventoryItem[]> {
  return listItems(tx, tenantId, { status: "active" });
}
