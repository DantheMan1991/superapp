import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  ilike,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  InventoryCostAdjustment,
  InventoryTaxTreatment,
  InventoryCount,
  InventoryCountLine,
  InventoryItem,
  InventoryLot,
  InventoryMovement,
} from "@/db/schema";
import {
  archiveDimensionMember,
  listDimensionMembers,
  upsertDimensionMember,
} from "@/modules/accounting/core";
import {
  COUNT_VARIANCE_REASON,
  isLotSource,
  isValidSlug,
} from "./vocabulary";
import { isKnownUnit, roundQuantity } from "./core/units";
import { enterpriseForMovement } from "./core/enterprise";
import type { MovementRow } from "./core/balances";
import {
  averageCostRate,
  issueCostCents,
  lotCarried,
  splitCostAdjustment,
  type CostAdjustment,
  type CostedMovement,
  type LotCarriedCost,
} from "./core/costing";
import {
  averagePackageWeight,
  type WeighedMovement,
} from "./core/weight";
import {
  carriedValue,
  valuationTotal,
  valueLine,
  type ValuationMethod,
  type ValuationTotal,
} from "./core/valuation";
import {
  isImplementedRule,
  isSubstitutingRule,
  isTimingRule,
  resolveTaxRule,
  type ResolvedTaxRule,
  type TaxRuleRow,
} from "./core/tax-rules";
import { postCostAdjustment, postMovement } from "./ledger-ops";

/**
 * Inventory operations. Every function takes a `Tx` so the caller owns the
 * transaction — the same rule `assets` and `land` follow, and for the same
 * reason: a write and its dimension sync must land together or not at all.
 *
 * THE COST OBJECT HERE IS THE LOT, not the item. "What did this pen of broilers
 * cost" and "what did this steer cost" are lot questions; nobody asks what
 * "feed" cost in the abstract. So lots sync into `dimension_members` and items
 * do not — which is also what makes profit-per-pen fall out of the existing
 * P&L with no accounting change at all.
 *
 * NOTHING IN HERE WRITES A BALANCE. Movements are events; the balance is their
 * sum, folded in `core/balances.ts`.
 */

/** The dimension type this pack owns. Core stores it; only this pack means anything by it. */
export const LOT_DIMENSION = "lot";

/**
 * A uuid, for guarding a value that came off a URL before it reaches a `uuid`
 * column. Postgres does not return nothing for a malformed one — it raises
 * `invalid input syntax for type uuid`, which surfaces as a 500.
 */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InventoryError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_KIND"
      | "INVALID_UNIT"
      | "INVALID_SOURCE"
      | "ITEM_INVALID"
      | "LOT_INVALID"
      | "LOT_CYCLE"
      | "ZERO_QUANTITY"
      | "INVALID_COST"
      | "INVALID_WEIGHT"
      | "INVALID_REASON"
      | "COUNT_CLOSED"
      | "COUNT_INVALID"
      | "INSUFFICIENT"
      | "LEDGER_ACCOUNTS"
      | "BILL_POSTED"
      | "ENTITY_AMBIGUOUS"
      | "ENTITY_MISMATCH"
      | "ALLOCATION_MISMATCH"
      | "POSTING_OFF"
      | "POSTING_LOCKED"
      | "INVALID_TIMING_RULE"
      | "TIMING_RULE_UNAVAILABLE"
      | "TAX_RULE_NEEDS_ACCOUNT",
    message: string,
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

export interface InventoryCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/**
 * Writes are owner-only, reads are member-wide.
 *
 * Forced from below as well as chosen: `upsertDimensionMember` calls
 * `requireOwnerRole`, so a staff-created lot could not sync its cost object and
 * would be invisible to every report — a worse outcome than a refusal. Reading
 * what is in the freezer stays ordinary work for whoever is sent to fetch it.
 *
 * WORTH REVISITING SOONER THAN THE OTHER PACKS: recording that four birds died
 * or that a bag of feed was opened is daily work for whoever is doing it, and
 * at 10x that person is not the owner. Slice 1 is where that starts to bite.
 */
function requireWrite(ctx: InventoryCtx, level: WriteLevel): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new InventoryError("FORBIDDEN", "only an owner can change this");
  }
}

// ------------------------------------------------------------------ items ---

/**
 * **`%` AND `_` ARE WILDCARDS, AND A PERSON TYPING ONE MEANS THE CHARACTER.**
 * Unescaped, a search box is a way to match every row by typing one key — and
 * `_` is worse than `%` because nothing about the result looks wrong.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listItems(
  tx: Tx,
  tenantId: string,
  filter: {
    kind?: string;
    status?: string;
    search?: string;
    /** An enterprise id, or `"none"` for the things belonging to none. */
    enterprise?: string;
  } = {},
): Promise<InventoryItem[]> {
  const where = [eq(schema.inventoryItems.tenantId, tenantId)];
  if (filter.kind) where.push(eq(schema.inventoryItems.itemKind, filter.kind));
  /**
   * **"NONE" IS A FILTER, NOT THE ABSENCE OF ONE.** Once things can be tagged,
   * *"what have I not tagged yet"* is the question somebody actually needs
   * answering — and it is unaskable if an empty parameter and an explicit
   * "untagged" mean the same thing.
   */
  if (filter.enterprise === "none") {
    where.push(isNull(schema.inventoryItems.enterpriseId));
  } else if (filter.enterprise) {
    /**
     * **A HAND-TYPED `?enterprise=` USED TO 500 THE WHOLE HUB**, because the
     * value went straight into a `uuid` column and Postgres refuses
     * `invalid input syntax for type uuid` rather than returning nothing.
     * Found by typing `?enterprise=all` at the page while driving it.
     *
     * **NO ROWS, not every row**, and that is the case worth getting right: a
     * valid uuid belonging to ANOTHER tenant already returns nothing here, so
     * a malformed one behaving the same way is the consistent answer. Ignoring
     * the filter instead would show a person the whole list under a bar
     * claiming to be filtered, which is the worse of the two lies.
     */
    if (!UUID_FORMAT.test(filter.enterprise)) return [];
    where.push(eq(schema.inventoryItems.enterpriseId, filter.enterprise));
  }
  if (filter.status) where.push(eq(schema.inventoryItems.status, filter.status));
  /**
   * **BY NAME, AND ONLY BY NAME.** The kind filter answers "just feed" and
   * "just animals"; this answers the question that cuts ACROSS kinds — chicken
   * feed, live broilers and packaged chicken are three kinds and one enterprise.
   * Matching notes as well would make a search for "beef" return the bag of feed
   * whose note says it is for the beef herd, which is a different question
   * wearing the same word.
   */
  const term = filter.search?.trim();
  if (term) {
    where.push(ilike(schema.inventoryItems.name, `%${escapeLike(term)}%`));
  }
  return tx.query.inventoryItems.findMany({
    where: and(...where),
    orderBy: (i, { asc: byAsc }) => [byAsc(i.itemKind), byAsc(i.name)],
  });
}

export async function getItem(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<InventoryItem | null> {
  const row = await tx.query.inventoryItems.findFirst({
    where: and(
      eq(schema.inventoryItems.tenantId, tenantId),
      eq(schema.inventoryItems.id, id),
    ),
  });
  return row ?? null;
}

export interface ItemInput {
  name: string;
  itemKind?: string;
  /**
   * Which line of business this belongs to, or null for none.
   *
   * **NOT VALIDATED HERE, AND THAT IS THE COMPOSITE FK'S JOB.** Naming another
   * tenant's is unrepresentable at the database; naming one that does not exist
   * fails the constraint. What this pack must not do is reach into
   * `src/lib/enterprises/` to re-check a thing the schema already guarantees.
   */
  enterpriseId?: string | null;
  stockingUnit: string;
  purchaseUnit?: string | null;
  purchaseUnitQty?: number | null;
  storageRequirement?: string | null;
  notes?: string;
}

export async function createItem(
  tx: Tx,
  ctx: InventoryCtx,
  input: ItemInput,
): Promise<InventoryItem> {
  requireWrite(ctx, "owner");
  const itemKind = (input.itemKind ?? "supply").trim().toLowerCase();
  if (!isValidSlug(itemKind)) {
    throw new InventoryError("INVALID_KIND", `invalid item kind: ${input.itemKind}`);
  }
  const stockingUnit = input.stockingUnit.trim();
  // The stocking unit is the one thing the whole balance is denominated in, so
  // an unrecognised one would produce a number nothing could convert or add.
  if (!isKnownUnit(stockingUnit)) {
    throw new InventoryError("INVALID_UNIT", `unknown unit: ${input.stockingUnit}`);
  }

  const rows = await tx
    .insert(schema.inventoryItems)
    .values({
      tenantId: ctx.tenantId,
      name: input.name.trim(),
      itemKind,
      enterpriseId: input.enterpriseId ?? null,
      stockingUnit,
      purchaseUnit: input.purchaseUnit?.trim() || null,
      purchaseUnitQty: input.purchaseUnitQty ?? null,
      storageRequirement: input.storageRequirement?.trim() || null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

export async function updateItem(
  tx: Tx,
  ctx: InventoryCtx,
  id: string,
  input: Partial<ItemInput>,
): Promise<InventoryItem> {
  requireWrite(ctx, "owner");
  const existing = await getItem(tx, ctx.tenantId, id);
  if (!existing) throw new InventoryError("NOT_FOUND", `item ${id} not found`);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.itemKind !== undefined) {
    const kind = input.itemKind.trim().toLowerCase();
    if (!isValidSlug(kind)) {
      throw new InventoryError("INVALID_KIND", `invalid item kind: ${input.itemKind}`);
    }
    patch.itemKind = kind;
  }
  if (input.stockingUnit !== undefined) {
    // CHANGING THE STOCKING UNIT DOES NOT RESTATE HISTORY, and must not
    // pretend to. Every movement was recorded in the old unit, so converting
    // the column alone would silently re-denominate the entire ledger. The
    // pack refuses it once anything has moved.
    const unit = input.stockingUnit.trim();
    if (!isKnownUnit(unit)) {
      throw new InventoryError("INVALID_UNIT", `unknown unit: ${input.stockingUnit}`);
    }
    if (unit !== existing.stockingUnit) {
      const moved = await tx.query.inventoryMovements.findFirst({
        where: and(
          eq(schema.inventoryMovements.tenantId, ctx.tenantId),
          eq(schema.inventoryMovements.itemId, id),
        ),
        columns: { id: true },
      });
      if (moved) {
        throw new InventoryError(
          "INVALID_UNIT",
          "this item already has movements recorded in its current unit, so changing it would restate every one of them",
        );
      }
      patch.stockingUnit = unit;
    }
  }
  if (input.enterpriseId !== undefined) {
    patch.enterpriseId = input.enterpriseId;
  }
  if (input.purchaseUnit !== undefined) {
    patch.purchaseUnit = input.purchaseUnit?.trim() || null;
  }
  if (input.purchaseUnitQty !== undefined) {
    patch.purchaseUnitQty = input.purchaseUnitQty;
  }
  if (input.storageRequirement !== undefined) {
    patch.storageRequirement = input.storageRequirement?.trim() || null;
  }
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.inventoryItems)
    .set(patch)
    .where(
      and(
        eq(schema.inventoryItems.tenantId, ctx.tenantId),
        eq(schema.inventoryItems.id, id),
      ),
    )
    .returning();
  return rows[0];
}

/** Archive an item. NOT a delete — its movements and lots keep reporting. */
export async function archiveItem(
  tx: Tx,
  ctx: InventoryCtx,
  id: string,
): Promise<InventoryItem> {
  return setItemStatus(tx, ctx, id, "archived");
}

/**
 * Put an archived item back.
 *
 * **ARCHIVING WITHOUT THIS IS A TRAP, and it was one for as long as
 * `archiveItem` had no caller.** Retiring an item is a judgement — the freezer
 * is empty, the line is discontinued — and judgements are wrong sometimes. A
 * one-way control on a list somebody is tidying would strand the item where
 * only a `?archived=1` query parameter can see it.
 *
 * Its own act rather than a field on `updateItem`, so it gets its own audit
 * entry: retiring a thing the business holds is not the same kind of event as
 * correcting its spelling.
 */
export async function restoreItem(
  tx: Tx,
  ctx: InventoryCtx,
  id: string,
): Promise<InventoryItem> {
  return setItemStatus(tx, ctx, id, "active");
}

async function setItemStatus(
  tx: Tx,
  ctx: InventoryCtx,
  id: string,
  status: "active" | "archived",
): Promise<InventoryItem> {
  requireWrite(ctx, "owner");
  const existing = await getItem(tx, ctx.tenantId, id);
  if (!existing) throw new InventoryError("NOT_FOUND", `item ${id} not found`);
  const rows = await tx
    .update(schema.inventoryItems)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inventoryItems.tenantId, ctx.tenantId),
        eq(schema.inventoryItems.id, id),
      ),
    )
    .returning();
  return rows[0];
}

// ------------------------------------------------------------------- lots ---

export async function listLots(
  tx: Tx,
  tenantId: string,
  filter: { itemId?: string; status?: string } = {},
): Promise<InventoryLot[]> {
  const where = [eq(schema.inventoryLots.tenantId, tenantId)];
  if (filter.itemId) where.push(eq(schema.inventoryLots.itemId, filter.itemId));
  if (filter.status) where.push(eq(schema.inventoryLots.status, filter.status));
  return tx.query.inventoryLots.findMany({
    where: and(...where),
    orderBy: (l, { desc: byDesc }) => [byDesc(l.createdAt)],
  });
}

