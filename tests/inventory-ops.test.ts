import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  InventoryError,
  LOT_DIMENSION,
  archiveItem,
  closeLot,
  createItem,
  createLot,
  getItem,
  listLots,
  mergeLot,
  movementRowsForItem,
  onHandByItem,
  recordMovement,
  splitLot,
  updateItem,
  lotAncestry,
  type InventoryCtx,
} from "../src/packs/inventory/ops";
import { balanceOfLot, balanceByItem } from "../src/packs/inventory/core/balances";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * The ops behind `inventory`, and especially THE LOT SPINE — the thing
 * `livestock` declares this pack in `requires` for.
 *
 * `tests/isolation/inventory.test.ts` builds its fixtures under `withSystem` on
 * purpose, so a bug in these ops cannot make that suite agree with it. The
 * consequence is that the pack's central claims — that a lot becomes a cost
 * object, and that a split BALANCES — are covered by nothing except this file.
 */
d("inventory ops", () => {
  const STAMP = `invops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId: string;
  let freezerId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const ownerCtx = (): InventoryCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const staffCtx = (): InventoryCtx => ({ tenantId, userId: STAFF, role: "staff" });

  const newItem = (name: string, unit = "lb") =>
    asOwner((tx) =>
      createItem(tx, ownerCtx(), { name, stockingUnit: unit, itemKind: "feed" }),
    );

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Inventory Ops",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
      // A location IS an asset — a chest freezer. Nothing new is invented, and
      // it is why this pack declares `assets` in `requires`.
      const asset = await tx
        .insert(schema.assets)
        .values({ tenantId, kind: "equipment", name: "Chest freezer" })
        .returning();
      freezerId = asset[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  const lotMembers = () =>
    asOwner((tx) =>
      tx.query.dimensionMembers.findMany({
        where: and(
          eq(schema.dimensionMembers.tenantId, tenantId),
          eq(schema.dimensionMembers.dimensionType, LOT_DIMENSION),
        ),
      }),
    );

  // ---- the claim the pack rests on -------------------------------------

  it("a LOT is the cost object, and an item is not", async () => {
    // "What did this pen of broilers cost" is a lot question. Nobody asks what
    // "feed" cost in the abstract — so lots sync and items do not, which is
    // what makes profit-per-pen fall out of the existing P&L.
    const item = await newItem("Broiler feed");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "B-2026-04-15" }),
    );

    const members = await lotMembers();
    const member = members.find((m) => m.packEntityId === lot.id);
    expect(member).toBeDefined();
    expect(member?.displayName).toBe("Broiler feed · B-2026-04-15");
    expect(members.some((m) => m.packEntityId === item.id)).toBe(false);
  });

  it("a failed lot write rolls its cost object back", async () => {
    const item = await newItem("Doomed feed");
    let created: string | undefined;
    await expect(
      asOwner(async (tx) => {
        const lot = await createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "DOOM-1",
        });
        created = lot.id;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const members = await lotMembers();
    expect(members.some((m) => m.packEntityId === created)).toBe(false);
  });

  it("closing a lot archives its cost object without deleting it", async () => {
    const item = await newItem("Finished feed");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "DONE-1" }),
    );
    await asOwner((tx) => closeLot(tx, ownerCtx(), lot.id));
    const member = (await lotMembers()).find((m) => m.packEntityId === lot.id);
    // Archived stops it being taggable while every existing tag keeps
    // reporting — what a finished batch wants.
    expect(member?.isActive).toBe(false);
  });

  // ---- the ledger ------------------------------------------------------

  it("the balance is the sum of movements, and nothing stores it", async () => {
    const item = await newItem("Layer pellets");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "LP-1" }),
    );
    for (const [qty, kind] of [
      [1000, "receipt"],
      [-120, "issue"],
      [-80, "issue"],
    ] as [number, string][]) {
      await asOwner((tx) =>
        recordMovement(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          locationAssetId: freezerId,
          quantity: qty,
          movementKind: kind,
          occurredOn: "2026-08-01",
        }),
      );
    }
    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, item.id));
    expect(balanceOfLot(rows, lot.id)).toBe(800);
    expect((await asOwner((tx) => onHandByItem(tx, tenantId))).get(item.id)).toBe(800);
  });

  it("refuses a movement of zero", async () => {
    const item = await newItem("Zero feed");
    await expect(
      asOwner((tx) =>
        recordMovement(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 0,
          movementKind: "receipt",
          occurredOn: "2026-08-01",
        }),
      ),
    ).rejects.toMatchObject({ code: "ZERO_QUANTITY" });
  });

  it("ALLOWS a movement that takes stock negative", async () => {
    // Deliberate. Issue feed on Tuesday, record Monday's delivery on
    // Wednesday — a system that refuses the Tuesday entry teaches people to
    // stop entering things, which costs far more than a temporarily wrong
    // number.
    const item = await newItem("Backdated feed");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "BD-1" }),
    );
    await asOwner((tx) =>
      recordMovement(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: -50,
        movementKind: "issue",
        occurredOn: "2026-08-04",
      }),
    );
    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, item.id));
    expect(balanceOfLot(rows, lot.id)).toBe(-50);
  });

  it("refuses a lot that belongs to another item", async () => {
    const a = await newItem("Item A");
    const b = await newItem("Item B");
    const lotA = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: a.id, code: "A-1" }),
    );
    await expect(
      asOwner((tx) =>
        recordMovement(tx, ownerCtx(), {
          itemId: b.id,
          lotId: lotA.id,
          quantity: 5,
          movementKind: "receipt",
          occurredOn: "2026-08-01",
        }),
      ),
    ).rejects.toMatchObject({ code: "LOT_INVALID" });
  });

  // ---- the spine: split and merge --------------------------------------

  it("a split BALANCES — the item total does not move", async () => {
    // The property that makes a head count reconcile with its own history
    // instead of being asserted. This is what `livestock` needs.
    const item = await newItem("Broiler chicks", "head");
    const batch = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "BATCH-1", source: "purchased" }),
    );
    await asOwner((tx) =>
      recordMovement(tx, ownerCtx(), {
        itemId: item.id,
        lotId: batch.id,
        quantity: 210,
        movementKind: "receipt",
        occurredOn: "2026-04-15",
      }),
    );

    const { child } = await asOwner((tx) =>
      splitLot(tx, ownerCtx(), {
        lotId: batch.id,
        quantity: 70,
        newCode: "PEN-1",
        occurredOn: "2026-04-16",
      }),
    );

    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, item.id));
    expect(balanceOfLot(rows, batch.id)).toBe(140);
    expect(balanceOfLot(rows, child.id)).toBe(70);
    // The whole point: nothing was created or destroyed.
    expect(balanceByItem(rows).get(item.id)).toBe(210);
  });

  it("a split child knows its parent, and the chain walks", async () => {
    const item = await newItem("Chicks 2", "head");
    const batch = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "BATCH-2" }),
    );
    await asOwner((tx) =>
      recordMovement(tx, ownerCtx(), {
        itemId: item.id,
        lotId: batch.id,
        quantity: 200,
        movementKind: "receipt",
        occurredOn: "2026-04-15",
      }),
    );
    const first = await asOwner((tx) =>
      splitLot(tx, ownerCtx(), {
        lotId: batch.id,
        quantity: 100,
        newCode: "PEN-A",
        occurredOn: "2026-04-16",
      }),
    );
    const second = await asOwner((tx) =>
      splitLot(tx, ownerCtx(), {
        lotId: first.child.id,
        quantity: 40,
        newCode: "PEN-A-1",
        occurredOn: "2026-05-01",
      }),
    );

    const chain = await asOwner((tx) =>
      lotAncestry(tx, tenantId, second.child.id),
    );
    // Lineage is demanded independently by batch management AND by
    // inspected-meat traceability. One mechanism serves both.
    expect(chain.map((l) => l.code)).toEqual(["PEN-A", "BATCH-2"]);
    expect(second.child.source).toBe(first.child.source);
  });

  it("refuses a split of nothing", async () => {
    const item = await newItem("Chicks 3", "head");
    const batch = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "BATCH-3" }),
    );
    await expect(
      asOwner((tx) =>
        splitLot(tx, ownerCtx(), {
          lotId: batch.id,
          quantity: 0,
          newCode: "NOPE",
          occurredOn: "2026-04-16",
        }),
      ),
    ).rejects.toMatchObject({ code: "ZERO_QUANTITY" });
  });

  it("a merge balances too, and records the join in both directions", async () => {
    const item = await newItem("Chicks 4", "head");
    const a = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "PEN-X" }),
    );
    const b = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "PEN-Y" }),
    );
    for (const lot of [a, b]) {
      await asOwner((tx) =>
        recordMovement(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 60,
          movementKind: "receipt",
          occurredOn: "2026-05-01",
        }),
      );
    }
    await asOwner((tx) =>
      mergeLot(tx, ownerCtx(), {
        fromLotId: a.id,
        intoLotId: b.id,
        quantity: 60,
        occurredOn: "2026-06-01",
      }),
    );

    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, item.id));
    expect(balanceOfLot(rows, a.id)).toBe(0);
    expect(balanceOfLot(rows, b.id)).toBe(120);
    expect(balanceByItem(rows).get(item.id)).toBe(120);
  });

  it("refuses to merge lots of different items", async () => {
    // That would produce a balance denominated in two units — the exact bug
    // the one-stocking-unit rule exists to prevent.
    const a = await newItem("Merge A");
    const b = await newItem("Merge B", "each");
    const lotA = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: a.id, code: "MA" }),
    );
    const lotB = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: b.id, code: "MB" }),
    );
    await expect(
      asOwner((tx) =>
        mergeLot(tx, ownerCtx(), {
          fromLotId: lotA.id,
          intoLotId: lotB.id,
          quantity: 1,
          occurredOn: "2026-06-01",
        }),
      ),
    ).rejects.toMatchObject({ code: "LOT_INVALID" });
  });

  it("refuses to merge a lot into itself", async () => {
    const item = await newItem("Self merge", "head");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "SM" }),
    );
    await expect(
      asOwner((tx) =>
        mergeLot(tx, ownerCtx(), {
          fromLotId: lot.id,
          intoLotId: lot.id,
          quantity: 1,
          occurredOn: "2026-06-01",
        }),
      ),
    ).rejects.toMatchObject({ code: "LOT_INVALID" });
  });

  it("refuses a lineage cycle", async () => {
    const item = await newItem("Cycle", "head");
    const root = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "ROOT" }),
    );
    const child = await asOwner((tx) =>
      createLot(tx, ownerCtx(), {
        itemId: item.id,
        code: "CHILD",
        parentLotId: root.id,
      }),
    );
    // The CHECK catches only self-parenting; a longer loop has to be refused
    // in the write path, because a CHECK cannot see other rows.
    await expect(
      asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "BAD",
          parentLotId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    ).rejects.toMatchObject({ code: "LOT_INVALID" });
    expect(child.parentLotId).toBe(root.id);
  });

  // ---- items -----------------------------------------------------------

  it("refuses a stocking unit it cannot convert or add", async () => {
    await expect(
      asOwner((tx) =>
        createItem(tx, ownerCtx(), { name: "Mystery", stockingUnit: "hogshead" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_UNIT" });
  });

  it("refuses to change the stocking unit once anything has moved", async () => {
    // Every movement was recorded in the old unit, so changing the column
    // alone would silently re-denominate the entire ledger.
    const item = await newItem("Locked feed");
    await asOwner((tx) =>
      updateItem(tx, ownerCtx(), item.id, { stockingUnit: "ton" }),
    );
    expect((await asOwner((tx) => getItem(tx, tenantId, item.id)))?.stockingUnit).toBe(
      "ton",
    );

    await asOwner((tx) =>
      recordMovement(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 1,
        movementKind: "receipt",
        occurredOn: "2026-08-01",
      }),
    );
    await expect(
      asOwner((tx) => updateItem(tx, ownerCtx(), item.id, { stockingUnit: "lb" })),
    ).rejects.toMatchObject({ code: "INVALID_UNIT" });
  });

  it("archives an item without touching its history", async () => {
    const item = await newItem("Old feed");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "OF-1" }),
    );
    await asOwner((tx) =>
      recordMovement(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 10,
        movementKind: "receipt",
        occurredOn: "2026-08-01",
      }),
    );
    await asOwner((tx) => archiveItem(tx, ownerCtx(), item.id));
    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, item.id));
    expect(rows).toHaveLength(1);
    expect((await asOwner((tx) => listLots(tx, tenantId, { itemId: item.id })))).toHaveLength(1);
  });

  it("refuses staff writes everywhere", async () => {
    const item = await newItem("Role check");
    await expect(
      asOwner((tx) =>
        createItem(tx, staffCtx(), { name: "Nope", stockingUnit: "lb" }),
      ),
    ).rejects.toThrow(InventoryError);
    await expect(
      asOwner((tx) => createLot(tx, staffCtx(), { itemId: item.id, code: "N" })),
    ).rejects.toThrow(InventoryError);
    await expect(
      asOwner((tx) =>
        recordMovement(tx, staffCtx(), {
          itemId: item.id,
          quantity: 1,
          movementKind: "receipt",
          occurredOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow(InventoryError);
  });

  it("stores quantities at the column's scale", async () => {
    const item = await newItem("Precise feed");
    const movement = await asOwner((tx) =>
      recordMovement(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 12.3456,
        movementKind: "receipt",
        occurredOn: "2026-08-01",
      }),
    );
    expect(movement.quantity).toBe(12.3456);
  });
});
