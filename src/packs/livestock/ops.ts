import "server-only";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  InventoryMovement,
  LivestockDailyLog,
  LivestockFeedDraw,
  LivestockFeedGroup,
  LivestockFeedGroupMember,
  LivestockGroup,
  LivestockGroupMember,
  LivestockCapitalTransfer,
  LivestockIdentifier,
  LivestockLot,
  LivestockTreatment,
  LivestockWeight,
} from "@/db/schema";
import {
  carriedCostByLot,
  consumedByLotAndItem,
  consumedDatedByLots,
  createItem,
  createLot as createInventoryLot,
  getLot as getInventoryLot,
  datedMovementsForLots,
  issueStock,
  listItems,
  listLots as listInventoryLots,
  lotsByIds,
  movementKindsForLots,
  movementsByIds,
  onHandByItem,
  recordMovement,
  splitLot as splitInventoryLot,
  adjustLotCost,
  type InventoryCtx,
} from "@/packs/inventory/ops";
import { postCapitalisation } from "@/packs/inventory/ledger-ops";
import {
  createAsset,
  disposeAsset,
  getAsset,
  type AssetCtx,
} from "@/packs/assets/ops";
import { postedToDateCents } from "@/packs/assets/depreciation-ops";
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
import { carriedValue } from "@/packs/inventory/core/valuation";
import { convert, getUnit } from "@/packs/inventory/core/units";
import { breedLabel, tapeDivisorFrom } from "./vocabulary";
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
  MAX_GENERATIONS,
  formatComposition,
  isAncestor,
  resolveComposition,
  type BreedPart,
  type Composition,
  type PedigreeIndex,
  type PedigreeNode,
} from "./core/pedigree";
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
      | "GROUP_INVALID"
      | "CAPITAL_INVALID"
      | "INVALID_METHOD"
      | "INVALID_WEIGHT"
      | "INVALID_TREATMENT"
      | "INVALID_BREED"
      | "INVALID_PARENT",
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
/**
 * `assets`, for slice 4f only. **NOT in this pack's `requires`**, deliberately:
 * a farm that never moves an animal to the breeding herd needs no asset
 * register, and forcing one on every livestock tenant to serve one slice is the
 * dependency this pack has otherwise been careful about. The ACTION checks the
 * module is enabled and says so when it is not.
 */
const asAssets = (ctx: LivestockCtx): AssetCtx => ctx;
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

/** A uuid nothing can be, for an `inArray` that must match no rows. */
const NO_UUID = "00000000-0000-0000-0000-000000000000";

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
  /**
   * ONE breed, meaning the whole animal — written to `livestock_breed_parts`
   * as a single part. A cross is stated afterwards on the animal's own page.
   */
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
      bornOn: input.bornOn ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();

  // ONE BREED ON CREATE IS THE WHOLE ANIMAL, and that is the common case: a
  // lot of Cornish Cross, a purebred cow. Anything crossed is stated on the
  // animal's own page afterwards, where there is room to say ½ and ¼ — a
  // fractions editor on the form that starts a pen of broilers would be four
  // fields nobody needs to see.
  const breed = input.breed?.trim();
  if (breed) {
    await setBreedParts(tx, ctx, rows[0].id, [{ breed, parts: 1 }]);
  }

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
  // NO `breed` — the column is superseded and composition is `setBreedParts`.
  input: Partial<Pick<LivestockLotInput, "species" | "sex" | "bornOn" | "notes">>,
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
 * The operation the pilot's broilers need — a lot of chicks arrives as one
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
      // The biology travels with the animals. Splitting a lot of Cornish
      // Cross does not produce a lot of something else.
      species: parent.species,
      sex: parent.sex,
      bornOn: parent.bornOn,
      // **THE PARENTS TRAVEL, THE SPLIT IS NOT ONE OF THEM.** Half a pen of
      // half-Angus calves is still half Angus, so the composition copies — but
      // the lot they were split OUT of is not their dam, and writing it here
      // would turn every pen division into a generation.
      damLotId: parent.damLotId,
      sireLotId: parent.sireLotId,
    })
    .returning();

  const parts = await breedPartsByLot(tx, ctx.tenantId, [parent.id]);
  const stated = parts.get(parent.id) ?? [];
  if (stated.length > 0) {
    await tx.insert(schema.livestockBreedParts).values(
      stated.map((part) => ({
        tenantId: ctx.tenantId,
        livestockLotId: rows[0].id,
        breed: part.breed,
        parts: part.parts,
      })),
    );
  }

  return { lot: rows[0], inventoryLotId: child.id };
}

// ------------------------------------------------------- capital transfers ---

/**
 * **A BREEDING ANIMAL IS NOT INVENTORY**, and moving between the two sides of
 * the balance sheet is an accounting event rather than a checkbox.
 *
 * The design has said so since 2026-08-13 and named it as the line between a
 * tracking app and an accounting one: a heifer raised for beef is stock; kept
 * for breeding she is a capital asset, depreciable, and treated completely
 * differently when she is sold. Most farm software makes it a flag and quietly
 * gets the books wrong.
 *
 * **HER HEAD STAYS AND ONLY THE MONEY MOVES**, which is the founder's own
 * correction after seeing the alternative built. Taking her head out of the
 * ledger made the accounting automatic — she vanished from stock valuation with
 * no special case — and made the daily work impossible: Treat and Weigh are
 * gated on head, recording her death would have taken the lot to minus one, and
 * shared-feeder allocation is head × days. A breeding cow is the animal a farm
 * touches MOST, and she had become the one it could do least to.
 *
 * "Not inventory" is a claim about the BALANCE SHEET — where her value sits —
 * and reading it as a claim about whether she exists was the mistake.
 *
 * So the mechanism is a marker rather than a movement:
 * `inventory_lots.capitalised_on` stops `valueStock` and `carriedCostByLot`
 * counting a cost that is now on an asset, and **no head event is written at
 * all** — the head ledger records what happened to the ANIMALS, and nothing
 * happened to them. What changed is what the business owns.
 *
 *   - **She can still be treated, weighed, fed, moved and lost**, because she
 *     is still one head of livestock standing in a paddock.
 *   - **She cannot be PROCESSED**, and that is an explicit refusal in
 *     `run-handler.ts` rather than an accident of having no head. Culling a
 *     breeding cow for beef means bringing her back to the market herd first,
 *     which is the reverse posting — the "entirely different treatment on sale"
 *     the design asked for.
 *   - **She disappears from stock valuation**, which is the entire point.
 */

/** The two directions a transfer can go, and the fold's answer. */
export type CapitalState = "market" | "breeding";

/**
 * Is this animal breeding stock today? **A FOLD, never a column.**
 *
 * The latest transfer on or before `on` wins. A boolean on the lot would stop
 * agreeing with the journal the first time somebody corrected a date, and the
 * journal is the half that matters.
 */
export async function capitalStateByLot(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
  on: string,
): Promise<Map<string, CapitalState>> {
  const out = new Map<string, CapitalState>();
  if (lotIds.length === 0) return out;
  const rows = await tx.query.livestockCapitalTransfers.findMany({
    where: and(
      eq(schema.livestockCapitalTransfers.tenantId, tenantId),
      inArray(schema.livestockCapitalTransfers.livestockLotId, lotIds),
      lte(schema.livestockCapitalTransfers.occurredOn, on),
    ),
    orderBy: (t, { asc }) => [asc(t.occurredOn), asc(t.createdAt)],
  });
  // Ascending, so the last write for each lot is the newest — and two transfers
  // on one day are settled by when they were recorded, which is the only
  // information there is.
  for (const row of rows) {
    out.set(
      row.livestockLotId,
      row.direction === "to_breeding" ? "breeding" : "market",
    );
  }
  return out;
}

/** Every transfer for one animal, newest first — the audit trail on her page. */
export async function capitalTransfersForLot(
  tx: Tx,
  tenantId: string,
  livestockLotId: string,
): Promise<LivestockCapitalTransfer[]> {
  return tx.query.livestockCapitalTransfers.findMany({
    where: and(
      eq(schema.livestockCapitalTransfers.tenantId, tenantId),
      eq(schema.livestockCapitalTransfers.livestockLotId, livestockLotId),
    ),
    orderBy: (t, { desc: byDesc }) => [byDesc(t.occurredOn), byDesc(t.createdAt)],
  });
}

