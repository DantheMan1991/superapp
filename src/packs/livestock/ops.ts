import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  LivestockDailyLog,
  LivestockIdentifier,
  LivestockLot,
} from "@/db/schema";
import {
  createItem,
  createLot as createInventoryLot,
  getLot as getInventoryLot,
  datedMovementsForLots,
  listItems,
  listLots as listInventoryLots,
  movementKindsForLots,
  onHandByItem,
  recordMovement,
  splitLot as splitInventoryLot,
  type InventoryCtx,
} from "@/packs/inventory/ops";
import {
  currentZoneForOccupants,
  listParcels,
  listZones,
  moveOccupant,
  restByZone,
  type LandCtx,
  type MoveResult,
} from "@/packs/land/ops";
import { isValidSlug } from "@/packs/inventory/vocabulary";
import { addDays } from "@/lib/timezone";
import { ageInDays, headEffect, summariseHead } from "./core/herd";
import { checkStreak } from "./core/daily";
import {
  SNAPSHOT_LOT_CAP,
  SNAPSHOT_ZONE_CAP,
  type AdvisorLot,
  type FarmSnapshot,
} from "./core/digest";

/** How far back the streak in the digest looks. Matches the round screen. */
const SNAPSHOT_STREAK_DAYS = 90;

/**
 * Loss EVENTS carried per lot. Five is enough to show a shape — front-loaded,
 * trickling, or one bad night — without turning the digest into a ledger.
 */
const SNAPSHOT_LOSS_EVENTS = 5;

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
      | "ITEM_REQUIRED"
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

/**
 * Who may write, and at which level. The rule lives in
 * `src/lib/packs/authorize.ts`: **is this a decision, or is it a chore?**
 *
 * `owner` is FORCED for anything that creates a cost object, because
 * `upsertDimensionMember` requires the owner role — a staff-created entity
 * would succeed while its cost object did not, leaving something no report can
 * group by. `member` is for recording that something happened to a thing that
 * already exists, which is daily work done by whoever is doing it.
 */
function requireWrite(ctx: LivestockCtx, level: WriteLevel): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new LivestockError("FORBIDDEN", "only an owner can change this");
  }
}

const SEXES = new Set(["male", "female", "mixed"]);

// ------------------------------------------------------------------- lots ---

export interface LivestockLotInput {
  /**
   * The inventory item these animals are counted as. Must be stocked in head.
   *
   * Omitted when `newItemName` is given — see `createLivestockLot`.
   */
  itemId?: string;
  /**
   * Create the item as part of starting the lot: "Beef cattle", "Laying hens".
   *
   * WHY THIS EXISTS. The item is a real and separate thing — it is the cost
   * object head roll up to, and a farm running beef and dairy as two lines
   * wants two items for one species. But requiring it to exist FIRST meant a
   * farm's first cattle could only be entered by leaving for the Inventory
   * module, and the picker cheerfully offered to count cattle as broiler
   * chicks in the meantime. Reported by the founder, 2026-08-16.
   */
  newItemName?: string;
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
  requireWrite(ctx, "owner");
  const species = input.species.trim().toLowerCase();
  if (!isValidSlug(species)) {
    throw new LivestockError("INVALID_SPECIES", `invalid species: ${input.species}`);
  }
  if (input.sex && !SEXES.has(input.sex)) {
    throw new LivestockError("INVALID_SEX", `invalid sex: ${input.sex}`);
  }

  // Exactly one. Both would leave it ambiguous which item the head landed in,
  // and neither is the caller forgetting the field rather than meaning "any".
  const newItemName = input.newItemName?.trim();
  if (!input.itemId === !newItemName) {
    throw new LivestockError(
      "ITEM_REQUIRED",
      "give either an existing item or a name for a new one",
    );
  }

  const itemId = newItemName
    ? (
        await createItem(tx, asInventory(ctx), {
          name: newItemName,
          // Head, always: this is the livestock pack, and a lot whose item were
          // stocked in pounds could not carry a head count at all.
          stockingUnit: "head",
          itemKind: "livestock",
        })
      ).id
    : input.itemId!;

