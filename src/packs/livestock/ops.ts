import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { LivestockIdentifier, LivestockLot } from "@/db/schema";
import {
  createLot as createInventoryLot,
  getLot as getInventoryLot,
  recordMovement,
  splitLot as splitInventoryLot,
  type InventoryCtx,
} from "@/packs/inventory/ops";
import { startOccupancy, type LandCtx } from "@/packs/land/ops";
import { isValidSlug } from "@/packs/inventory/vocabulary";

/**
 * Livestock operations.
 *
 * **THIS FILE IMPORTS TWO OTHER PACKS, AND THAT IS ALLOWED BECAUSE IT DECLARES
 * THEM.** `livestock.requires = ["inventory", "land"]`, which is exactly what
 * separates a legitimate composition from the leak
 * docs/extension-model.md §4 forbids. A pack must never reach into something it
 * does not require; requiring it is the whole permission.
 *
 * What that buys is visible in how little is here. The lot, the head ledger and
 * the split all belong to `inventory`; occupancy belongs to `land`. Livestock
 * writes the biology and then calls its neighbours — so there is no second lot
 * table, no parallel head counter, and no duplicate occupancy record to keep in
 * step. If this pack had been built first, all three would exist twice.
 *
 * The ctx types are structurally identical across the three packs, so one
 * context satisfies all of them. That is not an accident worth relying on
 * forever, but it is honest today.
 */

export class LivestockError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_SPECIES"
      | "INVALID_SEX"
      | "INVALID_IDENTIFIER"
      | "LOT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "LivestockError";
  }
}

export interface LivestockCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/** The same shape the packs it composes expect. */
const asInventory = (ctx: LivestockCtx): InventoryCtx => ctx;
const asLand = (ctx: LivestockCtx): LandCtx => ctx;

function requireOwner(ctx: LivestockCtx): void {
  if (ctx.role !== "owner") {
    throw new LivestockError("FORBIDDEN", "owner role required");
  }
}

const SEXES = new Set(["male", "female", "mixed"]);

// ------------------------------------------------------------------- lots ---

export interface LivestockLotInput {
  /** The inventory item these animals are counted as. Must be stocked in head. */
  itemId: string;
  /** The lot's human code: "B-2026-04-15", "Pen 3", "#47". */
  code: string;
  species: string;
  sex?: string | null;
  breed?: string;
  bornOn?: string | null;
  /** Where they came from, in inventory's terms. */
  source?: string;
  notes?: string;
}

/**
 * Create an animal lot: an inventory lot, plus its biology, in ONE transaction.
 *
 * The inventory lot is the spine — it is what carries the quantity, the
 * lineage, and the `dimension_member` that makes cost-per-pen a reporting
 * question. This function adds only what inventory could not know.
 */