/**
 * Lots by id, keyed by id, for a caller that already holds a set of them.
 *
 * Added for `livestock`'s pedigree screens, which hold animal ids and need the
 * CODE a person calls each one — the same shape as `movementsByIds`, and here
 * rather than there because the lot is this pack's row.
 */
export async function lotsByIds(
  tx: Tx,
  tenantId: string,
  ids: string[],
): Promise<Map<string, InventoryLot>> {
  const out = new Map<string, InventoryLot>();
  if (ids.length === 0) return out;
  const rows = await tx.query.inventoryLots.findMany({
    where: and(
      eq(schema.inventoryLots.tenantId, tenantId),
      inArray(schema.inventoryLots.id, ids),
    ),
  });
  for (const row of rows) out.set(row.id, row);
  return out;
}

export async function getLot(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<InventoryLot | null> {
  const row = await tx.query.inventoryLots.findFirst({
    where: and(
      eq(schema.inventoryLots.tenantId, tenantId),
      eq(schema.inventoryLots.id, id),
    ),
  });
  return row ?? null;
}

export interface LotInput {
  itemId: string;
  code: string;
  source?: string;
  parentLotId?: string | null;
  openedOn?: string | null;
  /** When this batch stops being good. A batch fact, never an item one. */
  expiresOn?: string | null;
  /**
   * Which line of business this batch belongs to. **Defaults to the ITEM's**,
   * which is the answer nine times in ten and saves asking on every delivery.
   * Pass `null` explicitly to leave a batch untagged under a tagged item.
   */
  enterpriseId?: string | null;
  notes?: string;
}

export async function createLot(
  tx: Tx,
  ctx: InventoryCtx,
  input: LotInput,
): Promise<InventoryLot> {
  requireWrite(ctx, "owner");
  const item = await getItem(tx, ctx.tenantId, input.itemId);
  if (!item) throw new InventoryError("ITEM_INVALID", "that item does not exist");
  const source = input.source ?? "purchased";
  if (!isLotSource(source)) {
    throw new InventoryError("INVALID_SOURCE", `invalid lot source: ${input.source}`);
  }
  if (input.parentLotId) {
    await assertParentUsable(tx, ctx.tenantId, input.parentLotId);
  }

  const rows = await tx
    .insert(schema.inventoryLots)
    .values({
      tenantId: ctx.tenantId,
      itemId: input.itemId,
      code: input.code.trim(),
      source,
      parentLotId: input.parentLotId ?? null,
      openedOn: input.openedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      /**
       * **INHERITED FROM THE ITEM WHEN NOT SAID, and that is a default rather
       * than a rule.** A farm that has tagged "Broiler chicks" as Broilers
       * should not have to say so again on every hatch; a batch that genuinely
       * belongs elsewhere overrides it here, which is why the column exists on
       * both. `undefined` means "not said" and `null` means "said none" — the
       * distinction the whole pack keeps.
       */
      enterpriseId:
        input.enterpriseId === undefined
          ? item.enterpriseId
          : input.enterpriseId,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  const lot = rows[0];

  // Same transaction, always. A lot is THE cost object of this pack.
  await upsertDimensionMember(tx, ctx, {
    dimensionType: LOT_DIMENSION,
    packEntityId: lot.id,
    displayName: `${item.name} · ${lot.code}`,
  });

  return lot;
}

/** Every lot descended from `rootId`, exclusive. Iterative — depth is unbounded. */
async function descendantLotIds(
  tx: Tx,
  tenantId: string,
  rootId: string,
): Promise<Set<string>> {
  const seen = new Set<string>();
  let frontier = [rootId];
  while (frontier.length > 0) {
    // `inArray`, NOT sql`= any(${frontier})`. Interpolating a JS array into a
    // raw fragment binds the whole array as ONE parameter and Postgres rejects
    // it — that shipped once in assets/ops.ts and silently disabled a guard.
    const children = await tx.query.inventoryLots.findMany({
      where: and(
        eq(schema.inventoryLots.tenantId, tenantId),
        inArray(schema.inventoryLots.parentLotId, frontier),
      ),
      columns: { id: true },
    });
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      frontier.push(child.id);
    }
  }
  return seen;
}

async function assertParentUsable(
  tx: Tx,
  tenantId: string,
  parentId: string,
  movingId?: string,
): Promise<void> {
  const parent = await getLot(tx, tenantId, parentId);
  if (!parent) throw new InventoryError("LOT_INVALID", "that lot does not exist");
  if (!movingId) return;
  if (parentId === movingId) {
    throw new InventoryError("LOT_CYCLE", "a lot cannot descend from itself");
  }
  const below = await descendantLotIds(tx, tenantId, movingId);
  if (below.has(parentId)) {
    throw new InventoryError(
      "LOT_CYCLE",
      "that would put the lot inside its own lineage",
    );
  }
}

/** Close a lot: nothing left, or it has moved on. Archives its cost object. */
export async function closeLot(
  tx: Tx,
  ctx: InventoryCtx,
  id: string,
): Promise<InventoryLot> {
  requireWrite(ctx, "owner");
  const existing = await getLot(tx, ctx.tenantId, id);
  if (!existing) throw new InventoryError("NOT_FOUND", `lot ${id} not found`);
  const rows = await tx
    .update(schema.inventoryLots)
    .set({ status: "closed", updatedAt: new Date() })
    .where(
      and(
        eq(schema.inventoryLots.tenantId, ctx.tenantId),
        eq(schema.inventoryLots.id, id),
      ),
    )
    .returning();

  // ARCHIVED, never removed: an archived member stops being taggable while
  // every existing tag keeps reporting, which is what a finished batch wants.
  const members = await listDimensionMembers(tx, ctx.tenantId, LOT_DIMENSION);
  const member = members.find((m) => m.packEntityId === id);
  if (member) await archiveDimensionMember(tx, ctx, { memberId: member.id });
  return rows[0];
}

// -------------------------------------------------------------- movements ---

export interface MovementInput {
  itemId: string;
  lotId?: string | null;
  locationAssetId?: string | null;
  /** Signed, in the item's stocking unit. */
  quantity: number;
  movementKind: string;
  occurredOn: string;
  /** Total money for this movement, in cents. Never a rate. */
  costCents?: number | null;
  /**
   * Total POUNDS for this movement, never a rate, and only on the way IN.
   *
   * "38 packages, 47.5 lb" — the fact a plant reports. `core/weight.ts` derives
   * the average from it; nothing derives a weight it was not given.
   */
  weightLb?: number | null;
  /** Which lot consumed it — a pen of broilers eating a delivery of feed. */
  issuedToLotId?: string | null;
  /** Why, when the kind does not already say. Open taxonomy; see the column. */
  reason?: string | null;
  extensionSlug?: string;
  notes?: string;
}

/**
 * Record one movement. THE write everything else is built from.
 *
 * Deliberately does NOT refuse a movement that takes a lot negative. Stock goes
 * negative the moment somebody issues feed on Tuesday and records Monday's
 * delivery on Wednesday, and a system that rejects the Tuesday entry teaches
 * people to stop entering things — which costs far more than a temporarily
 * wrong number. Surfacing it is slice 2's job, through adjustments and counts.
 */
export async function recordMovement(
  tx: Tx,
  ctx: InventoryCtx,
  input: MovementInput,
): Promise<InventoryMovement> {
  requireWrite(ctx, "member");
  const item = await getItem(tx, ctx.tenantId, input.itemId);
  if (!item) throw new InventoryError("ITEM_INVALID", "that item does not exist");

  const kind = input.movementKind.trim().toLowerCase();
  if (!isValidSlug(kind)) {
    throw new InventoryError("INVALID_KIND", `invalid movement kind: ${input.movementKind}`);
  }
  const quantity = roundQuantity(input.quantity);
  if (quantity === 0) {
    // A movement of nothing is not an event, and the one table that has to
    // reconcile should not carry rows that mean nothing happened.
    throw new InventoryError("ZERO_QUANTITY", "a movement cannot be zero");
  }
  let lotSource: string | null = null;
  let lotCode: string | null = null;
  let lotEnterpriseId: string | null = null;
  let consumerEnterpriseId: string | null = null;
  if (input.lotId) {
    const lot = await getLot(tx, ctx.tenantId, input.lotId);
    if (!lot) throw new InventoryError("LOT_INVALID", "that lot does not exist");
    if (lot.itemId !== input.itemId) {
      throw new InventoryError(
        "LOT_INVALID",
        "that lot belongs to a different item",
      );
    }
    // The ledger needs to know whether this stock was BOUGHT or MADE — see
    // `postMovement`, where it decides the credit side of a receipt.
    lotSource = lot.source;
    lotCode = lot.code;
    lotEnterpriseId = lot.enterpriseId;
  }
  if (input.issuedToLotId) {
    // The CONSUMING lot is deliberately unconstrained as to item: feed is not
    // the same item as the birds that eat it, and that difference is the whole
    // point of the column. It only has to exist and be this tenant's.
    const consumer = await getLot(tx, ctx.tenantId, input.issuedToLotId);
    if (!consumer) {
      throw new InventoryError("LOT_INVALID", "that consuming lot does not exist");
    }
    // **AND ITS LINE OF BUSINESS IS THE ONE THAT BEARS THE COST.** The same
    // join that closes the costing loop answers the money question too — see
    // `core/enterprise.ts`.
    consumerEnterpriseId = consumer.enterpriseId;
  }
  if (input.costCents !== undefined && input.costCents !== null && input.costCents < 0) {
    throw new InventoryError("INVALID_COST", "a cost cannot be negative");
  }
  const weightLb = input.weightLb ?? null;
  if (weightLb !== null) {
    // Both of these are CHECK constraints too. Refusing here as well turns a
    // constraint violation — which surfaces as a 500 nobody can act on — into
    // the pack's own error with a sentence in it.
    if (weightLb <= 0) {
      throw new InventoryError("INVALID_WEIGHT", "a weight has to be more than nothing");
    }
    if (quantity <= 0) {
      // `core/weight.ts` folds only inbound movements, so a weight recorded
      // here would be read by nothing while looking like a number that meant
      // something.
      throw new InventoryError(
        "INVALID_WEIGHT",
        "only stock arriving carries a weight — what leaves is weighed by whoever weighs it",
      );
    }
  }
  const reason = input.reason?.trim().toLowerCase() || null;
  if (reason !== null && !isValidSlug(reason)) {
    throw new InventoryError("INVALID_REASON", `invalid reason: ${input.reason}`);
  }

  const rows = await tx
    .insert(schema.inventoryMovements)
    .values({
      tenantId: ctx.tenantId,
      itemId: input.itemId,
      lotId: input.lotId ?? null,
      locationAssetId: input.locationAssetId ?? null,
      quantity,
      movementKind: kind,
      occurredOn: input.occurredOn,
      costCents: input.costCents ?? null,
      weightLb: weightLb === null ? null : roundQuantity(weightLb),
      issuedToLotId: input.issuedToLotId ?? null,
      reason,
      extensionSlug: input.extensionSlug?.trim() || "inventory",
      notes: input.notes?.trim() ?? "",
    })
    .returning();

  /**
   * **THE BOOKS FOLLOW THE SHELF, AND THEY FOLLOW IT FROM HERE.**
   *
   * Posting used to hang off `receiveStock`, `issueStock` and `adjustStock`,
   * which was wrong in a way that only showed up across packs: cost enters and
   * leaves inventory through more paths than those three. `livestock`'s
   * `removeHead` writes a costed movement straight through this function when a
   * pen is processed, so the pen's cost left the lot and never left `1300` —
   * and the meat it became was capitalised again on top.
   *
   * This is the write everything is built from, so it is the only place that
   * can see every one of them.
   */
  await postMovement(tx, ctx, {
    movementId: rows[0].id,
    movementKind: kind,
    quantity,
    costCents: rows[0].costCents,
    lotSource,
    occurredOn: input.occurredOn,
    itemId: input.itemId,
    lotCode,
    locationAssetId: input.locationAssetId ?? null,
    /**
     * **RESOLVED HERE BECAUSE ALL THREE TAGS ARE ALREADY IN HAND.** The item,
     * the batch and the consuming batch have each been loaded above to be
     * validated; asking the ledger to work the enterprise out for itself would
     * be three more queries for an answer this function is holding.
     */
    enterprises: enterpriseForMovement({
      itemEnterpriseId: item.enterpriseId,
      lotEnterpriseId,
      consumerEnterpriseId,
      hasLot: !!input.lotId,
    }),
  });

  return rows[0];
}

export async function listMovements(
  tx: Tx,
  tenantId: string,
  filter: { itemId?: string; lotId?: string; limit?: number } = {},
): Promise<InventoryMovement[]> {
  const where = [eq(schema.inventoryMovements.tenantId, tenantId)];
  if (filter.itemId) where.push(eq(schema.inventoryMovements.itemId, filter.itemId));
  if (filter.lotId) where.push(eq(schema.inventoryMovements.lotId, filter.lotId));
  return tx.query.inventoryMovements.findMany({
    where: and(...where),
    orderBy: (m, { desc: byDesc }) => [byDesc(m.occurredOn), byDesc(m.createdAt)],
    limit: filter.limit,
  });
}

/** The raw rows `core/balances.ts` folds. One query per item. */
export async function movementRowsForItem(
  tx: Tx,
  tenantId: string,
  itemId: string,
): Promise<MovementRow[]> {
  const rows = await tx
    .select({
      itemId: schema.inventoryMovements.itemId,
      lotId: schema.inventoryMovements.lotId,
      locationAssetId: schema.inventoryMovements.locationAssetId,
      quantity: schema.inventoryMovements.quantity,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        eq(schema.inventoryMovements.itemId, itemId),
      ),
    );
  return rows;
}

/**
 * Movements against a set of lots on ONE day, keyed by lot.
 *
 * Written for `livestock`'s daily round, and deliberately here rather than
 * there: the ledger is this pack's, and a neighbour that queried
 * `inventory_movements` directly would be the leak the extension model forbids.
 *
 * It exists so the round can show what was recorded today WITHOUT storing it —
 * the losses entered during a check are ordinary movements, and the log screen
 * reads them back out of the ledger rather than keeping a second copy that has
 * to agree with it forever.
 */
export async function movementsOnDate(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
  occurredOn: string,
): Promise<Map<string, { movementKind: string; quantity: number }[]>> {
  const out = new Map<string, { movementKind: string; quantity: number }[]>();
  if (lotIds.length === 0) return out;
  const rows = await tx
    .select({
      lotId: schema.inventoryMovements.lotId,
      movementKind: schema.inventoryMovements.movementKind,
      quantity: schema.inventoryMovements.quantity,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.lotId, lotIds),
        eq(schema.inventoryMovements.occurredOn, occurredOn),
      ),
    );
  for (const row of rows) {
    if (!row.lotId) continue;
    const entry = { movementKind: row.movementKind, quantity: row.quantity };
    const list = out.get(row.lotId);
    if (list) list.push(entry);
    else out.set(row.lotId, [entry]);
  }
  return out;
}

/**
 * Dated movements for a set of lots, newest first.
 *
 * `movementKindsForLots` deliberately drops the date, because a balance does
 * not need one. **A diagnosis does.** The livestock design's rule is that
 * timing implies cause — losses in the first week point at chick quality or
 * brooding, losses in the last at heat and the leg and heart problems of fast
 * growth — and a total with no dates cannot tell those apart.
 *
 * Capped rather than unbounded by default: at 10x these lots carry thousands of
 * rows between them, and the advisor wants the recent shape, not the archive.
 *
 * **`limit: null` MEANS EVERY ROW, AND SOME CALLERS NEED IT.** A running balance
 * day by day — what `livestock`'s feed allocation divides by — cannot be
 * computed from the most recent 200 movements, because the opening balance would
 * silently start in the middle of the ledger. A cap is right for a digest and
 * wrong for arithmetic.
 */
export async function datedMovementsForLots(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
  limit: number | null = 200,
): Promise<
  Map<string, { occurredOn: string; movementKind: string; quantity: number }[]>
> {
  const out = new Map<
    string,
    { occurredOn: string; movementKind: string; quantity: number }[]
  >();
  if (lotIds.length === 0) return out;
  const query = tx
    .select({
      lotId: schema.inventoryMovements.lotId,
      occurredOn: schema.inventoryMovements.occurredOn,
      movementKind: schema.inventoryMovements.movementKind,
      quantity: schema.inventoryMovements.quantity,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.lotId, lotIds),
      ),
    )
    .orderBy(
      desc(schema.inventoryMovements.occurredOn),
      desc(schema.inventoryMovements.createdAt),
    );
  const rows = limit === null ? await query : await query.limit(limit);
  for (const row of rows) {
    if (!row.lotId) continue;
    const entry = {
      occurredOn: row.occurredOn,
      movementKind: row.movementKind,
      quantity: row.quantity,
    };
    const list = out.get(row.lotId);
    if (list) list.push(entry);
    else out.set(row.lotId, [entry]);
  }
  return out;
}