  const inventoryLot = await createInventoryLot(tx, asInventory(ctx), {
    itemId,
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
  requireWrite(ctx, "owner");
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
  requireWrite(ctx, "member");
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
  requireWrite(ctx, "member");
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
  requireWrite(ctx, "owner");
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
 * Move a lot onto a zone. **Writes into `land`'s table, through `land`'s ops.**
 *
 * This is the seam land slice 1 was built for, now with its real caller. Land
 * owns the place and the rest clock and stays ignorant of what a lot is;
 * livestock supplies the fact and a LABEL, which is a copy — so a rest report
 * never needs to join into this pack, and keeps working if it is switched off.
 *
 * `moveOccupant`, not `startOccupancy`: if they are already somewhere, moving
 * them means taking them off it, and the inclusive-date arithmetic that makes
 * the two spans meet correctly is land's business, not this pack's.
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
    /**
     * The pen, barn or chicken tractor they are in. Null means loose on the
     * paddock — which is what cattle do, and is not a missing value.
     */
    structureAssetId?: string | null;
    notes?: string;
  },
): Promise<MoveResult> {
  requireWrite(ctx, "member");
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId} not found`);
  }
  const inventoryLot = await getInventoryLot(tx, ctx.tenantId, lot.inventoryLotId);
  if (!inventoryLot) {
    throw new LivestockError("LOT_INVALID", "that lot has no inventory record");
  }

  return moveOccupant(tx, asLand(ctx), input.zoneId, {
    occupantLabel: `${inventoryLot.code} · ${lot.species}`,
    startedOn: input.startedOn,
    endedOn: input.endedOn ?? null,
    areaAcres: input.areaAcres ?? null,
    structureAssetId: input.structureAssetId ?? null,
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
  requireWrite(ctx, "member");
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
  requireWrite(ctx, "member");
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

// ------------------------------------------------------------- daily round ---

/**
 * Record that somebody looked at a lot today, and what they found.
 *
 * **THE ROW IS THE CHECK.** Its presence means a person walked the pen on that
 * date; its absence means nobody did. That distinction is the whole reason this
 * table exists, because "zero died" and "didn't check" are different facts and
 * the mortality denominator is only honest if they are told apart.
 *
 * A loss entered during the round goes to `inventory`'s ledger through
 * `removeHead`, in the SAME transaction — never into a column here. The head
 * count stays a balance, the log stays a record of attention, and neither has
 * to be reconciled against the other because there is only ever one number.
 *
 * `member`, not `owner`. Walking the pens is the definition of a chore, and at
 * 10x the person doing it is not the owner.
 */
export async function recordDailyCheck(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    livestockLotId: string;
    loggedOn: string;
    status?: "normal" | "attention";
    notes?: string;
    /** Head lost while looking. Optional, and the common answer is none. */
    loss?: { head: number; reason: "death" | "cull" | "sold_live"; notes?: string };
  },
): Promise<LivestockDailyLog> {
  requireWrite(ctx, "member");
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId} not found`);
  }

  if (input.loss && input.loss.head > 0) {
    const inventoryLot = await getInventoryLot(tx, ctx.tenantId, lot.inventoryLotId);
    if (!inventoryLot) {
      throw new LivestockError("LOT_INVALID", "that lot has no inventory record");
    }
    await removeHead(tx, ctx, {
      itemId: inventoryLot.itemId,
      inventoryLotId: inventoryLot.id,
      head: input.loss.head,
      reason: input.loss.reason,
      occurredOn: input.loggedOn,
      notes: input.loss.notes,
    });
  }

  // A loss is by definition not a normal day, so the caller does not have to
  // remember to say so. Recording four dead birds against a "normal" check
  // would be a contradiction the screen should not be able to produce.
  const status =
    input.loss && input.loss.head > 0 ? "attention" : input.status ?? "normal";
  const notes = input.notes?.trim() ?? "";

  const rows = await tx
    .insert(schema.livestockDailyLogs)
    .values({
      tenantId: ctx.tenantId,
      livestockLotId: input.livestockLotId,
      loggedOn: input.loggedOn,
      status,
      notes,
      recordedBy: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.livestockDailyLogs.tenantId,
        schema.livestockDailyLogs.livestockLotId,
        schema.livestockDailyLogs.loggedOn,
      ],
      set: {
        status,
        // Looking twice in a day is one fact, so the second look UPDATES the
        // first rather than adding a row. Notes only overwrite when the second
        // check actually said something — otherwise a quick confirmation would
        // erase the morning's "left hind leg swollen".
        ...(notes ? { notes } : {}),
        recordedBy: ctx.userId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

/**
 * The one-tap round: mark every lot that has NOT been looked at as normal.
 *
 * **IT CANNOT OVERWRITE AN EXCEPTION**, and that is not politeness, it is what
 * makes the button usable. The design's rule is "one tap confirms all normal
 * across the whole farm, and only exceptions are entered individually" — which
 * only works if entering the exception first and tapping the button second is
 * safe. ON CONFLICT DO NOTHING against the one-per-lot-per-day index is what
 * guarantees that, in the database rather than in a read-then-write race.
 *
 * Returns the lots it actually recorded, so the screen can say "11 marked"
 * without claiming credit for the three that were already done.
 */
export async function markRoundNormal(
  tx: Tx,
  ctx: LivestockCtx,
  input: { livestockLotIds: string[]; loggedOn: string },
): Promise<LivestockDailyLog[]> {
  requireWrite(ctx, "member");
  if (input.livestockLotIds.length === 0) return [];

  // Only this tenant's lots, and only ones that exist. The ids arrive from a
  // form, so they are input rather than fact — the composite FK would refuse a
  // foreign one anyway, but with an error nobody can read.
  const lots = await tx.query.livestockLots.findMany({
    where: and(
      eq(schema.livestockLots.tenantId, ctx.tenantId),
      inArray(schema.livestockLots.id, input.livestockLotIds),
    ),
    columns: { id: true },
  });
  if (lots.length === 0) return [];

  return tx
    .insert(schema.livestockDailyLogs)
    .values(
      lots.map((lot) => ({
        tenantId: ctx.tenantId,
        livestockLotId: lot.id,
        loggedOn: input.loggedOn,
        status: "normal",
        recordedBy: ctx.userId,
      })),
    )
    .onConflictDoNothing({
      target: [
        schema.livestockDailyLogs.tenantId,
        schema.livestockDailyLogs.livestockLotId,
        schema.livestockDailyLogs.loggedOn,
      ],
    })
    .returning();
}

/** Every check made on one day, keyed by livestock lot. */
export async function checksOn(
  tx: Tx,
  tenantId: string,
  loggedOn: string,
): Promise<Map<string, LivestockDailyLog>> {
  const rows = await tx.query.livestockDailyLogs.findMany({
    where: and(
      eq(schema.livestockDailyLogs.tenantId, tenantId),
      eq(schema.livestockDailyLogs.loggedOn, loggedOn),
    ),
  });
  return new Map(rows.map((row) => [row.livestockLotId, row]));
}

/**
 * When each lot was last looked at. One query, whatever the lot count.
 *
 * A lot with no entry at all is ABSENT from the map rather than mapped to null,
 * because "never checked" is exactly what the round screen exists to surface
 * and a null rendering as a date-shaped blank would hide it.
 */
export async function lastCheckedByLot(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      livestockLotId: schema.livestockDailyLogs.livestockLotId,
      lastCheckedOn: sql<string>`max(${schema.livestockDailyLogs.loggedOn})`,
    })
    .from(schema.livestockDailyLogs)
    .where(eq(schema.livestockDailyLogs.tenantId, tenantId))
    .groupBy(schema.livestockDailyLogs.livestockLotId);
  return new Map(rows.map((row) => [row.livestockLotId, row.lastCheckedOn]));
}

