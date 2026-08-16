import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  InventoryItem,
  InventoryLot,
  InventoryMovement,
} from "@/db/schema";
import {
  archiveDimensionMember,
  listDimensionMembers,
  upsertDimensionMember,
} from "@/modules/accounting/core";
import { isLotSource, isValidSlug } from "./vocabulary";
import { isKnownUnit, roundQuantity } from "./core/units";
import type { MovementRow } from "./core/balances";

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
      | "INSUFFICIENT",
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
function requireOwner(ctx: InventoryCtx): void {
  if (ctx.role !== "owner") {
    throw new InventoryError("FORBIDDEN", "owner role required");
  }
}

// ------------------------------------------------------------------ items ---

export async function listItems(
  tx: Tx,
  tenantId: string,
  filter: { kind?: string; status?: string } = {},
): Promise<InventoryItem[]> {
  const where = [eq(schema.inventoryItems.tenantId, tenantId)];
  if (filter.kind) where.push(eq(schema.inventoryItems.itemKind, filter.kind));
  if (filter.status) where.push(eq(schema.inventoryItems.status, filter.status));
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
  requireOwner(ctx);
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
  requireOwner(ctx);
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
  requireOwner(ctx);
  const existing = await getItem(tx, ctx.tenantId, id);
  if (!existing) throw new InventoryError("NOT_FOUND", `item ${id} not found`);
  const rows = await tx
    .update(schema.inventoryItems)
    .set({ status: "archived", updatedAt: new Date() })
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
  notes?: string;
}

export async function createLot(
  tx: Tx,
  ctx: InventoryCtx,
  input: LotInput,
): Promise<InventoryLot> {
  requireOwner(ctx);
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
  requireOwner(ctx);
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
  requireOwner(ctx);
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
      extensionSlug: input.extensionSlug?.trim() || "inventory",
      notes: input.notes?.trim() ?? "",
    })
    .returning();
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
  requireOwner(ctx);
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
  requireOwner(ctx);
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
      and(eq(schema.assets.tenantId, tenantId), eq(schema.assets.status, "active")),
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