/**
 * Movement KINDS and quantities for a set of lots.
 *
 * `MovementRow` deliberately carries only what a balance needs, and a balance
 * does not care why stock moved. But a pack that composes this one may:
 * `livestock` has to tell a death from a transfer to compute mortality at all,
 * and that classification is its business rather than inventory's. So the rows
 * come out typed and unclassified, and the caller decides what they mean.
 */
export async function movementKindsForLots(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<Map<string, { movementKind: string; quantity: number }[]>> {
  const out = new Map<string, { movementKind: string; quantity: number }[]>();
  if (lotIds.length === 0) return out;
  const rows = await tx
    .select({
      lotId: schema.inventoryMovements.lotId,
      movementKind: schema.inventoryMovements.movementKind,
      quantity: schema.inventoryMovements.quantity,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.lotId, lotIds),
      ),
    );
  for (const row of rows) {
    if (!row.lotId) continue;
    const entry = { movementKind: row.movementKind, quantity: row.quantity };
    const list = out.get(row.lotId);
    if (list) list.push(entry);
    else out.set(row.lotId, [entry]);
  }
  return out;
}

/**
 * On-hand per item for the list page, summed in SQL.
 *
 * Folded in the database rather than in JS purely because the list would
 * otherwise pull every movement the business has ever recorded to render one
 * column. Per-item detail still folds in `core/balances.ts`, where it is
 * testable without a database.
 */
export async function onHandByItem(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      itemId: schema.inventoryMovements.itemId,
      quantity: sql<string>`sum(${schema.inventoryMovements.quantity})`,
    })
    .from(schema.inventoryMovements)
    .where(eq(schema.inventoryMovements.tenantId, tenantId))
    .groupBy(schema.inventoryMovements.itemId);
  return new Map(rows.map((r) => [r.itemId, roundQuantity(Number(r.quantity))]));
}

/**
 * Split a lot: move quantity out of it and into a NEW child lot.
 *
 * **One of only two operations that change cardinality**, and the one
 * `livestock` cannot live without — a batch of chicks arrives as one purchase
 * and splits across pens. It is two movements and a lot row, and it BALANCES:
 * the ledger's total is unchanged, which is what makes the head count reconcile
 * with its own history rather than being asserted.
 */
export async function splitLot(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    lotId: string;
    quantity: number;
    newCode: string;
    occurredOn: string;
    locationAssetId?: string | null;
    notes?: string;
  },
): Promise<{ parent: InventoryLot; child: InventoryLot }> {
  requireWrite(ctx, "owner");
  const parent = await getLot(tx, ctx.tenantId, input.lotId);
  if (!parent) throw new InventoryError("NOT_FOUND", `lot ${input.lotId} not found`);
  const quantity = roundQuantity(input.quantity);
  if (quantity <= 0) {
    throw new InventoryError("ZERO_QUANTITY", "split a positive quantity");
  }

  const child = await createLot(tx, ctx, {
    itemId: parent.itemId,
    code: input.newCode,
    source: parent.source,
    parentLotId: parent.id,
    openedOn: input.occurredOn,
    /**
     * **A SPLIT MUST NOT MOVE COST BETWEEN LINES OF BUSINESS**, and leaving
     * this out silently did.
     *
     * `createLot` reads an ABSENT `enterpriseId` as "not said" and inherits the
     * ITEM's — which is right for a delivery arriving into a brand-new batch and
     * wrong for a piece cut off an existing one. A pen tagged Broilers, split
     * into two pens, produced a child carrying whatever the item happened to
     * say: nothing, or worse, a different line of business. `livestock` splits
     * through here, so its own comment — *"the biology travels with the
     * animals"* — was true of the species, the sex, the birth date and both
     * parents, and not of the money.
     *
     * `splitIntoIndividuals` calls this once PER ANIMAL, so naming ten cows out
     * of a pen minted ten mis-tagged lots in one click.
     *
     * **`parent.enterpriseId` is passed even when it is null**, which is the
     * point rather than an edge case: an explicitly untagged parent must not
     * have the item's tag applied to its children behind its back. The child
     * reports exactly as the parent does, in both directions.
     */
    enterpriseId: parent.enterpriseId,
    notes: input.notes,
  });

  await recordMovement(tx, ctx, {
    itemId: parent.itemId,
    lotId: parent.id,
    locationAssetId: input.locationAssetId ?? null,
    quantity: -quantity,
    movementKind: "split_out",
    occurredOn: input.occurredOn,
    notes: `Split to ${child.code}`,
  });
  await recordMovement(tx, ctx, {
    itemId: parent.itemId,
    lotId: child.id,
    locationAssetId: input.locationAssetId ?? null,
    quantity,
    movementKind: "split_in",
    occurredOn: input.occurredOn,
    notes: `Split from ${parent.code}`,
  });

  return { parent, child };
}

/**
 * Merge one lot into another: everything left of `fromLotId` moves to
 * `intoLotId`.
 *
 * **THE LINEAGE HERE IS THE MOVEMENTS, not `parent_lot_id`**, and that
 * asymmetry with `splitLot` is deliberate rather than an oversight. A single
 * parent pointer cannot express "these three batches became that one" — and
 * pointing the merged lots AT the survivor would read backwards, as though they
 * had descended from it. The `merge_out` / `merge_in` pair records the join
 * honestly and in both directions, which is what a traceability question
 * actually walks.
 */
export async function mergeLot(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    fromLotId: string;
    intoLotId: string;
    quantity: number;
    occurredOn: string;
    locationAssetId?: string | null;
  },
): Promise<void> {
  requireWrite(ctx, "member");
  const from = await getLot(tx, ctx.tenantId, input.fromLotId);
  const into = await getLot(tx, ctx.tenantId, input.intoLotId);
  if (!from || !into) throw new InventoryError("NOT_FOUND", "lot not found");
  if (from.id === into.id) {
    throw new InventoryError("LOT_INVALID", "a lot cannot merge into itself");
  }
  if (from.itemId !== into.itemId) {
    // Merging across items would produce a balance denominated in two units,
    // which is the exact bug the one-stocking-unit rule exists to prevent.
    throw new InventoryError(
      "LOT_INVALID",
      "those lots are different items and cannot merge",
    );
  }
  const quantity = roundQuantity(input.quantity);
  if (quantity <= 0) {
    throw new InventoryError("ZERO_QUANTITY", "merge a positive quantity");
  }

  await recordMovement(tx, ctx, {
    itemId: from.itemId,
    lotId: from.id,
    locationAssetId: input.locationAssetId ?? null,
    quantity: -quantity,
    movementKind: "merge_out",
    occurredOn: input.occurredOn,
    notes: `Merged into ${into.code}`,
  });
  await recordMovement(tx, ctx, {
    itemId: into.itemId,
    lotId: into.id,
    locationAssetId: input.locationAssetId ?? null,
    quantity,
    movementKind: "merge_in",
    occurredOn: input.occurredOn,
    notes: `Merged from ${from.code}`,
  });
}

/** Item kinds actually in use, for the filter bar. One grouped index scan. */
export async function listKindsInUse(
  tx: Tx,
  tenantId: string,
): Promise<{ kind: string; count: number }[]> {
  return tx
    .select({
      kind: schema.inventoryItems.itemKind,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.tenantId, tenantId))
    .groupBy(schema.inventoryItems.itemKind)
    .orderBy(asc(schema.inventoryItems.itemKind));
}

/** Lots for several items at once, keyed by item. One query for a list page. */
export async function lotsByItem(
  tx: Tx,
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, InventoryLot[]>> {
  const out = new Map<string, InventoryLot[]>();
  if (itemIds.length === 0) return out;
  const rows = await tx.query.inventoryLots.findMany({
    where: and(
      eq(schema.inventoryLots.tenantId, tenantId),
      inArray(schema.inventoryLots.itemId, itemIds),
    ),
    orderBy: (l, { desc: byDesc }) => [byDesc(l.createdAt)],
  });
  for (const row of rows) {
    const list = out.get(row.itemId);
    if (list) list.push(row);
    else out.set(row.itemId, [row]);
  }
  return out;
}

/** Storage locations on offer: active assets. Locations ARE assets. */
/**
 * The places this business keeps things.
 *
 * ONLY ASSETS MARKED AS A PLACE THINGS ARE KEPT. It used to return every active
 * asset, so the picker offered a gate and a tractor as somewhere to put
 * chickens — a function whose name claimed a filter it never applied, which is
 * the same defect `land`'s `listStructures` carried until 2026-08-16.
 *
 * The flag lives on the asset rather than here because a freezer is a place
 * things live whatever pack is asking, and because KIND cannot answer it: a
 * chest freezer and a tractor are both `equipment`. See the column comment in
 * `db/schema/assets.ts`.
 */
export async function listLocations(
  tx: Tx,
  tenantId: string,
): Promise<{ id: string; name: string; kind: string }[]> {
  return tx
    .select({
      id: schema.assets.id,
      name: schema.assets.name,
      kind: schema.assets.kind,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.tenantId, tenantId),
        eq(schema.assets.status, "active"),
        eq(schema.assets.isStorageLocation, true),
      ),
    )
    .orderBy(asc(schema.assets.name));
}