export interface ToBreedingInput {
  livestockLotId: string;
  occurredOn: string;
  /** The fixed-asset account her cost lands in. Required where books exist. */
  assetAccountId?: string | null;
  /** What the asset register calls this kind of thing. */
  assetKind?: string;
  /** Book depreciation, if she is to depreciate. All four move together. */
  depreciationMethod?: string;
  usefulLifeMonths?: number | null;
  salvageValueCents?: number | null;
  notes?: string;
}

/**
 * **MOVE AN ANIMAL FROM THE MARKET HERD TO THE BREEDING HERD.** One
 * transaction: the head leaves stock, an asset appears, the money moves.
 *
 * **THE AMOUNT IS HER CARRIED COST, and there is no other honest number.** What
 * she cost to buy plus what has been spent raising her is exactly what the lot
 * is carrying, and `carriedCostByLot` is the same fold the valuation screen
 * uses — so the credit to inventory is the figure that was in stock a moment
 * before, and the two screens cannot disagree.
 *
 * **A COW WITH NO RECORDED COST TRANSFERS AT ZERO, and is allowed to.** A farm
 * that has never costed its animals still owns them, and refusing would be the
 * app insisting on bookkeeping before it will record a fact. The asset is
 * created either way; it simply has nothing to depreciate.
 *
 * `owner`, and unusually for this pack that is not about who is holding the
 * gate: this posts a journal entry, and deciding what the business owns is not
 * a chore.
 */
export async function transferToBreeding(
  tx: Tx,
  ctx: LivestockCtx,
  input: ToBreedingInput,
): Promise<LivestockCapitalTransfer> {
  requireWrite(ctx, "owner");
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId}`);
  }

  const state = await capitalStateByLot(
    tx,
    ctx.tenantId,
    [lot.id],
    input.occurredOn,
  );
  if (state.get(lot.id) === "breeding") {
    throw new LivestockError("CAPITAL_INVALID", "already breeding stock");
  }

  const inventoryLot = await getInventoryLot(
    tx,
    ctx.tenantId,
    lot.inventoryLotId,
  );
  if (!inventoryLot) throw new LivestockError("NOT_FOUND", "lot went missing");

  const movements = await movementKindsForLots(tx, ctx.tenantId, [
    lot.inventoryLotId,
  ]);
  const balance = summariseHead(
    movements.get(lot.inventoryLotId) ?? [],
  ).balance;
  // ONE ANIMAL AT A TIME. A capital asset is a thing, not a quantity — the
  // asset register depreciates one cow, and "half a pen became breeding stock"
  // is a split first. The refusal says so.
  if (balance !== 1) {
    throw new LivestockError(
      "CAPITAL_INVALID",
      balance === 0
        ? "nothing here to transfer"
        : `${balance} head here — record the one animal on its own first`,
    );
  }

  const carried = await carriedCostByLot(
    tx,
    ctx.tenantId,
    [lot.inventoryLotId],
    input.occurredOn,
  );
  // `carriedValue`, NEVER `remainingCents` directly — a lot nobody costed and a
  // lot whose cost has all been released both fold to zero, and only one of
  // those is a number. Null means uncosted, and she transfers at zero.
  const row = carried.get(lot.inventoryLotId);
  const amountCents = Math.max(
    0,
    Math.round((row ? carriedValue(row) : null) ?? 0),
  );

  // **NO HEAD EVENT.** She has not been bought, born, sold or died — the
  // ledger records what happens to animals, and nothing happened to her. The
  // marker is what stops inventory counting a cost that is now on an asset.
  await tx
    .update(schema.inventoryLots)
    .set({ capitalisedOn: input.occurredOn, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inventoryLots.tenantId, ctx.tenantId),
        eq(schema.inventoryLots.id, lot.inventoryLotId),
      ),
    );

  /**
   * **NOTHING TO DEPRECIATE MEANS SHE DOES NOT DEPRECIATE**, whatever the form
   * asked for. `assets_depreciable_is_complete` refuses a method other than
   * `none` without an in-service date, a life AND a cost — so an uncosted cow
   * with straight-line ticked is a constraint violation, which is what driving
   * this on Hilltop Farm produced before the guard existed.
   *
   * Silently dropping the method rather than refusing is the right way round:
   * the transfer is a fact about what the business owns, and a farm that has
   * never costed its animals still owns them. Depreciating nothing over sixty
   * months is not a thing anybody wanted.
   */
  const depreciates = amountCents > 0 && Boolean(input.depreciationMethod) &&
    input.depreciationMethod !== "none";
  const asset = await createAsset(tx, asAssets(ctx), {
    kind: input.assetKind?.trim() || "breeding_stock",
    name: inventoryLot.code,
    acquiredOn: input.occurredOn,
    acquisitionCostCents: amountCents || null,
    assetAccountId: input.assetAccountId ?? null,
    inServiceOn: depreciates ? input.occurredOn : null,
    depreciationMethod: depreciates ? input.depreciationMethod : "none",
    usefulLifeMonths: depreciates ? (input.usefulLifeMonths ?? null) : null,
    salvageValueCents: depreciates ? (input.salvageValueCents ?? null) : null,
    notes: input.notes,
  });

  // The transfer row FIRST, so the entry it produces has something to be
  // evidence of — and so the idempotency key is this event's own id.
  const rows = await tx
    .insert(schema.livestockCapitalTransfers)
    .values({
      tenantId: ctx.tenantId,
      livestockLotId: lot.id,
      direction: "to_breeding",
      occurredOn: input.occurredOn,
      amountCents,
      assetId: asset.id,
      createdByClerkUserId: ctx.userId,
    })
    .returning();

  if (amountCents > 0 && input.assetAccountId) {
    const posted = await postCapitalisation(tx, asInventory(ctx), {
      sourceId: rows[0].id,
      itemId: inventoryLot.itemId,
      lotId: lot.inventoryLotId,
      lotCode: inventoryLot.code,
      costCents: amountCents,
      counterAccountId: input.assetAccountId,
      occurredOn: input.occurredOn,
      direction: "out",
    });
    if (posted) {
      const updated = await tx
        .update(schema.livestockCapitalTransfers)
        .set({ journalEntryId: posted.entryId })
        .where(
          and(
            eq(schema.livestockCapitalTransfers.tenantId, ctx.tenantId),
            eq(schema.livestockCapitalTransfers.id, rows[0].id),
          ),
        )
        .returning();
      return updated[0];
    }
  }
  return rows[0];
}

/**
 * **BRING A BREEDING ANIMAL BACK INTO THE MARKET HERD** — the cull decision,
 * and the reverse posting.
 *
 * **AT NET BOOK VALUE, not at what she originally cost.** Depreciation has been
 * running against her since she was capitalised, and putting her back at cost
 * would re-create value the books have already written off. `postedToDateCents`
 * is the same figure the asset's own page shows.
 *
 * The asset is DISPOSED rather than deleted — an asset register that forgot the
 * cow it depreciated for four years would be missing the evidence for those four
 * years of entries.
 */
export async function returnToMarket(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    livestockLotId: string;
    occurredOn: string;
    notes?: string;
  },
): Promise<LivestockCapitalTransfer> {
  requireWrite(ctx, "owner");
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId}`);
  }
  const state = await capitalStateByLot(
    tx,
    ctx.tenantId,
    [lot.id],
    input.occurredOn,
  );
  if (state.get(lot.id) !== "breeding") {
    throw new LivestockError("CAPITAL_INVALID", "not breeding stock");
  }

  const history = await capitalTransfersForLot(tx, ctx.tenantId, lot.id);
  const outward = history.find((row) => row.direction === "to_breeding");
  const assetId = outward?.assetId ?? null;

  const inventoryLot = await getInventoryLot(
    tx,
    ctx.tenantId,
    lot.inventoryLotId,
  );
  if (!inventoryLot) throw new LivestockError("NOT_FOUND", "lot went missing");

  // Cost less what depreciation has already taken. A cow written down to
  // nothing comes back at nothing, which is what the books say she is worth.
  let amountCents = outward?.amountCents ?? 0;
  let writtenDownCents = 0;
  let assetAccountId: string | null = null;
  if (assetId) {
    const asset = await getAsset(tx, ctx.tenantId, assetId);
    assetAccountId = asset?.assetAccountId ?? null;
    const depreciated = await postedToDateCents(tx, ctx.tenantId, assetId);
    writtenDownCents = Math.min(depreciated, outward?.amountCents ?? 0);
    amountCents = Math.max(0, (asset?.acquisitionCostCents ?? amountCents) - depreciated);
    if (asset && asset.status !== "disposed") {
      // NOT a sale: nothing was received. She moved to the other side of the
      // balance sheet, and the entry below is where the value went — which is
      // why this is `disposeAsset` and not `postDisposal`, the path that books
      // proceeds and a gain.
      await disposeAsset(tx, asAssets(ctx), assetId, input.occurredOn);
    }
  }

  // Clearing the marker restores what the lot was carrying BEFORE she was
  // capitalised — her original cost. The books have depreciated her since, so
  // a correction of exactly that much brings the lot back to net book value
  // and keeps the ledger and the valuation screen agreeing.
  await tx
    .update(schema.inventoryLots)
    .set({ capitalisedOn: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.inventoryLots.tenantId, ctx.tenantId),
        eq(schema.inventoryLots.id, lot.inventoryLotId),
      ),
    );
  if (writtenDownCents > 0) {
    await adjustLotCost(tx, asInventory(ctx), {
      lotId: lot.inventoryLotId,
      amountCents: -writtenDownCents,
      occurredOn: input.occurredOn,
      reason: "capital_return",
      notes:
        input.notes ??
        "Depreciation taken while she was breeding stock",
    });
  }

  const rows = await tx
    .insert(schema.livestockCapitalTransfers)
    .values({
      tenantId: ctx.tenantId,
      livestockLotId: lot.id,
      direction: "to_market",
      occurredOn: input.occurredOn,
      amountCents,
      assetId,
      createdByClerkUserId: ctx.userId,
    })
    .returning();

  if (amountCents > 0 && assetAccountId) {
    const posted = await postCapitalisation(tx, asInventory(ctx), {
      sourceId: rows[0].id,
      itemId: inventoryLot.itemId,
      lotId: lot.inventoryLotId,
      lotCode: inventoryLot.code,
      costCents: amountCents,
      counterAccountId: assetAccountId,
      occurredOn: input.occurredOn,
      direction: "in",
    });
    if (posted) {
      const updated = await tx
        .update(schema.livestockCapitalTransfers)
        .set({ journalEntryId: posted.entryId })
        .where(
          and(
            eq(schema.livestockCapitalTransfers.tenantId, ctx.tenantId),
            eq(schema.livestockCapitalTransfers.id, rows[0].id),
          ),
        )
        .returning();
      return updated[0];
    }
  }
  return rows[0];
}

