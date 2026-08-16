import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  addIdentifier,
  createLivestockLot,
  getLivestockLot,
  listIdentifiers,
  moveLotToZone,
  placeHead,
  removeHead,
  retireIdentifier,
  splitLivestockLot,
  updateLivestockLot,
  type LivestockCtx,
} from "../src/packs/livestock/ops";
import { createItem, movementRowsForItem, LOT_DIMENSION } from "../src/packs/inventory/ops";
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
    const parcel = await asOwner((tx) =>
      createParcel(tx, ctx(), { name: "Home Farm", areaAcres: 100 }),
    );
    zoneId = (
      await asOwner((tx) =>
        createZone(tx, ctx(), {
          parcelId: parcel.id,
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
      currentZoneForOccupants(tx, tenantId, "livestock", [
        penned.inventoryLotId,
        loose.inventoryLotId,
      ]),
    );
    expect(places.get(penned.inventoryLotId)?.structureName).toBe("Pen 3");
    // Loose animals are still ON the zone — the LEFT join is what stops an
    // inner join silently hiding every herd that is not in a structure.
    expect(places.get(loose.inventoryLotId)?.zoneName).toBe("North Pasture");
    expect(places.get(loose.inventoryLotId)?.structureName).toBeNull();

    // And "what is in Pen 3" is answerable from land, without joining into
    // livestock at all — the label is a copy.
    const inPen = await asOwner((tx) =>
      occupantsInStructures(tx, tenantId, [penId]),
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
});
