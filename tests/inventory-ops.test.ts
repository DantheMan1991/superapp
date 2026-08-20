import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
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
  listLocations,
} from "../src/packs/inventory/ops";
import { balanceOfLot, balanceByItem } from "../src/packs/inventory/core/balances";
import {
  consumedByLot,
  consumedCostByLot,
  issueStock,
  itemCostRate,
  receiveStock,
} from "../src/packs/inventory/ops";

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
        .values({
          tenantId,
          kind: "equipment",
          name: "Chest freezer",
          // A freezer is `equipment`, exactly like a tractor — which is why
          // "is it a place?" is a flag on the asset and not a kind rule.
          isStorageLocation: true,
        })
        .returning();
      freezerId = asset[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("offers only the places things are kept", async () => {
    /**
     * FOUND BY DRIVING, 2026-08-19: `listLocations` returned every active asset,
     * so the "Where" picker offered a gate and a tractor as places to put
     * chickens — a function whose name claimed a filter it never applied, which
     * is the same defect `land`'s `listStructures` carried.
     *
     * A KIND FILTER CANNOT FIX THIS, and that is what the tractor below is for:
     * it is `equipment`, exactly like the freezer. Any rule keyed on kind either
     * admits it or excludes the freezer.
     */
    const tractorId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({ tenantId, kind: "equipment", name: "Tractor" })
        .returning();
      return rows[0].id;
    });

    const locations = await asOwner((tx) => listLocations(tx, tenantId));
    const ids = locations.map((l) => l.id);
    expect(ids).toContain(freezerId);
    expect(ids).not.toContain(tractorId);
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

  it("lets STAFF record a movement, because feeding out is a chore", async () => {
    // Settled 2026-08-15. Every ledger row here is somebody reporting what
    // they physically did with a bag of feed. Requiring the owner for that
    // does not make the count safer, it makes the count empty.
    const item = await newItem("Chore check");
    const movement = await asOwner((tx) =>
      recordMovement(tx, staffCtx(), {
        itemId: item.id,
        quantity: -1,
        movementKind: "consumption",
        occurredOn: "2026-08-01",
      }),
    );
    expect(movement.quantity).toBe(-1);
  });

  it("keeps items and lots with the OWNER, because both are cost objects", async () => {
    // A lot is a dimension member — `upsertDimensionMember` requires the owner
    // role, so a staff-created lot would exist with nothing to group it by.
    // Splitting creates a lot, so it is on this side of the line even though
    // it feels like a chore. See src/lib/packs/authorize.ts.
    const item = await newItem("Role check");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "SPLIT-SRC" }),
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

    await expect(
      asOwner((tx) =>
        createItem(tx, staffCtx(), { name: "Nope", stockingUnit: "lb" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      asOwner((tx) => createLot(tx, staffCtx(), { itemId: item.id, code: "N" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      asOwner((tx) => archiveItem(tx, staffCtx(), item.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      asOwner((tx) =>
        splitLot(tx, staffCtx(), {
          lotId: lot.id,
          quantity: 4,
          newCode: "SPLIT-DST",
          occurredOn: "2026-08-02",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

  // ---- slice 1: receipts, issues, and the loop they close -----------------

  describe("receipts and issues", () => {
    it("puts money on the farm, and the rate falls out of the ledger", async () => {
      const feed = await newItem("Layer pellets");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: feed.id,
          newLotCode: "DELIVERY-1",
          quantity: 600,
          costCents: 34_000,
          occurredOn: "2026-08-01",
        }),
      );
      // 34000 cents over 600 lb. Computed, never stored — the same rule the
      // quantity balance follows.
      const rate = await asOwner((tx) => itemCostRate(tx, tenantId, feed.id));
      expect(rate).toBeCloseTo(56.6667, 3);
    });

    it("STAMPS the issue cost, so a later delivery cannot rewrite what a pen cost", async () => {
      // The sharpest property in this slice. If cost were derived at read time,
      // buying dearer feed next month would retroactively change last month's
      // pen and every FCR comparison would move under its own feet.
      const feed = await newItem("Broiler crumble");
      const pen = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: feed.id, code: "PEN-COST-1" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: feed.id,
          newLotCode: "CHEAP",
          quantity: 100,
          costCents: 1_000,
          occurredOn: "2026-08-01",
        }),
      );
      const issued = await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: feed.id,
          quantity: 10,
          issuedToLotId: pen.id,
          occurredOn: "2026-08-02",
        }),
      );
      expect(issued.costCents).toBe(100);

      // Now buy dearer feed. The stamped issue does not move.
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: feed.id,
          newLotCode: "DEAR",
          quantity: 100,
          costCents: 9_000,
          occurredOn: "2026-08-03",
        }),
      );
      const after = await asOwner((tx) => consumedCostByLot(tx, tenantId, [pen.id]));
      expect(after.get(pen.id)).toBe(100);

      // But the NEXT issue costs at the new average — 10000 cents over 200 lb.
      const later = await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: feed.id,
          quantity: 10,
          issuedToLotId: pen.id,
          occurredOn: "2026-08-04",
        }),
      );
      expect(later.costCents).toBe(500);
    });

    it("feeds one item's stock to a lot of a DIFFERENT item, which is the whole point", async () => {
      // Feed is not the same item as the birds that eat it. The consuming lot
      // is deliberately unconstrained as to item for exactly this reason.
      const feed = await newItem("Grower ration");
      const birds = await newItem("Broiler chicks", "head");
      const pen = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: birds.id, code: "PEN-MIXED" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: feed.id,
          newLotCode: "MIX-DELIVERY",
          quantity: 200,
          costCents: 10_000,
          occurredOn: "2026-08-01",
        }),
      );
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: feed.id,
          quantity: 50,
          issuedToLotId: pen.id,
          occurredOn: "2026-08-02",
        }),
      );

      const cost = await asOwner((tx) => consumedCostByLot(tx, tenantId, [pen.id]));
      expect(cost.get(pen.id)).toBe(2_500);

      const eaten = await asOwner((tx) => consumedByLot(tx, tenantId, pen.id));
      expect(eaten).toHaveLength(1);
      expect(eaten[0].itemId).toBe(feed.id);
      // The BIRD lot's own quantity is untouched: feeding a pen does not
      // change how many birds are in it.
      const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, birds.id));
      expect(balanceOfLot(rows, pen.id)).toBe(0);
    });

    it("issues at no cost when nothing priced has ever arrived", async () => {
      // Raised stock has no purchase basis. Inventing a zero would report a
      // pen as free, which is worse than reporting nothing.
      const eggs = await newItem("Eggs", "dozen");
      const issued = await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: eggs.id,
          quantity: 2,
          occurredOn: "2026-08-02",
        }),
      );
      expect(issued.costCents).toBeNull();
    });

    it("takes the quantity out of stock, signed, like every other movement", async () => {
      const feed = await newItem("Scratch grain");
      const received = await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: feed.id,
          newLotCode: "SCRATCH-1",
          quantity: 500,
          costCents: 20_000,
          occurredOn: "2026-08-01",
        }),
      );
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: feed.id,
          lotId: received.lotId,
          quantity: 120,
          occurredOn: "2026-08-02",
        }),
      );
      const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, feed.id));
      expect(balanceOfLot(rows, received.lotId!)).toBe(380);
    });

    it("refuses a negative cost", async () => {
      const feed = await newItem("Refusal feed");
      await expect(
        asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: feed.id,
            newLotCode: "BAD-COST",
            quantity: 10,
            costCents: -1,
            occurredOn: "2026-08-01",
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_COST" });
    });

    it("refuses to feed a lot that does not exist", async () => {
      const feed = await newItem("Ghost feed");
      await expect(
        asOwner((tx) =>
          issueStock(tx, ownerCtx(), {
            itemId: feed.id,
            quantity: 5,
            issuedToLotId: "00000000-0000-0000-0000-000000000000",
            occurredOn: "2026-08-02",
          }),
        ),
      ).rejects.toMatchObject({ code: "LOT_INVALID" });
    });
  });
});