// ------------------------------------------------------------------ herds ---

/**
 * **A HERD IS A THING SOMEBODY CREATES AND PUTS ANIMALS INTO**, and it holds
 * LOTS rather than animals — which is what lets one hold Bluebell (a lot of one)
 * and a pen of forty-seven unnamed head at the same time.
 *
 * Everything here is a fold or a membership write. **No head event is ever
 * recorded by moving between herds**: a cow changing herds has not been bought,
 * born, sold or died, and putting a movement on the ledger for it would corrupt
 * the one number the whole pack is built to keep honest. That is the difference
 * between this and the split/merge dance it replaces.
 */

export async function createGroup(
  tx: Tx,
  ctx: LivestockCtx,
  input: { name: string; notes?: string },
): Promise<LivestockGroup> {
  requireWrite(ctx, "owner");
  const name = input.name.trim();
  if (!name) throw new LivestockError("GROUP_INVALID", "give the herd a name");
  const rows = await tx
    .insert(schema.livestockGroups)
    .values({
      tenantId: ctx.tenantId,
      name,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

export async function updateGroup(
  tx: Tx,
  ctx: LivestockCtx,
  id: string,
  input: { name?: string; notes?: string; status?: string },
): Promise<LivestockGroup> {
  requireWrite(ctx, "owner");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new LivestockError("GROUP_INVALID", "give the herd a name");
    patch.name = name;
  }
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "closed") {
      throw new LivestockError("GROUP_INVALID", `invalid status: ${input.status}`);
    }
    patch.status = input.status;
  }
  const rows = await tx
    .update(schema.livestockGroups)
    .set(patch)
    .where(
      and(
        eq(schema.livestockGroups.tenantId, ctx.tenantId),
        eq(schema.livestockGroups.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) throw new LivestockError("NOT_FOUND", `herd ${id}`);
  return rows[0];
}

export async function getGroup(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<LivestockGroup | null> {
  const row = await tx.query.livestockGroups.findFirst({
    where: and(
      eq(schema.livestockGroups.tenantId, tenantId),
      eq(schema.livestockGroups.id, id),
    ),
  });
  return row ?? null;
}

export async function listGroups(
  tx: Tx,
  tenantId: string,
  filter: { status?: string } = {},
): Promise<LivestockGroup[]> {
  const where = [eq(schema.livestockGroups.tenantId, tenantId)];
  if (filter.status) where.push(eq(schema.livestockGroups.status, filter.status));
  return tx.query.livestockGroups.findMany({
    where: and(...where),
    orderBy: (g, { asc }) => [asc(g.name)],
  });
}

/**
 * Which herd each lot is in TODAY, keyed by lot id.
 *
 * `on` rather than "now": membership is date-ranged, so *which herd was she in
 * when that calf was born* is answerable, and a caller that means today has to
 * say today.
 */
export async function groupForLots(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
  on: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (lotIds.length === 0) return out;
  const rows = await tx.query.livestockGroupMembers.findMany({
    where: and(
      eq(schema.livestockGroupMembers.tenantId, tenantId),
      inArray(schema.livestockGroupMembers.livestockLotId, lotIds),
      lte(schema.livestockGroupMembers.startedOn, on),
    ),
  });
  for (const row of rows) {
    // Inclusive end, matching land_occupancy and the feed groups.
    if (row.endedOn && row.endedOn < on) continue;
    out.set(row.livestockLotId, row.livestockGroupId);
  }
  return out;
}

/** The lots in one herd on a given day. */
export async function groupMembers(
  tx: Tx,
  tenantId: string,
  groupId: string,
  on: string,
): Promise<LivestockGroupMember[]> {
  const rows = await tx.query.livestockGroupMembers.findMany({
    where: and(
      eq(schema.livestockGroupMembers.tenantId, tenantId),
      eq(schema.livestockGroupMembers.livestockGroupId, groupId),
      lte(schema.livestockGroupMembers.startedOn, on),
    ),
    orderBy: (m, { asc }) => [asc(m.startedOn)],
  });
  return rows.filter((row) => !row.endedOn || row.endedOn >= on);
}

/**
 * Put a lot in a herd — **and take it out of whichever herd it was in.**
 *
 * One act, because one open membership per lot is a database constraint rather
 * than a convention. A caller that had to close the old one first could fail
 * between the two and leave a cow in no herd at all.
 *
 * `member`: moving animals between herds is a chore done by whoever is moving
 * them, the same level as putting a pen on a feeder or walking them to a
 * paddock. CREATING a herd is the owner's, beside every other decision that
 * makes a new thing to report on.
 */
export async function addLotToGroup(
  tx: Tx,
  ctx: LivestockCtx,
  input: { groupId: string; livestockLotId: string; startedOn: string },
): Promise<LivestockGroupMember> {
  requireWrite(ctx, "member");
  const group = await getGroup(tx, ctx.tenantId, input.groupId);
  if (!group) throw new LivestockError("NOT_FOUND", `herd ${input.groupId}`);
  if (group.status !== "active") {
    throw new LivestockError("GROUP_INVALID", "that herd is closed");
  }
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId}`);
  }

  const open = await tx.query.livestockGroupMembers.findFirst({
    where: and(
      eq(schema.livestockGroupMembers.tenantId, ctx.tenantId),
      eq(schema.livestockGroupMembers.livestockLotId, input.livestockLotId),
      isNull(schema.livestockGroupMembers.endedOn),
    ),
  });
  if (open) {
    if (open.livestockGroupId === input.groupId) return open;
    // The day BEFORE the new stay starts, so the two spans meet without
    // overlapping — the inclusive-end arithmetic land already settled.
    await tx
      .update(schema.livestockGroupMembers)
      .set({ endedOn: addDays(input.startedOn, -1) })
      .where(
        and(
          eq(schema.livestockGroupMembers.tenantId, ctx.tenantId),
          eq(schema.livestockGroupMembers.id, open.id),
        ),
      );
  }

  const rows = await tx
    .insert(schema.livestockGroupMembers)
    .values({
      tenantId: ctx.tenantId,
      livestockGroupId: input.groupId,
      livestockLotId: input.livestockLotId,
      startedOn: input.startedOn,
    })
    .returning();
  return rows[0];
}

/** Take a lot out of its herd, leaving it in none. */
export async function removeLotFromGroup(
  tx: Tx,
  ctx: LivestockCtx,
  input: { livestockLotId: string; endedOn: string },
): Promise<void> {
  requireWrite(ctx, "member");
  const rows = await tx
    .update(schema.livestockGroupMembers)
    .set({ endedOn: input.endedOn })
    .where(
      and(
        eq(schema.livestockGroupMembers.tenantId, ctx.tenantId),
        eq(schema.livestockGroupMembers.livestockLotId, input.livestockLotId),
        isNull(schema.livestockGroupMembers.endedOn),
      ),
    )
    .returning({ id: schema.livestockGroupMembers.id });
  if (rows.length === 0) {
    throw new LivestockError("NOT_FOUND", "that animal is not in a herd");
  }
}

/**
 * **MOVE THE WHOLE HERD, and this is the reason a herd is worth having.**
 *
 * Ten cows on a paddock used to be ten trips through the move dialog, because
 * `moveOccupant` takes one occupant. This walks the membership and moves every
 * one of them in a single transaction, so the herd either arrives or does not.
 *
 * **Each member still goes through `land`'s own `moveOccupant`**, exactly as a
 * single lot does — the inclusive-date arithmetic that makes the old stay end
 * the day before the new one begins is land's, and a bulk path that
 * re-implemented it would drift from the single path the first time somebody
 * fixed one of them.
 *
 * Returns what it moved and what it skipped rather than a count, because a herd
 * where three of ten refused is a thing somebody has to be told about — silence
 * there would read as ten.
 */
export async function moveGroupToZone(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    groupId: string;
    zoneId: string;
    startedOn: string;
    structureAssetId?: string | null;
    notes?: string;
  },
): Promise<{ moved: string[]; refused: { lotId: string; reason: string }[] }> {
  requireWrite(ctx, "member");
  const group = await getGroup(tx, ctx.tenantId, input.groupId);
  if (!group) throw new LivestockError("NOT_FOUND", `herd ${input.groupId}`);

  const members = await groupMembers(
    tx,
    ctx.tenantId,
    input.groupId,
    input.startedOn,
  );
  const moved: string[] = [];
  const refused: { lotId: string; reason: string }[] = [];
  for (const member of members) {
    try {
      await moveLotToZone(tx, ctx, {
        livestockLotId: member.livestockLotId,
        zoneId: input.zoneId,
        startedOn: input.startedOn,
        structureAssetId: input.structureAssetId ?? null,
        notes: input.notes,
      });
      moved.push(member.livestockLotId);
    } catch (err) {
      // A lot with no head left is the ordinary case here — an emptied pen
      // still in the herd — and one refusal must not strand the other nine.
      refused.push({
        lotId: member.livestockLotId,
        reason: err instanceof Error ? err.message : "could not be moved",
      });
    }
  }
  return { moved, refused };
}

/** Head, and how many of the members are named animals rather than counts. */
export type GroupSummary = {
  group: LivestockGroup;
  lotIds: string[];
  head: number;
  /** Lots holding exactly one head — the animals somebody named. */
  individuals: number;
  species: string[];
  /**
   * Where the herd is, in one phrase. **A herd standing on two paddocks says so
   * rather than picking one** — that is either a move half done or a herd that
   * wants splitting, and both are things somebody should see.
   */
  where: string | null;
};

/**
 * Every herd with its totals, in as few queries as the shape allows.
 *
 * **The head figure is the sum of its members' balances**, folded from
 * `inventory`'s ledger like every other head number in this pack. Nothing is
 * stored on the herd, so a loss recorded on one animal shows up in its herd's
 * total without anybody re-counting.
 */
export async function groupSummaries(
  tx: Tx,
  tenantId: string,
  on: string,
  filter: { status?: string } = {},
): Promise<GroupSummary[]> {
  const groups = await listGroups(tx, tenantId, filter);
  if (groups.length === 0) return [];

  const rows = await tx.query.livestockGroupMembers.findMany({
    where: and(
      eq(schema.livestockGroupMembers.tenantId, tenantId),
      inArray(
        schema.livestockGroupMembers.livestockGroupId,
        groups.map((g) => g.id),
      ),
      lte(schema.livestockGroupMembers.startedOn, on),
    ),
  });
  const current = rows.filter((row) => !row.endedOn || row.endedOn >= on);
  const lotIds = [...new Set(current.map((row) => row.livestockLotId))];

  const lots = await tx.query.livestockLots.findMany({
    where: and(
      eq(schema.livestockLots.tenantId, tenantId),
      inArray(schema.livestockLots.id, lotIds.length > 0 ? lotIds : [NO_UUID]),
    ),
    columns: { id: true, inventoryLotId: true, species: true },
  });
  const byLot = new Map(lots.map((l) => [l.id, l]));
  const movements = await movementKindsForLots(
    tx,
    tenantId,
    lots.map((l) => l.inventoryLotId),
  );
  // From `land`, through land's own query — this pack never touches
  // land_occupancy directly, herd or no herd.
  const places = await currentZoneForOccupants(
    tx,
    tenantId,
    "livestock",
    lots.map((l) => l.inventoryLotId),
    on,
  );

  const membersByGroup = new Map<string, string[]>();
  for (const row of current) {
    const list = membersByGroup.get(row.livestockGroupId) ?? [];
    list.push(row.livestockLotId);
    membersByGroup.set(row.livestockGroupId, list);
  }

  return groups.map((group) => {
    const ids = membersByGroup.get(group.id) ?? [];
    let head = 0;
    let individuals = 0;
    const species = new Set<string>();
    const zoneNames = new Set<string>();
    for (const id of ids) {
      const lot = byLot.get(id);
      if (!lot) continue;
      species.add(lot.species);
      const balance = summariseHead(
        movements.get(lot.inventoryLotId) ?? [],
      ).balance;
      head += balance;
      if (balance === 1) individuals += 1;
      // Only animals that are actually somewhere count toward the answer: an
      // emptied pen still in the herd is not a second paddock.
      const place = places.get(lot.inventoryLotId);
      if (place && balance > 0) zoneNames.add(place.zoneName);
    }
    const names = [...zoneNames].sort();
    return {
      group,
      lotIds: ids,
      head,
      individuals,
      species: [...species].sort(),
      where:
        names.length === 0
          ? null
          : names.length === 1
            ? names[0]
            : `${names.length} places`,
    };
  });
}

// ------------------------------------------------------------ individuals ---

/**
 * **AN INDIVIDUAL IS A LOT OF ONE, and until now nothing said so on screen.**
 *
 * The model has always supported it — identifiers, weights, treatments, photos
 * and pedigree parents all hang off the LOT, so a lot holding one head IS an
 * animal and every one of those tables means what you would expect. What was
 * missing was any way to ASK for that: the founder's question on 2026-08-27 was
 * *"you create a lot and then you add head to the lot, but I don't see how you
 * track each individual animal in the lot"*, and the honest answer was that you
 * split, ten times, inventing a code each time.
 *
 * **WITHIN a lot the app deliberately cannot tell one animal from another**, and
 * that is not a gap to close. A pen of a thousand broilers must stay one row; a
 * weight there is a sample average and a treatment holds the whole pen back,
 * both correctly. These two functions are about making the OTHER shape — the
 * named cow — as easy to reach as the pen already was.
 */

/**
 * How many animals one "record as individuals" may produce at a time.
 *
 * Fifty is far past a homestead's cattle and far short of a broiler pen, which
 * is the point: this is the wrong tool for a flock, and a cap that bites tells
 * somebody that before it makes five hundred rows they did not want.
 */
export const MAX_INDIVIDUALS = 50;

/**
 * Split head out of a lot into one lot per animal, each named.
 *
 * **N SPLITS IN ONE TRANSACTION, not a new mechanism.** Each animal goes through
 * `splitLivestockLot`, which already carries the species, the sex, the birth
 * date, the breeding and both parents across — so ten cows out of a pen are ten
 * animals that know what they are, and the ledger still balances because every
 * one of them is an ordinary transfer.
 *
 * The name is used as BOTH the lot code and an identifier, because that is what
 * a person means when they type "Bluebell": the app's handle for her and what
 * she is called are the same word, and making somebody enter it twice would be
 * this function asking a question it already has the answer to.
 */
export async function splitIntoIndividuals(
  tx: Tx,
  ctx: LivestockCtx,
  input: {
    livestockLotId: string;
    /** One per animal: a name, a tag number, whatever they are called. */
    names: string[];
    /** `name`, `visual`, `official`, `eid`, `tattoo` — an open taxonomy. */
    identifierKind: string;
    occurredOn: string;
    locationAssetId?: string | null;
  },
): Promise<{ lot: LivestockLot; inventoryLotId: string }[]> {
  requireWrite(ctx, "owner");
  const lot = await getLivestockLot(tx, ctx.tenantId, input.livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${input.livestockLotId} not found`);
  }

  const names = input.names.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new LivestockError("LOT_INVALID", "name at least one animal");
  }
  if (names.length > MAX_INDIVIDUALS) {
    throw new LivestockError(
      "LOT_INVALID",
      `${MAX_INDIVIDUALS} at a time — a pen this size is better kept as one lot`,
    );
  }
  // Two animals called the same thing is a paste that went wrong, and it would
  // produce two records nobody could tell apart afterwards — which is the exact
  // problem this whole function exists to solve.
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new LivestockError("LOT_INVALID", `"${name}" is named twice`);
    }
    seen.add(key);
  }

  // Checked UP FRONT rather than discovered on the sixth split. The transaction
  // would roll the lot back either way; the difference is whether the person is
  // told how many they have or shown a failure halfway down their list.
  const movements = await movementKindsForLots(tx, ctx.tenantId, [
    lot.inventoryLotId,
  ]);
  const balance = summariseHead(movements.get(lot.inventoryLotId) ?? []).balance;
  if (names.length > balance) {
    throw new LivestockError(
      "LOT_INVALID",
      `only ${balance} head here — you named ${names.length}`,
    );
  }

  const kind = input.identifierKind.trim().toLowerCase();
  if (!isValidSlug(kind)) {
    throw new LivestockError("INVALID_IDENTIFIER", `invalid kind: ${input.identifierKind}`);
  }

  const created: { lot: LivestockLot; inventoryLotId: string }[] = [];
  for (const name of names) {
    const child = await splitLivestockLot(tx, ctx, {
      livestockLotId: input.livestockLotId,
      head: 1,
      newCode: name,
      occurredOn: input.occurredOn,
      locationAssetId: input.locationAssetId ?? null,
    });
    await addIdentifier(tx, ctx, {
      livestockLotId: child.lot.id,
      identifierKind: kind,
      value: name,
      appliedOn: input.occurredOn,
    });
    created.push(child);
  }
  return created;
}