/** The lineage chain above a lot, nearest parent first. */
export async function lotAncestry(
  tx: Tx,
  tenantId: string,
  lotId: string,
): Promise<InventoryLot[]> {
  const chain: InventoryLot[] = [];
  const seen = new Set<string>([lotId]);
  let current = await getLot(tx, tenantId, lotId);
  while (current?.parentLotId && !seen.has(current.parentLotId)) {
    seen.add(current.parentLotId);
    const parent = await getLot(tx, tenantId, current.parentLotId);
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/** Recent movements across everything, for the module's activity read. */
export async function recentMovements(
  tx: Tx,
  tenantId: string,
  limit = 15,
): Promise<{ movement: InventoryMovement; itemName: string }[]> {
  return tx
    .select({
      movement: schema.inventoryMovements,
      itemName: schema.inventoryItems.name,
    })
    .from(schema.inventoryMovements)
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryItems.id, schema.inventoryMovements.itemId),
      ),
    )
    .where(eq(schema.inventoryMovements.tenantId, tenantId))
    .orderBy(
      desc(schema.inventoryMovements.occurredOn),
      desc(schema.inventoryMovements.createdAt),
    )
    .limit(limit);
}

// -------------------------------------------------- receipts and issues ---

/**
 * Feed in. A delivery, with what it cost.
 *
 * **THE MOVEMENT THAT PUTS MONEY ON THE FARM.** Slice 0 could say a pen held
 * 210 birds; nothing anywhere could say what anything cost. This is the first
 * half of the loop the profile's whole thesis rests on — *every farm activity
 * posts a cost to a cost object* — and `issueStock` is the other half.
 *
 * The cost is the TOTAL for the delivery, because that is the number on the
 * ticket. A rate is derived from it; storing the rate instead would bake a
 * division into the record.
 *
 * Creates the lot when given a code, for the same reason `livestock` does:
 * requiring the batch to exist first meant leaving the screen to make it, and
 * a delivery IS a batch.
 */
export async function receiveStock(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    itemId: string;
    /** An existing batch, or `newLotCode` to start one. */
    lotId?: string;
    newLotCode?: string;
    quantity: number;
    /** Total, in cents. Null when the price is not known yet. */
    costCents?: number | null;
    /**
     * Total POUNDS for the delivery, when the thing arriving is counted rather
     * than weighed. "38 packages, 47.5 lb".
     *
     * **A RECEIPT IS THE ONLY MOVEMENT THAT MEASURES ANYTHING**, which is why
     * this parameter is here and not on `issueStock` or `transferStock`: a
     * transfer moves a box without re-weighing it, and what leaves is weighed
     * by whoever weighs it, on their own record. Null for an item stocked by
     * mass — the quantity already is the weight.
     */
    weightLb?: number | null;
    occurredOn: string;
    locationAssetId?: string | null;
    /**
     * Where the new lot came from, when one is being created. Defaults to
     * `purchased`, which is what a delivery is.
     *
     * **`produced` IS WHY THIS IS A PARAMETER.** A run's outputs are made here,
     * not bought, and the lot's own column comment says slice 3 cannot infer
     * that retroactively — so the pack landing the boxes has to be able to say
     * so at the moment it lands them.
     */
    source?: string;
    /**
     * Which line of business the NEW batch belongs to, when one is being
     * created. Omit it and the batch inherits the item's, which is right for a
     * delivery and **wrong for a batch that was MADE from other batches.**
     *
     * `production` passes the run's, and the reason is the same one
     * `postMovement`'s doc gives for a run netting to nothing on the P&L: the
     * inputs debited the consumption account under THEIR line of business, and
     * only an output tagged the same way credits it back. Left to inherit the
     * output item's tag, a kill day charged Broilers and credited Unassigned —
     * a negative cost of goods for a line of business that produced nothing.
     */
    enterpriseId?: string | null;
    extensionSlug?: string;
    notes?: string;
  },
): Promise<{ movement: InventoryMovement; lotId: string | null }> {
  requireWrite(ctx, "member");
  if (input.quantity <= 0) {
    throw new InventoryError("ZERO_QUANTITY", "a receipt has to be a positive quantity");
  }

  let lotId = input.lotId ?? null;
  const newLotCode = input.newLotCode?.trim();
  if (newLotCode) {
    if (lotId) {
      throw new InventoryError(
        "LOT_INVALID",
        "give either an existing batch or a name for a new one",
      );
    }
    // `createLot` is owner-only because a lot is a cost object. Receiving into
    // an EXISTING batch stays a chore, which is the common case once a farm is
    // running.
    const lot = await createLot(tx, ctx, {
      itemId: input.itemId,
      code: newLotCode,
      source: input.source ?? "purchased",
      openedOn: input.occurredOn,
      // Absent means "not said" and inherits the item's, which is what a
      // delivery wants. A caller that knows better — `production`, whose output
      // belongs to the run rather than to the item — says so.
      enterpriseId: input.enterpriseId,
    });
    lotId = lot.id;
  }

  const movement = await recordMovement(tx, ctx, {
    itemId: input.itemId,
    lotId,
    locationAssetId: input.locationAssetId ?? null,
    quantity: Math.abs(input.quantity),
    movementKind: "receipt",
    occurredOn: input.occurredOn,
    costCents: input.costCents ?? null,
    weightLb: input.weightLb ?? null,
    extensionSlug: input.extensionSlug,
    notes: input.notes,
  });

  return { movement, lotId };
}

/**
 * Feed out, and to whom.
 *
 * **THE HALF THAT CLOSES THE LOOP.** `issuedToLotId` is what turns a bag of
 * feed leaving the barn into a cost carried by a pen of broilers, which is what
 * makes "what did this pen cost" a query rather than a feature. Without it an
 * issue is just stock disappearing.
 *
 * **The cost is stamped here, at the average as it stands right now**, and
 * never derived later. If a pen's feed cost were computed from today's average,
 * buying feed next month would retroactively change what that pen cost last
 * month, and every FCR comparison across batches would move under its own feet.
 * See `core/costing.ts` for the rounding remainder this leaves and why it is
 * ordinary.
 *
 * Consuming nothing is allowed — feed spoiled, stock thrown out — so the
 * consumer is optional. What is NOT allowed is inventing a cost: an item with
 * no priced receipts issues at null, and the screens say so rather than showing
 * a confident zero.
 */
export async function issueStock(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    itemId: string;
    lotId?: string | null;
    quantity: number;
    /** The lot that ate it. Null for waste, or stock leaving for any other reason. */
    issuedToLotId?: string | null;
    occurredOn: string;
    locationAssetId?: string | null;
    /**
     * Which feature drew it. A shared-feeder draw is `livestock`'s, and stamping
     * it keeps the row attributable to the pack that will explain it — the same
     * reason every head event carries the slug.
     */
    extensionSlug?: string;
    notes?: string;
  },
): Promise<InventoryMovement> {
  requireWrite(ctx, "member");
  if (input.quantity <= 0) {
    throw new InventoryError("ZERO_QUANTITY", "an issue has to be a positive quantity");
  }

  const rate = await itemCostRate(tx, ctx.tenantId, input.itemId);
  // Bounded by what the item actually holds — an issue cannot release cost that
  // never came in. See `issueCostCents` for why the rate itself is left alone.
  const costCents = issueCostCents(
    rate,
    input.quantity,
    await itemUnreleasedCost(tx, ctx.tenantId, input.itemId),
  );

  const movement = await recordMovement(tx, ctx, {
    itemId: input.itemId,
    lotId: input.lotId ?? null,
    locationAssetId: input.locationAssetId ?? null,
    // Signed OUT. The ledger's sign is the only thing that decides a balance.
    quantity: -Math.abs(input.quantity),
    movementKind: "issue",
    occurredOn: input.occurredOn,
    costCents,
    issuedToLotId: input.issuedToLotId ?? null,
    extensionSlug: input.extensionSlug,
    notes: input.notes,
  });

  return movement;
}

/**
 * What an item still holds: everything that came in with a price, less
 * everything already issued back out.
 *
 * **THE CAP ON A RELEASE.** `averageCostRate` divides priced cost by priced
 * quantity, so applying it to a quantity that includes unpriced stock invents
 * money — see `issueCostCents`. This is the ceiling that stops it, and it is
 * deliberately per ITEM rather than per lot, because the rate it bounds is an
 * item-level average.
 *
 * Adjustments count as releases: spoiled stock has left just as surely as
 * issued stock has, and leaving them out would let the same cost go out twice.
 */
export async function itemUnreleasedCost(
  tx: Tx,
  tenantId: string,
  itemId: string,
): Promise<number> {
  const rows = await tx
    .select({
      quantity: schema.inventoryMovements.quantity,
      costCents: schema.inventoryMovements.costCents,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        eq(schema.inventoryMovements.itemId, itemId),
        isNotNull(schema.inventoryMovements.costCents),
      ),
    );
  let held = 0;
  for (const row of rows) {
    if (row.costCents === null) continue;
    // In adds, out releases. A transfer carries no cost at all, so it never
    // appears here — which is why moving a box between freezers cannot change
    // what the item holds.
    held += row.quantity > 0 ? row.costCents : -row.costCents;
  }
  return held;
}

/**
 * Cents per stocking unit for an item, from everything ever received.
 *
 * Computed, never stored — the same reasoning as every other balance in this
 * pack. An average that lived in a column would be a second number to keep in
 * step with the movements that produced it.
 */
export async function itemCostRate(
  tx: Tx,
  tenantId: string,
  itemId: string,
): Promise<number | null> {
  const rows = await tx
    .select({
      quantity: schema.inventoryMovements.quantity,
      costCents: schema.inventoryMovements.costCents,
      movementKind: schema.inventoryMovements.movementKind,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        eq(schema.inventoryMovements.itemId, itemId),
      ),
    );
  return averageCostRate(rows);
}

/**
 * What was issued INTO each of these lots, in cents.
 *
 * One query whatever the lot count, because the caller is a list: the livestock
 * page wants feed cost against every pen at once, and a per-lot round trip is
 * how a page with twenty pens becomes a page with twenty-one queries.
 */
export async function consumedCostByLot(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (lotIds.length === 0) return out;
  const rows = await tx
    .select({
      lotId: schema.inventoryMovements.issuedToLotId,
      cents: sql<string>`coalesce(sum(${schema.inventoryMovements.costCents}), 0)`,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.issuedToLotId, lotIds),
      ),
    )
    .groupBy(schema.inventoryMovements.issuedToLotId);
  for (const row of rows) {
    if (!row.lotId) continue;
    out.set(row.lotId, Number(row.cents));
  }
  return out;
}

/**
 * What was issued into each lot, **broken down by item and carrying its unit**.
 *
 * `consumedCostByLot` answers "what did this pen cost" in one number, which is
 * what a card wants. A feed REPORT wants more and cannot get it from a total:
 * how much was fed (a quantity, in the unit the item is stocked in — pounds of
 * grower and gallons of surplus milk never add), and how many of those entries
 * carried no price at all.
 *
 * **THAT LAST COUNT IS NOT AN ERROR TALLY.** Spent grain, windfalls and expired
 * bakery bread are real feed with no invoice, and the design is explicit that a
 * model insisting every input has a purchase price will be lied to. A null cost
 * is carried through as fed-but-not-spent and counted so the report can say so.
 *
 * One grouped query whatever the lot count, and an optional date window so the
 * same read serves "this season" and "everything".
 */
export async function consumedByLotAndItem(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
  window: { from?: string; to?: string } = {},
): Promise<
  Map<
    string,
    {
      itemId: string;
      itemName: string;
      /**
       * The ITEM'S KIND, returned so the caller can decide what it means.
       *
       * This op has no opinion about which issues are feed — `livestock`'s
       * report does, because a card reading "Fed" that quietly included the
       * penicillin would be wrong in the pack that owns the word. Same seam as
       * `movementKindsForLots`: typed and unclassified out, classified by the
       * caller.
       */
      itemKind: string;
      unit: string;
      /** Positive: how much was fed, not the ledger's negative sign. */
      quantity: number;
      costCents: number;
      unpricedMovements: number;
    }[]
  >
> {
  const out = new Map<
    string,
    {
      itemId: string;
      itemName: string;
      itemKind: string;
      unit: string;
      quantity: number;
      costCents: number;
      unpricedMovements: number;
    }[]
  >();
  if (lotIds.length === 0) return out;

  const where = [
    eq(schema.inventoryMovements.tenantId, tenantId),
    inArray(schema.inventoryMovements.issuedToLotId, lotIds),
  ];
  if (window.from) {
    where.push(gte(schema.inventoryMovements.occurredOn, window.from));
  }
  if (window.to) {
    where.push(lte(schema.inventoryMovements.occurredOn, window.to));
  }

  const rows = await tx
    .select({
      lotId: schema.inventoryMovements.issuedToLotId,
      itemId: schema.inventoryMovements.itemId,
      itemName: schema.inventoryItems.name,
      itemKind: schema.inventoryItems.itemKind,
      unit: schema.inventoryItems.stockingUnit,
      quantity: sql<string>`sum(${schema.inventoryMovements.quantity})`,
      costCents: sql<string>`coalesce(sum(${schema.inventoryMovements.costCents}), 0)`,
      unpriced: sql<number>`count(*) filter (where ${schema.inventoryMovements.costCents} is null)::int`,
    })
    .from(schema.inventoryMovements)
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryItems.id, schema.inventoryMovements.itemId),
      ),
    )
    .where(and(...where))
    .groupBy(
      schema.inventoryMovements.issuedToLotId,
      schema.inventoryMovements.itemId,
      schema.inventoryItems.name,
      schema.inventoryItems.itemKind,
      schema.inventoryItems.stockingUnit,
    );

  for (const row of rows) {
    if (!row.lotId) continue;
    const entry = {
      itemId: row.itemId,
      itemName: row.itemName,
      itemKind: row.itemKind,
      unit: row.unit,
      quantity: Math.abs(roundQuantity(Number(row.quantity))),
      costCents: Number(row.costCents),
      unpricedMovements: row.unpriced,
    };
    const list = out.get(row.lotId);
    if (list) list.push(entry);
    else out.set(row.lotId, [entry]);
  }
  return out;
}