export async function createLivestockLot(
  tx: Tx,
  ctx: LivestockCtx,
  input: LivestockLotInput,
): Promise<{ lot: LivestockLot; inventoryLotId: string }> {
  requireOwner(ctx);
  const species = input.species.trim().toLowerCase();
  if (!isValidSlug(species)) {
    throw new LivestockError("INVALID_SPECIES", `invalid species: ${input.species}`);
  }
  if (input.sex && !SEXES.has(input.sex)) {
    throw new LivestockError("INVALID_SEX", `invalid sex: ${input.sex}`);
  }

  const inventoryLot = await createInventoryLot(tx, asInventory(ctx), {
    itemId: input.itemId,
    code: input.code,
    source: input.source ?? "purchased",
    openedOn: input.bornOn ?? null,
    notes: input.notes,
  });

  const rows = await tx
    .insert(schema.livestockLots)
    .values({
      tenantId: ctx.tenantId,
      inventoryLotId: inventoryLot.id,
      species,
      sex: input.sex ?? null,
      breed: input.breed?.trim() ?? "",
      bornOn: input.bornOn ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();

  return { lot: rows[0], inventoryLotId: inventoryLot.id };
}

export async function listLivestockLots(
  tx: Tx,
  tenantId: string,
  filter: { species?: string } = {},
): Promise<LivestockLot[]> {
  const where = [eq(schema.livestockLots.tenantId, tenantId)];
  if (filter.species) where.push(eq(schema.livestockLots.species, filter.species));
  return tx.query.livestockLots.findMany({
    where: and(...where),
    orderBy: (l, { desc }) => [desc(l.createdAt)],
  });
}

export async function getLivestockLot(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<LivestockLot | null> {
  const row = await tx.query.livestockLots.findFirst({
    where: and(
      eq(schema.livestockLots.tenantId, tenantId),
      eq(schema.livestockLots.id, id),
    ),
  });
  return row ?? null;
}

/** The biology for several inventory lots at once, keyed by inventory lot id. */
export async function livestockByInventoryLot(
  tx: Tx,
  tenantId: string,
  inventoryLotIds: string[],
): Promise<Map<string, LivestockLot>> {
  const out = new Map<string, LivestockLot>();
  if (inventoryLotIds.length === 0) return out;
  const rows = await tx.query.livestockLots.findMany({
    where: and(
      eq(schema.livestockLots.tenantId, tenantId),
      inArray(schema.livestockLots.inventoryLotId, inventoryLotIds),
    ),
  });
  for (const row of rows) out.set(row.inventoryLotId, row);
  return out;
}

export async function updateLivestockLot(
  tx: Tx,
  ctx: LivestockCtx,
  id: string,
  input: Partial<Pick<LivestockLotInput, "species" | "sex" | "breed" | "bornOn" | "notes">>,
): Promise<LivestockLot> {
  requireOwner(ctx);
  const existing = await getLivestockLot(tx, ctx.tenantId, id);
  if (!existing) throw new LivestockError("NOT_FOUND", `lot ${id} not found`);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.species !== undefined) {
    const species = input.species.trim().toLowerCase();
    if (!isValidSlug(species)) {
      throw new LivestockError("INVALID_SPECIES", `invalid species: ${input.species}`);
    }
    patch.species = species;
  }
  if (input.sex !== undefined) {
    if (input.sex && !SEXES.has(input.sex)) {
      throw new LivestockError("INVALID_SEX", `invalid sex: ${input.sex}`);
    }
    patch.sex = input.sex;
  }
  if (input.breed !== undefined) patch.breed = input.breed.trim();
  if (input.bornOn !== undefined) patch.bornOn = input.bornOn;
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.livestockLots)
    .set(patch)
    .where(
      and(
        eq(schema.livestockLots.tenantId, ctx.tenantId),
        eq(schema.livestockLots.id, id),
      ),
    )
    .returning();
  return rows[0];
}

// ------------------------------------------------------------ head events ---

/**
 * Place head into a lot: hatched, bought in, born.
 *
 * A thin wrapper over `inventory.recordMovement`, and it stays thin on purpose.
 * Livestock does not get its own ledger — it stamps `extension_slug` so the
 * rows are attributable, and lets the spine do the arithmetic.
 */
export async function placeHead(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    itemId: string;
    inventoryLotId: string;
    head: number;
    occurredOn: string;
    locationAssetId?: string | null;
    notes?: string;
  },
): Promise<void> {
  requireOwner(ctx);
  await recordMovement(tx, asInventory(ctx), {
    itemId: input.itemId,
    lotId: input.inventoryLotId,
    locationAssetId: input.locationAssetId ?? null,
    quantity: Math.abs(input.head),
    movementKind: "placement",
    occurredOn: input.occurredOn,
    extensionSlug: "livestock",
    notes: input.notes,
  });
}

/**
 * Record deaths, culls or live sales — head leaving other than by transfer.
 *
 * **Mortality is a diagnostic, not bookkeeping.** Expected broiler loss is a few
 * percent, and the system should make deviation visible while it can still be
 * acted on: timing implies cause, with first-week losses pointing at chick
 * quality or brooding and late ones at heat or the leg and heart problems of
 * fast growth. All of that is a query over these rows.
 */
export async function removeHead(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    itemId: string;
    inventoryLotId: string;
    head: number;
    reason: "death" | "cull" | "sold_live";
    occurredOn: string;
    locationAssetId?: string | null;
    notes?: string;
  },
): Promise<void> {
  requireOwner(ctx);
  await recordMovement(tx, asInventory(ctx), {
    itemId: input.itemId,
    lotId: input.inventoryLotId,
    locationAssetId: input.locationAssetId ?? null,
    quantity: -Math.abs(input.head),
    movementKind: input.reason,
    occurredOn: input.occurredOn,
    extensionSlug: "livestock",
    notes: input.notes,
  });
}

/**
 * Split head into a new lot, carrying the biology across.
 *
 * The operation the pilot's broilers need — a batch of chicks arrives as one
 * purchase and splits across pens — and the one that makes "promote the pigs to
 * individuals when the slaughter date is booked" fall out instead of being
 * bespoke. Inventory does the split and the balancing; this adds the biology
 * row so the child is still an animal lot rather than an anonymous quantity.
 */