/**
 * Start ONE animal: the lot, its name, and the single head — in one act.
 *
 * **The head is placed here rather than left to a second step**, and that is the
 * whole difference from `createLivestockLot`. A lot of one that contains no
 * animal is a record of nothing, and "create it, then go and add a head to it"
 * was the two-step that made the individual case feel like it was not really
 * supported.
 *
 * A GROUP still does not place head automatically, deliberately: how many chicks
 * actually arrived in a box of a hundred is a fact somebody checks, and a form
 * that assumed it would be inventing the mortality denominator.
 */
export async function startIndividual(
  tx: Tx,
  ctx: LivestockCtx,
  input: Omit<LivestockLotInput, "code"> & {
    /** What she is called. Becomes the lot code AND an identifier. */
    name: string;
    identifierKind?: string;
    /** When she arrived or was born. The head event's date. */
    occurredOn: string;
    locationAssetId?: string | null;
  },
): Promise<{ lot: LivestockLot; inventoryLotId: string }> {
  requireWrite(ctx, "owner");
  const name = input.name.trim();
  if (!name) throw new LivestockError("LOT_INVALID", "give the animal a name");

  const created = await createLivestockLot(tx, ctx, { ...input, code: name });
  await addIdentifier(tx, ctx, {
    livestockLotId: created.lot.id,
    identifierKind: input.identifierKind?.trim().toLowerCase() || "name",
    value: name,
    appliedOn: input.occurredOn,
  });

  const inventoryLot = await getInventoryLot(
    tx,
    ctx.tenantId,
    created.inventoryLotId,
  );
  if (!inventoryLot) {
    throw new LivestockError("NOT_FOUND", "the lot went missing mid-write");
  }
  await placeHead(tx, ctx, {
    itemId: inventoryLot.itemId,
    inventoryLotId: created.inventoryLotId,
    head: 1,
    occurredOn: input.occurredOn,
    locationAssetId: input.locationAssetId ?? null,
  });
  return created;
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

// ---------------------------------------------------- pedigree & breeding ---

/**
 * At most this many breeds may be stated for one animal.
 *
 * Eight is past anything a real cross reaches — the pilot's most complicated
 * cow is three — and it is here as a typo guard rather than a rule about
 * genetics. A hundred rows would be somebody's paste, not somebody's herd.
 */
export const MAX_BREED_PARTS = 8;

/** How many animals one pedigree walk loads before it stops climbing. */
export const PEDIGREE_NODE_CAP = 200;

/**
 * The STATED composition for several animals at once, keyed by lot id.
 *
 * **STATED ONLY — never the resolved answer.** What somebody typed and what the
 * app worked out from the parents are different kinds of fact, and a list that
 * mixed them would put them side by side looking identical. That is the same
 * distinction the feed report draws between measured and allocated, and the
 * weights screen between a scale and a tape.
 */
export async function breedPartsByLot(
  tx: Tx,
  tenantId: string,
  livestockLotIds: string[],
): Promise<Map<string, BreedPart[]>> {
  const out = new Map<string, BreedPart[]>();
  if (livestockLotIds.length === 0) return out;
  const rows = await tx.query.livestockBreedParts.findMany({
    where: and(
      eq(schema.livestockBreedParts.tenantId, tenantId),
      inArray(schema.livestockBreedParts.livestockLotId, livestockLotIds),
    ),
  });
  for (const row of rows) {
    const list = out.get(row.livestockLotId) ?? [];
    list.push({ breed: row.breed, parts: row.parts });
    out.set(row.livestockLotId, list);
  }
  return out;
}

/**
 * Walk a pedigree UPWARD and load what the pure fold needs.
 *
 * Generation by generation rather than one recursive query per animal: a
 * pedigree fans out by two each level, so ten generations of one-at-a-time
 * reads is a thousand round trips and ten batched ones is ten.
 *
 * **BOUNDED TWICE, AND A BOUND THAT BITES IS VISIBLE.** `generations` stops the
 * climb and `PEDIGREE_NODE_CAP` stops the fan-out. An animal the cap left out is
 * simply absent from the index, and `resolveComposition` reports that as
 * `truncated` rather than as an unknown parent — because "we stopped looking"
 * and "nobody knows" are different sentences and the screen says which.
 */
export async function pedigreeIndex(
  tx: Tx,
  tenantId: string,
  rootIds: string[],
  generations: number = MAX_GENERATIONS,
): Promise<PedigreeIndex> {
  const found = new Map<
    string,
    { id: string; damLotId: string | null; sireLotId: string | null }
  >();
  let frontier = [...new Set(rootIds.filter(Boolean))];

  for (let depth = 0; depth <= generations; depth++) {
    const wanted = frontier.filter((id) => !found.has(id));
    if (wanted.length === 0 || found.size >= PEDIGREE_NODE_CAP) break;
    const rows = await tx.query.livestockLots.findMany({
      where: and(
        eq(schema.livestockLots.tenantId, tenantId),
        inArray(
          schema.livestockLots.id,
          wanted.slice(0, PEDIGREE_NODE_CAP - found.size),
        ),
      ),
      columns: { id: true, damLotId: true, sireLotId: true },
    });
    for (const row of rows) found.set(row.id, row);
    frontier = rows.flatMap((row) =>
      [row.damLotId, row.sireLotId].filter((id): id is string => Boolean(id)),
    );
  }

  const stated = await breedPartsByLot(tx, tenantId, [...found.keys()]);
  const index: PedigreeIndex = new Map();
  for (const [id, row] of found) {
    const node: PedigreeNode = {
      id,
      damLotId: row.damLotId,
      sireLotId: row.sireLotId,
      stated: stated.get(id) ?? [],
    };
    index.set(id, node);
  }
  return index;
}

/** What one animal is made of, pedigree walked. Nothing about it is stored. */
export async function compositionFor(
  tx: Tx,
  tenantId: string,
  livestockLotId: string,
): Promise<Composition> {
  const index = await pedigreeIndex(tx, tenantId, [livestockLotId]);
  return resolveComposition(livestockLotId, index);
}

/**
 * State what an animal is made of, replacing whatever was there.
 *
 * **THE WHOLE SET IS ONE FACT**, so this is a replace and not an upsert. "½
 * Angus, ¼ Hereford, ¼ Simmental" is a single sentence about a cow, and editing
 * it one row at a time would allow an intermediate state that sums to something
 * nobody meant.
 *
 * `owner`, beside the rest of editing a lot. What an animal IS is a record
 * somebody keeps, not a chore somebody does.
 */
export async function setBreedParts(
  tx: Tx,
  ctx: LivestockCtx,
  livestockLotId: string,
  parts: BreedPart[],
): Promise<BreedPart[]> {
  requireWrite(ctx, "owner");
  const lot = await getLivestockLot(tx, ctx.tenantId, livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${livestockLotId} not found`);
  }

  // Merged before validation, so stating Angus twice is one component rather
  // than a refusal about a mistake nobody meant to make.
  const merged = new Map<string, number>();
  for (const part of parts) {
    const breed = part.breed.trim().toLowerCase().replace(/\s+/g, "_");
    if (!breed) continue;
    if (!isValidSlug(breed)) {
      throw new LivestockError("INVALID_BREED", `invalid breed: ${part.breed}`);
    }
    if (!Number.isInteger(part.parts) || part.parts < 1 || part.parts > 10_000) {
      throw new LivestockError(
        "INVALID_BREED",
        "a share must be a whole number of parts, at least one",
      );
    }
    merged.set(breed, (merged.get(breed) ?? 0) + part.parts);
  }
  if (merged.size > MAX_BREED_PARTS) {
    throw new LivestockError(
      "INVALID_BREED",
      `at most ${MAX_BREED_PARTS} breeds for one animal`,
    );
  }

  await tx
    .delete(schema.livestockBreedParts)
    .where(
      and(
        eq(schema.livestockBreedParts.tenantId, ctx.tenantId),
        eq(schema.livestockBreedParts.livestockLotId, livestockLotId),
      ),
    );

  const rows = [...merged].map(([breed, count]) => ({
    tenantId: ctx.tenantId,
    livestockLotId,
    breed,
    parts: count,
  }));
  if (rows.length > 0) await tx.insert(schema.livestockBreedParts).values(rows);

  return rows.map((r) => ({ breed: r.breed, parts: r.parts }));
}

/**
 * Say who an animal's dam and sire are.
 *
 * `undefined` leaves a parent alone and `null` clears it — the same distinction
 * every patch in this pack draws, and it matters here because "I only know the
 * dam" is the ordinary case rather than an incomplete form.
 *
 * **WHAT THIS REFUSES, AND WHY EACH ONE IS A REFUSAL RATHER THAN A WARNING:**
 *
 *   - **A loop.** A cow who is her own granddam makes a pedigree that cannot be
 *     walked and a composition that cannot be computed. A CHECK stops the
 *     one-step case; only a walk can see the rest.
 *   - **A stated contradiction of sex.** A dam recorded as male is a mis-click,
 *     not a fact about biology. **An UNRECORDED sex is not a contradiction** and
 *     is allowed through — this pack never reads a missing fact as the most
 *     convenient value.
 *
 * **WHAT IT DELIBERATELY DOES NOT REFUSE: a parent of another species.** A mule
 * is a real animal. The picker offers same-species animals first, which handles
 * the mis-click without the app inventing a rule about what can breed with what.
 */
export async function setParents(
  tx: Tx,
  ctx: LivestockCtx,
  livestockLotId: string,
  input: { damLotId?: string | null; sireLotId?: string | null },
): Promise<LivestockLot> {
  requireWrite(ctx, "owner");
  const lot = await getLivestockLot(tx, ctx.tenantId, livestockLotId);
  if (!lot) {
    throw new LivestockError("NOT_FOUND", `lot ${livestockLotId} not found`);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const named: string[] = [];
  if (input.damLotId !== undefined) {
    patch.damLotId = input.damLotId;
    if (input.damLotId) named.push(input.damLotId);
  }
  if (input.sireLotId !== undefined) {
    patch.sireLotId = input.sireLotId;
    if (input.sireLotId) named.push(input.sireLotId);
  }
  if (named.length === 0 && Object.keys(patch).length === 1) return lot;

  // One walk covers both parents: the index is loaded from whichever were
  // named, and every ancestor of either is in it.
  const index = named.length > 0
    ? await pedigreeIndex(tx, ctx.tenantId, named)
    : (new Map() as PedigreeIndex);

  for (const [role, parentId] of [
    ["dam", input.damLotId] as const,
    ["sire", input.sireLotId] as const,
  ]) {
    if (!parentId) continue;
    if (parentId === livestockLotId) {
      throw new LivestockError(
        "INVALID_PARENT",
        "an animal cannot be its own parent",
      );
    }
    const parent = await getLivestockLot(tx, ctx.tenantId, parentId);
    if (!parent) {
      throw new LivestockError("INVALID_PARENT", `${role} ${parentId} not found`);
    }
    if (role === "dam" && parent.sex === "male") {
      throw new LivestockError(
        "INVALID_PARENT",
        "that animal is recorded as male, so it cannot be the dam",
      );
    }
    if (role === "sire" && parent.sex === "female") {
      throw new LivestockError(
        "INVALID_PARENT",
        "that animal is recorded as female, so it cannot be the sire",
      );
    }
    if (isAncestor(livestockLotId, parentId, index)) {
      throw new LivestockError(
        "INVALID_PARENT",
        "that animal is already descended from this one",
      );
    }
  }

  const rows = await tx
    .update(schema.livestockLots)
    .set(patch)
    .where(
      and(
        eq(schema.livestockLots.tenantId, ctx.tenantId),
        eq(schema.livestockLots.id, livestockLotId),
      ),
    )
    .returning();
  return rows[0];
}

/** Everything out of this animal, either side. "Show me her calves." */
export async function offspringOf(
  tx: Tx,
  tenantId: string,
  livestockLotId: string,
): Promise<LivestockLot[]> {
  return tx.query.livestockLots.findMany({
    where: and(
      eq(schema.livestockLots.tenantId, tenantId),
      or(
        eq(schema.livestockLots.damLotId, livestockLotId),
        eq(schema.livestockLots.sireLotId, livestockLotId),
      ),
    ),
    orderBy: (l, { desc }) => [desc(l.bornOn), desc(l.createdAt)],
  });
}

/** An animal a picker may offer as a parent, with the code a person calls it. */
export type ParentCandidate = {
  id: string;
  code: string;
  species: string;
  sex: string | null;
  bornOn: string | null;
};

/**
 * Who could be named as a parent.
 *
 * Excludes the animal itself and nothing else. Its DESCENDANTS are also
 * impossible and are not filtered out here — finding them means a walk per
 * candidate, and the write path refuses the choice with a sentence that says
 * why. A picker that silently omitted an animal somebody was looking for would
 * be the worse of the two failures.
 */
export async function parentCandidates(
  tx: Tx,
  tenantId: string,
  opts: { species?: string; excludeId?: string } = {},
): Promise<ParentCandidate[]> {
  const where = [eq(schema.livestockLots.tenantId, tenantId)];
  if (opts.species) where.push(eq(schema.livestockLots.species, opts.species));
  const lots = await tx.query.livestockLots.findMany({ where: and(...where) });
  const kept = lots.filter((lot) => lot.id !== opts.excludeId);
  const codes = await lotsByIds(
    tx,
    tenantId,
    kept.map((lot) => lot.inventoryLotId),
  );
  return kept
    .map((lot) => ({
      id: lot.id,
      code: codes.get(lot.inventoryLotId)?.code ?? "",
      species: lot.species,
      sex: lot.sex,
      bornOn: lot.bornOn,
    }))
    .filter((c) => c.code !== "")
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The CODE a person calls each animal, by livestock lot id.
 *
 * The pedigree index deliberately carries ids and no codes — it is the input to
 * a pure fold, and a fold that knew about `inventory_lots` would be reaching
 * across a seam to render a label. So a screen that wants names asks for them
 * separately, in one query, here.
 */
export async function codesByLivestockLot(
  tx: Tx,
  tenantId: string,
  livestockLotIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (livestockLotIds.length === 0) return out;
  const lots = await tx.query.livestockLots.findMany({
    where: and(
      eq(schema.livestockLots.tenantId, tenantId),
      inArray(schema.livestockLots.id, livestockLotIds),
    ),
    columns: { id: true, inventoryLotId: true },
  });
  const codes = await lotsByIds(
    tx,
    tenantId,
    lots.map((lot) => lot.inventoryLotId),
  );
  for (const lot of lots) {
    const code = codes.get(lot.inventoryLotId)?.code;
    if (code) out.set(lot.id, code);
  }
  return out;
}

export interface BirthInput {
  damLotId?: string | null;
  sireLotId?: string | null;
  /** The new lot's code: "COW-14", "Farrowing 2026-03-02". */
  code: string;
  /** One for a calf, ten for a farrowing. The lot model absorbs both. */
  head: number;
  bornOn: string;
  /** Where the offspring are counted. Exactly one of these, as on create. */
  itemId?: string;
  newItemName?: string;
  /** Defaults to the dam's, then the sire's. */
  species?: string;
  sex?: string | null;
  locationAssetId?: string | null;
  notes?: string;
}

/**
 * **A BIRTH.** Creates the lot, links both parents, and places the head — one
 * transaction, because a calf that exists without arriving is a record nobody
 * asked for.
 *
 * **THIS DOES NOT SET `inventory_lots.parent_lot_id`, AND THAT IS THE WHOLE
 * POINT OF THE COLUMNS IT DOES SET.** That column is the SPLIT chain: it means
 * "these animals came out of that group", and a traceability walk follows it to
 * find which pen a box of meat was raised in. A birth is not a split — the dam
 * does not lose a head when her calf arrives — and putting the dam there would
 * make a lot trace wander into a family tree. The design note that said births
 * are "parented by the dam" predates that chain existing in code.
 *
 * `source: "raised"`, always. A born animal has no purchase basis at all, only
 * accumulated production cost, and `inventory` has held that distinction since
 * its slice 0 precisely so this moment does not have to invent it.
 *
 * `owner`, because it creates a lot and chooses the stock line the offspring
 * are counted in — the same reason `createLivestockLot` is. Whether recording a
 * 2am calving should really need the owner is an open item, not an oversight.
 */
export async function recordBirth(
  tx: Tx,
  ctx: LivestockCtx,
  input: BirthInput,
): Promise<{ lot: LivestockLot; inventoryLotId: string }> {
  requireWrite(ctx, "owner");
  if (!input.damLotId && !input.sireLotId) {
    throw new LivestockError(
      "INVALID_PARENT",
      "a birth needs at least a dam or a sire — start a lot instead",
    );
  }
  if (!(input.head > 0)) {
    throw new LivestockError("LOT_INVALID", "how many were born?");
  }

  const dam = input.damLotId
    ? await getLivestockLot(tx, ctx.tenantId, input.damLotId)
    : null;
  const sire = input.sireLotId
    ? await getLivestockLot(tx, ctx.tenantId, input.sireLotId)
    : null;
  if (input.damLotId && !dam) {
    throw new LivestockError("INVALID_PARENT", "that dam no longer exists");
  }
  if (input.sireLotId && !sire) {
    throw new LivestockError("INVALID_PARENT", "that sire no longer exists");
  }

  const created = await createLivestockLot(tx, ctx, {
    itemId: input.itemId,
    newItemName: input.newItemName,
    code: input.code,
    // Inherited rather than asked for: a calf out of cattle is cattle, and a
    // form that asked would be asking a question with one answer.
    species: input.species ?? dam?.species ?? sire?.species ?? "",
    sex: input.sex ?? null,
    bornOn: input.bornOn,
    source: "raised",
    notes: input.notes,
  });

  await setParents(tx, ctx, created.lot.id, {
    damLotId: input.damLotId ?? null,
    sireLotId: input.sireLotId ?? null,
  });

  const inventoryLot = await getInventoryLot(
    tx,
    ctx.tenantId,
    created.inventoryLotId,
  );
  if (!inventoryLot) {
    throw new LivestockError("NOT_FOUND", "the lot went missing mid-write");
  }
  await placeHead(tx, ctx, {
    itemId: inventoryLot.itemId,
    inventoryLotId: created.inventoryLotId,
    head: input.head,
    occurredOn: input.bornOn,
    locationAssetId: input.locationAssetId ?? null,
    notes: input.notes,
  });

  const lot = await getLivestockLot(tx, ctx.tenantId, created.lot.id);
  return { lot: lot ?? created.lot, inventoryLotId: created.inventoryLotId };
}

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
/**
 * One lot's treatments, **inherited ones included** — the same list the clock is
 * folded from, so the screen and the refusal can never disagree.
 *
 * A row whose `livestockLotId` is not this lot came from the pen it was split
 * out of. The page shows it and does not offer to correct it, because it is
 * another record's row.
 */
export async function listTreatmentsForLot(
  tx: Tx,
  tenantId: string,
  livestockLotId: string,
): Promise<LivestockTreatment[]> {
  const byLot = await treatmentsByLot(tx, tenantId, [livestockLotId]);
  return byLot.get(livestockLotId) ?? [];
}

/**
 * How far up the SPLIT chain a withdrawal is inherited before the walk stops.
 *
 * Twenty is far past any real chain — a lot of chicks splits across pens once
 * — and it is here so a chain somebody has managed to loop terminates rather
 * than hangs. `inventory_lots` has a CHECK against the one-step case.
 */
const SPLIT_CHAIN_DEPTH = 20;

/**
 * **A TREATMENT FOLLOWS THE ANIMALS WHEN A LOT IS SPLIT.**
 *
 * Found by driving "record as individuals" on 2026-08-27: HOGS-1 had nineteen
 * days left on its meat clock, three pigs were split out of it, and all three
 * read CLEAR. A one-click way to empty a pen's withdrawal — and the dossier
 * already says this is the one number in the pack where being quietly wrong is
 * a legal problem, because the end of it is uninspectable meat in a freezer.
 *
 * **Inherited at READ time rather than copied at split time**, and the
 * difference matters: `updateTreatment` and `deleteTreatment` exist because a
 * clock can be wrong and has to be correctable. Copies would make a correction
 * reach the pen and miss the animals that left it — quiet wrongness of exactly
 * the kind this replaces. One row stays the truth; every animal descended from
 * the pen it was given to reads it.
 *
 * **BOUNDED BY WHEN EACH BRANCH SEPARATED.** A treatment given to a pen AFTER
 * three pigs left it was not given to those three, so the bound at each step up
 * is the `opened_on` of the lot one level below — the day that branch became its
 * own. Splits move forward in time, so the bound tightens as the walk climbs.
 *
 * **A lot with no `opened_on` inherits everything**, which is the conservative
 * reading rather than the tidy one: an unknown separation date cannot rule a
 * treatment out, and this file errs toward saying an animal is still under a
 * period.
 */
async function inheritedTreatmentSources(
  tx: Tx,
  tenantId: string,
  livestockLotIds: string[],
): Promise<Map<string, { livestockLotId: string; onOrBefore: string | null }[]>> {
  const out = new Map<
    string,
    { livestockLotId: string; onOrBefore: string | null }[]
  >();
  if (livestockLotIds.length === 0) return out;

  const lots = await tx.query.livestockLots.findMany({
    where: and(
      eq(schema.livestockLots.tenantId, tenantId),
      inArray(schema.livestockLots.id, livestockLotIds),
    ),
    columns: { id: true, inventoryLotId: true },
  });
  if (lots.length === 0) return out;

  // The inventory lots in play, loaded generation by generation: a chain of
  // twenty is twenty round trips rather than twenty per animal.
  const chain = new Map<
    string,
    { id: string; parentLotId: string | null; openedOn: string | null }
  >();
  let frontier = lots.map((l) => l.inventoryLotId);
  for (let depth = 0; depth <= SPLIT_CHAIN_DEPTH && frontier.length > 0; depth++) {
    const wanted = [...new Set(frontier)].filter((id) => !chain.has(id));
    if (wanted.length === 0) break;
    const rows = await tx.query.inventoryLots.findMany({
      where: and(
        eq(schema.inventoryLots.tenantId, tenantId),
        inArray(schema.inventoryLots.id, wanted),
      ),
      columns: { id: true, parentLotId: true, openedOn: true },
    });
    for (const row of rows) chain.set(row.id, row);
    frontier = rows
      .map((row) => row.parentLotId)
      .filter((id): id is string => Boolean(id));
  }

  // Every ancestor inventory lot, with the bound that applies to it.
  const ancestors = new Map<string, { id: string; onOrBefore: string | null }[]>();
  for (const lot of lots) {
    const found: { id: string; onOrBefore: string | null }[] = [];
    const walked = new Set<string>([lot.inventoryLotId]);
    let current = chain.get(lot.inventoryLotId);
    // The bound starts at the day THIS lot separated from its parent.
    let bound = current?.openedOn ?? null;
    for (let depth = 0; depth < SPLIT_CHAIN_DEPTH; depth++) {
      const parentId = current?.parentLotId;
      if (!parentId || walked.has(parentId)) break;
      walked.add(parentId);
      found.push({ id: parentId, onOrBefore: bound });
      current = chain.get(parentId);
      // One level further up, the branch separated when the lot below it did.
      if (current?.openedOn && (!bound || current.openedOn < bound)) {
        bound = current.openedOn;
      }
    }
    if (found.length > 0) ancestors.set(lot.id, found);
  }
  if (ancestors.size === 0) return out;

  const ancestorInventoryIds = [
    ...new Set([...ancestors.values()].flatMap((rows) => rows.map((r) => r.id))),
  ];
  const biology = await livestockByInventoryLot(tx, tenantId, ancestorInventoryIds);
  for (const [lotId, rows] of ancestors) {
    const mapped = rows
      .map((row) => {
        const ancestor = biology.get(row.id);
        return ancestor
          ? { livestockLotId: ancestor.id, onOrBefore: row.onOrBefore }
          : null;
      })
      .filter((row): row is { livestockLotId: string; onOrBefore: string | null } =>
        row !== null,
      );
    if (mapped.length > 0) out.set(lotId, mapped);
  }
  return out;
}

/**
 * Every treatment across a set of lots, keyed by lot — **including the ones
 * inherited from the pen each animal was split out of.**
 *
 * The single funnel for the withdrawal clock, which is why the inheritance
 * lives here rather than at each call site: `withdrawalByLot` feeds the hub, the
 * daily round and `run-handler.ts`, and a clock that was right on one of those
 * and wrong on another would be worse than one that was simply wrong.
 *
 * **An inherited row keeps its OWN `livestock_lot_id`**, so a caller can always
 * tell whose treatment it is — that is what lets the detail page show it without
 * offering to correct another lot's record.
 */
export async function treatmentsByLot(
  tx: Tx,
  tenantId: string,
  lotIds: string[],
): Promise<Map<string, LivestockTreatment[]>> {
  const out = new Map<string, LivestockTreatment[]>();
  if (lotIds.length === 0) return out;

  const inherited = await inheritedTreatmentSources(tx, tenantId, lotIds);
  const wanted = [
    ...new Set([
      ...lotIds,
      ...[...inherited.values()].flatMap((rows) =>
        rows.map((r) => r.livestockLotId),
      ),
    ]),
  ];
  const rows = await tx.query.livestockTreatments.findMany({
    where: and(
      eq(schema.livestockTreatments.tenantId, tenantId),
      inArray(schema.livestockTreatments.livestockLotId, wanted),
    ),
    orderBy: (t, { desc: byDesc }) => [byDesc(t.treatedOn)],
  });

  const byOwner = new Map<string, LivestockTreatment[]>();
  for (const row of rows) {
    const list = byOwner.get(row.livestockLotId);
    if (list) list.push(row);
    else byOwner.set(row.livestockLotId, [row]);
  }

  for (const lotId of lotIds) {
    const own = byOwner.get(lotId) ?? [];
    const fromAbove = (inherited.get(lotId) ?? []).flatMap((source) =>
      (byOwner.get(source.livestockLotId) ?? []).filter(
        // A null bound cannot rule anything out, and this file errs toward
        // saying an animal is still under a period.
        (t) => !source.onOrBefore || t.treatedOn <= source.onOrBefore,
      ),
    );
    const all = [...own, ...fromAbove];
    if (all.length > 0) {
      all.sort((a, b) => (a.treatedOn < b.treatedOn ? 1 : -1));
      out.set(lotId, all);
    }
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
 * A report over a whole lot's life needs a lower bound and there is no honest
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
   * first lot with a single weighing can honestly produce.
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

  const [
    inventoryLots,
    movements,
    measured,
    fedDated,
    groups,
    weights,
    hauls,
    carried,
  ] =
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
      /**
       * **WHAT HAS ALREADY LEFT EACH PEN CARRYING COST**, from `inventory`,
       * through inventory's own query — the ledger is its table and a read of
       * `inventory_movements` from here would be the leak the extension model
       * forbids.
       *
       * Added the day `production` shipped. Until a run could take 100 birds and
       * $43.15 into the freezer, nothing could take cost OUT of a pen, and this
       * report was right to treat "fed to this lot" and "carried by this lot" as
       * one number. They stopped being one number, and the card went on showing
       * the whole bill against the birds still standing.
       */
      carriedCostByLot(tx, tenantId, inventoryLotIds),
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
        // `opened_on` is when the lot started; `born_on` is the fallback for a
        // lot created before anything was placed into it.
        startedOn: inventoryLot?.openedOn ?? lot.bornOn ?? null,
        measuredCents: fed.reduce((sum, f) => sum + f.costCents, 0),
        measuredQuantities: mergeQuantities(
          fed.map((f) => ({ unit: f.unit, quantity: f.quantity })),
        ),
        allocatedCents: allocatedCents.get(lot.id) ?? 0,
        allocatedQuantities: mergeQuantities(allocatedQuantities.get(lot.id) ?? []),
        unpricedMovements: fed.reduce((sum, f) => sum + f.unpricedMovements, 0),
        /**
         * **DELIBERATELY NOT WINDOWED BY THE REPORT'S PERIOD.** What a pen is
         * still carrying is a fact about now, not about the last 30 days: asking
         * for a month and being told a pen carries cost it handed to the freezer
         * in April would be worse than useless. The measured and allocated
         * figures above ARE windowed, because "what did this pen eat this month"
         * is exactly that question.
         */
        releasedCents: carried.get(lot.inventoryLotId)?.releasedCents ?? 0,
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
   * weighing halfway through its first lot.
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

    // The first-lot answer, and NOT a conversion — see `feedPerLiveweightLb`.
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
    pedigrees,
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
    // Bounded by the same cap as the digest itself: at most SNAPSHOT_LOT_CAP
    // roots, and `pedigreeIndex` bounds the climb from there.
    pedigreeIndex(
      tx,
      tenantId,
      lots.map((l) => l.id),
    ),
  ]);

  /**
   * Feed, from slice 2, and it is the same read the feed report makes.
   *
   * Deliberately not a cheaper approximation: an advisor asked "is this lot
   * costing more than the last one" must see the figure the screen shows, or the
   * two will disagree in front of the person who asked. The window is
   * everything, because a lot is judged over its life.
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
    /**
     * THE REAL BREEDING, not the superseded column.
     *
     * The advisor is asked feed-conversion questions, and Cornish Cross against
     * a slow-growing bird is the difference between a six-week bird and a
     * twelve-week one. A half-and-half cross reads as one — and the unknown
     * share travels with it, so an answer never sounds more certain about an
     * animal's breeding than the records are.
     */
    const composition = resolveComposition(lot.id, pedigrees);
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
      // Empty when nothing is known, which the digest prints as an omission
      // rather than as a word. The superseded free-text column used to stand in
      // here and no longer exists.
      breed:
        composition.source === "unknown"
          ? ""
          : formatComposition(composition, breedLabel),
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
