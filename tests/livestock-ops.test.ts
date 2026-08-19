import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  addIdentifier,
  checkedDaysSince,
  checksOn,
  createLivestockLot,
  getLivestockLot,
  lastCheckedByLot,
  listChecksForLot,
  listIdentifiers,
  markRoundNormal,
  moveLotToZone,
  placeHead,
  recordDailyCheck,
  removeHead,
  retireIdentifier,
  splitLivestockLot,
  updateLivestockLot,
  type LivestockCtx,
} from "../src/packs/livestock/ops";
import {
  createItem,
  movementKindsForLots,
  movementRowsForItem,
  LOT_DIMENSION,
} from "../src/packs/inventory/ops";
import { balanceByItem, balanceOfLot } from "../src/packs/inventory/core/balances";
import {
  createParcel,
  createZone,
  currentZoneForOccupants,
  occupantsInStructures,
  restByZone,
} from "../src/packs/land/ops";
import { summariseHead, mortalityRate } from "../src/packs/livestock/core/herd";

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
});
