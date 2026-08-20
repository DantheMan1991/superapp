import "server-only";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  InventoryMovement,
  LivestockDailyLog,
  LivestockFeedDraw,
  LivestockFeedGroup,
  LivestockFeedGroupMember,
  LivestockIdentifier,
  LivestockLot,
  LivestockTreatment,
  LivestockWeight,
} from "@/db/schema";
import {
  consumedByLotAndItem,
  consumedDatedByLots,
  createItem,
  createLot as createInventoryLot,
  getLot as getInventoryLot,
  datedMovementsForLots,
  issueStock,
  listItems,
  listLots as listInventoryLots,
  movementKindsForLots,
  movementsByIds,
  onHandByItem,
  recordMovement,
  splitLot as splitInventoryLot,
  type InventoryCtx,
} from "@/packs/inventory/ops";
import {
  currentZoneForOccupants,
  lastHauledOn,
  listParcels,
  listZones,
  moveOccupant,
  restByZone,
  type LandCtx,
  type MoveResult,
} from "@/packs/land/ops";
import { isValidSlug } from "@/packs/inventory/vocabulary";
import { convert, getUnit } from "@/packs/inventory/core/units";
import { tapeDivisorFrom } from "./vocabulary";
import { addDays } from "@/lib/timezone";
import { ageInDays, headEffect, summariseHead } from "./core/herd";
import { checkStreak } from "./core/daily";
import {
  allocateCents,
  allocateQuantity,
  daysOnFeed,
  earliestSpanStart,
  feedReportRows,
  headDays,
  headOnDays,
  mergeQuantities,
  type FeedLotRow,
  type FeedQuantity,
  type MembershipSpan,
} from "./core/feed";
import {
  WITHDRAWAL_SOURCES,
  lotWithdrawal,
  type LotWithdrawal,
} from "./core/withdrawal";
import {
  averageWeightLb,
  combinedConfidence,
  feedConversion,
  feedPerLiveweightLb,
  gainBetween,
  isShrinkAffected,
  latestWeighIn,
  type FeedConversion,
  type GainResult,
  type WeighIn,
} from "./core/weights";
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
      | "LOT_INVALID"
      | "FEED_GROUP_INVALID"
      | "INVALID_METHOD"
      | "INVALID_WEIGHT"
      | "INVALID_TREATMENT",
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
    /**
     * **`processed` IS NOT OFFERED TO A PERSON, and that is deliberate.** Head
     * leaving for a run goes through `production`, which is the only caller that
     * also lands the meat, carries the pen's cost across with it and consults
     * the withdrawal clock first. A picker offering it here would be a way to
     * empty a pen that does none of those three things — so the action layer
     * accepts the other three and this is reachable only through the run
     * handler.
     */
    reason: "death" | "cull" | "sold_live" | "processed";
    occurredOn: string;
    locationAssetId?: string | null;
    /**
     * What leaves with them, in cents. Null for everything a person records by
     * hand: a bird that died did not take a stamped cost anywhere, and inventing
     * one would put money on a movement nothing releases it from.
     */
    costCents?: number | null;
    notes?: string;
  },
): Promise<InventoryMovement> {
  requireWrite(ctx, "member");
  return recordMovement(tx, asInventory(ctx), {
    itemId: input.itemId,
    lotId: input.inventoryLotId,
    locationAssetId: input.locationAssetId ?? null,
    quantity: -Math.abs(input.head),
    movementKind: input.reason,
    occurredOn: input.occurredOn,
    costCents: input.costCents ?? null,
    // STILL LIVESTOCK'S EVENT even when a run asked for it. The slug says which
    // pack owns the record, not which one pressed the button — and a pen's head
    // ledger that suddenly read `production` for the one movement that empties
    // it would be the parallel counter this pack exists to avoid.
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

// ------------------------------------------------------------ treatments ---

/**
 * Record a treatment, and start its clock.
 *
 * `member`, and this is the least negotiable one in the pack: the person with
 * the syringe is the person who knows what went in, and a treatment recorded
 * three days later by somebody who was not there is how a withdrawal period ends
 * up counted from the wrong date.
 *
 * **The product may come out of stock, and then the cost is `inventory`'s.** A
 * bottle issued to the pen is an ordinary issue with the lot as consumer —
 * exactly what feed does — so a sick pen carries its own expense without this
 * table holding a second copy of the money. Null when the vet brought their own.
 */
export async function recordTreatment(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    livestockLotId: string;
    treatedOn: string;
    product: string;
    dose?: string;
    route: string;
    headTreated?: number | null;
    meatWithdrawalDays?: number | null;
    milkWithdrawalDays?: number | null;
    withdrawalSource?: string;
    administeredBy?: string;
    notes?: string;
    /** Taking the product out of stock, when it came from stock. */
    fromStock?: { itemId: string; quantity: number; lotId?: string | null } | null;
  },
): Promise<LivestockTreatment> {
  requireWrite(ctx, "member");
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId} not found`);
  }
  const product = input.product.trim();
  if (!product) {
    throw new LivestockError("INVALID_TREATMENT", "say what was given");
  }
  const route = input.route.trim().toLowerCase();
  if (!isValidSlug(route)) {
    throw new LivestockError("INVALID_TREATMENT", `invalid route: ${input.route}`);
  }
  const source = input.withdrawalSource ?? "label";
  if (!WITHDRAWAL_SOURCES.includes(source as (typeof WITHDRAWAL_SOURCES)[number])) {
    throw new LivestockError(
      "INVALID_TREATMENT",
      "say where the withdrawal period came from",
    );
  }
  /**
   * **A STATED SOURCE HAS TO STATE SOMETHING.** Claiming a period came off the
   * label while leaving both clocks empty is the row that later reads as "clear"
   * to somebody deciding whether to load a trailer. If neither was looked up,
   * that is `none_stated`, which the clock treats as NOT clear.
   */
  if (
    source !== "none_stated" &&
    (input.meatWithdrawalDays ?? null) === null &&
    (input.milkWithdrawalDays ?? null) === null
  ) {
    throw new LivestockError(
      "INVALID_TREATMENT",
      "give a meat or milk withdrawal, or say the period was not looked up",
    );
  }

  let movementId: string | null = null;
  if (input.fromStock && input.fromStock.quantity > 0) {
    const movement = await issueStock(tx, asInventory(ctx), {
      itemId: input.fromStock.itemId,
      lotId: input.fromStock.lotId ?? null,
      quantity: input.fromStock.quantity,
      // The pen that got it. Same consumer column feed uses, which is what puts
      // the cost on the animal without a second ledger.
      issuedToLotId: lot.inventoryLotId,
      occurredOn: input.treatedOn,
      extensionSlug: "livestock",
      notes: `Treated with ${product}`,
    });
    movementId = movement.id;
  }

  const rows = await tx
    .insert(schema.livestockTreatments)
    .values({
      tenantId: ctx.tenantId,
      livestockLotId: input.livestockLotId,
      treatedOn: input.treatedOn,
      product,
      dose: input.dose?.trim() ?? "",
      route,
      headTreated: input.headTreated ?? null,
      meatWithdrawalDays: input.meatWithdrawalDays ?? null,
      milkWithdrawalDays: input.milkWithdrawalDays ?? null,
      withdrawalSource: source,
      administeredBy: input.administeredBy?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      inventoryMovementId: movementId,
      recordedBy: ctx.userId,
    })
    .returning();
  return rows[0];
}

/**
 * Correct a treatment.
 *
 * **A TREATMENT RECORD IS AN OBSERVATION, SO THIS EDITS IN PLACE** — the same
 * call `updateWeight` makes and the same one `land.deleteOccupancy` made before
 * it: if somebody typed 10 days where the label said 21, no such record ever
 * existed and there is nothing to compensate for. Correcting a record is not
 * rewriting history.
 *
 * **AND IT IS THE HIGHEST-STAKES EDIT IN THE APP.** A wrong feed figure costs a
 * bad decision; a wrong withdrawal clock is a legal record, and the row somebody
 * reads before loading a trailer. The validation below therefore runs against
 * the MERGED row rather than the patch — clearing the only period a treatment
 * had while leaving its source saying "off the label" would produce exactly the
 * row that reads as clear.
 *
 * **The stock link is not editable here.** The medicine really did leave the
 * shelf; that is an `inventory` event and its correction is an adjustment in
 * that pack, not a column this one may quietly rewrite.
 */
export async function updateTreatment(
  tx: Tx,
  ctx: LivestockCtx,
  id: string,
  input: {
    treatedOn?: string;
    product?: string;
    dose?: string;
    route?: string;
    headTreated?: number | null;
    meatWithdrawalDays?: number | null;
    milkWithdrawalDays?: number | null;
    withdrawalSource?: string;
    administeredBy?: string;
    notes?: string;
  },
): Promise<LivestockTreatment> {
  requireWrite(ctx, "member");
  const existing = await tx.query.livestockTreatments.findFirst({
    where: and(
      eq(schema.livestockTreatments.tenantId, ctx.tenantId),
      eq(schema.livestockTreatments.id, id),
    ),
  });
  if (!existing) {
    throw new LivestockError("NOT_FOUND", `treatment ${id} not found`);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.treatedOn !== undefined) patch.treatedOn = input.treatedOn;
  if (input.dose !== undefined) patch.dose = input.dose.trim();
  if (input.administeredBy !== undefined) {
    patch.administeredBy = input.administeredBy.trim();
  }
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.headTreated !== undefined) patch.headTreated = input.headTreated;
  if (input.product !== undefined) {
    const product = input.product.trim();
    if (!product) {
      throw new LivestockError("INVALID_TREATMENT", "say what was given");
    }
    patch.product = product;
  }
  if (input.route !== undefined) {
    const route = input.route.trim().toLowerCase();
    if (!isValidSlug(route)) {
      throw new LivestockError("INVALID_TREATMENT", `invalid route: ${input.route}`);
    }
    patch.route = route;
  }
  if (input.withdrawalSource !== undefined) {
    if (
      !WITHDRAWAL_SOURCES.includes(
        input.withdrawalSource as (typeof WITHDRAWAL_SOURCES)[number],
      )
    ) {
      throw new LivestockError(
        "INVALID_TREATMENT",
        "say where the withdrawal period came from",
      );
    }
    patch.withdrawalSource = input.withdrawalSource;
  }
  if (input.meatWithdrawalDays !== undefined) {
    patch.meatWithdrawalDays = input.meatWithdrawalDays;
  }
  if (input.milkWithdrawalDays !== undefined) {
    patch.milkWithdrawalDays = input.milkWithdrawalDays;
  }

  // THE MERGED ROW, not the patch. See the note above.
  const source = (patch.withdrawalSource ?? existing.withdrawalSource) as string;
  const meat =
    input.meatWithdrawalDays !== undefined
      ? input.meatWithdrawalDays
      : existing.meatWithdrawalDays;
  const milk =
    input.milkWithdrawalDays !== undefined
      ? input.milkWithdrawalDays
      : existing.milkWithdrawalDays;
  if (source !== "none_stated" && meat === null && milk === null) {
    throw new LivestockError(
      "INVALID_TREATMENT",
      "give a meat or milk withdrawal, or say the period was not looked up",
    );
  }

  const rows = await tx
    .update(schema.livestockTreatments)
    .set(patch)
    .where(
      and(
        eq(schema.livestockTreatments.tenantId, ctx.tenantId),
        eq(schema.livestockTreatments.id, id),
      ),
    )
    .returning();
  return rows[0];
}

/**
 * Remove a treatment entered by mistake — a duplicate, or one recorded against
 * the wrong pen.
 *
 * **THE STOCK ISSUE IS NOT REMOVED WITH IT, AND THAT IS THE POINT.** The
 * medicine really did leave the shelf: that is an EVENT in `inventory`'s ledger,
 * and unwriting it would rewrite what happened — the exact rule that makes a
 * movement correctable only by another movement. So the treatment record goes,
 * the cost stays on the pen, and the caller has to say so on screen rather than
 * letting somebody discover it later.
 *
 * Returns the row, including its movement id, so the caller knows whether there
 * is a loose end to mention.
 */
export async function deleteTreatment(
  tx: Tx,
  ctx: LivestockCtx,
  id: string,
): Promise<LivestockTreatment> {
  requireWrite(ctx, "member");
  const deleted = await tx
    .delete(schema.livestockTreatments)
    .where(
      and(
        eq(schema.livestockTreatments.tenantId, ctx.tenantId),
        eq(schema.livestockTreatments.id, id),
      ),
    )
    .returning();
  if (deleted.length === 0) {
    throw new LivestockError("NOT_FOUND", `treatment ${id} not found`);
  }
  return deleted[0];
}

/** One lot's treatments, newest first — the history on its detail page. */
export async function listTreatmentsForLot(
  tx: Tx,
  tenantId: string,
  livestockLotId: string,
): Promise<LivestockTreatment[]> {
  return tx.query.livestockTreatments.findMany({
    where: and(
      eq(schema.livestockTreatments.tenantId, tenantId),
      eq(schema.livestockTreatments.livestockLotId, livestockLotId),
    ),
    orderBy: (t, { desc: byDesc }) => [byDesc(t.treatedOn), byDesc(t.createdAt)],
  });
}

/** Every treatment across a set of lots, keyed by lot. One query for a list. */
export async function treatmentsByLot(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<Map<string, LivestockTreatment[]>> {
  const out = new Map<string, LivestockTreatment[]>();
  if (lotIds.length === 0) return out;
  const rows = await tx.query.livestockTreatments.findMany({
    where: and(
      eq(schema.livestockTreatments.tenantId, tenantId),
      inArray(schema.livestockTreatments.livestockLotId, lotIds),
    ),
    orderBy: (t, { desc: byDesc }) => [byDesc(t.treatedOn)],
  });
  for (const row of rows) {
    const list = out.get(row.livestockLotId);
    if (list) list.push(row);
    else out.set(row.livestockLotId, [row]);
  }
  return out;
}

/**
 * Where every lot stands on both clocks, today.
 *
 * The read the livestock list and the daily round both make, because **a lot
 * under withdrawal has to be visible where somebody is already looking** rather
 * than only on a page they would have to think to open.
 */
export async function withdrawalByLot(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
  today: string,
): Promise<Map<string, LotWithdrawal>> {
  const treatments = await treatmentsByLot(tx, tenantId, lotIds);
  const out = new Map<string, LotWithdrawal>();
  for (const [lotId, rows] of treatments) {
    out.set(lotId, lotWithdrawal(rows, today));
  }
  return out;
}

/**
 * What this farm entered last time for the same product, across every lot.
 *
 * **The only default the app offers, and it is the farm's own record.** The
 * design asks for a default the user can override while forbidding the app from
 * presenting a number as authoritative — a figure somebody here typed off a
 * label three weeks ago satisfies both, where a built-in drug table would
 * satisfy neither.
 */
export async function lastTreatmentOfProduct(
  tx: Tx,
  tenantId: string,
  product: string,
): Promise<LivestockTreatment | null> {
  const wanted = product.trim();
  if (!wanted) return null;
  const rows = await tx.query.livestockTreatments.findMany({
    where: and(
      eq(schema.livestockTreatments.tenantId, tenantId),
      sql`lower(${schema.livestockTreatments.product}) = lower(${wanted})`,
    ),
    orderBy: (t, { desc: byDesc }) => [byDesc(t.treatedOn), byDesc(t.createdAt)],
    limit: 1,
  });
  return rows[0] ?? null;
}

/** Products this farm has used, most recent first — the picker's suggestions. */
export async function productsInUse(
  tx: Tx,
  tenantId: string,
  limit = 20,
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ product: schema.livestockTreatments.product })
    .from(schema.livestockTreatments)
    .where(eq(schema.livestockTreatments.tenantId, tenantId))
    .limit(limit);
  return rows.map((r) => r.product);
}

// --------------------------------------------------------------- weights ---

/**
 * Record what an animal weighed, and how anybody knows.
 *
 * `member`, and this is the clearest chore in the pack: catching ten birds and
 * putting them in a crate is done by whoever is in the pen, and a weight that
 * waits for the owner to be free is a weight taken on the wrong day.
 *
 * **The pack does not compute the pounds for a tape here.** The girth and the
 * length are stored as measured and the weight is derived at read time, so a
 * better formula — or a divisor a tenant corrects in their config — applies to
 * every animal ever measured rather than only to the next one.
 */
export async function recordWeight(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    livestockLotId: string;
    weighedOn: string;
    method: string;
    sampleSize?: number;
    sampleWeightLb?: number | null;
    heartGirthIn?: number | null;
    bodyLengthIn?: number | null;
    notes?: string;
  },
): Promise<LivestockWeight> {
  requireWrite(ctx, "member");
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId} not found`);
  }
  const method = input.method.trim().toLowerCase();
  if (!isValidSlug(method)) {
    throw new LivestockError("INVALID_METHOD", `invalid method: ${input.method}`);
  }
  const sampleSize = input.sampleSize ?? 1;
  if (!Number.isInteger(sampleSize) || sampleSize < 1) {
    throw new LivestockError(
      "INVALID_WEIGHT",
      "say how many head went on the scale — at least one",
    );
  }
  // The same rule as the CHECK, refused here so the message is one a person
  // can act on rather than a constraint name.
  const hasScale = (input.sampleWeightLb ?? null) !== null;
  const hasTape = (input.heartGirthIn ?? null) !== null;
  if (!hasScale && !hasTape) {
    throw new LivestockError(
      "INVALID_WEIGHT",
      "record what the scale said, or the girth and length off the tape",
    );
  }
  if (hasTape && (input.bodyLengthIn ?? null) === null) {
    throw new LivestockError(
      "INVALID_WEIGHT",
      "a tape needs both the heart girth and the body length",
    );
  }

  const rows = await tx
    .insert(schema.livestockWeights)
    .values({
      tenantId: ctx.tenantId,
      livestockLotId: input.livestockLotId,
      weighedOn: input.weighedOn,
      method,
      sampleSize,
      sampleWeightLb: input.sampleWeightLb ?? null,
      heartGirthIn: input.heartGirthIn ?? null,
      bodyLengthIn: input.bodyLengthIn ?? null,
      notes: input.notes?.trim() ?? "",
      recordedBy: ctx.userId,
    })
    .returning();
  return rows[0];
}