/**
 * What was issued into each lot, **movement by movement, with its date**.
 *
 * `consumedByLotAndItem` aggregates, which is what a report of a fixed period
 * wants. This does not, because `livestock`'s feed conversion needs a window
 * that is DIFFERENT FOR EVERY LOT: feed conversion is feed per pound of gain,
 * gain is measured between that lot's own first and last weighing, and feed fed
 * before anybody put a bird on a scale produced gain nobody measured. Summing it
 * into the ratio would inflate the one number the enterprise is judged on.
 *
 * So the caller gets the rows and does its own arithmetic per lot. One query
 * whatever the lot count.
 */
export async function consumedDatedByLots(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<
  Map<
    string,
    {
      occurredOn: string;
      itemKind: string;
      unit: string;
      /** Positive: how much was fed, not the ledger's negative sign. */
      quantity: number;
      costCents: number | null;
    }[]
  >
> {
  const out = new Map<
    string,
    {
      occurredOn: string;
      itemKind: string;
      unit: string;
      quantity: number;
      costCents: number | null;
    }[]
  >();
  if (lotIds.length === 0) return out;
  const rows = await tx
    .select({
      lotId: schema.inventoryMovements.issuedToLotId,
      occurredOn: schema.inventoryMovements.occurredOn,
      itemKind: schema.inventoryItems.itemKind,
      unit: schema.inventoryItems.stockingUnit,
      quantity: schema.inventoryMovements.quantity,
      costCents: schema.inventoryMovements.costCents,
    })
    .from(schema.inventoryMovements)
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryItems.id, schema.inventoryMovements.itemId),
      ),
    )
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.issuedToLotId, lotIds),
      ),
    );
  for (const row of rows) {
    if (!row.lotId) continue;
    const entry = {
      occurredOn: row.occurredOn,
      itemKind: row.itemKind,
      unit: row.unit,
      quantity: Math.abs(roundQuantity(row.quantity)),
      costCents: row.costCents,
    };
    const list = out.get(row.lotId);
    if (list) list.push(entry);
    else out.set(row.lotId, [entry]);
  }
  return out;
}

/**
 * Specific movements, by id, with the item name and unit they are denominated
 * in.
 *
 * Written for `livestock`'s shared-feeder draws, which are an ordinary issue in
 * this ledger plus an association row in that pack. The association is
 * livestock's — what a feeding group is has nothing to do with inventory — so
 * the caller arrives holding ids and needs the rows behind them.
 *
 * Capped, and the cap is the caller's to state: a season of daily draws is
 * hundreds of rows and a report should say what it left out rather than
 * truncating quietly.
 */
export async function movementsByIds(
  tx: Tx,
  tenantId: string,
  ids: string[],
): Promise<
  {
    id: string;
    itemId: string;
    itemName: string;
    unit: string;
    occurredOn: string;
    /** Signed as recorded: an issue is negative. */
    quantity: number;
    costCents: number | null;
    notes: string;
  }[]
> {
  if (ids.length === 0) return [];
  return tx
    .select({
      id: schema.inventoryMovements.id,
      itemId: schema.inventoryMovements.itemId,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.stockingUnit,
      occurredOn: schema.inventoryMovements.occurredOn,
      quantity: schema.inventoryMovements.quantity,
      costCents: schema.inventoryMovements.costCents,
      notes: schema.inventoryMovements.notes,
    })
    .from(schema.inventoryMovements)
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryItems.id, schema.inventoryMovements.itemId),
      ),
    )
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.id, ids),
      ),
    )
    .orderBy(
      desc(schema.inventoryMovements.occurredOn),
      desc(schema.inventoryMovements.createdAt),
    );
}

/**
 * What each of these lots has cost, and what has already left carrying some of
 * it. One pair of queries whatever the lot count.
 *
 * **ADDED FOR `production`, AND IT LIVES HERE FOR THE REASON EVERY OTHER
 * NEIGHBOUR READ DOES**: the ledger is this pack's, and a pack querying
 * `inventory_movements` directly is the leak the extension model forbids.
 *
 * A run consuming a pen needs the pen's ACCUMULATED cost — chicks plus feed plus
 * medicine — rather than the item average, which would price a bird at what the
 * chick cost and throw away eight weeks of feed. It also needs it net of
 * anything already processed out, or a pen split across two kill days is charged
 * for one and a half pens. `core/costing.ts` explains the arithmetic; this only
 * fetches the rows.
 */
/**
 * A batch carrying nothing, for a lot whose cost has been capitalised.
 *
 * Every field zeroed rather than a partial object: `hasRecordedCost` folds over
 * several of them, and a half-filled shape would make `carriedValue` answer
 * "somebody costed this" about a batch whose cost is on an asset.
 */
const EMPTY_CARRIED: LotCarriedCost = {
  purchasedCents: 0,
  consumedCents: 0,
  releasedCents: 0,
  adjustedOnHandCents: 0,
  adjustedIssuedCents: 0,
  remainingCents: 0,
};

export async function carriedCostByLot(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
  /**
   * Value the lot as it stood on this date. **The filter is on the MOVEMENTS,
   * not the lot** — a pen created in June has eaten more by August, and a
   * balance sheet dated June must not see August's feed. Omitted means all of
   * it, which is what every caller before valuation wanted.
   */
  asOf?: string,
): Promise<Map<string, LotCarriedCost>> {
  const out = new Map<string, LotCarriedCost>();
  if (lotIds.length === 0) return out;
  const upTo = asOf ? lte(schema.inventoryMovements.occurredOn, asOf) : undefined;

  const [own, consumed, adjustments] = await Promise.all([
    tx
      .select({
        lotId: schema.inventoryMovements.lotId,
        quantity: schema.inventoryMovements.quantity,
        costCents: schema.inventoryMovements.costCents,
        movementKind: schema.inventoryMovements.movementKind,
      })
      .from(schema.inventoryMovements)
      .where(
        and(
          eq(schema.inventoryMovements.tenantId, tenantId),
          inArray(schema.inventoryMovements.lotId, lotIds),
          upTo,
        ),
      ),
    tx
      .select({
        lotId: schema.inventoryMovements.issuedToLotId,
        quantity: schema.inventoryMovements.quantity,
        costCents: schema.inventoryMovements.costCents,
        movementKind: schema.inventoryMovements.movementKind,
      })
      .from(schema.inventoryMovements)
      .where(
        and(
          eq(schema.inventoryMovements.tenantId, tenantId),
          inArray(schema.inventoryMovements.issuedToLotId, lotIds),
          upTo,
        ),
      ),
    /**
     * **THE THIRD TABLE THAT FEEDS THIS FOLD** — ADR 0012 §A.4, and the one its
     * Consequences warned about: *"any caller that reaches for movements
     * directly to compute cost will be quietly wrong."* Read here, in the one
     * function that answers "what has this batch cost", so nowhere else has to
     * remember.
     *
     * Filtered by `occurred_on` exactly as the movements are: a correction
     * dated in August must not appear in a balance sheet dated June.
     */
    tx
      .select({
        lotId: schema.inventoryCostAdjustments.lotId,
        amountCents: schema.inventoryCostAdjustments.amountCents,
        onHandCents: schema.inventoryCostAdjustments.onHandCents,
        issuedCents: schema.inventoryCostAdjustments.issuedCents,
      })
      .from(schema.inventoryCostAdjustments)
      .where(
        and(
          eq(schema.inventoryCostAdjustments.tenantId, tenantId),
          inArray(schema.inventoryCostAdjustments.lotId, lotIds),
          asOf
            ? lte(schema.inventoryCostAdjustments.occurredOn, asOf)
            : undefined,
        ),
      ),
  ]);

  const ownByLot = new Map<string, CostedMovement[]>();
  for (const row of own) {
    if (!row.lotId) continue;
    const list = ownByLot.get(row.lotId);
    if (list) list.push(row);
    else ownByLot.set(row.lotId, [row]);
  }
  const consumedByLotId = new Map<string, CostedMovement[]>();
  for (const row of consumed) {
    if (!row.lotId) continue;
    const list = consumedByLotId.get(row.lotId);
    if (list) list.push(row);
    else consumedByLotId.set(row.lotId, [row]);
  }

  const adjustedByLot = new Map<string, CostAdjustment[]>();
  for (const row of adjustments) {
    const list = adjustedByLot.get(row.lotId);
    if (list) list.push(row);
    else adjustedByLot.set(row.lotId, [row]);
  }

  /**
   * **A CAPITALISED BATCH CARRIES NOTHING AS STOCK.** Its cost moved to the
   * other side of the balance sheet, and every caller of this — the feed
   * report, production's cost roll, the valuation screen — would otherwise
   * report money that is already on an asset. The thing is still there; its
   * VALUE is not here. See `inventory_lots.capitalised_on`.
   */
  const capitalised = await tx
    .select({
      id: schema.inventoryLots.id,
      capitalisedOn: schema.inventoryLots.capitalisedOn,
    })
    .from(schema.inventoryLots)
    .where(
      and(
        eq(schema.inventoryLots.tenantId, tenantId),
        inArray(schema.inventoryLots.id, lotIds),
        isNotNull(schema.inventoryLots.capitalisedOn),
      ),
    );
  const suppressed = new Set(
    capitalised
      // As of the caller's own date, so a report dated before she was
      // capitalised still sees her cost where it was.
      .filter((row) => !asOf || (row.capitalisedOn ?? "") <= asOf)
      .map((row) => row.id),
  );

  for (const lotId of lotIds) {
    if (suppressed.has(lotId)) {
      out.set(lotId, EMPTY_CARRIED);
      continue;
    }
    out.set(
      lotId,
      lotCarried(
        ownByLot.get(lotId) ?? [],
        consumedByLotId.get(lotId) ?? [],
        adjustedByLot.get(lotId) ?? [],
      ),
    );
  }
  return out;
}

/**
 * What is standing in each of these lots — the fold, summed in SQL.
 *
 * `onHandByItem` answers the same question one grain coarser. A run pro-rating
 * a pen's cost needs the LOT's balance, and needs it before it takes anything
 * out, because the share it carries is the head taken over the head standing.
 */
export async function balanceByLots(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (lotIds.length === 0) return out;
  const rows = await tx
    .select({
      lotId: schema.inventoryMovements.lotId,
      quantity: sql<string>`sum(${schema.inventoryMovements.quantity})`,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.lotId, lotIds),
      ),
    )
    .groupBy(schema.inventoryMovements.lotId);
  for (const row of rows) {
    if (!row.lotId) continue;
    out.set(row.lotId, roundQuantity(Number(row.quantity)));
  }
  return out;
}



// ------------------------------------ where a tax decision gets recorded ---

/** Every rule this tenant has recorded, defaults first. */
export async function listTaxRules(
  tx: Tx,
  tenantId: string,
): Promise<InventoryTaxTreatment[]> {
  return tx.query.inventoryTaxTreatments.findMany({
    where: eq(schema.inventoryTaxTreatments.tenantId, tenantId),
    orderBy: (r, { asc: byAsc }) => [byAsc(r.itemKind)],
  });
}

/**
 * What each category in use resolves to, and WHY.
 *
 * **DRIVEN BY THE KINDS THE BUSINESS ACTUALLY HOLDS**, not by the suggested
 * list: `item_kind` is an open taxonomy, so a farm that typed `bedding` has a
 * category the vocabulary has never heard of, and a screen built from the
 * suggestions would silently omit it. The one place a person checks what their
 * decision means must be built from their own data.
 *
 * The tenant default is always included even when nothing resolves to it, since
 * it is what a new category will get.
 */
export async function taxRuleCoverage(
  tx: Tx,
  tenantId: string,
): Promise<
  {
    itemKind: string | null;
    items: number;
    resolved: ResolvedTaxRule;
  }[]
> {
  const [kinds, rows] = await Promise.all([
    tx
      .select({
        itemKind: schema.inventoryItems.itemKind,
        items: sql<string>`count(*)`,
      })
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.tenantId, tenantId),
          eq(schema.inventoryItems.status, "active"),
        ),
      )
      .groupBy(schema.inventoryItems.itemKind),
    listTaxRules(tx, tenantId),
  ]);
  const stored: TaxRuleRow[] = rows.map((r) => ({
    itemKind: r.itemKind,
    timingRule: r.timingRule,
    expenseAccountId: r.expenseAccountId,
  }));

  // Typed explicitly: `inventory_items.item_kind` is NOT NULL, so the mapped
  // rows infer as `string` and the tenant-default row below cannot be unshifted
  // into them.
  const out: { itemKind: string | null; items: number; resolved: ResolvedTaxRule }[] =
    kinds
      .map((k) => ({
        itemKind: k.itemKind as string | null,
        items: Number(k.items),
        resolved: resolveTaxRule(k.itemKind, stored),
      }))
      .sort((a, b) => (a.itemKind ?? "").localeCompare(b.itemKind ?? ""));

  out.unshift({
    itemKind: null,
    items: 0,
    resolved: resolveTaxRule(null, stored),
  });
  return out;
}