export async function splitLivestockLot(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    livestockLotId: string;
    head: number;
    newCode: string;
    occurredOn: string;
    locationAssetId?: string | null;
  },
): Promise<{ lot: LivestockLot; inventoryLotId: string }> {
  requireOwner(ctx);
  const parent = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!parent) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId} not found`);
  }

  const { child } = await splitInventoryLot(tx, asInventory(ctx), {
    lotId: parent.inventoryLotId,
    quantity: Math.abs(input.head),
    newCode: input.newCode,
    occurredOn: input.occurredOn,
    locationAssetId: input.locationAssetId ?? null,
  });

  const rows = await tx
    .insert(schema.livestockLots)
    .values({
      tenantId: ctx.tenantId,
      inventoryLotId: child.id,
      // The biology travels with the animals. Splitting a batch of Cornish
      // Cross does not produce a batch of something else.
      species: parent.species,
      sex: parent.sex,
      breed: parent.breed,
      bornOn: parent.bornOn,
    })
    .returning();

  return { lot: rows[0], inventoryLotId: child.id };
}

// -------------------------------------------------------------- occupancy ---

/**
 * Put a lot on a zone. **Writes into `land`'s table, through `land`'s ops.**
 *
 * This is the seam land slice 1 was built for, now with its real caller. Land
 * owns the place and the rest clock and stays ignorant of what a lot is;
 * livestock supplies the fact and a LABEL, which is a copy — so a rest report
 * never needs to join into this pack, and keeps working if it is switched off.
 */
export async function moveLotToZone(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    livestockLotId: string;
    zoneId: string;
    startedOn: string;
    endedOn?: string | null;
    /** Strip size for a polywire graze. Null means the whole zone. */
    areaAcres?: number | null;
    notes?: string;
  },
): Promise<void> {
  requireOwner(ctx);
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId} not found`);
  }
  const inventoryLot = await getInventoryLot(tx, ctx.tenantId, lot.inventoryLotId);
  if (!inventoryLot) {
    throw new LivestockError("LOT_INVALID", "that lot has no inventory record");
  }

  await startOccupancy(tx, asLand(ctx), input.zoneId, {
    occupantLabel: `${inventoryLot.code} · ${lot.species}`,
    startedOn: input.startedOn,
    endedOn: input.endedOn ?? null,
    areaAcres: input.areaAcres ?? null,
    notes: input.notes,
    // The identity `land` indexes on, and it is the INVENTORY lot id — the
    // spine, the same thing `dimension_members` points at. Using the biology
    // row's id would make the reference dependent on this pack existing.
    extensionSlug: "livestock",
    occupantType: "lot",
    occupantId: inventoryLot.id,
  });
}

// ------------------------------------------------------------ identifiers ---

export async function listIdentifiers(
  tx: Tx,
  tenantId: string,
  livestockLotId: string,
): Promise<LivestockIdentifier[]> {
  return tx.query.livestockIdentifiers.findMany({
    where: and(
      eq(schema.livestockIdentifiers.tenantId, tenantId),
      eq(schema.livestockIdentifiers.livestockLotId, livestockLotId),
    ),
    orderBy: (i, { asc }) => [asc(i.identifierKind), asc(i.createdAt)],
  });
}

/** Identifiers for several lots at once, keyed by livestock lot id. */
export async function identifiersByLot(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<Map<string, LivestockIdentifier[]>> {
  const out = new Map<string, LivestockIdentifier[]>();
  if (lotIds.length === 0) return out;
  const rows = await tx.query.livestockIdentifiers.findMany({
    where: and(
      eq(schema.livestockIdentifiers.tenantId, tenantId),
      inArray(schema.livestockIdentifiers.livestockLotId, lotIds),
    ),
  });
  for (const row of rows) {
    const list = out.get(row.livestockLotId);
    if (list) list.push(row);
    else out.set(row.livestockLotId, [row]);
  }
  return out;
}

export async function addIdentifier(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    livestockLotId: string;
    identifierKind: string;
    value: string;
    appliedOn?: string | null;
    notes?: string;
  },
): Promise<LivestockIdentifier> {
  requireOwner(ctx);
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId} not found`);
  }
  const kind = input.identifierKind.trim().toLowerCase();
  if (!isValidSlug(kind)) {
    throw new LivestockError(
      "INVALID_IDENTIFIER",
      `invalid identifier kind: ${input.identifierKind}`,
    );
  }

  const rows = await tx
    .insert(schema.livestockIdentifiers)
    .values({
      tenantId: ctx.tenantId,
      livestockLotId: input.livestockLotId,
      identifierKind: kind,
      value: input.value.trim(),
      appliedOn: input.appliedOn ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/**
 * Retire an identifier. NOT a delete.
 *
 * A tag that came out in a fence still identified the animal for two years, and
 * the official one carries the traceability chain onto processor paperwork —
 * so the history is the point rather than an accident of keeping rows around.
 */
export async function retireIdentifier(
  tx: Tx,
  ctx: LivestockCtx,
  id: string,
  removedOn: string,
): Promise<LivestockIdentifier> {
  requireOwner(ctx);
  const rows = await tx
    .update(schema.livestockIdentifiers)
    .set({ removedOn, updatedAt: new Date() })
    .where(
      and(
        eq(schema.livestockIdentifiers.tenantId, ctx.tenantId),
        eq(schema.livestockIdentifiers.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LivestockError("NOT_FOUND", `identifier ${id} not found`);
  }
  return rows[0];
}