/**
 * Correct a weighing.
 *
 * **A MEASUREMENT IS NOT A LEDGER ENTRY, AND THIS IS THE DIFFERENCE.** Every
 * quantity in `inventory` is corrected by a compensating movement, because a
 * movement is an EVENT: the feed really did leave the barn, and unwriting it
 * would be rewriting what happened. A weighing is an OBSERVATION. If somebody
 * typed 625 lb for a crate of ten broilers, no such measurement ever existed —
 * there is nothing to compensate for, and no "corrective weighing" that means
 * anything. So this edits in place, exactly as `land.deleteOccupancy` removes a
 * stay entered by mistake: correcting a record is not rewriting history.
 *
 * **The audit log is the history.** The previous values travel into it, so who
 * changed a weight from what to what is answerable — which matters most on the
 * farm where two people are recording.
 *
 * **WHICH READING WINS IS DECIDED BY THE DATA, NOT THE METHOD STRING.** Supply a
 * scale weight and the tape columns are cleared; supply a girth and the scale
 * column is. A row carrying both would claim two measurements were taken, and a
 * row that kept a stale girth after being corrected to a scale reading would be
 * a lie about what somebody actually did. The method taxonomy is open, so this
 * cannot be keyed on it.
 */
export async function updateWeight(
  tx: Tx,
  ctx: LivestockCtx,
  id: string,
  input: {
    weighedOn?: string;
    method?: string;
    sampleSize?: number;
    sampleWeightLb?: number | null;
    heartGirthIn?: number | null;
    bodyLengthIn?: number | null;
    notes?: string;
  },
): Promise<LivestockWeight> {
  requireWrite(ctx, "member");
  const existing = await tx.query.livestockWeights.findFirst({
    where: and(
      eq(schema.livestockWeights.tenantId, ctx.tenantId),
      eq(schema.livestockWeights.id, id),
    ),
  });
  if (!existing) {
    throw new LivestockError("NOT_FOUND", `weighing ${id} not found`);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.weighedOn !== undefined) patch.weighedOn = input.weighedOn;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.method !== undefined) {
    const method = input.method.trim().toLowerCase();
    if (!isValidSlug(method)) {
      throw new LivestockError("INVALID_METHOD", `invalid method: ${input.method}`);
    }
    patch.method = method;
  }
  if (input.sampleSize !== undefined) {
    if (!Number.isInteger(input.sampleSize) || input.sampleSize < 1) {
      throw new LivestockError(
        "INVALID_WEIGHT",
        "say how many head went on the scale — at least one",
      );
    }
    patch.sampleSize = input.sampleSize;
  }

  const scale = input.sampleWeightLb ?? null;
  const girth = input.heartGirthIn ?? null;
  if (scale !== null) {
    patch.sampleWeightLb = scale;
    patch.heartGirthIn = null;
    patch.bodyLengthIn = null;
  } else if (girth !== null) {
    if ((input.bodyLengthIn ?? null) === null) {
      throw new LivestockError(
        "INVALID_WEIGHT",
        "a tape needs both the heart girth and the body length",
      );
    }
    patch.heartGirthIn = girth;
    patch.bodyLengthIn = input.bodyLengthIn;
    patch.sampleWeightLb = null;
    // A tape reads one animal, so a sample size carried over from a crate would
    // divide the estimate by ten.
    patch.sampleSize = 1;
  } else if (
    input.sampleWeightLb === null ||
    input.heartGirthIn === null
  ) {
    // Explicitly clearing the only reading there was. The CHECK would refuse it
    // with a constraint name; this refuses it with a sentence.
    throw new LivestockError(
      "INVALID_WEIGHT",
      "record what the scale said, or the girth and length off the tape",
    );
  }

  const rows = await tx
    .update(schema.livestockWeights)
    .set(patch)
    .where(
      and(
        eq(schema.livestockWeights.tenantId, ctx.tenantId),
        eq(schema.livestockWeights.id, id),
      ),
    )
    .returning();
  return rows[0];
}

