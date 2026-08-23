import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  addIdentifier,
  addLotToFeedGroup,
  checkedDaysSince,
  closeFeedGroup,
  createFeedGroup,
  endFeedGroupMembership,
  feedGroupMembers,
  feedReport,
  listFeedGroups,
  lastTreatmentOfProduct,
  listTreatmentsForLot,
  listWeightsForLot,
  toWeighIns,
  withdrawalByLot,
  checksOn,
  createLivestockLot,
  farmSnapshot,
  getLivestockLot,
  lastCheckedByLot,
  listChecksForLot,
  listIdentifiers,
  markRoundNormal,
  moveLotToZone,
  placeHead,
  recordDailyCheck,
  recordFeedDraw,
  deleteTreatment,
  recordTreatment,
  updateTreatment,
  deleteWeight,
  recordWeight,
  removeHead,
  retireIdentifier,
  splitLivestockLot,
  updateLivestockLot,
  updateWeight,
  type LivestockCtx,
} from "../src/packs/livestock/ops";
import {
  consumedCostByLot,
  createItem,
  issueStock,
  movementKindsForLots,
  movementRowsForItem,
  receiveStock,
  LOT_DIMENSION,
} from "../src/packs/inventory/ops";
import { balanceByItem, balanceOfLot } from "../src/packs/inventory/core/balances";
import {
  createParcel,
  createZone,
  lastHauledOn,
  currentZoneForOccupants,
  occupantsInStructures,
  restByZone,
} from "../src/packs/land/ops";
import { summariseHead, mortalityRate } from "../src/packs/livestock/core/herd";
import { gainBetween } from "../src/packs/livestock/core/weights";
import { formatSnapshot } from "../src/packs/livestock/core/digest";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * `livestock` ops — and what these actually certify is the PACK MODEL.
 *
 * This pack owns two tables. The lot, the head ledger and the split are
 * `inventory`'s; occupancy is `land`'s. So the tests worth writing are not
 * "does it store a species" but **"does composing three packs produce one
 * coherent record"** — that a split still balances when livestock drives it,
 * that head events land in inventory's ledger, and that putting a herd on a
 * paddock starts land's rest clock.
 *
 * If those hold, the model earned what it cost. If they do not, the profile
 * needed six tables here instead of two.
 */