/**
 * The distinct days the round was walked at all, most recent first.
 *
 * FARM-WIDE, not per lot, because that is what the streak means here: the habit
 * is "I did the rounds", and a day when eleven of fourteen pens were checked
 * was still a day somebody went out. Per-lot strictness would break the streak
 * on the pen that stood empty that week and teach people the counter is noise.
 */
export async function checkedDaysSince(
  tx: Tx,
  tenantId: string,
  since: string,
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ loggedOn: schema.livestockDailyLogs.loggedOn })
    .from(schema.livestockDailyLogs)
    .where(
      and(
        eq(schema.livestockDailyLogs.tenantId, tenantId),
        gte(schema.livestockDailyLogs.loggedOn, since),
      ),
    );
  return rows.map((row) => row.loggedOn);
}

/** One lot's recent checks, newest first — the history on its detail page. */
export async function listChecksForLot(
  tx: Tx,
  tenantId: string,
  livestockLotId: string,
  limit = 14,
): Promise<LivestockDailyLog[]> {
  return tx.query.livestockDailyLogs.findMany({
    where: and(
      eq(schema.livestockDailyLogs.tenantId, tenantId),
      eq(schema.livestockDailyLogs.livestockLotId, livestockLotId),
    ),
    orderBy: (l, { desc }) => [desc(l.loggedOn)],
    limit,
  });
}

// ---------------------------------------------------------------- advisory ---