/**
 * Remove a weighing entered by mistake — a duplicate, or one recorded against
 * the wrong pen.
 *
 * Deliberately a DELETE and not a void flag. A voided weighing is a row every
 * fold in this pack would have to remember to exclude, and the thing it would
 * preserve — that somebody once typed a wrong number — is what the audit log is
 * for. Same call `land` makes for a stay entered by mistake.
 */
export async function deleteWeight(
  tx: Tx,
  ctx: LivestockCtx,
  id: string,
): Promise<LivestockWeight> {
  requireWrite(ctx, "member");
  const deleted = await tx
    .delete(schema.livestockWeights)
    .where(
      and(
        eq(schema.livestockWeights.tenantId, ctx.tenantId),
        eq(schema.livestockWeights.id, id),
      ),
    )
    .returning();
  if (deleted.length === 0) {
    throw new LivestockError("NOT_FOUND", `weighing ${id} not found`);
  }
  return deleted[0];
}

/** One lot's weighings, oldest first — the history on its detail page. */
export async function listWeightsForLot(
  tx: Tx,
  tenantId: string,
  livestockLotId: string,
): Promise<LivestockWeight[]> {
  return tx.query.livestockWeights.findMany({
    where: and(
      eq(schema.livestockWeights.tenantId, tenantId),
      eq(schema.livestockWeights.livestockLotId, livestockLotId),
    ),
    orderBy: (w, { asc: byAsc }) => [byAsc(w.weighedOn), byAsc(w.createdAt)],
  });
}