/**
 * **RECORD WHAT SOMEBODY QUALIFIED DECIDED**, for one category or for the
 * business as a whole.
 *
 * OWNER only. A tax election is not a chore, and it is the same line every other
 * cost-object decision in this pack sits on.
 *
 * **REFUSES A RULE THE REPORT LENS CANNOT HONOUR.** Stage 1 can apply
 * `consumed` and nothing else. Storing `paid` here while the lens ignores it
 * would produce a setting that claims to change a report and does not, which is
 * precisely the "plausible, balanced, wrong" failure ADR 0013 was written to
 * end. The refusal names the rule so a person can see the software is not ready
 * rather than that they typed something invalid.
 *
 * **Upserts by selecting first**, including the null-kind default row, because
 * Postgres treats two nulls as distinct and the unique index therefore does not
 * hold for it. Same limitation and the same remedy as `recordCountLine`.
 */
export async function setTaxRule(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    /** Null records the tenant's default. */
    itemKind: string | null;
    timingRule: string;
    expenseAccountId?: string | null;
    decidedBy?: string;
    decidedOn?: string | null;
    notes?: string;
  },
): Promise<InventoryTaxTreatment> {
  requireWrite(ctx, "owner");
  if (input.itemKind !== null && !isValidSlug(input.itemKind)) {
    throw new InventoryError("INVALID_KIND", input.itemKind);
  }
  if (!isTimingRule(input.timingRule)) {
    throw new InventoryError(
      "INVALID_TIMING_RULE",
      "that is not a moment this software can date",
    );
  }
  if (!isImplementedRule(input.timingRule)) {
    throw new InventoryError(
      "TIMING_RULE_UNAVAILABLE",
      `The reports cannot apply "${input.timingRule}" yet, so recording it here would mean a setting that says one thing and does another. Only "when it is used" is applied today.`,
    );
  }

  /**
   * **A SUBSTITUTING RULE NEEDS SOMEWHERE TO PUT THE COST, AND THE PLACE TO SAY
   * SO IS HERE.** Found by driving: the rule saved happily with no account, and
   * the refusal arrived later on a REPORT — a long way from the decision that
   * caused it, and on a screen whose reader may not be the person who chose.
   *
   * The report still refuses too, and that is not redundancy: an account can be
   * deactivated after a rule was recorded, so the late check is the only one
   * that can be sure. This one just means the common case fails where somebody
   * can fix it.
   */
  if (
    isSubstitutingRule(input.timingRule) &&
    !input.expenseAccountId
  ) {
    throw new InventoryError(
      "TAX_RULE_NEEDS_ACCOUNT",
      "Pick the expense account this cost should land in. A rule that moves cost off the balance sheet has to say where it goes, and \"everything to cost of goods\" is no use at return time.",
    );
  }

  const existing = await tx.query.inventoryTaxTreatments.findFirst({
    where: and(
      eq(schema.inventoryTaxTreatments.tenantId, ctx.tenantId),
      input.itemKind === null
        ? isNull(schema.inventoryTaxTreatments.itemKind)
        : eq(schema.inventoryTaxTreatments.itemKind, input.itemKind),
    ),
  });

  const values = {
    timingRule: input.timingRule,
    expenseAccountId: input.expenseAccountId ?? null,
    decidedBy: input.decidedBy?.trim() ?? "",
    decidedOn: input.decidedOn ?? null,
    notes: input.notes?.trim() ?? "",
  };

  if (existing) {
    const [row] = await tx
      .update(schema.inventoryTaxTreatments)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(schema.inventoryTaxTreatments.tenantId, ctx.tenantId),
          eq(schema.inventoryTaxTreatments.id, existing.id),
        ),
      )
      .returning();
    return row;
  }
  const [row] = await tx
    .insert(schema.inventoryTaxTreatments)
    .values({ tenantId: ctx.tenantId, itemKind: input.itemKind, ...values })
    .returning();
  return row;
}

/**
 * Remove a recorded decision, so the category falls back to the next step of the
 * resolution order.
 *
 * Deleting rather than setting it back to `consumed`, because those are
 * different facts: one is "nobody has decided about this category", the other is
 * "somebody decided it is used-based". `resolveTaxRule` reports which through
 * `source`, and a screen that could not tell them apart would put an
 * accountant's name against a decision they never made.
 */
export async function clearTaxRule(
  tx: Tx,
  ctx: InventoryCtx,
  itemKind: string | null,
): Promise<void> {
  requireWrite(ctx, "owner");
  await tx
    .delete(schema.inventoryTaxTreatments)
    .where(
      and(
        eq(schema.inventoryTaxTreatments.tenantId, ctx.tenantId),
        itemKind === null
          ? isNull(schema.inventoryTaxTreatments.itemKind)
          : eq(schema.inventoryTaxTreatments.itemKind, itemKind),
      ),
    );
}

// --------------------------------------------- correcting what it cost ---

/**
 * **PUT RIGHT WHAT A BATCH COST, WITHOUT REWRITING WHAT HAPPENED.**
 * [ADR 0012](../../../docs/decisions/0012-what-capitalises-stock.md) §A.4.
 *
 * A delivery ticket can overstate, understate, omit the freight or use the
 * wrong unit, and a receipt can arrive with no price at all. Until this, a
 * stamped cost was final — `issueStock` stamps at the moment of issue and this
 * repo's rule is that a stamped cost is never re-derived, so feed issued before
 * its invoice arrived stayed at `null` forever while `1300` held an asset that
 * had been eaten.
 *
 * **THE CORRECTION IS A NEW RECORD, NOT AN EDIT**, which is `costing.ts`'s own
 * rule — *cost is a ledger, not a column* — and the same rule a physical count
 * already follows for quantity: what happened, happened, and a disagreement is
 * another event.
 *
 * **IT SPLITS BY WHAT HAS ALREADY LEFT THE BATCH, AND THE SPLIT IS STORED.**
 * The part covering stock still on hand raises the batch's carrying value; the
 * part covering stock already issued is expensed, because capitalising it would
 * put an asset back on the balance sheet for feed that is gone. The proportion
 * is what the ledger believed at this moment, and it is written down rather
 * than re-derived for the reason a count line stores `expected_quantity`: a
 * movement backdated tomorrow must not restate a posting that has happened.
 *
 * **OWNER ONLY.** Recording that a bag was opened is a chore; saying that a
 * delivery cost something other than what the ticket said moves money between
 * the balance sheet and the P&L, and that is the same line `createLot` and
 * `splitLot` already draw — an act that creates or re-states a cost object.
 *
 * The correction is deliberately NOT bounded by what the batch currently
 * carries. A batch can be corrected downwards past zero, and the negative that
 * leaves is left standing rather than clamped, for the reason `lotCarried`
 * gives: it is a real disagreement somebody should see.
 */
export async function adjustLotCost(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    lotId: string;
    /** SIGNED, and non-zero. Negative means the ticket said too much. */
    amountCents: number;
    /** Open taxonomy. See `COST_ADJUSTMENT_REASONS`. */
    reason: string;
    occurredOn: string;
    notes?: string;
  },
): Promise<InventoryCostAdjustment> {
  requireWrite(ctx, "owner");

  const amountCents = Math.round(input.amountCents);
  if (amountCents === 0) {
    throw new InventoryError(
      "INVALID_COST",
      "a correction of nothing is not a correction",
    );
  }
  if (!isValidSlug(input.reason)) {
    throw new InventoryError("INVALID_REASON", input.reason);
  }

  const lot = await getLot(tx, ctx.tenantId, input.lotId);
  if (!lot) throw new InventoryError("NOT_FOUND", "that batch no longer exists");

  /**
   * **BOTH FIGURES COME FROM THE LEDGER, IN ONE QUERY, AND THEN STOP BEING
   * QUESTIONS.** `quantityReceived` is everything that has ever come into the
   * batch — the denominator — and `quantityOnHand` is the net balance. They are
   * read now and stored, because the split they produce has to survive
   * everything that happens to this batch afterwards.
   */
  const [totals] = await tx
    .select({
      onHand: sql<string>`coalesce(sum(${schema.inventoryMovements.quantity}), 0)`,
      received: sql<string>`coalesce(sum(${schema.inventoryMovements.quantity}) filter (where ${schema.inventoryMovements.quantity} > 0), 0)`,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, ctx.tenantId),
        eq(schema.inventoryMovements.lotId, input.lotId),
      ),
    );
  const quantityOnHand = roundQuantity(Number(totals?.onHand ?? 0));
  const quantityReceived = roundQuantity(Number(totals?.received ?? 0));

  const split = splitCostAdjustment({
    amountCents,
    quantityOnHand,
    quantityReceived,
  });

  const [row] = await tx
    .insert(schema.inventoryCostAdjustments)
    .values({
      tenantId: ctx.tenantId,
      itemId: lot.itemId,
      lotId: lot.id,
      occurredOn: input.occurredOn,
      amountCents,
      onHandCents: split.onHandCents,
      issuedCents: split.issuedCents,
      quantityOnHand,
      quantityReceived,
      reason: input.reason,
      notes: input.notes ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();

  await postCostAdjustment(tx, ctx, {
    adjustmentId: row.id,
    itemId: lot.itemId,
    lotId: lot.id,
    lotCode: lot.code,
    occurredOn: input.occurredOn,
    onHandCents: split.onHandCents,
    issuedCents: split.issuedCents,
  });

  return row;
}

/**
 * Every correction against these batches, newest first.
 *
 * Takes a list because the caller is always a list — the item page shows one
 * row per batch and asking per batch is how a page with twenty batches becomes
 * a page with twenty-one queries.
 */
export async function costAdjustmentsForLots(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<InventoryCostAdjustment[]> {
  if (lotIds.length === 0) return [];
  return tx.query.inventoryCostAdjustments.findMany({
    where: and(
      eq(schema.inventoryCostAdjustments.tenantId, tenantId),
      inArray(schema.inventoryCostAdjustments.lotId, lotIds),
    ),
    orderBy: (a, { desc: byDesc }) => [byDesc(a.occurredOn), byDesc(a.createdAt)],
  });
}


// ------------------------------------------- adjustments, counts, expiry ---

/**
 * Put the ledger right, and say why.
 *
 * **THE REASON IS THE POINT, NOT THE CORRECTION.** The design says it plainly:
 * *reasons are a diagnostic rather than a correction — sustained feed shrinkage
 * is not an accounting problem, it is a rodent problem.* One spoiled bag is a
 * wasted bag; the same reason four months running is a freezer that is not
 * holding temperature. Neither is visible if the reason lives in free text, and
 * that is the whole justification for a column.
 *
 * **`quantity` IS SIGNED HERE, unlike `receiveStock` and `issueStock`**, which
 * both take a positive number and decide the sign themselves. An adjustment
 * genuinely goes either way and the caller is the only one who knows which:
 * finding ten pounds nobody had recorded and losing ten to a rat are the same
 * act against the same column.
 *
 * **A NEGATIVE ADJUSTMENT RELEASES COST AT THE AVERAGE; A POSITIVE ONE CARRIES
 * NONE.** Stock that spoils really did cost money, and stamping it is what makes
 * the loss show up as a number somebody will act on — the same rule
 * `issueStock` follows, for the same reason. Stock that turns up was never
 * bought, so it arrives at null rather than at a price the farm did not pay.
 * That leaves the item's average where it was: `averageCostRate` counts only
 * what came in WITH a price, which is exactly how raised stock is already
 * treated.
 */
export async function adjustStock(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    itemId: string;
    lotId?: string | null;
    /** SIGNED. Negative is stock going away, positive is stock turning up. */
    quantity: number;
    /** Open taxonomy. See `SUGGESTED_ADJUSTMENT_REASONS`. */
    reason: string;
    occurredOn: string;
    locationAssetId?: string | null;
    extensionSlug?: string;
    notes?: string;
  },
): Promise<InventoryMovement> {
  requireWrite(ctx, "member");
  const quantity = roundQuantity(input.quantity);
  if (quantity === 0) {
    throw new InventoryError(
      "ZERO_QUANTITY",
      "an adjustment of nothing is not a correction",
    );
  }

  let costCents: number | null = null;
  if (quantity < 0) {
    const rate = await itemCostRate(tx, ctx.tenantId, input.itemId);
    costCents = issueCostCents(
      rate,
      quantity,
      await itemUnreleasedCost(tx, ctx.tenantId, input.itemId),
    );
  }

  const movement = await recordMovement(tx, ctx, {
    itemId: input.itemId,
    lotId: input.lotId ?? null,
    locationAssetId: input.locationAssetId ?? null,
    quantity,
    movementKind: "adjustment",
    occurredOn: input.occurredOn,
    costCents,
    reason: input.reason,
    extensionSlug: input.extensionSlug,
    notes: input.notes,
  });

  return movement;
}

/**
 * How often each reason has come up, newest window first — the diagnostic the
 * reason column exists for.
 *
 * Deliberately returns COUNTS AND QUANTITIES rather than a verdict. Whether
 * four spoilage entries in four months is a rodent problem or a bad summer is
 * not a judgement this pack is in a position to make; showing the pattern is.
 */
export async function adjustmentReasons(
  tx: Tx,
  tenantId: string,
  window: { from: string; to: string },
): Promise<
  { reason: string; entries: number; itemsAffected: number; costCents: number }[]
> {
  const rows = await tx
    .select({
      reason: schema.inventoryMovements.reason,
      entries: sql<string>`count(*)`,
      itemsAffected: sql<string>`count(distinct ${schema.inventoryMovements.itemId})`,
      costCents: sql<string>`coalesce(sum(${schema.inventoryMovements.costCents}), 0)`,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        eq(schema.inventoryMovements.movementKind, "adjustment"),
        gte(schema.inventoryMovements.occurredOn, window.from),
        lte(schema.inventoryMovements.occurredOn, window.to),
      ),
    )
    .groupBy(schema.inventoryMovements.reason);
  return rows
    .filter((r): r is typeof r & { reason: string } => r.reason !== null)
    .map((r) => ({
      reason: r.reason,
      entries: Number(r.entries),
      itemsAffected: Number(r.itemsAffected),
      costCents: Number(r.costCents),
    }))
    .sort((a, b) => b.entries - a.entries || (a.reason < b.reason ? -1 : 1));
}

/**
 * Batches with an expiry date, soonest first — the FEFO view.
 *
 * **FIRST EXPIRED, FIRST OUT, AND IT IS A SUGGESTION.** The design asks for two
 * views that prevent loss — *oldest first* and *expiring soon* — and this
 * answers both, because sorted-by-expiry IS oldest-first for anything that
 * expires. Nothing anywhere refuses an issue from a later batch: the person
 * holding the scoop can see which bag is already open and this cannot.
 *
 * **Batches that have gone to zero are dropped.** An empty batch cannot expire
 * into a loss, and a list padded with them is a list nobody reads. A batch with
 * no expiry date is not here at all — that is not the same as "does not expire",
 * and the screen says which.
 */
export async function expiringLots(
  tx: Tx,
  tenantId: string,
  options: { onOrBefore?: string; limit?: number } = {},
): Promise<
  {
    lot: InventoryLot;
    itemName: string;
    unit: string;
    balance: number;
  }[]
> {
  const where = [
    eq(schema.inventoryLots.tenantId, tenantId),
    isNotNull(schema.inventoryLots.expiresOn),
  ];
  if (options.onOrBefore) {
    where.push(lte(schema.inventoryLots.expiresOn, options.onOrBefore));
  }
  const lots = await tx
    .select({
      lot: schema.inventoryLots,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.stockingUnit,
    })
    .from(schema.inventoryLots)
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.inventoryLots.tenantId),
        eq(schema.inventoryItems.id, schema.inventoryLots.itemId),
      ),
    )
    .where(and(...where))
    .orderBy(asc(schema.inventoryLots.expiresOn))
    .limit(options.limit ?? 100);

  const balances = await balanceByLots(
    tx,
    tenantId,
    lots.map((l) => l.lot.id),
  );
  return lots
    .map((row) => ({ ...row, balance: balances.get(row.lot.id) ?? 0 }))
    // A batch that is not there cannot go off. Zero AND negative: a negative is
    // a temporary disagreement, not stock sitting in a freezer going bad.
    .filter((row) => row.balance > 0);
}