d("livestock ops", () => {
  const STAMP = `lsops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId: string;
  let itemId: string;
  let zoneId: string;
  let parcelId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const ctx = (): LivestockCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const staffCtx = (): LivestockCtx => ({ tenantId, userId: STAFF, role: "staff" });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Livestock Ops",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
    });
    // Built through the real ops, because the composition is the thing under
    // test — an animal item stocked in HEAD, and a paddock to put them on.
    itemId = (
      await asOwner((tx) =>
        createItem(tx, ctx(), {
          name: "Broiler chicks",
          stockingUnit: "head",
          itemKind: "livestock",
        }),
      )
    ).id;
    parcelId = (
      await asOwner((tx) =>
        createParcel(tx, ctx(), { name: "Home Farm", areaAcres: 100 }),
      )
    ).id;
    zoneId = (
      await asOwner((tx) =>
        createZone(tx, ctx(), {
          parcelId,
          name: "North Pasture",
          areaAcres: 10,
        }),
      )
    ).id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  const newLot = (code: string, species = "poultry") =>
    asOwner((tx) =>
      createLivestockLot(tx, ctx(), {
        itemId,
        code,
        species,
        sex: "mixed",
        breed: "Cornish Cross",
        bornOn: "2026-04-15",
      }),
    );

  // ---- the composition ---------------------------------------------------

  it("creates ONE record across three packs, in one transaction", async () => {
    const { lot, inventoryLotId } = await newLot("B-1");

    // inventory owns the spine...
    const invLot = await asOwner((tx) =>
      tx.query.inventoryLots.findFirst({
        where: eq(schema.inventoryLots.id, inventoryLotId),
      }),
    );
    expect(invLot?.code).toBe("B-1");

    // ...livestock owns only the biology...
    expect(lot.species).toBe("poultry");
    expect(lot.breed).toBe("Cornish Cross");
    expect(lot.inventoryLotId).toBe(inventoryLotId);

    // ...and the cost object came from inventory, not from here. Livestock
    // never touches dimension_members.
    const members = await asOwner((tx) =>
      tx.query.dimensionMembers.findMany({
        where: and(
          eq(schema.dimensionMembers.tenantId, tenantId),
          eq(schema.dimensionMembers.dimensionType, LOT_DIMENSION),
        ),
      }),
    );
    expect(members.some((m) => m.packEntityId === inventoryLotId)).toBe(true);
    expect(members.some((m) => m.packEntityId === lot.id)).toBe(false);
  });

  it("rolls all three back together when one fails", async () => {
    let inventoryLotId: string | undefined;
    await expect(
      asOwner(async (tx) => {
        const created = await createLivestockLot(tx, ctx(), {
          itemId,
          code: "DOOMED",
          species: "poultry",
        });
        inventoryLotId = created.inventoryLotId;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const orphan = await asOwner((tx) =>
      tx.query.inventoryLots.findFirst({
        where: eq(schema.inventoryLots.id, inventoryLotId!),
      }),
    );
    // No half-record: no inventory lot, and therefore no cost object either.
    expect(orphan).toBeUndefined();
  });

  // ---- what the animals are counted as -----------------------------------

  it("creates the stock line as part of starting the lot", async () => {
    // The founder hit this on production: the only item stocked in head was
    // "Broiler chicks", so the picker offered to count CATTLE as broiler
    // chicks, and the only way out was to leave for the Inventory module.
    const created = await asOwner((tx) =>
      createLivestockLot(tx, ctx(), {
        newItemName: "Beef cattle",
        code: "COW-1",
        species: "cattle",
      }),
    );

    const lot = await asOwner((tx) =>
      tx.query.inventoryLots.findFirst({
        where: eq(schema.inventoryLots.id, created.inventoryLotId),
      }),
    );
    const item = await asOwner((tx) =>
      tx.query.inventoryItems.findFirst({
        where: eq(schema.inventoryItems.id, lot!.itemId),
      }),
    );
    expect(item?.name).toBe("Beef cattle");
    // Head, always. An item stocked in pounds could not carry a head count.
    expect(item?.stockingUnit).toBe("head");
    expect(item?.itemKind).toBe("livestock");

    // And it is a cost object, because inventory made it one — livestock still
    // never touches dimension_members.
    const members = await asOwner((tx) =>
      tx.query.dimensionMembers.findMany({
        where: and(
          eq(schema.dimensionMembers.tenantId, tenantId),
          eq(schema.dimensionMembers.dimensionType, LOT_DIMENSION),
        ),
      }),
    );
    expect(members.some((m) => m.packEntityId === created.inventoryLotId)).toBe(
      true,
    );
  });

  it("refuses both an item and a new name, and refuses neither", async () => {
    // Both would leave it ambiguous which stock line the head landed in.
    // Neither is the caller forgetting the field, not meaning "any".
    await expect(
      asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId,
          newItemName: "Beef cattle",
          code: "AMBIGUOUS",
          species: "cattle",
        }),
      ),
    ).rejects.toMatchObject({ code: "ITEM_REQUIRED" });

    await expect(
      asOwner((tx) =>
        createLivestockLot(tx, ctx(), { code: "NOTHING", species: "cattle" }),
      ),
    ).rejects.toMatchObject({ code: "ITEM_REQUIRED" });
  });

  it("rolls the new stock line back with everything else", async () => {
    // The item is created inside the same transaction, so a lot that fails
    // must not leave a stock line and a cost object nobody asked for.
    await expect(
      asOwner(async (tx) => {
        await createLivestockLot(tx, ctx(), {
          newItemName: "Doomed herd",
          code: "DOOMED-2",
          species: "cattle",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const items = await asOwner((tx) =>
      tx.query.inventoryItems.findMany({
        where: eq(schema.inventoryItems.tenantId, tenantId),
      }),
    );
    expect(items.map((i) => i.name)).not.toContain("Doomed herd");
  });

  // ---- the head ledger is inventory's ------------------------------------

  it("head events land in INVENTORY's ledger, stamped as livestock's", async () => {
    const { lot, inventoryLotId } = await newLot("B-2");
    await asOwner((tx) =>
      placeHead(tx, ctx(), {
        itemId,
        inventoryLotId,
        head: 210,
        occurredOn: "2026-04-15",
      }),
    );
    await asOwner((tx) =>
      removeHead(tx, ctx(), {
        itemId,
        inventoryLotId,
        head: 4,
        reason: "death",
        occurredOn: "2026-04-20",
      }),
    );

    const movements = await asOwner((tx) =>
      tx.query.inventoryMovements.findMany({
        where: and(
          eq(schema.inventoryMovements.tenantId, tenantId),
          eq(schema.inventoryMovements.lotId, inventoryLotId),
        ),
      }),
    );
    expect(movements).toHaveLength(2);
    // Attributable without being a separate ledger.
    expect(movements.every((m) => m.extensionSlug === "livestock")).toBe(true);

    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, itemId));
    expect(balanceOfLot(rows, inventoryLotId)).toBe(206);
    expect(lot.id).toBeTruthy();
  });

  it("mortality is a query over that ledger, not a stored field", async () => {
    const { inventoryLotId } = await newLot("B-3");
    await asOwner((tx) =>
      placeHead(tx, ctx(), {
        itemId,
        inventoryLotId,
        head: 100,
        occurredOn: "2026-04-15",
      }),
    );
    for (const n of [3, 2]) {
      await asOwner((tx) =>
        removeHead(tx, ctx(), {
          itemId,
          inventoryLotId,
          head: n,
          reason: "death",
          occurredOn: "2026-04-20",
        }),
      );
    }

    const movements = await asOwner((tx) =>
      tx.query.inventoryMovements.findMany({
        where: and(
          eq(schema.inventoryMovements.tenantId, tenantId),
          eq(schema.inventoryMovements.lotId, inventoryLotId),
        ),
      }),
    );
    const summary = summariseHead(
      movements.map((m) => ({ movementKind: m.movementKind, quantity: m.quantity })),
    );
    expect(summary.intake).toBe(100);
    expect(summary.died).toBe(5);
    expect(summary.balance).toBe(95);
    expect(mortalityRate(summary)).toBeCloseTo(0.05, 5);
  });

  // ---- the split, driven from livestock ----------------------------------

  it("a split still BALANCES when livestock drives it, and carries the biology", async () => {
    const { lot, inventoryLotId } = await newLot("BATCH-A");
    await asOwner((tx) =>
      placeHead(tx, ctx(), {
        itemId,
        inventoryLotId,
        head: 210,
        occurredOn: "2026-04-15",
      }),
    );

    const pen = await asOwner((tx) =>
      splitLivestockLot(tx, ctx(), {
        livestockLotId: lot.id,
        head: 70,
        newCode: "PEN-1",
        occurredOn: "2026-04-16",
      }),
    );

    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, itemId));
    expect(balanceOfLot(rows, inventoryLotId)).toBe(140);
    expect(balanceOfLot(rows, pen.inventoryLotId)).toBe(70);

    // Splitting a batch of Cornish Cross does not produce a batch of
    // something else.
    expect(pen.lot.species).toBe(lot.species);
    expect(pen.lot.breed).toBe("Cornish Cross");
    expect(pen.lot.bornOn).toBe("2026-04-15");

    // And the child is a real animal lot, not an anonymous quantity.
    const child = await asOwner((tx) => getLivestockLot(tx, tenantId, pen.lot.id));
    expect(child).not.toBeNull();
  });

  // ---- occupancy is land's ----------------------------------------------

  it("putting a herd on a paddock writes LAND's table and starts its clock", async () => {
    // The seam land slice 1 was built for, with its first real caller.
    const { lot, inventoryLotId } = await newLot("GRAZERS", "cattle");
    await asOwner((tx) =>
      placeHead(tx, ctx(), {
        itemId,
        inventoryLotId,
        head: 10,
        occurredOn: "2026-08-01",
      }),
    );
    await asOwner((tx) =>
      moveLotToZone(tx, ctx(), {
        livestockLotId: lot.id,
        zoneId,
        startedOn: "2026-08-01",
        endedOn: "2026-08-05",
        areaAcres: 0.4,
      }),
    );

    const occupancy = await asOwner((tx) =>
      tx.query.landOccupancy.findMany({
        where: and(
          eq(schema.landOccupancy.tenantId, tenantId),
          eq(schema.landOccupancy.zoneId, zoneId),
        ),
      }),
    );
    expect(occupancy).toHaveLength(1);
    expect(occupancy[0].extensionSlug).toBe("livestock");
    expect(occupancy[0].occupantType).toBe("lot");
    // The reference is the INVENTORY lot — the spine, and the same identity
    // dimension_members points at — so it survives this pack being switched off.
    expect(occupancy[0].occupantId).toBe(inventoryLotId);
    // The label is a COPY, so a rest report never joins into livestock.
    expect(occupancy[0].occupantLabel).toContain("GRAZERS");
    // The strip decision, end to end: 0.4 of a 10-acre paddock, no new place.
    expect(occupancy[0].areaAcres).toBe(0.4);

    // And land's rest clock is now running, computed from a record livestock
    // made without land knowing what a lot is.
    const rest = await asOwner((tx) =>
      restByZone(tx, tenantId, [zoneId], "2026-08-15"),
    );
    expect(rest.get(zoneId)?.status).toBe("resting");
    expect(rest.get(zoneId)?.restDays).toBe(10);
  });

  it("rotates a lot between paddocks in ONE act", async () => {
    // The daily loop of a rotational farm, and it used to be impossible from
    // this side: `startOccupancy` refused a second open stay, so moving meant
    // going to Land, finding the paddock they were on, moving off, coming
    // back, and moving on. Five clicks across two modules, every move.
    // Found by driving it, 2026-08-16.
    // Its own two paddocks, not the shared fixture: the assertions are about
    // rest, and rest is a fold over every stay a zone has ever had.
    const [first, second] = await Promise.all([
      asOwner((tx) =>
        createZone(tx, ctx(), { parcelId, name: "Rotate A", areaAcres: 8 }),
      ),
      asOwner((tx) =>
        createZone(tx, ctx(), { parcelId, name: "Rotate B", areaAcres: 8 }),
      ),
    ]);

    const { lot, inventoryLotId } = await newLot("ROTATE", "cattle");
    await asOwner((tx) =>
      moveLotToZone(tx, ctx(), {
        livestockLotId: lot.id,
        zoneId: first.id,
        startedOn: "2026-05-01",
      }),
    );
    const result = await asOwner((tx) =>
      moveLotToZone(tx, ctx(), {
        livestockLotId: lot.id,
        zoneId: second.id,
        startedOn: "2026-05-04",
      }),
    );

    // Off the first the DAY BEFORE — the inclusive bound, so the 4th belongs
    // to the new paddock alone and three days of grazing is three days.
    expect(result.movedOff).toEqual({ zoneId: first.id, endedOn: "2026-05-03" });

    const places = await asOwner((tx) =>
      currentZoneForOccupants(tx, tenantId, "livestock", [inventoryLotId], "2026-05-06"),
    );
    expect(places.get(inventoryLotId)?.zoneName).toBe("Rotate B");

    const rest = await asOwner((tx) =>
      restByZone(tx, tenantId, [first.id, second.id], "2026-05-06"),
    );
    expect(rest.get(first.id)?.status).toBe("resting");
    expect(rest.get(first.id)?.grazingDays).toBe(3);
    expect(rest.get(first.id)?.restDays).toBe(3);
    expect(rest.get(second.id)?.status).toBe("occupied");
  });

  it("says where they are TODAY, not where they are booked", async () => {
    // Found on production the day the one-act move shipped. After a move dated
    // ahead, the OLD stay is closed on a date that has not arrived and the NEW
    // one has not started — so "the stay with no end date" was the wrong
    // answer. Livestock said Creek Paddock while Land said Creek Paddock was
    // resting: two pages, the same rows, different answers.
    const [here, next] = await Promise.all([
      asOwner((tx) =>
        createZone(tx, ctx(), { parcelId, name: "Booked A", areaAcres: 5 }),
      ),
      asOwner((tx) =>
        createZone(tx, ctx(), { parcelId, name: "Booked B", areaAcres: 5 }),
      ),
    ]);
    const { lot, inventoryLotId } = await newLot("BOOKED", "cattle");
    await asOwner((tx) =>
      moveLotToZone(tx, ctx(), {
        livestockLotId: lot.id,
        zoneId: here.id,
        startedOn: "2026-06-01",
      }),
    );
    await asOwner((tx) =>
      moveLotToZone(tx, ctx(), {
        livestockLotId: lot.id,
        zoneId: next.id,
        startedOn: "2026-06-20",
      }),
    );

    const where = (today: string) =>
      asOwner((tx) =>
        currentZoneForOccupants(tx, tenantId, "livestock", [inventoryLotId], today),
      ).then((m) => m.get(inventoryLotId)?.zoneName ?? null);

    // Still on the first, even though its stay is closed — on the 19th.
    expect(await where("2026-06-10")).toBe("Booked A");
    expect(await where("2026-06-19")).toBe("Booked A");
    // And on the day itself, the new one. Nothing is entered to make it flip.
    expect(await where("2026-06-20")).toBe("Booked B");
    // Before any of it, they were nowhere.
    expect(await where("2026-05-01")).toBeNull();
  });

  it("records the STRUCTURE they are in, and null means loose", async () => {
    // The founder's own distinction: cattle roam a paddock, chickens live in a
    // pen that sits on it. Both are ordinary, so null is a real answer.
    const penId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({ tenantId, kind: "chicken_tractor", name: "Pen 3" })
        .returning();
      return rows[0].id;
    });

    const penned = await newLot("PENNED", "poultry");
    await asOwner((tx) =>
      moveLotToZone(tx, ctx(), {
        livestockLotId: penned.lot.id,
        zoneId,
        startedOn: "2026-08-10",
        structureAssetId: penId,
      }),
    );

    const loose = await newLot("LOOSE", "cattle");
    await asOwner((tx) =>
      moveLotToZone(tx, ctx(), {
        livestockLotId: loose.lot.id,
        zoneId,
        startedOn: "2026-08-10",
      }),
    );

    const places = await asOwner((tx) =>
      currentZoneForOccupants(
        tx,
        tenantId,
        "livestock",
        [penned.inventoryLotId, loose.inventoryLotId],
        "2026-08-10",
      ),
    );
    expect(places.get(penned.inventoryLotId)?.structureName).toBe("Pen 3");
    // Loose animals are still ON the zone — the LEFT join is what stops an
    // inner join silently hiding every herd that is not in a structure.
    expect(places.get(loose.inventoryLotId)?.zoneName).toBe("North Pasture");
    expect(places.get(loose.inventoryLotId)?.structureName).toBeNull();

    // And "what is in Pen 3" is answerable from land, without joining into
    // livestock at all — the label is a copy.
    const inPen = await asOwner((tx) =>
      occupantsInStructures(tx, tenantId, [penId], "2026-08-10"),
    );
    expect(inPen.get(penId)?.[0].occupantLabel).toContain("PENNED");
    expect(inPen.get(penId)?.[0].zoneName).toBe("North Pasture");
  });

  // ---- identifiers -------------------------------------------------------

  it("keeps many identifiers, and retiring one is not a delete", async () => {
    // Tags are lost and replaced while the official ID must persist, and the
    // official one carries the chain onto processor paperwork.
    const { lot } = await newLot("COW-47", "cattle");
    const visual = await asOwner((tx) =>
      addIdentifier(tx, ctx(), {
        livestockLotId: lot.id,
        identifierKind: "visual",
        value: "47",
        appliedOn: "2026-04-15",
      }),
    );
    await asOwner((tx) =>
      addIdentifier(tx, ctx(), {
        livestockLotId: lot.id,
        identifierKind: "official",
        value: "USA-840-1234",
        appliedOn: "2026-04-15",
      }),
    );

    await asOwner((tx) => retireIdentifier(tx, ctx(), visual.id, "2026-07-01"));

    const all = await asOwner((tx) => listIdentifiers(tx, tenantId, lot.id));
    expect(all).toHaveLength(2);
    expect(all.find((i) => i.id === visual.id)?.removedOn).toBe("2026-07-01");
    // The official one is untouched, which is the whole reason they are
    // separate rows rather than one column.
    expect(all.find((i) => i.identifierKind === "official")?.removedOn).toBeNull();
  });

  // ---- validation and role ----------------------------------------------

  it("normalises the case of a species rather than refusing it", async () => {
    // Same as `assets.kind` and `land_zone_uses.use`: lowercase, then
    // validate. Somebody typing "Cattle" meant cattle.
    const { lot } = await asOwner((tx) =>
      createLivestockLot(tx, ctx(), { itemId, code: "CASE-1", species: "Cattle" }),
    );
    expect(lot.species).toBe("cattle");
  });

  it("refuses a malformed species and an invented sex", async () => {
    await expect(
      asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId,
          code: "X",
          species: "beef cattle",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_SPECIES" });
    await expect(
      asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId,
          code: "Y",
          species: "cattle",
          sex: "unknown",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_SEX" });
  });

  // ---- who may write -----------------------------------------------------

  it("STAFF may record chores: place, lose, move and tag", async () => {
    // Settled 2026-08-15. Recording that four birds died is done by whoever is
    // standing in the pen, and at 10× that person is not the owner — a daily
    // log only the owner can use is built for the wrong person.
    const { lot, inventoryLotId } = await newLot("STAFF-CHORES");

    await asOwner((tx) =>
      placeHead(tx, staffCtx(), {
        itemId,
        inventoryLotId,
        head: 50,
        occurredOn: "2026-08-01",
      }),
    );
    await asOwner((tx) =>
      removeHead(tx, staffCtx(), {
        itemId,
        inventoryLotId,
        head: 2,
        reason: "death",
        occurredOn: "2026-08-02",
      }),
    );
    await asOwner((tx) =>
      moveLotToZone(tx, staffCtx(), {
        livestockLotId: lot.id,
        zoneId,
        startedOn: "2026-08-03",
        endedOn: "2026-08-04",
      }),
    );
    const tag = await asOwner((tx) =>
      addIdentifier(tx, staffCtx(), {
        livestockLotId: lot.id,
        identifierKind: "visual",
        value: "S-1",
      }),
    );
    await asOwner((tx) => retireIdentifier(tx, staffCtx(), tag.id, "2026-08-05"));

    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, itemId));
    expect(balanceOfLot(rows, inventoryLotId)).toBe(48);
  });

  it("STAFF may not make decisions: create, edit or split a lot", async () => {
    // Creating a lot creates a cost object, and `upsertDimensionMember`
    // requires the owner role — the write would succeed while its cost object
    // did not, leaving something no report can group by.
    const { lot, inventoryLotId } = await newLot("STAFF-DENIED");
    await asOwner((tx) =>
      placeHead(tx, ctx(), {
        itemId,
        inventoryLotId,
        head: 10,
        occurredOn: "2026-08-01",
      }),
    );

    await expect(
      asOwner((tx) =>
        createLivestockLot(tx, staffCtx(), {
          itemId,
          code: "NOPE",
          species: "poultry",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      asOwner((tx) =>
        updateLivestockLot(tx, staffCtx(), lot.id, { breed: "Something else" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Splitting is a chore in spirit and a decision in the books. Kept with the
    // owner deliberately: it happens at batch placement, a handful of times a
    // season, not thirty times a day.
    await expect(
      asOwner((tx) =>
        splitLivestockLot(tx, staffCtx(), {
          livestockLotId: lot.id,
          head: 5,
          newCode: "NOPE-PEN",
          occurredOn: "2026-08-02",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an EXPERT is not an owner here either", async () => {
    // The platform's own bookkeeper reviews books; they do not decide that the
    // farm has bought a parcel. They may still record, like any member.
    const expertCtx = (): LivestockCtx => ({
      tenantId,
      userId: OWNER,
      role: "expert",
    });
    await expect(
      asOwner((tx) =>
        createLivestockLot(tx, expertCtx(), {
          itemId,
          code: "EXPERT",
          species: "poultry",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the whole item total is unchanged by everything above", async () => {
    // The property that makes a head count reconcile with its own history.
    // Splits and merges move head between lots; only placements and removals
    // change the total, and every one of those was deliberate.
    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, itemId));
    const total = balanceByItem(rows).get(itemId);
    // 210 - 4 (B-2) + 100 - 5 (B-3) + 210 (BATCH-A, split internally) + 10
    // (GRAZERS) + 50 - 2 (STAFF-CHORES) + 10 (STAFF-DENIED, nothing denied
    // moved head).
    expect(total).toBe(579);
  });

  // ---- the daily round (slice 1) -----------------------------------------

  /**
   * A SEPARATE ITEM, deliberately. The head these tests place and lose must not
   * change the item total the test above pins, or the two suites would be
   * coupled through a number and the order they run in would matter.
   */
  describe("the daily round", () => {
    let roundItemId: string;
    let roundLotId: string;
    let roundInventoryLotId: string;

    beforeAll(async () => {
      roundItemId = (
        await asOwner((tx) =>
          createItem(tx, ctx(), {
            name: "Round birds",
            stockingUnit: "head",
            itemKind: "livestock",
          }),
        )
      ).id;
      const made = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: roundItemId,
          code: "ROUND-1",
          species: "poultry",
        }),
      );
      roundLotId = made.lot.id;
      roundInventoryLotId = made.inventoryLotId;
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: roundItemId,
          inventoryLotId: roundInventoryLotId,
          head: 70,
          occurredOn: "2026-08-01",
        }),
      );
    });

    it("records that somebody looked, on a day nothing happened", async () => {
      // THE ROW IS THE CHECK. This is the fact no ledger can carry, because a
      // day when nothing happened leaves a ledger empty — and empty is
      // indistinguishable from nobody having walked the pens.
      const log = await asOwner((tx) =>
        recordDailyCheck(tx, ctx(), {
          livestockLotId: roundLotId,
          loggedOn: "2026-08-10",
        }),
      );
      expect(log.status).toBe("normal");
      expect(log.loggedOn).toBe("2026-08-10");

      const rows = await asOwner((tx) =>
        movementRowsForItem(tx, tenantId, roundItemId),
      );
      // Nothing moved. A normal day is not a head event.
      expect(balanceOfLot(rows, roundInventoryLotId)).toBe(70);
    });

    it("a loss entered on the round lands in INVENTORY's ledger, not here", async () => {
      const log = await asOwner((tx) =>
        recordDailyCheck(tx, ctx(), {
          livestockLotId: roundLotId,
          loggedOn: "2026-08-11",
          loss: { head: 4, reason: "death" },
          notes: "Heat, back corner",
        }),
      );
      // The check itself carries no count — only that it was worth noting.
      expect(log.status).toBe("attention");
      expect(log.notes).toBe("Heat, back corner");
      expect(Object.keys(log)).not.toContain("deaths");

      const rows = await asOwner((tx) =>
        movementRowsForItem(tx, tenantId, roundItemId),
      );
      expect(balanceOfLot(rows, roundInventoryLotId)).toBe(66);

      // And it counts as mortality, which is the number the enterprise is
      // judged on — 4 of 70.
      const kinds = await asOwner((tx) =>
        movementKindsForLots(tx, tenantId, [roundInventoryLotId]),
      );
      const summary = summariseHead(kinds.get(roundInventoryLotId) ?? []);
      expect(summary.died).toBe(4);
      expect(mortalityRate(summary)).toBeCloseTo(4 / 70, 5);
    });

    it("a loss forces `attention`, whatever the caller claims", async () => {
      // Four dead birds against a "normal" check is a contradiction, and the
      // ops layer is where it has to be impossible rather than the screen.
      const log = await asOwner((tx) =>
        recordDailyCheck(tx, ctx(), {
          livestockLotId: roundLotId,
          loggedOn: "2026-08-12",
          status: "normal",
          loss: { head: 1, reason: "death" },
        }),
      );
      expect(log.status).toBe("attention");
    });

    it("checking twice in a day UPDATES rather than adding a second fact", async () => {
      await asOwner((tx) =>
        recordDailyCheck(tx, ctx(), {
          livestockLotId: roundLotId,
          loggedOn: "2026-08-13",
          notes: "Left hind swollen",
          status: "attention",
        }),
      );
      const second = await asOwner((tx) =>
        recordDailyCheck(tx, ctx(), {
          livestockLotId: roundLotId,
          loggedOn: "2026-08-13",
          status: "normal",
        }),
      );
      // The note SURVIVES a later empty confirmation. Otherwise the evening
      // walk-past would erase the morning's observation.
      expect(second.notes).toBe("Left hind swollen");
      expect(second.status).toBe("normal");

      const all = await asOwner((tx) =>
        listChecksForLot(tx, tenantId, roundLotId),
      );
      expect(all.filter((c) => c.loggedOn === "2026-08-13")).toHaveLength(1);
    });

    it("the one-tap round marks only what has NOT been looked at", async () => {
      const other = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: roundItemId,
          code: "ROUND-2",
          species: "poultry",
        }),
      );
      // ROUND-1 is flagged first; the button must not touch it.
      await asOwner((tx) =>
        recordDailyCheck(tx, ctx(), {
          livestockLotId: roundLotId,
          loggedOn: "2026-08-14",
          status: "attention",
          notes: "Watch the water",
        }),
      );

      const recorded = await asOwner((tx) =>
        markRoundNormal(tx, ctx(), {
          livestockLotIds: [roundLotId, other.lot.id],
          loggedOn: "2026-08-14",
        }),
      );
      // One insert, not two: the conflict clause is what makes the button safe
      // to tap after entering an exception.
      expect(recorded).toHaveLength(1);
      expect(recorded[0].livestockLotId).toBe(other.lot.id);

      const checks = await asOwner((tx) => checksOn(tx, tenantId, "2026-08-14"));
      expect(checks.get(roundLotId)?.status).toBe("attention");
      expect(checks.get(roundLotId)?.notes).toBe("Watch the water");
      expect(checks.get(other.lot.id)?.status).toBe("normal");
    });

    it("tapping the round twice records nothing the second time", async () => {
      await asOwner((tx) =>
        markRoundNormal(tx, ctx(), {
          livestockLotIds: [roundLotId],
          loggedOn: "2026-08-15",
        }),
      );
      const again = await asOwner((tx) =>
        markRoundNormal(tx, ctx(), {
          livestockLotIds: [roundLotId],
          loggedOn: "2026-08-15",
        }),
      );
      expect(again).toHaveLength(0);
    });

    it("ignores a lot id that is not this tenant's", async () => {
      // The ids arrive from a form. The composite FK would refuse a foreign one
      // anyway, but with an error nobody could read.
      const recorded = await asOwner((tx) =>
        markRoundNormal(tx, ctx(), {
          livestockLotIds: ["00000000-0000-0000-0000-000000000000"],
          loggedOn: "2026-08-16",
        }),
      );
      expect(recorded).toEqual([]);
    });

    it("STAFF may walk the round — this is the chore the slice exists for", async () => {
      // Owner-only here would mean the check that separates "zero died" from
      // "didn't check" simply never gets recorded. See src/lib/packs/authorize.ts.
      const log = await withTenant(
        tenantId,
        (tx) =>
          recordDailyCheck(tx, staffCtx(), {
            livestockLotId: roundLotId,
            loggedOn: "2026-08-17",
            loss: { head: 1, reason: "death" },
          }),
        { role: "staff", userId: STAFF },
      );
      expect(log.status).toBe("attention");
      expect(log.recordedBy).toBe(STAFF);
    });

    it("reports when each lot was last looked at", async () => {
      const last = await asOwner((tx) => lastCheckedByLot(tx, tenantId));
      expect(last.get(roundLotId)).toBe("2026-08-17");
    });

    it("gives the distinct days the round was walked, for the streak", async () => {
      const days = await asOwner((tx) =>
        checkedDaysSince(tx, tenantId, "2026-08-13"),
      );
      // Two lots were checked on the 14th; that is ONE day of habit, not two.
      expect([...days].sort()).toEqual([
        "2026-08-13",
        "2026-08-14",
        "2026-08-15",
        "2026-08-17",
      ]);
    });

    it("refuses a check against a lot that does not exist", async () => {
      await expect(
        asOwner((tx) =>
          recordDailyCheck(tx, ctx(), {
            livestockLotId: "00000000-0000-0000-0000-000000000000",
            loggedOn: "2026-08-18",
          }),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ---- the advisory digest (slice 1b) ------------------------------------

  /**
   * `farmSnapshot` is the advisory layer's whole differentiation: an answer
   * anchored to this farm rather than to husbandry in general. It is also the
   * fourth thing in this pack that reads across all three, so what is certified
   * here is the composition — head and losses from `inventory`, the paddock
   * from `land`, the check from this pack's own slice 1a.
   */
  describe("the farm snapshot", () => {
    let snapItemId: string;
    let snapLotId: string;

    beforeAll(async () => {
      snapItemId = (
        await asOwner((tx) =>
          createItem(tx, ctx(), {
            name: "Snapshot cattle",
            stockingUnit: "head",
            itemKind: "livestock",
          }),
        )
      ).id;
      const made = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: snapItemId,
          code: "SNAP-1",
          species: "cattle",
          breed: "Angus cross",
          bornOn: "2026-02-01",
        }),
      );
      snapLotId = made.lot.id;
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: snapItemId,
          inventoryLotId: made.inventoryLotId,
          head: 10,
          occurredOn: "2026-02-01",
        }),
      );
      await asOwner((tx) =>
        removeHead(tx, ctx(), {
          itemId: snapItemId,
          inventoryLotId: made.inventoryLotId,
          head: 1,
          reason: "death",
          occurredOn: "2026-06-01",
        }),
      );
      await asOwner((tx) =>
        moveLotToZone(tx, ctx(), {
          livestockLotId: snapLotId,
          zoneId,
          startedOn: "2026-08-01",
        }),
      );
      await asOwner((tx) =>
        recordDailyCheck(tx, ctx(), {
          livestockLotId: snapLotId,
          loggedOn: "2026-08-19",
        }),
      );
    });

    it("anchors on this farm's own numbers, gathered across three packs", async () => {
      const snapshot = await asOwner((tx) =>
        farmSnapshot(tx, tenantId, {
          today: "2026-08-19",
          species: ["cattle", "swine", "poultry"],
        }),
      );
      const snap = snapshot.lots.find((l) => l.code === "SNAP-1");
      expect(snap).toBeDefined();
      // inventory's ledger...
      expect(snap!.head).toBe(9);
      expect(snap!.intake).toBe(10);
      expect(snap!.died).toBe(1);
      // ...this pack's biology...
      expect(snap!.species).toBe("cattle");
      expect(snap!.breed).toBe("Angus cross");
      expect(snap!.ageDays).toBe(199);
      // ...land's occupancy, including WHEN the stay began, which is what
      // makes "how long have they been on this ground" answerable...
      expect(snap!.where).toBe("North Pasture");
      expect(snap!.whereSince).toBe("2026-08-01");
      // ...the loss with its date and the age it happened at, because timing
      // implies cause...
      expect(snap!.losses).toEqual([
        { on: "2026-06-01", ageDays: 120, head: 1 },
      ]);
      // ...and slice 1a's check.
      expect(snap!.lastCheckedOn).toBe("2026-08-19");
      expect(snapshot.species).toEqual(["cattle", "swine", "poultry"]);
    });

    it("carries the ground and its rest, which is what 'where next' needs", async () => {
      const snapshot = await asOwner((tx) =>
        farmSnapshot(tx, tenantId, { today: "2026-08-19" }),
      );
      const zone = snapshot.zones.find((z) => z.name === "North Pasture");
      expect(zone).toBeDefined();
      expect(zone!.parcel).toBe("Home Farm");
      // Somebody is standing on it, so it is occupied rather than rested — and
      // "occupied" and "rested 0 days" are different facts.
      expect(zone!.status).toBe("occupied");
      expect(zone!.restDays).toBeNull();
    });

    it("lists only stock there is some of", async () => {
      const snapshot = await asOwner((tx) =>
        farmSnapshot(tx, tenantId, { today: "2026-08-19" }),
      );
      const cattle = snapshot.stock.find((s) => s.name === "Snapshot cattle");
      expect(cattle).toEqual({ name: "Snapshot cattle", onHand: 9, unit: "head" });
      expect(snapshot.stock.every((s) => s.onHand !== 0)).toBe(true);
    });

    it("renders to a digest a person could check the answer against", async () => {
      // The format is deliberately human-readable: when an answer is wrong the
      // first question is "what did it actually know", and only this makes that
      // answerable.
      const snapshot = await asOwner((tx) =>
        farmSnapshot(tx, tenantId, { today: "2026-08-19" }),
      );
      const text = formatSnapshot(snapshot);
      expect(text).toContain("**SNAP-1** — cattle");
      expect(text).toContain("1 lost of 10 placed (10.0%)");
      expect(text).toContain("on North Pasture");
    });
  });
  // ---- slice 2: feed, and the allocation seam ----------------------------

  describe("feed and the shared-feeder allocation", () => {
    let feedItemId: string;
    let binId: string;
    let lotBig: { lot: { id: string }; inventoryLotId: string };
    let lotSmall: { lot: { id: string }; inventoryLotId: string };

    beforeAll(async () => {
      // A real feed item with a priced delivery behind it, so the rate every
      // draw is stamped at is a known 50 cents a pound rather than a guess.
      feedItemId = (
        await asOwner((tx) =>
          createItem(tx, ctx(), {
            name: "Grower crumble",
            stockingUnit: "lb",
            itemKind: "feed",
          }),
        )
      ).id;
      await asOwner((tx) =>
        receiveStock(tx, ctx(), {
          itemId: feedItemId,
          newLotCode: "FEED-DEL-1",
          quantity: 1000,
          costCents: 50_000,
          occurredOn: "2026-06-30",
        }),
      );

      lotBig = await newLot("FEED-A");
      lotSmall = await newLot("FEED-B");
      for (const [lot, head] of [
        [lotBig, 100],
        [lotSmall, 50],
      ] as const) {
        await asOwner((tx) =>
          placeHead(tx, ctx(), {
            itemId,
            inventoryLotId: lot.inventoryLotId,
            head,
            occurredOn: "2026-07-01",
          }),
        );
      }

      binId = (
        await asOwner((tx) => createFeedGroup(tx, ctx(), { name: "Broiler bin" }))
      ).id;
      for (const lot of [lotBig, lotSmall]) {
        await asOwner((tx) =>
          addLotToFeedGroup(tx, ctx(), {
            feedGroupId: binId,
            livestockLotId: lot.lot.id,
            startedOn: "2026-07-01",
          }),
        );
      }
    });

    it("A DRAW IS AN ORDINARY ISSUE — no second ledger, and no second cost", async () => {
      const before = await asOwner((tx) =>
        movementRowsForItem(tx, tenantId, feedItemId),
      );
      const { costCents } = await asOwner((tx) =>
        recordFeedDraw(tx, ctx(), {
          feedGroupId: binId,
          itemId: feedItemId,
          quantity: 200,
          occurredOn: "2026-07-10",
        }),
      );
      // Stamped at the average as it stands: 200 lb at 50 cents.
      expect(costCents).toBe(10_000);

      const after = await asOwner((tx) =>
        movementRowsForItem(tx, tenantId, feedItemId),
      );
      expect(balanceByItem(after).get(feedItemId)).toBe(
        balanceByItem(before).get(feedItemId)! - 200,
      );

      const movement = await asOwner((tx) =>
        tx.query.inventoryMovements.findFirst({
          where: and(
            eq(schema.inventoryMovements.itemId, feedItemId),
            eq(schema.inventoryMovements.occurredOn, "2026-07-10"),
          ),
        }),
      );
      // NOBODY IS NAMED, and that is what makes the cost allocated rather than
      // measured. The association lives in this pack's own table.
      expect(movement!.issuedToLotId).toBeNull();
      expect(movement!.extensionSlug).toBe("livestock");
      const draw = await asOwner((tx) =>
        tx.query.livestockFeedDraws.findFirst({
          where: eq(schema.livestockFeedDraws.inventoryMovementId, movement!.id),
        }),
      );
      expect(draw!.feedGroupId).toBe(binId);
    });

    it("spreads that draw by HEAD × DAYS, and the shares sum to the pot", async () => {
      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-07-01", to: "2026-07-10" }),
      );
      const bin = report.groups.find((g) => g.group.id === binId)!;
      expect(bin.drawnCents).toBe(10_000);

      const big = bin.members.find((m) => m.livestockLotId === lotBig.lot.id)!;
      const small = bin.members.find((m) => m.livestockLotId === lotSmall.lot.id)!;
      // Ten days on feed each; 100 head against 50.
      expect(big.daysOnFeed).toBe(10);
      expect(big.headDays).toBe(1000);
      expect(small.headDays).toBe(500);
      expect(big.shareCents + small.shareCents).toBe(10_000);
      expect(big.shareCents).toBe(6_667);
      expect(small.shareCents).toBe(3_333);
      // Nothing was left over, so nothing is reported unallocated.
      expect(bin.unallocatedCents).toBe(0);

      const row = report.lots.find((l) => l.code === "FEED-A")!;
      expect(row.allocatedCents).toBe(6_667);
      expect(row.provenance).toBe("allocated");
      expect(row.quantities).toEqual([{ unit: "lb", quantity: 133.3333 }]);
      // 6,667 cents over the 100 head placed.
      expect(row.centsPerHeadPlaced).toBe(67);
    });

    it("A LOT THAT JOINED LATE PAYS FOR THE DAYS IT WAS THERE", async () => {
      // The reason membership is date-ranged at all. A batch brooded on bagged
      // starter for a week is not on the bin for that week, and its head count
      // says nothing about when it went on.
      const lateBin = (
        await asOwner((tx) => createFeedGroup(tx, ctx(), { name: "Late bin" }))
      ).id;
      const early = await newLot("FEED-C");
      const late = await newLot("FEED-D");
      for (const entry of [early, late]) {
        await asOwner((tx) =>
          placeHead(tx, ctx(), {
            itemId,
            inventoryLotId: entry.inventoryLotId,
            head: 100,
            occurredOn: "2026-07-01",
          }),
        );
      }
      await asOwner((tx) =>
        addLotToFeedGroup(tx, ctx(), {
          feedGroupId: lateBin,
          livestockLotId: early.lot.id,
          startedOn: "2026-07-01",
        }),
      );
      await asOwner((tx) =>
        addLotToFeedGroup(tx, ctx(), {
          feedGroupId: lateBin,
          livestockLotId: late.lot.id,
          startedOn: "2026-07-06",
        }),
      );
      await asOwner((tx) =>
        recordFeedDraw(tx, ctx(), {
          feedGroupId: lateBin,
          itemId: feedItemId,
          quantity: 300,
          occurredOn: "2026-07-10",
        }),
      );

      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-07-01", to: "2026-07-10" }),
      );
      const bin = report.groups.find((g) => g.group.id === lateBin)!;
      const first = bin.members.find((m) => m.livestockLotId === early.lot.id)!;
      const second = bin.members.find((m) => m.livestockLotId === late.lot.id)!;
      expect(first.daysOnFeed).toBe(10);
      expect(second.daysOnFeed).toBe(5);
      expect(first.headDays).toBe(1000);
      expect(second.headDays).toBe(500);
      // Same head, two thirds against one third, purely because of five days.
      expect(first.shareCents).toBe(10_000);
      expect(second.shareCents).toBe(5_000);
    });

    it("REPORTS COST IT COULD NOT ALLOCATE rather than dropping it", async () => {
      // Feed drawn for a bin no lot is on is money the farm spent. A report that
      // silently lost it would add up while being wrong.
      const orphan = (
        await asOwner((tx) => createFeedGroup(tx, ctx(), { name: "Empty bin" }))
      ).id;
      await asOwner((tx) =>
        recordFeedDraw(tx, ctx(), {
          feedGroupId: orphan,
          itemId: feedItemId,
          quantity: 40,
          occurredOn: "2026-07-11",
        }),
      );
      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-07-01", to: "2026-07-11" }),
      );
      const bin = report.groups.find((g) => g.group.id === orphan)!;
      expect(bin.drawnCents).toBe(2_000);
      expect(bin.unallocatedCents).toBe(2_000);
      expect(bin.members).toEqual([]);
    });

    it("keeps MEASURED and ALLOCATED apart on a lot that has both", async () => {
      await asOwner((tx) =>
        issueStock(tx, ctx(), {
          itemId: feedItemId,
          quantity: 20,
          issuedToLotId: lotSmall.inventoryLotId,
          occurredOn: "2026-07-12",
        }),
      );
      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-07-01", to: "2026-07-12" }),
      );
      const row = report.lots.find((l) => l.code === "FEED-B")!;
      expect(row.measuredCents).toBe(1_000);
      expect(row.allocatedCents).toBeGreaterThan(0);
      expect(row.totalCents).toBe(row.measuredCents + row.allocatedCents);
      // The design's rule: same report, different confidence, and permanently
      // so — at 10× the bagged number becomes an allocated one.
      expect(row.provenance).toBe("mixed");
    });

    it("COUNTS UNPRICED FEED AS FED, NOT AS FREE", async () => {
      // Spent grain, surplus milk, garden culls, expired bakery. A model that
      // insists every input has a purchase price will be lied to.
      const wasteItemId = (
        await asOwner((tx) =>
          createItem(tx, ctx(), {
            name: "Spent brewery grain",
            stockingUnit: "lb",
            itemKind: "feed",
          }),
        )
      ).id;
      await asOwner((tx) =>
        receiveStock(tx, ctx(), {
          itemId: wasteItemId,
          quantity: 500,
          costCents: null,
          occurredOn: "2026-07-13",
        }),
      );
      await asOwner((tx) =>
        issueStock(tx, ctx(), {
          itemId: wasteItemId,
          quantity: 100,
          issuedToLotId: lotBig.inventoryLotId,
          occurredOn: "2026-07-13",
        }),
      );
      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-07-01", to: "2026-07-13" }),
      );
      const row = report.lots.find((l) => l.code === "FEED-A")!;
      expect(row.unpricedMovements).toBe(1);
      // The quantity is real and carried; the money is not invented.
      expect(
        row.quantities.find((q) => q.unit === "lb")!.quantity,
      ).toBeGreaterThan(200);
    });

    it("refuses to put the same lot on a feeder twice", async () => {
      // Two open memberships would count the same head twice in the basis and
      // hand that pen double its share of the bill.
      await expect(
        asOwner((tx) =>
          addLotToFeedGroup(tx, ctx(), {
            feedGroupId: binId,
            livestockLotId: lotBig.lot.id,
            startedOn: "2026-07-20",
          }),
        ),
      ).rejects.toThrow(/already on this feeder/);
    });

    it("refuses to take a lot off before it went on", async () => {
      const members = await asOwner((tx) =>
        feedGroupMembers(tx, tenantId, [binId]),
      );
      const member = members
        .get(binId)!
        .find((m) => m.livestockLotId === lotSmall.lot.id)!;
      await expect(
        asOwner((tx) =>
          endFeedGroupMembership(tx, ctx(), {
            memberId: member.id,
            endedOn: "2026-06-01",
          }),
        ),
      ).rejects.toThrow(/cannot come off before/);
    });

    it("stops the clock on the INCLUSIVE last day, like land's occupancy", async () => {
      const stopBin = (
        await asOwner((tx) => createFeedGroup(tx, ctx(), { name: "Stop bin" }))
      ).id;
      const entry = await newLot("FEED-E");
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId,
          inventoryLotId: entry.inventoryLotId,
          head: 10,
          occurredOn: "2026-07-01",
        }),
      );
      const member = await asOwner((tx) =>
        addLotToFeedGroup(tx, ctx(), {
          feedGroupId: stopBin,
          livestockLotId: entry.lot.id,
          startedOn: "2026-07-01",
        }),
      );
      await asOwner((tx) =>
        endFeedGroupMembership(tx, ctx(), {
          memberId: member.id,
          endedOn: "2026-07-03",
        }),
      );
      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-07-01", to: "2026-07-31" }),
      );
      const bin = report.groups.find((g) => g.group.id === stopBin)!;
      // The 1st, 2nd and 3rd. Three days, not two.
      expect(bin.members[0].daysOnFeed).toBe(3);
      expect(bin.members[0].headDays).toBe(30);
    });

    it("STAFF may draw and put lots on feeders — both are chores", async () => {
      const entry = await newLot("FEED-F");
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId,
          inventoryLotId: entry.inventoryLotId,
          head: 10,
          occurredOn: "2026-07-01",
        }),
      );
      await expect(
        asOwner((tx) =>
          addLotToFeedGroup(tx, staffCtx(), {
            feedGroupId: binId,
            livestockLotId: entry.lot.id,
            startedOn: "2026-07-15",
          }),
        ),
      ).resolves.toBeTruthy();
      await expect(
        asOwner((tx) =>
          recordFeedDraw(tx, staffCtx(), {
            feedGroupId: binId,
            itemId: feedItemId,
            quantity: 10,
            occurredOn: "2026-07-15",
          }),
        ),
      ).resolves.toBeTruthy();
    });

    it("STAFF may NOT create or close a feeder — that is a decision about cost", async () => {
      await expect(
        asOwner((tx) => createFeedGroup(tx, staffCtx(), { name: "Nope" })),
      ).rejects.toThrow(/only an owner/);
      await expect(
        asOwner((tx) => closeFeedGroup(tx, staffCtx(), binId)),
      ).rejects.toThrow(/only an owner/);
    });

    it("a closed feeder stops being offered and keeps reporting", async () => {
      const closed = await asOwner((tx) => closeFeedGroup(tx, ctx(), binId));
      expect(closed.status).toBe("closed");
      const active = await asOwner((tx) =>
        listFeedGroups(tx, tenantId, { status: "active" }),
      );
      expect(active.some((g) => g.id === binId)).toBe(false);
      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-07-01", to: "2026-07-31" }),
      );
      expect(report.groups.some((g) => g.group.id === binId)).toBe(true);
    });
  });
  // ---- slice 3: treatments and the withdrawal clock ----------------------

  describe("treatments and the withdrawal clock", () => {
    let tItemId: string;
    let medicineId: string;
    let lotId: string;
    let invLotId: string;

    beforeAll(async () => {
      tItemId = (
        await asOwner((tx) =>
          createItem(tx, ctx(), {
            name: "Treat chicks",
            stockingUnit: "head",
            itemKind: "livestock",
          }),
        )
      ).id;
      medicineId = (
        await asOwner((tx) =>
          createItem(tx, ctx(), {
            name: "Penicillin G",
            stockingUnit: "floz",
            itemKind: "medicine",
          }),
        )
      ).id;
      await asOwner((tx) =>
        receiveStock(tx, ctx(), {
          itemId: medicineId,
          quantity: 100,
          costCents: 20_000,
          occurredOn: "2026-06-01",
        }),
      );
      const created = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: tItemId,
          code: "TREAT-1",
          species: "cattle",
        }),
      );
      lotId = created.lot.id;
      invLotId = created.inventoryLotId;
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: tItemId,
          inventoryLotId: invLotId,
          head: 10,
          occurredOn: "2026-06-01",
        }),
      );
    });

    it("starts both clocks, and they run to different dates", async () => {
      await asOwner((tx) =>
        recordTreatment(tx, ctx(), {
          livestockLotId: lotId,
          treatedOn: "2026-08-01",
          product: "Penicillin G",
          dose: "1 cc per 100 lb",
          route: "injection",
          meatWithdrawalDays: 10,
          milkWithdrawalDays: 4,
          withdrawalSource: "label",
        }),
      );
      const map = await asOwner((tx) =>
        withdrawalByLot(tx, tenantId, [lotId], "2026-08-06"),
      );
      const w = map.get(lotId)!;
      // On the 6th the milk is saleable and the animal is not.
      expect(w.meat.state).toBe("under");
      expect(w.meat.clearsOn).toBe("2026-08-11");
      expect(w.milk.state).toBe("clear");
    });

    it("REFUSES A STATED SOURCE WITH NOTHING STATED", async () => {
      // Claiming a period came off the label while leaving both clocks empty is
      // the row that later reads as "clear" to somebody loading a trailer.
      await expect(
        asOwner((tx) =>
          recordTreatment(tx, ctx(), {
            livestockLotId: lotId,
            treatedOn: "2026-08-01",
            product: "Mystery",
            route: "water",
            withdrawalSource: "label",
          }),
        ),
      ).rejects.toThrow(/give a meat or milk withdrawal/);
    });

    it("ACCEPTS 'not looked up', AND IT BLOCKS", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: tItemId,
          code: "TREAT-UNKNOWN",
          species: "cattle",
        }),
      );
      await asOwner((tx) =>
        recordTreatment(tx, ctx(), {
          livestockLotId: lot.lot.id,
          treatedOn: "2026-08-01",
          product: "Something the vet left",
          route: "injection",
          withdrawalSource: "none_stated",
        }),
      );
      const map = await asOwner((tx) =>
        withdrawalByLot(tx, tenantId, [lot.lot.id], "2026-12-01"),
      );
      // Months later, and still not clear — because nobody looked.
      expect(map.get(lot.lot.id)!.meat.state).toBe("unknown");
    });

    it("PUTS THE COST ON THE PEN through inventory, not a column here", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: tItemId,
          code: "TREAT-COST",
          species: "cattle",
        }),
      );
      const treatment = await asOwner((tx) =>
        recordTreatment(tx, ctx(), {
          livestockLotId: lot.lot.id,
          treatedOn: "2026-08-01",
          product: "Penicillin G",
          route: "injection",
          meatWithdrawalDays: 10,
          fromStock: { itemId: medicineId, quantity: 5 },
        }),
      );
      // The money is on the movement, and this table only points at it.
      expect(treatment.inventoryMovementId).not.toBeNull();
      const consumed = await asOwner((tx) =>
        consumedCostByLot(tx, tenantId, [lot.inventoryLotId]),
      );
      // 5 fluid ounces out of a 100 floz, $200 bottle.
      expect(consumed.get(lot.inventoryLotId)).toBe(1_000);
    });

    it("MEDICINE IS NOT FEED, and the feed report knows it", async () => {
      // The correction slice 3 forces: medicine goes through the same door feed
      // does, and a card reading "Fed" that quietly included the penicillin
      // would be wrong in the pack that owns the word.
      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-06-01", to: "2026-12-31" }),
      );
      const row = report.lots.find((l) => l.code === "TREAT-COST")!;
      expect(row.measuredCents).toBe(0);
      expect(row.quantities).toEqual([]);
      expect(row.provenance).toBe("none");
    });

    it("suggests what THIS FARM entered last time, and nothing otherwise", async () => {
      const previous = await asOwner((tx) =>
        lastTreatmentOfProduct(tx, tenantId, "penicillin g"),
      );
      expect(previous?.meatWithdrawalDays).toBe(10);
      expect(
        await asOwner((tx) => lastTreatmentOfProduct(tx, tenantId, "Draxxin")),
      ).toBeNull();
    });

    it("refuses a malformed route and an invented source", async () => {
      await expect(
        asOwner((tx) =>
          recordTreatment(tx, ctx(), {
            livestockLotId: lotId,
            treatedOn: "2026-08-01",
            product: "X",
            route: "In The Water",
            meatWithdrawalDays: 1,
          }),
        ),
      ).rejects.toThrow(/invalid route/);
      await expect(
        asOwner((tx) =>
          recordTreatment(tx, ctx(), {
            livestockLotId: lotId,
            treatedOn: "2026-08-01",
            product: "X",
            route: "water",
            meatWithdrawalDays: 1,
            withdrawalSource: "i_reckon",
          }),
        ),
      ).rejects.toThrow(/where the withdrawal period came from/);
    });

    it("CORRECTS A PERIOD IN PLACE, and the clock moves with it", async () => {
      // 10 days typed where the label said 21. No such record ever existed, so
      // there is nothing to compensate for.
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: tItemId,
          code: "FIXWD-1",
          species: "cattle",
        }),
      );
      const wrong = await asOwner((tx) =>
        recordTreatment(tx, ctx(), {
          livestockLotId: lot.lot.id,
          treatedOn: "2026-08-01",
          product: "Penicillin G",
          route: "injection",
          meatWithdrawalDays: 10,
        }),
      );
      const before = await asOwner((tx) =>
        withdrawalByLot(tx, tenantId, [lot.lot.id], "2026-08-15"),
      );
      expect(before.get(lot.lot.id)!.meat.state).toBe("clear");

      await asOwner((tx) =>
        updateTreatment(tx, ctx(), wrong.id, { meatWithdrawalDays: 21 }),
      );
      const after = await asOwner((tx) =>
        withdrawalByLot(tx, tenantId, [lot.lot.id], "2026-08-15"),
      );
      // A lot that read as clear on the 15th is now under until the 22nd.
      expect(after.get(lot.lot.id)!.meat.state).toBe("under");
      expect(after.get(lot.lot.id)!.meat.clearsOn).toBe("2026-08-22");
      // One row, not two.
      const rows = await asOwner((tx) =>
        listTreatmentsForLot(tx, tenantId, lot.lot.id),
      );
      expect(rows).toHaveLength(1);
    });

    it("VALIDATES THE MERGED ROW, not the patch", async () => {
      // Clearing the only period a treatment had, while its source still says
      // "off the label", produces exactly the row that reads as clear to
      // somebody about to load a trailer.
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: tItemId,
          code: "FIXWD-2",
          species: "cattle",
        }),
      );
      const row = await asOwner((tx) =>
        recordTreatment(tx, ctx(), {
          livestockLotId: lot.lot.id,
          treatedOn: "2026-08-01",
          product: "Penicillin G",
          route: "injection",
          meatWithdrawalDays: 21,
        }),
      );
      await expect(
        asOwner((tx) =>
          updateTreatment(tx, ctx(), row.id, { meatWithdrawalDays: null }),
        ),
      ).rejects.toThrow(/give a meat or milk withdrawal/);

      // ...but the same clearing IS allowed when the source says nobody looked,
      // because that state blocks rather than clears.
      await expect(
        asOwner((tx) =>
          updateTreatment(tx, ctx(), row.id, {
            meatWithdrawalDays: null,
            withdrawalSource: "none_stated",
          }),
        ),
      ).resolves.toBeTruthy();
      const after = await asOwner((tx) =>
        withdrawalByLot(tx, tenantId, [lot.lot.id], "2027-01-01"),
      );
      expect(after.get(lot.lot.id)!.meat.state).toBe("unknown");
    });

    it("REMOVES THE RECORD AND LEAVES THE STOCK ISSUE STANDING", async () => {
      // The medicine really did leave the shelf. Unwriting that would rewrite
      // inventory's history, which is the rule a movement exists under.
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: tItemId,
          code: "FIXWD-3",
          species: "cattle",
        }),
      );
      const treatment = await asOwner((tx) =>
        recordTreatment(tx, ctx(), {
          livestockLotId: lot.lot.id,
          treatedOn: "2026-08-01",
          product: "Penicillin G",
          route: "injection",
          meatWithdrawalDays: 21,
          fromStock: { itemId: medicineId, quantity: 4 },
        }),
      );
      const costBefore = await asOwner((tx) =>
        consumedCostByLot(tx, tenantId, [lot.inventoryLotId]),
      );
      expect(costBefore.get(lot.inventoryLotId)).toBe(800);

      const removed = await asOwner((tx) =>
        deleteTreatment(tx, ctx(), treatment.id),
      );
      // The caller is told there is a loose end, so the screen can say so.
      expect(removed.inventoryMovementId).not.toBeNull();

      // The record is gone and the clock with it...
      expect(
        await asOwner((tx) => listTreatmentsForLot(tx, tenantId, lot.lot.id)),
      ).toHaveLength(0);
      const wd = await asOwner((tx) =>
        withdrawalByLot(tx, tenantId, [lot.lot.id], "2026-08-05"),
      );
      expect(wd.get(lot.lot.id)).toBeUndefined();
      // ...and the cost is still on the pen.
      const costAfter = await asOwner((tx) =>
        consumedCostByLot(tx, tenantId, [lot.inventoryLotId]),
      );
      expect(costAfter.get(lot.inventoryLotId)).toBe(800);
    });

    it("refuses to correct or remove a treatment that is not this tenant's", async () => {
      const nowhere = "00000000-0000-0000-0000-000000000000";
      await expect(
        asOwner((tx) =>
          updateTreatment(tx, ctx(), nowhere, { meatWithdrawalDays: 1 }),
        ),
      ).rejects.toThrow(/not found/);
      await expect(
        asOwner((tx) => deleteTreatment(tx, ctx(), nowhere)),
      ).rejects.toThrow(/not found/);
    });

    it("STAFF may correct and remove — same hands, same day", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: tItemId,
          code: "FIXWD-4",
          species: "cattle",
        }),
      );
      const row = await asOwner((tx) =>
        recordTreatment(tx, staffCtx(), {
          livestockLotId: lot.lot.id,
          treatedOn: "2026-08-01",
          product: "Penicillin G",
          route: "injection",
          meatWithdrawalDays: 10,
        }),
      );
      await expect(
        asOwner((tx) =>
          updateTreatment(tx, staffCtx(), row.id, { meatWithdrawalDays: 21 }),
        ),
      ).resolves.toBeTruthy();
      await expect(
        asOwner((tx) => deleteTreatment(tx, staffCtx(), row.id)),
      ).resolves.toBeTruthy();
    });

    it("STAFF may treat — the person with the syringe is the one who knows", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: tItemId,
          code: "TREAT-STAFF",
          species: "cattle",
        }),
      );
      await expect(
        asOwner((tx) =>
          recordTreatment(tx, staffCtx(), {
            livestockLotId: lot.lot.id,
            treatedOn: "2026-08-01",
            product: "Penicillin G",
            route: "injection",
            meatWithdrawalDays: 10,
          }),
        ),
      ).resolves.toBeTruthy();
    });

    it("reaches the advisor's digest as a legal fact", async () => {
      const snapshot = await asOwner((tx) =>
        farmSnapshot(tx, tenantId, { today: "2026-08-06" }),
      );
      const lot = snapshot.lots.find((l) => l.code === "TREAT-1")!;
      expect(lot.withdrawal?.meatState).toBe("under");
      expect(lot.withdrawal?.meatClearsOn).toBe("2026-08-11");
      const text = formatSnapshot(snapshot);
      expect(text).toContain("MEAT WITHDRAWAL until 2026-08-11");
    });
  });

  // ---- slice 5: weights, and the conversion they make possible -----------

  describe("weights and feed conversion", () => {
    let wItemId: string;
    let wFeedId: string;
    let lotId: string;
    let invLotId: string;

    beforeAll(async () => {
      wItemId = (
        await asOwner((tx) =>
          createItem(tx, ctx(), {
            name: "Weigh chicks",
            stockingUnit: "head",
            itemKind: "livestock",
          }),
        )
      ).id;
      wFeedId = (
        await asOwner((tx) =>
          createItem(tx, ctx(), {
            name: "Weigh feed",
            stockingUnit: "lb",
            itemKind: "feed",
          }),
        )
      ).id;
      // 2,000 lb at $1,000 — a round 50 cents a pound, so every stamped cost
      // below is checkable by eye.
      await asOwner((tx) =>
        receiveStock(tx, ctx(), {
          itemId: wFeedId,
          quantity: 2000,
          costCents: 100_000,
          occurredOn: "2026-05-31",
        }),
      );

      const created = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "WEIGH-1",
          species: "poultry",
          bornOn: "2026-06-01",
        }),
      );
      lotId = created.lot.id;
      invLotId = created.inventoryLotId;
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: wItemId,
          inventoryLotId: invLotId,
          head: 100,
          occurredOn: "2026-06-01",
        }),
      );
    });

    it("records the READING, not the pounds — a tape stays a tape", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "TAPE-1",
          species: "swine",
          bornOn: "2026-06-01",
        }),
      );
      const row = await asOwner((tx) =>
        recordWeight(tx, ctx(), {
          livestockLotId: lot.lot.id,
          weighedOn: "2026-08-01",
          method: "tape",
          heartGirthIn: 40,
          bodyLengthIn: 42,
        }),
      );
      expect(row.heartGirthIn).toBe(40);
      expect(row.bodyLengthIn).toBe(42);
      // No pounds stored anywhere. A better divisor tomorrow reweighs every
      // animal ever measured, rather than only the next one.
      expect(row.sampleWeightLb).toBeNull();

      const [weighIn] = toWeighIns(
        await asOwner((tx) => listWeightsForLot(tx, tenantId, lot.lot.id)),
        { tapeDivisor: 400, lastHauledOn: null },
      );
      expect(weighIn.averageLb).toBe(168);
      // And with no divisor for the species, the same row produces nothing.
      const [noDivisor] = toWeighIns(
        await asOwner((tx) => listWeightsForLot(tx, tenantId, lot.lot.id)),
        { tapeDivisor: null, lastHauledOn: null },
      );
      expect(noDivisor.averageLb).toBeNull();
    });

    it("refuses a weighing that measured nothing", async () => {
      await expect(
        asOwner((tx) =>
          recordWeight(tx, ctx(), {
            livestockLotId: lotId,
            weighedOn: "2026-08-01",
            method: "sample",
          }),
        ),
      ).rejects.toThrow(/record what the scale said/);
    });

    it("refuses half a tape reading", async () => {
      await expect(
        asOwner((tx) =>
          recordWeight(tx, ctx(), {
            livestockLotId: lotId,
            weighedOn: "2026-08-01",
            method: "tape",
            heartGirthIn: 40,
          }),
        ),
      ).rejects.toThrow(/both the heart girth and the body length/);
    });

    it("STAFF may weigh — catching ten birds is the definition of a chore", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "WEIGH-STAFF",
          species: "poultry",
        }),
      );
      await expect(
        asOwner((tx) =>
          recordWeight(tx, staffCtx(), {
            livestockLotId: lot.lot.id,
            weighedOn: "2026-08-01",
            method: "sample",
            sampleSize: 10,
            sampleWeightLb: 40,
          }),
        ),
      ).resolves.toBeTruthy();
    });

    it("THE CONVERSION WINDOW IS THE GAIN WINDOW, NOT THE REPORT'S", async () => {
      // The whole reason this is not a one-liner. Feed fed before anybody put a
      // bird on a scale made gain nobody measured, so counting it would inflate
      // the one number the enterprise is judged on — badly, for exactly the farm
      // that starts weighing halfway through its first batch.
      //
      // 400 lb fed BEFORE the first weighing, 200 lb between the two.
      await asOwner((tx) =>
        issueStock(tx, ctx(), {
          itemId: wFeedId,
          quantity: 400,
          issuedToLotId: invLotId,
          occurredOn: "2026-06-15",
        }),
      );
      await asOwner((tx) =>
        issueStock(tx, ctx(), {
          itemId: wFeedId,
          quantity: 200,
          issuedToLotId: invLotId,
          occurredOn: "2026-07-10",
        }),
      );
      // 1 lb a bird on 1 July, 3 lb a bird on 31 July. 2 lb of gain across 100
      // head is 200 lb — against the 200 lb fed inside that window, so 1.00 : 1.
      await asOwner((tx) =>
        recordWeight(tx, ctx(), {
          livestockLotId: lotId,
          weighedOn: "2026-07-01",
          method: "sample",
          sampleSize: 10,
          sampleWeightLb: 10,
        }),
      );
      await asOwner((tx) =>
        recordWeight(tx, ctx(), {
          livestockLotId: lotId,
          weighedOn: "2026-07-31",
          method: "sample",
          sampleSize: 10,
          sampleWeightLb: 30,
        }),
      );

      const report = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-06-01", to: "2026-08-31" }),
      );
      const row = report.lots.find((l) => l.code === "WEIGH-1")!;
      expect(row.weight.gain!.gainLb).toBe(2);
      expect(row.weight.gain!.adgLb).toBe(0.067);
      // The 400 lb fed in June is NOT in it.
      expect(row.weight.conversion!.feedLb).toBe(200);
      expect(row.weight.conversion!.gainLb).toBe(200);
      expect(row.weight.conversion!.ratio).toBe(1);
      // Feed issued by name against a sampled scale weight: a number to act on.
      expect(row.weight.conversion!.confidence).toBe("measured");
    });

    it("says WHY there is no conversion, in words the screen can print", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "WEIGH-ONCE",
          species: "poultry",
        }),
      );
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: wItemId,
          inventoryLotId: lot.inventoryLotId,
          head: 50,
          occurredOn: "2026-06-01",
        }),
      );
      const before = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-06-01", to: "2026-08-31" }),
      );
      expect(
        before.lots.find((l) => l.code === "WEIGH-ONCE")!.weight.conversionBlockedBy,
      ).toMatch(/Nothing weighed/);

      await asOwner((tx) =>
        recordWeight(tx, ctx(), {
          livestockLotId: lot.lot.id,
          weighedOn: "2026-07-01",
          method: "sample",
          sampleSize: 10,
          sampleWeightLb: 20,
        }),
      );
      const after = await asOwner((tx) =>
        feedReport(tx, tenantId, { from: "2026-06-01", to: "2026-08-31" }),
      );
      const row = after.lots.find((l) => l.code === "WEIGH-ONCE")!;
      expect(row.weight.conversion).toBeNull();
      // A refusal with no reason is indistinguishable from a bug, and this one
      // fires on nearly every lot for a farm's whole first season.
      expect(row.weight.conversionBlockedBy).toMatch(/needs two/);
      // The one figure a single weighing CAN honestly produce.
      expect(row.weight.liveweightLb).toBe(100);
    });

    it("CORRECTS A WEIGHING IN PLACE — a measurement is not a ledger entry", async () => {
      // 625 for a crate of ten broilers instead of 62.5. No such measurement
      // ever happened, so there is nothing to compensate for and no corrective
      // weighing that would mean anything.
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "FIXME-1",
          species: "poultry",
        }),
      );
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: wItemId,
          inventoryLotId: lot.inventoryLotId,
          head: 100,
          occurredOn: "2026-06-01",
        }),
      );
      const wrong = await asOwner((tx) =>
        recordWeight(tx, ctx(), {
          livestockLotId: lot.lot.id,
          weighedOn: "2026-07-01",
          method: "sample",
          sampleSize: 10,
          sampleWeightLb: 625,
        }),
      );
      const fixed = await asOwner((tx) =>
        updateWeight(tx, ctx(), wrong.id, { sampleWeightLb: 62.5 }),
      );
      expect(fixed.id).toBe(wrong.id);
      expect(fixed.sampleWeightLb).toBe(62.5);
      // One row, not two. The wrong number is gone from the record and lives in
      // the audit log.
      const rows = await asOwner((tx) =>
        listWeightsForLot(tx, tenantId, lot.lot.id),
      );
      expect(rows).toHaveLength(1);
    });

    it("A SCALE READING CLEARS THE TAPE, and the data decides which", async () => {
      // Not the method string — the taxonomy is open. A row carrying both would
      // claim two measurements were taken, and one keeping a stale girth after
      // being corrected to a scale reading would lie about what somebody did.
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "FIXME-2",
          species: "swine",
        }),
      );
      const taped = await asOwner((tx) =>
        recordWeight(tx, ctx(), {
          livestockLotId: lot.lot.id,
          weighedOn: "2026-07-01",
          method: "tape",
          heartGirthIn: 40,
          bodyLengthIn: 42,
        }),
      );
      const scaled = await asOwner((tx) =>
        updateWeight(tx, ctx(), taped.id, {
          method: "scale",
          sampleSize: 1,
          sampleWeightLb: 174,
        }),
      );
      expect(scaled.sampleWeightLb).toBe(174);
      expect(scaled.heartGirthIn).toBeNull();
      expect(scaled.bodyLengthIn).toBeNull();

      // And back the other way — including the sample size, because a tape
      // reads one animal and a ten carried over from a crate would divide the
      // estimate by ten.
      const retaped = await asOwner((tx) =>
        updateWeight(tx, ctx(), taped.id, {
          method: "tape",
          heartGirthIn: 41,
          bodyLengthIn: 43,
        }),
      );
      expect(retaped.sampleWeightLb).toBeNull();
      expect(retaped.sampleSize).toBe(1);
    });

    it("refuses a correction that would leave nothing measured", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "FIXME-3",
          species: "poultry",
        }),
      );
      const row = await asOwner((tx) =>
        recordWeight(tx, ctx(), {
          livestockLotId: lot.lot.id,
          weighedOn: "2026-07-01",
          method: "sample",
          sampleSize: 10,
          sampleWeightLb: 62.5,
        }),
      );
      // The CHECK would refuse this too, with a constraint name nobody can
      // read. The ops layer refuses it with a sentence.
      await expect(
        asOwner((tx) =>
          updateWeight(tx, ctx(), row.id, { sampleWeightLb: null }),
        ),
      ).rejects.toThrow(/record what the scale said/);
    });

    it("REMOVES A WEIGHING THAT NEVER HAPPENED, and the gain follows", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "FIXME-4",
          species: "poultry",
        }),
      );
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: wItemId,
          inventoryLotId: lot.inventoryLotId,
          head: 100,
          occurredOn: "2026-06-01",
        }),
      );
      for (const [on, lb] of [
        ["2026-07-01", 10],
        ["2026-07-15", 400],
        ["2026-07-31", 30],
      ] as const) {
        await asOwner((tx) =>
          recordWeight(tx, ctx(), {
            livestockLotId: lot.lot.id,
            weighedOn: on,
            method: "sample",
            sampleSize: 10,
            sampleWeightLb: lb,
          }),
        );
      }
      // The duplicate in the middle is a whole order of magnitude out and would
      // read as birds that grew to 40 lb and shrank back.
      const rows = await asOwner((tx) =>
        listWeightsForLot(tx, tenantId, lot.lot.id),
      );
      const bogus = rows.find((r) => r.weighedOn === "2026-07-15")!;
      await asOwner((tx) => deleteWeight(tx, ctx(), bogus.id));

      const left = await asOwner((tx) =>
        listWeightsForLot(tx, tenantId, lot.lot.id),
      );
      expect(left.map((r) => r.weighedOn)).toEqual(["2026-07-01", "2026-07-31"]);
      // Gain and conversion are folds over these rows, so removing one moves
      // both — 1 lb to 3 lb across 30 days.
      const gain = gainBetween(
        toWeighIns(left, { tapeDivisor: null, lastHauledOn: null }),
      )!;
      expect(gain.gainLb).toBe(2);
    });

    it("refuses to correct or remove a weighing that is not this tenant's", async () => {
      const nowhere = "00000000-0000-0000-0000-000000000000";
      await expect(
        asOwner((tx) => updateWeight(tx, ctx(), nowhere, { sampleWeightLb: 1 })),
      ).rejects.toThrow(/not found/);
      await expect(
        asOwner((tx) => deleteWeight(tx, ctx(), nowhere)),
      ).rejects.toThrow(/not found/);
    });

    it("STAFF may correct and remove — the person who typed it is standing there", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "FIXME-5",
          species: "poultry",
        }),
      );
      const row = await asOwner((tx) =>
        recordWeight(tx, staffCtx(), {
          livestockLotId: lot.lot.id,
          weighedOn: "2026-07-01",
          method: "sample",
          sampleSize: 10,
          sampleWeightLb: 625,
        }),
      );
      await expect(
        asOwner((tx) =>
          updateWeight(tx, staffCtx(), row.id, { sampleWeightLb: 62.5 }),
        ),
      ).resolves.toBeTruthy();
      await expect(
        asOwner((tx) => deleteWeight(tx, staffCtx(), row.id)),
      ).resolves.toBeTruthy();
    });

    it("A HAUL IS A PARCEL CROSSING, and a walk is not", async () => {
      // Land's own definition, and the reason this is not "when did they last
      // move": a rotational farm walks its herd daily, and a flag that fired
      // every morning would be ignored inside a week.
      const other = await asOwner((tx) =>
        createParcel(tx, ctx(), { name: "Far Field", areaAcres: 20 }),
      );
      const farZone = await asOwner((tx) =>
        createZone(tx, ctx(), {
          parcelId: other.id,
          name: "Far Paddock",
          areaAcres: 5,
        }),
      );
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "HAUL-1",
          species: "cattle",
        }),
      );
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: wItemId,
          inventoryLotId: lot.inventoryLotId,
          head: 10,
          occurredOn: "2026-06-01",
        }),
      );

      // Arrival, then a WALK to another zone on the same parcel.
      const homeZone2 = await asOwner((tx) =>
        createZone(tx, ctx(), { parcelId, name: "Second Paddock", areaAcres: 4 }),
      );
      await asOwner((tx) =>
        moveLotToZone(tx, ctx(), {
          livestockLotId: lot.lot.id,
          zoneId,
          startedOn: "2026-06-01",
        }),
      );
      await asOwner((tx) =>
        moveLotToZone(tx, ctx(), {
          livestockLotId: lot.lot.id,
          zoneId: homeZone2.id,
          startedOn: "2026-06-10",
        }),
      );
      const afterWalk = await asOwner((tx) =>
        lastHauledOn(tx, tenantId, "livestock", [lot.inventoryLotId]),
      );
      expect(afterWalk.get(lot.inventoryLotId)).toBeUndefined();

      // Now a HAUL — a different parcel.
      await asOwner((tx) =>
        moveLotToZone(tx, ctx(), {
          livestockLotId: lot.lot.id,
          zoneId: farZone.id,
          startedOn: "2026-06-20",
        }),
      );
      const afterHaul = await asOwner((tx) =>
        lastHauledOn(tx, tenantId, "livestock", [lot.inventoryLotId]),
      );
      expect(afterHaul.get(lot.inventoryLotId)).toBe("2026-06-20");
    });

    it("KEEPS a shrink-affected weighing and leaves it out of the gain", async () => {
      const lot = await asOwner((tx) =>
        createLivestockLot(tx, ctx(), {
          itemId: wItemId,
          code: "SHRINK-1",
          species: "cattle",
        }),
      );
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId: wItemId,
          inventoryLotId: lot.inventoryLotId,
          head: 10,
          occurredOn: "2026-06-01",
        }),
      );
      const away = await asOwner((tx) =>
        createParcel(tx, ctx(), { name: "Hauled To", areaAcres: 30 }),
      );
      const awayZone = await asOwner((tx) =>
        createZone(tx, ctx(), { parcelId: away.id, name: "Away", areaAcres: 6 }),
      );
      await asOwner((tx) =>
        moveLotToZone(tx, ctx(), {
          livestockLotId: lot.lot.id,
          zoneId,
          startedOn: "2026-06-01",
        }),
      );
      await asOwner((tx) =>
        moveLotToZone(tx, ctx(), {
          livestockLotId: lot.lot.id,
          zoneId: awayZone.id,
          startedOn: "2026-07-20",
        }),
      );

      for (const [on, lb] of [
        ["2026-07-01", 4000],
        ["2026-07-21", 3900],
      ] as const) {
        await asOwner((tx) =>
          recordWeight(tx, ctx(), {
            livestockLotId: lot.lot.id,
            weighedOn: on,
            method: "scale",
            sampleSize: 10,
            sampleWeightLb: lb,
          }),
        );
      }

      const hauls = await asOwner((tx) =>
        lastHauledOn(tx, tenantId, "livestock", [lot.inventoryLotId]),
      );
      const weighIns = toWeighIns(
        await asOwner((tx) => listWeightsForLot(tx, tenantId, lot.lot.id)),
        { tapeDivisor: 300, lastHauledOn: hauls.get(lot.inventoryLotId) ?? null },
      );
      expect(weighIns).toHaveLength(2);
      // Both kept. Deleting one would lose an observation somebody made.
      expect(weighIns[1].shrinkAffected).toBe(true);
      // And with only one usable weighing left, there is no gain to report —
      // which beats reporting that ten cattle lost 100 lb on a trailer.
      expect(gainBetween(weighIns)).toBeNull();
    });
  });
});