/** Every weighing across a set of lots, keyed by lot. One query for a report. */
export async function weightsByLot(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<Map<string, LivestockWeight[]>> {
  const out = new Map<string, LivestockWeight[]>();
  if (lotIds.length === 0) return out;
  const rows = await tx.query.livestockWeights.findMany({
    where: and(
      eq(schema.livestockWeights.tenantId, tenantId),
      inArray(schema.livestockWeights.livestockLotId, lotIds),
    ),
    orderBy: (w, { asc: byAsc }) => [byAsc(w.weighedOn), byAsc(w.createdAt)],
  });
  for (const row of rows) {
    const list = out.get(row.livestockLotId);
    if (list) list.push(row);
    else out.set(row.livestockLotId, [row]);
  }
  return out;
}

/**
 * Turn stored observations into weigh-ins the pure layer can fold.
 *
 * The two things it adds are the two things a row cannot know on its own: the
 * average per head (which needs the profile's tape divisor for that species) and
 * whether the weighing sat in the shadow of a haul (which needs `land`).
 */
export function toWeighIns(
  weights: LivestockWeight[],
  options: { tapeDivisor: number | null; lastHauledOn: string | null },
): WeighIn[] {
  return weights.map((w) => ({
    id: w.id,
    weighedOn: w.weighedOn,
    method: w.method,
    averageLb: averageWeightLb(
      {
        id: w.id,
        weighedOn: w.weighedOn,
        method: w.method,
        sampleSize: w.sampleSize,
        sampleWeightLb: w.sampleWeightLb,
        heartGirthIn: w.heartGirthIn,
        bodyLengthIn: w.bodyLengthIn,
      },
      options.tapeDivisor,
    ),
    shrinkAffected: isShrinkAffected(w.weighedOn, options.lastHauledOn),
  }));
}

// --------------------------------------------------------------- feeders ---

/**
 * How many draws travel into one report before it stops reading them.
 *
 * A season of daily draws across a handful of bins is a few hundred rows; a
 * report is not the archive. Stated rather than silent — the screen says how
 * many it left out, for the same reason the advisor's digest does.
 */
export const FEED_DRAW_CAP = 500;

/**
 * Item kinds that are issued to a pen and are NOT feed.
 *
 * **A card reading "Fed" must not quietly include the penicillin.** Slice 3 puts
 * medicine through the same door feed goes through — `issued_to_lot_id`, so a
 * sick pen carries its own expense — and every figure in the feed report would
 * otherwise absorb it silently: the cost per head, the pounds fed, and worst,
 * the feed conversion ratio.
 *
 * An EXCLUSION rather than a whitelist of `feed`, deliberately. **Waste streams
 * are real feed** and are recorded under whatever kind they were bought as —
 * spent grain, garden culls, expired bakery — so listing what counts would drop
 * the half of this farm's inputs the design is most insistent about.
 */
const NOT_FEED_KINDS = new Set(["medicine", "livestock", "supply"]);

/**
 * "Everything ever recorded", as a date.
 *
 * A report over a whole batch's life needs a lower bound and there is no honest
 * one — so this is a floor that predates any farm record rather than a guess at
 * when the tenant started. The day-by-day walk never actually iterates from here:
 * `feedReport` clamps each feeder's window to its first membership, because days
 * before any lot was on a feeder contribute nothing to a head-day basis.
 */
export const LEDGER_EPOCH = "1900-01-01";

export async function listFeedGroups(
  tx: Tx,
  tenantId: string,
  filter: { status?: string } = {},
): Promise<LivestockFeedGroup[]> {
  const where = [eq(schema.livestockFeedGroups.tenantId, tenantId)];
  if (filter.status) {
    where.push(eq(schema.livestockFeedGroups.status, filter.status));
  }
  return tx.query.livestockFeedGroups.findMany({
    where: and(...where),
    orderBy: (g, { asc: byAsc }) => [byAsc(g.name)],
  });
}

/**
 * Create a shared feeder.
 *
 * `owner`, because deciding that fifteen pens share one cost pot is a decision
 * about how this farm's money is attributed, not a chore in the yard. It is also
 * rare — a bin is created once and fed from for years.
 */
export async function createFeedGroup(
  tx: Tx,
  ctx: LivestockCtx,
  input: { name: string; notes?: string },
): Promise<LivestockFeedGroup> {
  requireWrite(ctx, "owner");
  const name = input.name.trim();
  if (!name) {
    throw new LivestockError("FEED_GROUP_INVALID", "give the feeder a name");
  }
  const rows = await tx
    .insert(schema.livestockFeedGroups)
    .values({
      tenantId: ctx.tenantId,
      name,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/** Close a feeder. NOT a delete — last season's allocation still has to report. */
export async function closeFeedGroup(
  tx: Tx,
  ctx: LivestockCtx,
  id: string,
): Promise<LivestockFeedGroup> {
  requireWrite(ctx, "owner");
  const rows = await tx
    .update(schema.livestockFeedGroups)
    .set({ status: "closed", updatedAt: new Date() })
    .where(
      and(
        eq(schema.livestockFeedGroups.tenantId, ctx.tenantId),
        eq(schema.livestockFeedGroups.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LivestockError("NOT_FOUND", `feed group ${id} not found`);
  }
  return rows[0];
}

/** Every membership, current and ended, keyed by feed group. */
export async function feedGroupMembers(
  tx: Tx,
  tenantId: string,
  feedGroupIds?: string[],
): Promise<Map<string, LivestockFeedGroupMember[]>> {
  const where = [eq(schema.livestockFeedGroupMembers.tenantId, tenantId)];
  if (feedGroupIds) {
    if (feedGroupIds.length === 0) return new Map();
    where.push(
      inArray(schema.livestockFeedGroupMembers.feedGroupId, feedGroupIds),
    );
  }
  const rows = await tx.query.livestockFeedGroupMembers.findMany({
    where: and(...where),
    orderBy: (m, { asc: byAsc }) => [byAsc(m.startedOn)],
  });
  const out = new Map<string, LivestockFeedGroupMember[]>();
  for (const row of rows) {
    const list = out.get(row.feedGroupId);
    if (list) list.push(row);
    else out.set(row.feedGroupId, [row]);
  }
  return out;
}

/**
 * Put a lot onto a feeder from a date.
 *
 * `member`, and deliberately the opposite level from creating the feeder. This
 * records a physical fact — these birds now eat from that bin — done by whoever
 * moved them, exactly as `moveLotToZone` records which paddock they walked onto.
 * Both change how cost is attributed downstream; neither is a decision taken at
 * the moment it is recorded.
 *
 * **Re-adding a lot that is already on the feeder is refused rather than
 * silently doubling it.** Two open memberships would count the same head twice
 * in the head-day basis and hand that pen twice its share of the bill.
 */
export async function addLotToFeedGroup(
  tx: Tx,
  ctx: LivestockCtx,
  input: { feedGroupId: string; livestockLotId: string; startedOn: string },
): Promise<LivestockFeedGroupMember> {
  requireWrite(ctx, "member");
  const group = await tx.query.livestockFeedGroups.findFirst({
    where: and(
      eq(schema.livestockFeedGroups.tenantId, ctx.tenantId),
      eq(schema.livestockFeedGroups.id, input.feedGroupId),
    ),
  });
  if (!group) {
    throw new LivestockError("NOT_FOUND", "that feeder does not exist");
  }
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", "that lot does not exist");
  }
  const open = await tx.query.livestockFeedGroupMembers.findFirst({
    where: and(
      eq(schema.livestockFeedGroupMembers.tenantId, ctx.tenantId),
      eq(schema.livestockFeedGroupMembers.feedGroupId, input.feedGroupId),
      eq(schema.livestockFeedGroupMembers.livestockLotId, input.livestockLotId),
      isNull(schema.livestockFeedGroupMembers.endedOn),
    ),
  });
  if (open) {
    throw new LivestockError(
      "FEED_GROUP_INVALID",
      "that lot is already on this feeder",
    );
  }

  const rows = await tx
    .insert(schema.livestockFeedGroupMembers)
    .values({
      tenantId: ctx.tenantId,
      feedGroupId: input.feedGroupId,
      livestockLotId: input.livestockLotId,
      startedOn: input.startedOn,
    })
    .returning();
  return rows[0];
}

/**
 * Take a lot off a feeder, on an INCLUSIVE last day.
 *
 * The same bound `land`'s occupancy uses, and it has to be: the two are read
 * together the moment somebody asks what a pen cost while it stood on that
 * paddock, and a half-open range in one of them would be off by a day forever.
 */
export async function endFeedGroupMembership(
  tx: Tx,
  ctx: LivestockCtx,
  input: { memberId: string; endedOn: string },
): Promise<LivestockFeedGroupMember> {
  requireWrite(ctx, "member");
  const existing = await tx.query.livestockFeedGroupMembers.findFirst({
    where: and(
      eq(schema.livestockFeedGroupMembers.tenantId, ctx.tenantId),
      eq(schema.livestockFeedGroupMembers.id, input.memberId),
    ),
  });
  if (!existing) {
    throw new LivestockError("NOT_FOUND", "that membership does not exist");
  }
  if (input.endedOn < existing.startedOn) {
    throw new LivestockError(
      "FEED_GROUP_INVALID",
      `they went on the feeder on ${existing.startedOn}, so they cannot come off before that`,
    );
  }
  const rows = await tx
    .update(schema.livestockFeedGroupMembers)
    .set({ endedOn: input.endedOn, updatedAt: new Date() })
    .where(
      and(
        eq(schema.livestockFeedGroupMembers.tenantId, ctx.tenantId),
        eq(schema.livestockFeedGroupMembers.id, input.memberId),
      ),
    )
    .returning();
  return rows[0];
}

/**
 * Draw feed for a shared feeder — the OTHER half of the design's "both paths
 * must exist".
 *
 * **IT IS AN ORDINARY ISSUE, and that is the whole design.** The quantity leaves
 * stock through `inventory.issueStock` and the cost is stamped at the average as
 * it stands right now, exactly as it is for a bag handed to a named pen. The
 * only difference is who it was for: a direct issue names the lot, and this
 * names a feeder, because at 10x nobody knows which bird ate which pound.
 *
 * So there is no second ledger and no second cost. This writes one association
 * row saying that movement was drawn for this bin, and the allocation happens at
 * read time in `core/feed.ts` where it can be re-run, re-explained, and never
 * disagree with the delivery it came from.
 *
 * `member`: opening a bin is a chore.
 */
export async function recordFeedDraw(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    feedGroupId: string;
    itemId: string;
    lotId?: string | null;
    quantity: number;
    occurredOn: string;
    locationAssetId?: string | null;
    notes?: string;
  },
): Promise<{ draw: LivestockFeedDraw; costCents: number | null }> {
  requireWrite(ctx, "member");
  const group = await tx.query.livestockFeedGroups.findFirst({
    where: and(
      eq(schema.livestockFeedGroups.tenantId, ctx.tenantId),
      eq(schema.livestockFeedGroups.id, input.feedGroupId),
    ),
  });
  if (!group) {
    throw new LivestockError("NOT_FOUND", "that feeder does not exist");
  }

  const movement = await issueStock(tx, asInventory(ctx), {
    itemId: input.itemId,
    lotId: input.lotId ?? null,
    quantity: input.quantity,
    // Null on purpose: NOBODY IS NAMED. That is what makes this an allocated
    // cost rather than a measured one, and it is the fact the report reads.
    issuedToLotId: null,
    occurredOn: input.occurredOn,
    locationAssetId: input.locationAssetId ?? null,
    extensionSlug: "livestock",
    notes: input.notes,
  });

  const rows = await tx
    .insert(schema.livestockFeedDraws)
    .values({
      tenantId: ctx.tenantId,
      feedGroupId: input.feedGroupId,
      inventoryMovementId: movement.id,
    })
    .returning();

  return { draw: rows[0], costCents: movement.costCents };
}

/** The draws recorded against a set of feeders, keyed by feeder. */
export async function feedDrawsByGroup(
  tx: Tx,
  tenantId: string,
  feedGroupIds: string[],
  limit = FEED_DRAW_CAP,
): Promise<Map<string, LivestockFeedDraw[]>> {
  const out = new Map<string, LivestockFeedDraw[]>();
  if (feedGroupIds.length === 0) return out;
  const rows = await tx.query.livestockFeedDraws.findMany({
    where: and(
      eq(schema.livestockFeedDraws.tenantId, tenantId),
      inArray(schema.livestockFeedDraws.feedGroupId, feedGroupIds),
    ),
    orderBy: (d, { desc: byDesc }) => [byDesc(d.createdAt)],
    limit,
  });
  for (const row of rows) {
    const list = out.get(row.feedGroupId);
    if (list) list.push(row);
    else out.set(row.feedGroupId, [row]);
  }
  return out;
}

// ------------------------------------------------------------ feed report ---

export interface FeedGroupReport {
  group: LivestockFeedGroup;
  /** Draw cost inside the window, in cents. */
  drawnCents: number;
  drawnQuantities: FeedQuantity[];
  drawCount: number;
  /** Draws that carried no price — waste streams, or an invoice not yet in. */
  unpricedDraws: number;
  /**
   * Cost that could not be allocated because no lot was on the feeder with head
   * standing on any day of the window. **Reported, never dropped** — the farm
   * paid for it.
   */
  unallocatedCents: number;
  members: {
    livestockLotId: string;
    code: string;
    headDays: number;
    daysOnFeed: number;
    shareCents: number;
  }[];
}

/**
 * What weighing adds to a lot's feed row — and what it still refuses.
 *
 * `conversion` is the number the broiler enterprise is judged on and it is null
 * far more often than not. `conversionBlockedBy` is why, in words a screen can
 * print: **a refusal with no reason is indistinguishable from a bug**, and this
 * one will be refused on nearly every lot for a farm's whole first season.
 */
export interface LotWeightSummary {
  /** The most recent usable weighing in the period. */
  latest: WeighIn | null;
  /** Latest average per head times the head standing. What is walking about. */
  liveweightLb: number | null;
  gain: GainResult | null;
  conversion: FeedConversion | null;
  conversionBlockedBy: string | null;
  /**
   * Feed per pound of LIVEWEIGHT, which is NOT conversion — it counts the weight
   * the animal arrived with as though the feed had made it. The only figure a
   * first batch with a single weighing can honestly produce.
   */
  feedPerLiveweight: number | null;
  weighInCount: number;
  /** Weighings set aside because they sat in the shadow of a haul. */
  shrinkAffectedCount: number;
}

export type FeedReportLot = FeedLotRow & { weight: LotWeightSummary };

export interface FeedReport {
  from: string;
  to: string;
  lots: FeedReportLot[];
  groups: FeedGroupReport[];
  /** Draws beyond `FEED_DRAW_CAP`, said out loud rather than truncated silently. */
  drawsOmitted: number;
}

/**
 * Feed and what it cost, per lot — measured and allocated, kept apart.
 *
 * **THE NUMBER THE BROILER ENTERPRISE IS JUDGED ON**, and the reason the design
 * puts feed at slice 2: it is the largest cash cost, and until this exists the
 * app can say a pen held 210 birds and not what feeding them came to.
 *
 * Assembled from three sources and no fourth: this pack's feeders and their
 * membership dates, `inventory`'s ledger for every quantity and every cent, and
 * the head balance that is itself a fold of that same ledger. Nothing is stored,
 * so re-running it after a correction gives the corrected answer.
 */
export async function feedReport(
  tx: Tx,
  tenantId: string,
  options: {
    from: string;
    to: string;
    /**
     * The installed profile's `livestock` config. Supplies the tape divisors, so
     * a girth and a length become pounds — and without it a tape reading stays a
     * tape reading rather than becoming a guess. See `tapeDivisorFrom`.
     */
    packConfig?: unknown;
  },
): Promise<FeedReport> {
  const { from, to } = options;
  const lots = await listLivestockLots(tx, tenantId);
  const inventoryLotIds = lots.map((l) => l.inventoryLotId);
  const lotIds = lots.map((l) => l.id);

  const [inventoryLots, movements, measured, fedDated, groups, weights, hauls] =
    await Promise.all([
      listInventoryLots(tx, tenantId),
      // Every dated head movement, uncapped for these lots: the head-day basis
      // is a running balance and a truncated ledger would silently start it in
      // the middle.
      datedMovementsForLots(tx, tenantId, inventoryLotIds, null),
      consumedByLotAndItem(tx, tenantId, inventoryLotIds, { from, to }),
      // Undated totals answer the report; feed conversion needs the dates,
      // because its window is each lot's own gain window.
      consumedDatedByLots(tx, tenantId, inventoryLotIds),
      listFeedGroups(tx, tenantId),
      weightsByLot(tx, tenantId, lotIds),
      // WHEN THEY WERE LAST HAULED, from `land`, through land's own query. A
      // weighing taken days after a trailer is shrink, not a loss.
      lastHauledOn(tx, tenantId, "livestock", inventoryLotIds),
    ]);

  const groupIds = groups.map((g) => g.id);
  const [membersByGroup, drawsByGroup] = await Promise.all([
    feedGroupMembers(tx, tenantId, groupIds),
    feedDrawsByGroup(tx, tenantId, groupIds),
  ]);

  const drawIds = [...drawsByGroup.values()].flat().map((d) => d.inventoryMovementId);
  const drawMovements = await movementsByIds(tx, tenantId, drawIds);
  const movementById = new Map(drawMovements.map((m) => [m.id, m]));

  const byInventoryLot = new Map(inventoryLots.map((l) => [l.id, l]));
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const headMovements = new Map(
    lots.map((lot) => [
      lot.id,
      (dated(movements, lot.inventoryLotId) ?? []).map((m) => ({
        occurredOn: m.occurredOn,
        quantity: m.quantity,
      })),
    ]),
  );

  /**
   * The allocation fold, over any window.
   *
   * **A FUNCTION RATHER THAN A LOOP, because feed conversion needs it run
   * twice.** The report's window answers "what did this pen cost"; a lot's FCR
   * needs the feed drawn between ITS OWN first and last weighing, which is a
   * different window for every lot. Re-running the fold is exact — it is the
   * same arithmetic over fewer draws — where pro-rating the annual figure by
   * elapsed days would be a guess dressed as a number.
   *
   * No extra queries: the draws, the memberships and the head ledger are all
   * already in hand.
   */
  function foldGroups(
    windowFrom: string,
    windowTo: string,
  ): {
    cents: Map<string, number>;
    quantities: Map<string, FeedQuantity[]>;
    reports: FeedGroupReport[];
  } {
    const cents = new Map<string, number>();
    const quantities = new Map<string, FeedQuantity[]>();
    const reports: FeedGroupReport[] = [];

    for (const group of groups) {
      const spansByLot = new Map<string, MembershipSpan[]>();
      for (const member of membersByGroup.get(group.id) ?? []) {
        const list = spansByLot.get(member.livestockLotId);
        const span = { startedOn: member.startedOn, endedOn: member.endedOn };
        if (list) list.push(span);
        else spansByLot.set(member.livestockLotId, [span]);
      }

      /**
       * Start the day-by-day walk at the first membership rather than at the
       * window's start. Days before any lot was on this feeder contribute
       * nothing to the basis by definition, and an "everything" window that
       * began at the epoch would otherwise iterate a century of empty days per
       * feeder.
       */
      const allSpans = [...spansByLot.values()].flat();
      const earliest = earliestSpanStart(allSpans);
      const groupFrom = earliest && earliest > windowFrom ? earliest : windowFrom;

      // The basis: head × days, per member lot, over this window. Both halves
      // come from records already being kept — the dates from the membership,
      // the head from the ledger.
      const shares = [...spansByLot.entries()].map(([lotId, spans]) => ({
        key: lotId,
        basis: headDays(headMovements.get(lotId) ?? [], spans, groupFrom, windowTo),
        days: daysOnFeed(spans, groupFrom, windowTo),
      }));

      const draws = (drawsByGroup.get(group.id) ?? [])
        .map((d) => movementById.get(d.inventoryMovementId))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .filter((m) => m.occurredOn >= windowFrom && m.occurredOn <= windowTo);

      const drawnCents = draws.reduce((sum, m) => sum + (m.costCents ?? 0), 0);
      const unpricedDraws = draws.filter((m) => m.costCents === null).length;
      const drawnQuantities = mergeQuantities(
        draws.map((m) => ({ unit: m.unit, quantity: Math.abs(m.quantity) })),
      );

      const centsShare = allocateCents(drawnCents, shares);
      // Quantity is allocated per UNIT, because pounds of grower and gallons of
      // milk are not addable and a single split would have to pick one of them.
      const quantityShares = new Map<string, FeedQuantity[]>();
      for (const part of drawnQuantities) {
        const split = allocateQuantity(part.quantity, shares);
        for (const [lotId, quantity] of split) {
          const list = quantityShares.get(lotId);
          if (list) list.push({ unit: part.unit, quantity });
          else quantityShares.set(lotId, [{ unit: part.unit, quantity }]);
        }
      }

      let allocated = 0;
      for (const [lotId, share] of centsShare) {
        allocated += share;
        cents.set(lotId, (cents.get(lotId) ?? 0) + share);
      }
      for (const [lotId, parts] of quantityShares) {
        quantities.set(lotId, [...(quantities.get(lotId) ?? []), ...parts]);
      }

      reports.push({
        group,
        drawnCents,
        drawnQuantities,
        drawCount: draws.length,
        unpricedDraws,
        unallocatedCents: drawnCents - allocated,
        members: shares.map((share) => ({
          livestockLotId: share.key,
          code:
            byInventoryLot.get(lotById.get(share.key)?.inventoryLotId ?? "")?.code ??
            "—",
          headDays: share.basis,
          daysOnFeed: share.days,
          shareCents: centsShare.get(share.key) ?? 0,
        })),
      });
    }
    return { cents, quantities, reports };
  }

  const {
    cents: allocatedCents,
    quantities: allocatedQuantities,
    reports: groupReports,
  } = foldGroups(from, to);

  const rows = feedReportRows(
    lots.map((lot) => {
      const summary = summariseHead(
        (dated(movements, lot.inventoryLotId) ?? []).map((m) => ({
          movementKind: m.movementKind,
          quantity: m.quantity,
        })),
      );
      const consumed = measured.get(lot.inventoryLotId) ?? [];
      // What was issued to this pen that is actually FEED. The medicine went
      // through the same door and is reported beside the treatment that used
      // it, not inside the feed figures.
      const fed = consumed.filter((c) => !NOT_FEED_KINDS.has(c.itemKind));
      const inventoryLot = byInventoryLot.get(lot.inventoryLotId);
      return {
        lotId: lot.id,
        code: inventoryLot?.code ?? "—",
        species: lot.species,
        ageDays: ageInDays(lot.bornOn, to),
        head: summary.balance,
        intake: summary.intake,
        // `opened_on` is when the batch started; `born_on` is the fallback for a
        // lot created before anything was placed into it.
        startedOn: inventoryLot?.openedOn ?? lot.bornOn ?? null,
        measuredCents: fed.reduce((sum, f) => sum + f.costCents, 0),
        measuredQuantities: mergeQuantities(
          fed.map((f) => ({ unit: f.unit, quantity: f.quantity })),
        ),
        allocatedCents: allocatedCents.get(lot.id) ?? 0,
        allocatedQuantities: mergeQuantities(allocatedQuantities.get(lot.id) ?? []),
        unpricedMovements: fed.reduce((sum, f) => sum + f.unpricedMovements, 0),
      };
    }),
  );

  /**
   * The weight half, and the conversion it finally makes possible.
   *
   * **THE FCR WINDOW IS THE GAIN WINDOW, NOT THE REPORT'S.** Feed conversion is
   * feed per pound of gain, and gain is only known between this lot's own first
   * and last usable weighing. Feed fed before anybody put a bird on a scale
   * produced gain nobody measured, so counting it would inflate the one number
   * the enterprise is judged on — badly, for exactly the farm that starts
   * weighing halfway through its first batch.
   */
  const lotsWithWeight = rows.map((row) => {
    const lot = lotById.get(row.lotId);
    const weighIns = toWeighIns(weights.get(row.lotId) ?? [], {
      tapeDivisor: tapeDivisorFrom(options.packConfig, lot?.species ?? ""),
      lastHauledOn: hauls.get(lot?.inventoryLotId ?? "") ?? null,
    });
    // Only weighings inside the report's period. Asking for the last 30 days
    // and being answered with a gain measured in April is not the question.
    const inWindow = weighIns.filter(
      (w) => w.weighedOn >= from && w.weighedOn <= to,
    );
    const latest = latestWeighIn(inWindow);
    const gain = gainBetween(inWindow);
    const headMoves = headMovements.get(row.lotId) ?? [];

    const liveweightLb =
      latest && latest.averageLb !== null && row.head > 0
        ? Math.round(latest.averageLb * row.head * 10) / 10
        : null;

    let conversion: FeedConversion | null = null;
    let conversionBlockedBy: string | null = null;
    if (!gain) {
      const usable = inWindow.filter((w) => w.averageLb !== null);
      conversionBlockedBy =
        usable.length === 0
          ? "Nothing weighed in this period."
          : usable.length === 1
            ? "One weighing. Feed per pound of GAIN needs two — weigh them again and this fills itself in."
            : inWindow.some((w) => w.shrinkAffected)
              ? "The weighings left are too close together, or too close to a haul, to measure gain from."
              : "Two weighings on the same day cannot show a gain.";
    } else {
      // Feed drawn and issued between the two weighings, and nothing outside.
      const gainFrom = gain.from.weighedOn;
      const gainTo = gain.to.weighedOn;
      const measuredLb = toPoundsOfFeed(
        (fedDated.get(lot?.inventoryLotId ?? "") ?? []).filter(
          (m) =>
            !NOT_FEED_KINDS.has(m.itemKind) &&
            m.occurredOn >= gainFrom &&
            m.occurredOn <= gainTo,
        ),
      );
      const allocatedLb = toPoundsOfFeed(
        foldGroups(gainFrom, gainTo).quantities.get(row.lotId) ?? [],
      );

      // Head standing at the END of the gain window. The birds that died in the
      // middle ate feed and produced no gain, which correctly makes the ratio
      // worse — that is what "as-hatched" conversion means and why mortality
      // shows up in it.
      const headAtEnd = headOnDays(headMoves, gainTo, gainTo)[0] ?? 0;
      const totalGainLb = gain.gainLb * headAtEnd;
      conversion = feedConversion(
        measuredLb + allocatedLb,
        totalGainLb,
        combinedConfidence(row.provenance, gain.measured),
      );
      if (!conversion) {
        conversionBlockedBy =
          totalGainLb <= 0
            ? "They weighed less at the end than at the start, so there is no gain to divide into."
            : "No feed recorded in pounds between the two weighings.";
      }
    }

    // The first-batch answer, and NOT a conversion — see `feedPerLiveweightLb`.
    const feedLbAll = toPoundsOfFeed(row.quantities);

    return {
      ...row,
      weight: {
        latest,
        liveweightLb,
        gain,
        conversion,
        conversionBlockedBy,
        feedPerLiveweight:
          liveweightLb === null
            ? null
            : feedPerLiveweightLb(feedLbAll, liveweightLb),
        weighInCount: weighIns.length,
        shrinkAffectedCount: weighIns.filter((w) => w.shrinkAffected).length,
      },
    };
  });

  const drawTotal = [...drawsByGroup.values()].reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return {
    from,
    to,
    lots: lotsWithWeight,
    groups: groupReports,
    drawsOmitted: drawTotal >= FEED_DRAW_CAP ? drawTotal - drawIds.length : 0,
  };
}

/**
 * Feed quantities that are a MASS, in pounds. Anything else is skipped.
 *
 * **Feed conversion is pounds of feed per pound of gain, so both sides have to
 * be a weight.** Surplus milk is real feed and is stocked in gallons, and there
 * is no factor between gallons and pounds that does not depend on what is in the
 * bucket — `inventory`'s own rule about conversions across dimensions. So a farm
 * feeding mostly milk gets no conversion figure and is told why, which is better
 * than a ratio with a density somebody guessed baked into it.
 *
 * Tons and kilograms DO convert, because those are the same dimension and the
 * factor is exact.
 */
function toPoundsOfFeed(parts: { unit: string; quantity: number }[]): number {
  let pounds = 0;
  for (const part of parts) {
    const unit = getUnit(part.unit);
    if (!unit || unit.dimension !== "mass") continue;
    pounds += convert(part.quantity, part.unit, "lb");
  }
  return pounds;
}

/** Small helper: the dated rows for one lot, or undefined. */
function dated(
  map: Map<string, { occurredOn: string; movementKind: string; quantity: number }[]>,
  lotId: string,
) {
  return map.get(lotId);
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
  options: { today: string; species?: string[]; packConfig?: unknown },
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
    withdrawals,
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
    // The one fact in the digest with a legal edge. See `AdvisorLot.withdrawal`.
    withdrawalByLot(
      tx,
      tenantId,
      lots.map((l) => l.id),
      today,
    ),
  ]);

  /**
   * Feed, from slice 2, and it is the same read the feed report makes.
   *
   * Deliberately not a cheaper approximation: an advisor asked "is this batch
   * costing more than the last one" must see the figure the screen shows, or the
   * two will disagree in front of the person who asked. The window is
   * everything, because a batch is judged over its life.
   */
  const feed = await feedReport(tx, tenantId, {
    from: LEDGER_EPOCH,
    to: today,
    packConfig: options.packConfig,
  });
  const feedByLot = new Map(feed.lots.map((row) => [row.lotId, row]));

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
      feed: (() => {
        const row = feedByLot.get(lot.id);
        if (!row || row.totalCents === 0) return null;
        return {
          cents: row.totalCents,
          centsPerHead: row.centsPerHead,
          provenance: row.provenance,
        };
      })(),
      withdrawal: (() => {
        const w = withdrawals.get(lot.id);
        if (!w || w.treatmentCount === 0) return null;
        const binding = w.meat.binding ?? w.milk.binding;
        return {
          meatState: w.meat.state,
          meatClearsOn: w.meat.clearsOn,
          milkState: w.milk.state,
          milkClearsOn: w.milk.clearsOn,
          product: binding?.product ?? null,
          source: binding?.withdrawalSource ?? null,
        };
      })(),
      weight: (() => {
        const row = feedByLot.get(lot.id);
        if (!row || row.weight.weighInCount === 0) return null;
        return {
          latestLb: row.weight.latest?.averageLb ?? null,
          weighedOn: row.weight.latest?.weighedOn ?? null,
          method: row.weight.latest?.method ?? null,
          adgLb: row.weight.gain?.adgLb ?? null,
          gainFrom: row.weight.gain?.from.weighedOn ?? null,
          gainTo: row.weight.gain?.to.weighedOn ?? null,
          gainDays: row.weight.gain?.days ?? null,
          conversion: row.weight.conversion?.ratio ?? null,
          conversionConfidence: row.weight.conversion?.confidence ?? null,
          blockedBy: row.weight.conversionBlockedBy,
        };
      })(),
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