// --------------------------------------------------------------- counts ---

export async function listCounts(
  tx: Tx,
  tenantId: string,
  filter: { status?: string } = {},
): Promise<InventoryCount[]> {
  const where = [eq(schema.inventoryCounts.tenantId, tenantId)];
  if (filter.status) where.push(eq(schema.inventoryCounts.status, filter.status));
  return tx.query.inventoryCounts.findMany({
    where: and(...where),
    orderBy: (c, { desc: byDesc }) => [byDesc(c.countedOn), byDesc(c.createdAt)],
  });
}

export async function getCount(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<InventoryCount | null> {
  const row = await tx.query.inventoryCounts.findFirst({
    where: and(
      eq(schema.inventoryCounts.tenantId, tenantId),
      eq(schema.inventoryCounts.id, id),
    ),
  });
  return row ?? null;
}

/**
 * Start a count.
 *
 * **`member`, deliberately, and it is the clearest case in the pack.** Counting
 * a freezer is the definition of a chore: it is done by whoever was sent to do
 * it, standing in the cold with a clipboard. Nothing here creates a cost object.
 */
export async function startCount(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    countedOn: string;
    locationAssetId?: string | null;
    countedBy?: string;
    notes?: string;
  },
): Promise<InventoryCount> {
  requireWrite(ctx, "member");
  const rows = await tx
    .insert(schema.inventoryCounts)
    .values({
      tenantId: ctx.tenantId,
      countedOn: input.countedOn,
      locationAssetId: input.locationAssetId ?? null,
      countedBy: input.countedBy?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

async function draftCountOrThrow(
  tx: Tx,
  ctx: InventoryCtx,
  countId: string,
): Promise<InventoryCount> {
  const count = await getCount(tx, ctx.tenantId, countId);
  if (!count) throw new InventoryError("NOT_FOUND", "that count no longer exists");
  if (count.status !== "draft") {
    // A posted count has already written its variances. Changing a line now
    // would mean either rewriting a movement or leaving a variance that no
    // longer matches the line that produced it.
    throw new InventoryError(
      "COUNT_CLOSED",
      "this count is posted — its variances are already in the ledger",
    );
  }
  return count;
}

/**
 * Record what is actually on one shelf.
 *
 * Upserts on (count, item, lot): counting the same batch twice in one walk and
 * getting two answers is a question for the person holding the clipboard, not
 * two variances for the ledger to average.
 */
export async function recordCountLine(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    countId: string;
    itemId: string;
    lotId?: string | null;
    /** What is there. ZERO IS A REAL ANSWER and posts a variance. */
    countedQuantity: number;
    notes?: string;
  },
): Promise<InventoryCountLine> {
  requireWrite(ctx, "member");
  await draftCountOrThrow(tx, ctx, input.countId);
  const item = await getItem(tx, ctx.tenantId, input.itemId);
  if (!item) throw new InventoryError("ITEM_INVALID", "that item does not exist");
  if (input.lotId) {
    const lot = await getLot(tx, ctx.tenantId, input.lotId);
    if (!lot) throw new InventoryError("LOT_INVALID", "that lot does not exist");
    if (lot.itemId !== input.itemId) {
      throw new InventoryError(
        "LOT_INVALID",
        "that lot belongs to a different item",
      );
    }
  }
  const countedQuantity = roundQuantity(input.countedQuantity);
  if (countedQuantity < 0) {
    throw new InventoryError(
      "COUNT_INVALID",
      "record what you counted, not the difference — a count cannot be negative",
    );
  }

  const existing = await tx.query.inventoryCountLines.findFirst({
    where: and(
      eq(schema.inventoryCountLines.tenantId, ctx.tenantId),
      eq(schema.inventoryCountLines.countId, input.countId),
      eq(schema.inventoryCountLines.itemId, input.itemId),
      input.lotId
        ? eq(schema.inventoryCountLines.lotId, input.lotId)
        : isNull(schema.inventoryCountLines.lotId),
    ),
  });
  if (existing) {
    const updated = await tx
      .update(schema.inventoryCountLines)
      .set({
        countedQuantity,
        notes: input.notes?.trim() ?? existing.notes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.inventoryCountLines.tenantId, ctx.tenantId),
          eq(schema.inventoryCountLines.id, existing.id),
        ),
      )
      .returning();
    return updated[0];
  }

  const rows = await tx
    .insert(schema.inventoryCountLines)
    .values({
      tenantId: ctx.tenantId,
      countId: input.countId,
      itemId: input.itemId,
      lotId: input.lotId ?? null,
      countedQuantity,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

export async function removeCountLine(
  tx: Tx,
  ctx: InventoryCtx,
  id: string,
): Promise<InventoryCountLine> {
  requireWrite(ctx, "member");
  const existing = await tx.query.inventoryCountLines.findFirst({
    where: and(
      eq(schema.inventoryCountLines.tenantId, ctx.tenantId),
      eq(schema.inventoryCountLines.id, id),
    ),
  });
  if (!existing) throw new InventoryError("NOT_FOUND", "that line is gone");
  await draftCountOrThrow(tx, ctx, existing.countId);
  const rows = await tx
    .delete(schema.inventoryCountLines)
    .where(
      and(
        eq(schema.inventoryCountLines.tenantId, ctx.tenantId),
        eq(schema.inventoryCountLines.id, id),
      ),
    )
    .returning();
  return rows[0];
}

export async function countLines(
  tx: Tx,
  tenantId: string,
  countId: string,
): Promise<InventoryCountLine[]> {
  return tx.query.inventoryCountLines.findMany({
    where: and(
      eq(schema.inventoryCountLines.tenantId, tenantId),
      eq(schema.inventoryCountLines.countId, countId),
    ),
    orderBy: (l, { asc: byAsc }) => [byAsc(l.createdAt)],
  });
}

export interface CountPosting {
  count: InventoryCount;
  /** Lines whose count matched the ledger exactly. No movement written. */
  agreed: number;
  /** Lines that wrote an adjustment. */
  adjusted: number;
  /** Net variance, in the items' own units — NOT summed across items. */
  variances: { itemId: string; itemName: string; unit: string; variance: number }[];
}

/**
 * Post the count: every disagreement becomes an adjustment, in one transaction.
 *
 * **THE VARIANCE IS THE OUTPUT, and `count_variance` is its reason.** That keeps
 * it separate from spoilage and shrinkage in the diagnostic, which matters: a
 * count variance means the record drifted, while spoilage means stock was
 * destroyed, and treating them as one number would hide both.
 *
 * **A LINE THAT AGREES WRITES NOTHING.** A movement of zero is refused by the
 * ledger anyway, and a row saying "nothing happened" in the one table that has
 * to reconcile is noise. The line still records that it was counted and what was
 * expected, which is the useful half.
 *
 * **`expected` IS STAMPED HERE**, at the moment of posting, and never recomputed
 * — see the column comment. It is what the ledger believed when somebody
 * disagreed with it, and a backdated movement tomorrow must not silently
 * restate a variance that has already been posted.
 */
export async function postCount(
  tx: Tx,
  ctx: InventoryCtx,
  countId: string,
  postedOn: string,
): Promise<CountPosting> {
  requireWrite(ctx, "member");
  const count = await draftCountOrThrow(tx, ctx, countId);
  const lines = await countLines(tx, ctx.tenantId, countId);
  if (lines.length === 0) {
    throw new InventoryError(
      "COUNT_INVALID",
      "count something before posting — an empty count has nothing to reconcile",
    );
  }

  const items = await itemsByIds(
    tx,
    ctx.tenantId,
    lines.map((l) => l.itemId),
  );
  const lotBalances = await balanceByLots(
    tx,
    ctx.tenantId,
    lines.map((l) => l.lotId).filter((id): id is string => id !== null),
  );
  const itemBalances = await onHandByItem(tx, ctx.tenantId);

  let agreed = 0;
  let adjusted = 0;
  const varianceByItem = new Map<string, number>();

  for (const line of lines) {
    // A lot's balance for a lot line; the whole item's for a line with no lot,
    // because that is what "how much of this is there" means when nobody tracks
    // it in batches.
    const expected = line.lotId
      ? (lotBalances.get(line.lotId) ?? 0)
      : (itemBalances.get(line.itemId) ?? 0);
    const variance = roundQuantity(line.countedQuantity - expected);

    let movementId: string | null = null;
    if (variance !== 0) {
      const movement = await adjustStock(tx, ctx, {
        itemId: line.itemId,
        lotId: line.lotId,
        quantity: variance,
        reason: COUNT_VARIANCE_REASON,
        occurredOn: postedOn,
        locationAssetId: count.locationAssetId,
        notes: line.notes,
      });
      movementId = movement.id;
      adjusted += 1;
      varianceByItem.set(
        line.itemId,
        roundQuantity((varianceByItem.get(line.itemId) ?? 0) + variance),
      );
    } else {
      agreed += 1;
    }

    await tx
      .update(schema.inventoryCountLines)
      .set({
        expectedQuantity: expected,
        inventoryMovementId: movementId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.inventoryCountLines.tenantId, ctx.tenantId),
          eq(schema.inventoryCountLines.id, line.id),
        ),
      );
  }

  const posted = await tx
    .update(schema.inventoryCounts)
    .set({ status: "posted", postedOn, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inventoryCounts.tenantId, ctx.tenantId),
        eq(schema.inventoryCounts.id, countId),
      ),
    )
    .returning();

  return {
    count: posted[0],
    agreed,
    adjusted,
    // Never summed across items: pounds of feed and dozens of eggs have no
    // total between them, which is this pack's oldest rule.
    variances: [...varianceByItem].map(([itemId, variance]) => ({
      itemId,
      itemName: items.get(itemId)?.name ?? "—",
      unit: items.get(itemId)?.stockingUnit ?? "each",
      variance,
    })),
  };
}

async function itemsByIds(
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
 * Move stock from one place to another, as ONE act.
 *
 * **TWO MOVEMENTS AND NO NET CHANGE.** A `transfer_out` at the origin and a
 * `transfer_in` at the destination, same item, same lot, same day. The item's
 * balance does not move; only the "where is it" split does — which is the
 * property `splitLot` already relies on and the reason both sides are recorded
 * rather than one row with two locations on it.
 *
 * **CARRIES NO COST, and that is deliberate.** Moving a box of beef from a
 * garage freezer to a market truck does not change what it cost; stamping a
 * figure would release cost from the lot and then put a different one back,
 * which is how a lot's `remainingCents` starts disagreeing with itself. This is
 * the same reasoning `livestock` applies to a pen walking to the next paddock.
 *
 * **THIS CLOSES A KNOWN GAP.** The pack's own open items have said since slice 0
 * that moving stock was "two movements, and the UI does not offer it as one
 * act" — which is exactly the shape that produces one leg entered and the other
 * forgotten. `retail` needs it to load a truck, and it belongs here because the
 * ledger is this pack's.
 */
export async function transferStock(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    itemId: string;
    lotId?: string | null;
    /** Positive. The direction is the two locations, not the sign. */
    quantity: number;
    /** Null means "from wherever it was", which an uncounted farm honestly has. */
    fromLocationAssetId?: string | null;
    toLocationAssetId?: string | null;
    occurredOn: string;
    extensionSlug?: string;
    notes?: string;
  },
): Promise<{ out: InventoryMovement; in: InventoryMovement }> {
  requireWrite(ctx, "member");
  const quantity = roundQuantity(Math.abs(input.quantity));
  if (quantity <= 0) {
    throw new InventoryError("ZERO_QUANTITY", "a transfer has to be a positive quantity");
  }
  const from = input.fromLocationAssetId ?? null;
  const to = input.toLocationAssetId ?? null;
  if (from === to) {
    // Both null is the common version of this: a farm that has never recorded a
    // location asking to move something from nowhere to nowhere. It is not a
    // move, and two rows that cancel would be noise in the one table that has to
    // reconcile.
    throw new InventoryError(
      "LOT_INVALID",
      "pick two different places — a transfer that starts and ends in the same place is not a move",
    );
  }

  const outbound = await recordMovement(tx, ctx, {
    itemId: input.itemId,
    lotId: input.lotId ?? null,
    locationAssetId: from,
    quantity: -quantity,
    movementKind: "transfer_out",
    occurredOn: input.occurredOn,
    extensionSlug: input.extensionSlug,
    notes: input.notes,
  });
  const inbound = await recordMovement(tx, ctx, {
    itemId: input.itemId,
    lotId: input.lotId ?? null,
    locationAssetId: to,
    quantity,
    movementKind: "transfer_in",
    occurredOn: input.occurredOn,
    extensionSlug: input.extensionSlug,
    notes: input.notes,
  });
  return { out: outbound, in: inbound };
}

export interface LocationStockLine {
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  lotCode: string | null;
  onHand: number;
}

/**
 * What is at one place, by item and batch.
 *
 * **ADDED FOR THE MARKET TRUCK**, which is a storage-location asset like any
 * other — the whole reason the design says the offline problem has no
 * distributed-inventory problem inside it. A till loads this once and does its
 * own arithmetic from there.
 *
 * Lines that net to zero are dropped, the same call the item page's "where it
 * is" panel makes: stock that went out and came back is not "0 lb on the truck",
 * it is not on the truck.
 */
export async function stockAtLocation(
  tx: Tx,
  tenantId: string,
  locationAssetId: string,
): Promise<LocationStockLine[]> {
  const rows = await tx
    .select({
      itemId: schema.inventoryMovements.itemId,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.stockingUnit,
      lotId: schema.inventoryMovements.lotId,
      lotCode: schema.inventoryLots.code,
      quantity: sql<string>`sum(${schema.inventoryMovements.quantity})`,
    })
    .from(schema.inventoryMovements)
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
        eq(schema.inventoryMovements.tenantId, tenantId),
        eq(schema.inventoryMovements.locationAssetId, locationAssetId),
      ),
    )
    .groupBy(
      schema.inventoryMovements.itemId,
      schema.inventoryItems.name,
      schema.inventoryItems.stockingUnit,
      schema.inventoryMovements.lotId,
      schema.inventoryLots.code,
    );

  return rows
    .map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      unit: row.unit,
      lotId: row.lotId,
      lotCode: row.lotCode,
      onHand: roundQuantity(Number(row.quantity)),
    }))
    .filter((row) => row.onHand !== 0)
    .sort((a, b) => (a.itemName < b.itemName ? -1 : 1));
}