/**
 * Everything the advisor is allowed to know about this farm, in one read.
 *
 * **ASSEMBLED HERE, NEVER FROM THE BROWSER.** The question is the only thing a
 * client sends; every fact in the answer comes from this function, inside
 * `withTenant`, under RLS. That is the boundary that makes it safe for an
 * answer to sound certain about the farm — and it is why the digest is built in
 * the ops layer rather than passed in by the action.
 *
 * It composes all three packs, which is the point: the animals are this pack's,
 * the head counts and the feed are `inventory`'s, and the ground and its rest
 * are `land`'s. An advisor that could only see livestock rows would answer
 * "where do I put them next" with a shrug.
 */
export async function farmSnapshot(
  tx: Tx,
  tenantId: string,
  options: { today: string; species?: string[] },
): Promise<FarmSnapshot> {
  const { today } = options;
  const allLots = await listLivestockLots(tx, tenantId);
  const lots = allLots.slice(0, SNAPSHOT_LOT_CAP);
  const inventoryLotIds = lots.map((l) => l.inventoryLotId);

  const [
    inventoryLots,
    movements,
    dated,
    places,
    lastChecked,
    todaysChecks,
    checkedDays,
    zones,
    parcels,
    items,
    onHand,
  ] = await Promise.all([
    listInventoryLots(tx, tenantId),
    movementKindsForLots(tx, tenantId, inventoryLotIds),
    datedMovementsForLots(tx, tenantId, inventoryLotIds),
    currentZoneForOccupants(tx, tenantId, "livestock", inventoryLotIds, today),
    lastCheckedByLot(tx, tenantId),
    checksOn(tx, tenantId, today),
    checkedDaysSince(tx, tenantId, addDays(today, -SNAPSHOT_STREAK_DAYS)),
    listZones(tx, tenantId, { status: "active" }),
    listParcels(tx, tenantId, { status: "active" }),
    listItems(tx, tenantId, { status: "active" }),
    onHandByItem(tx, tenantId),
  ]);

  const byInventoryLot = new Map(inventoryLots.map((l) => [l.id, l]));
  const parcelNames = new Map(parcels.map((p) => [p.id, p.name]));
  const shownZones = zones.slice(0, SNAPSHOT_ZONE_CAP);
  const rest = await restByZone(
    tx,
    tenantId,
    shownZones.map((z) => z.id),
    today,
  );

  const advisorLots: AdvisorLot[] = lots.map((lot) => {
    const summary = summariseHead(movements.get(lot.inventoryLotId) ?? []);
    const place = places.get(lot.inventoryLotId);
    // The CLASSIFICATION is this pack's, as it has been since slice 0 — what
    // counts as a death is livestock's business and inventory has no opinion.
    const losses = (dated.get(lot.inventoryLotId) ?? [])
      .filter((m) => headEffect(m.movementKind) === "death")
      .slice(0, SNAPSHOT_LOSS_EVENTS)
      .map((m) => ({
        on: m.occurredOn,
        ageDays: ageInDays(lot.bornOn, m.occurredOn),
        head: Math.abs(m.quantity),
      }));
    return {
      code: byInventoryLot.get(lot.inventoryLotId)?.code ?? "—",
      species: lot.species,
      breed: lot.breed,
      sex: lot.sex,
      ageDays: ageInDays(lot.bornOn, today),
      head: summary.balance,
      intake: summary.intake,
      died: summary.died,
      where: place
        ? place.structureName
          ? `${place.zoneName} (${place.structureName})`
          : place.zoneName
        : null,
      whereSince: place?.startedOn ?? null,
      losses,
      lastCheckedOn: lastChecked.get(lot.id) ?? null,
    };
  });

  return {
    today,
    species: options.species ?? [],
    lots: advisorLots,
    lotsOmitted: allLots.length - lots.length,
    zones: shownZones.map((zone) => {
      const zoneRest = rest.get(zone.id);
      return {
        name: zone.name,
        parcel: parcelNames.get(zone.parcelId) ?? "",
        areaAcres: zone.areaAcres === null ? null : Number(zone.areaAcres),
        status: zoneRest?.status ?? "never_grazed",
        restDays: zoneRest?.restDays ?? null,
      };
    }),
    zonesOmitted: zones.length - shownZones.length,
    // Only what there is some of. A list of every item at zero is noise, and
    // "we have no feed" is a claim this pack cannot make anyway until issues
    // are recorded — inventory slice 1.
    stock: items
      .map((item) => ({
        name: item.name,
        onHand: onHand.get(item.id) ?? 0,
        unit: item.stockingUnit,
      }))
      .filter((s) => s.onHand !== 0),
    streakDays: checkStreak(checkedDays, today),
    checkedToday: advisorLots.filter((_, i) => todaysChecks.has(lots[i].id)).length,
  };
}