// ------------------------------------------------------------- valuation ---

export interface ValuationRow {
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  lotCode: string | null;
  /** The lot's provenance — `purchased`, `raised` or `produced`. */
  lotSource: string | null;
  quantity: number;
  valueCents: number | null;
  method: ValuationMethod;
}

export interface StockValuation {
  rows: ValuationRow[];
  total: ValuationTotal;
  /** The date everything here is as of. */
  asOf: string;
}

/**
 * **WHAT THE SHELF IS WORTH, AS OF A DATE.**
 *
 * A balance sheet is always as of a day, so this is too — and `asOf` filters the
 * MOVEMENTS rather than the lots, because a lot created in June holds different
 * stock in July than it did in June. Passing no date values everything, which is
 * what a stock list on screen wants.
 *
 * **THE THREE QUERIES ARE DELIBERATELY NOT ONE.** Quantity on hand, a lot's
 * carried cost and an item's average rate are three different folds over the
 * same table with three different shapes — the first groups by (item, lot), the
 * second needs movements issued INTO a lot as well as its own, and the third
 * counts only what came in with a price. Fusing them into one clever query
 * produced, in an earlier draft, an average that quietly included issues and was
 * therefore circular.
 *
 * Zero-balance lines are dropped, the same rule `stockAtLocation` follows: a lot
 * that went in and came out is not "0 lb worth nothing", it is not there.
 */
export async function valueStock(
  tx: Tx,
  tenantId: string,
  opts: { asOf?: string; itemId?: string } = {},
): Promise<StockValuation> {
  const dateFilter = opts.asOf
    ? lte(schema.inventoryMovements.occurredOn, opts.asOf)
    : undefined;
  const itemFilter = opts.itemId
    ? eq(schema.inventoryMovements.itemId, opts.itemId)
    : undefined;

  const rows = await tx
    .select({
      itemId: schema.inventoryMovements.itemId,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.stockingUnit,
      lotId: schema.inventoryMovements.lotId,
      lotCode: schema.inventoryLots.code,
      lotSource: schema.inventoryLots.source,
      capitalisedOn: schema.inventoryLots.capitalisedOn,
      quantity: sql<string>`sum(${schema.inventoryMovements.quantity})`,
    })
    .from(schema.inventoryMovements)
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
      and(eq(schema.inventoryMovements.tenantId, tenantId), dateFilter, itemFilter),
    )
    .groupBy(
      schema.inventoryMovements.itemId,
      schema.inventoryItems.name,
      schema.inventoryItems.stockingUnit,
      schema.inventoryMovements.lotId,
      schema.inventoryLots.code,
      schema.inventoryLots.source,
      schema.inventoryLots.capitalisedOn,
    );

  const standing = rows
    .map((row) => ({ ...row, quantity: roundQuantity(Number(row.quantity)) }))
    .filter((row) => row.quantity !== 0)
    // **A CAPITALISED BATCH IS NOT STOCK.** Its cost is on the other side of
    // the balance sheet, and a line here would count it twice — the thing is
    // still THERE (a breeding cow is very much there), it is simply not
    // inventory. As of the report's own date, so a valuation run before she was
    // capitalised still includes her.
    .filter(
      (row) =>
        !row.capitalisedOn ||
        (opts.asOf ? row.capitalisedOn > opts.asOf : false),
    );

  const lotIds = [
    ...new Set(
      standing.map((r) => r.lotId).filter((id): id is string => id !== null),
    ),
  ];
  const itemIds = [...new Set(standing.map((r) => r.itemId))];

  const [carried, rates] = await Promise.all([
    carriedCostByLot(tx, tenantId, lotIds, opts.asOf),
    averageRatesForItems(tx, tenantId, itemIds, opts.asOf),
  ]);

  const valued: ValuationRow[] = standing
    .map((row) => {
      const line = valueLine({
        quantity: row.quantity,
        // `carriedValue`, NEVER `remainingCents` directly — a lot nobody
        // costed and a lot whose cost has all been released both fold to zero,
        // and only the first must come out unvalued.
        carriedCents: row.lotId
          ? (() => {
              const cost = carried.get(row.lotId);
              return cost ? carriedValue(cost) : null;
            })()
          : null,
        averageRate: rates.get(row.itemId) ?? null,
      });
      return {
        itemId: row.itemId,
        itemName: row.itemName,
        unit: row.unit,
        lotId: row.lotId,
        lotCode: row.lotCode,
        lotSource: row.lotSource,
        quantity: row.quantity,
        valueCents: line.valueCents,
        method: line.method,
      };
    })
    .sort((a, b) =>
      a.itemName === b.itemName
        ? (a.lotCode ?? "").localeCompare(b.lotCode ?? "")
        : a.itemName.localeCompare(b.itemName),
    );

  return {
    rows: valued,
    total: valuationTotal(valued),
    asOf: opts.asOf ?? "",
  };
}

/**
 * The average cost rate for several items at once, as of a date.
 *
 * `itemCostRate` answers this for one item and is the shape every caller before
 * valuation needed. A stock list asks for fifty at a time, and fifty round trips
 * to compute fifty averages is the query pattern that makes a page crawl.
 */
export async function averageRatesForItems(
  tx: Tx,
  tenantId: string,
  itemIds: string[],
  asOf?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;
  const rows = await tx
    .select({
      itemId: schema.inventoryMovements.itemId,
      quantity: schema.inventoryMovements.quantity,
      costCents: schema.inventoryMovements.costCents,
      movementKind: schema.inventoryMovements.movementKind,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.itemId, itemIds),
        asOf ? lte(schema.inventoryMovements.occurredOn, asOf) : undefined,
      ),
    );
  const byItem = new Map<string, CostedMovement[]>();
  for (const row of rows) {
    const list = byItem.get(row.itemId);
    if (list) list.push(row);
    else byItem.set(row.itemId, [row]);
  }
  for (const itemId of itemIds) {
    const rate = averageCostRate(byItem.get(itemId) ?? []);
    if (rate !== null) out.set(itemId, rate);
  }
  return out;
}

/**
 * **POUNDS PER STOCKING UNIT for a set of items AND for each of their lots, in
 * one query.**
 *
 * Both halves come out of the same rows, which is the whole reason they are one
 * function: the item page wants the item's figure on its "on hand" card and
 * every batch's figure in the table below it, and the truck wants a figure per
 * line where a line IS an (item, lot) pair.
 *
 * **PER LOT IS THE ANSWER THAT MATTERS, and per item is only the fallback.**
 * A run packed in 1 lb bags and a run packed in 2 lb bags are different batches
 * and averaging them across the item produces a number true of neither — which
 * is exactly the item-level drift `averageCostRate` is stuck with and the
 * dossier's open items already complain about. Weight does not have to repeat
 * that mistake, because the receipt movement carries `lot_id` already.
 *
 * A lot nobody weighed is ABSENT from the map rather than present at zero. See
 * "UNWEIGHED IS NOT ZERO" in `core/weight.ts`.
 */
export async function weightRatesForItems(
  tx: Tx,
  tenantId: string,
  itemIds: string[],
): Promise<{ byItem: Map<string, number>; byLot: Map<string, number> }> {
  const byItem = new Map<string, number>();
  const byLot = new Map<string, number>();
  if (itemIds.length === 0) return { byItem, byLot };
  const rows = await tx
    .select({
      itemId: schema.inventoryMovements.itemId,
      lotId: schema.inventoryMovements.lotId,
      quantity: schema.inventoryMovements.quantity,
      weightLb: schema.inventoryMovements.weightLb,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        inArray(schema.inventoryMovements.itemId, itemIds),
        // Only weighed rows can contribute, and on a farm holding feed and
        // animals that is a small minority of the ledger.
        isNotNull(schema.inventoryMovements.weightLb),
      ),
    );
  const perItem = new Map<string, WeighedMovement[]>();
  const perLot = new Map<string, WeighedMovement[]>();
  for (const row of rows) {
    const list = perItem.get(row.itemId);
    if (list) list.push(row);
    else perItem.set(row.itemId, [row]);
    if (row.lotId) {
      const lotList = perLot.get(row.lotId);
      if (lotList) lotList.push(row);
      else perLot.set(row.lotId, [row]);
    }
  }
  for (const [itemId, movements] of perItem) {
    const rate = averagePackageWeight(movements);
    if (rate !== null) byItem.set(itemId, rate);
  }
  for (const [lotId, movements] of perLot) {
    const rate = averagePackageWeight(movements);
    if (rate !== null) byLot.set(lotId, rate);
  }
  return { byItem, byLot };
}

/** Everything issued into one lot, newest first — the "what has this pen eaten" list. */
export async function consumedByLot(
  tx: Tx,
  tenantId: string,
  lotId: string,
  limit = 50,
): Promise<InventoryMovement[]> {
  return tx.query.inventoryMovements.findMany({
    where: and(
      eq(schema.inventoryMovements.tenantId, tenantId),
      eq(schema.inventoryMovements.issuedToLotId, lotId),
    ),
    orderBy: (m, { desc: byDesc }) => [byDesc(m.occurredOn), byDesc(m.createdAt)],
    limit,
  });
}
