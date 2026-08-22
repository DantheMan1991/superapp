import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `inventory` RLS — items, the lot spine, and the movement ledger.
 *
 * The movement ledger is the most sensitive thing this pack holds: it IS the
 * traceability chain, so "no context, no rows" has to be true of it in its own
 * right rather than by way of its item's policy.
 *
 * It also certifies the four composite FKs, which are what this pack has that a
 * flat list of stock would not. A lot on another tenant's item, a movement on
 * another tenant's lot, and stock in another tenant's freezer are all
 * UNREPRESENTABLE rather than merely refused — they fail even under
 * `withSystem`, where RLS is not watching.
 *
 * Fixtures are built under `withSystem` on purpose: this suite certifies what
 * the DATABASE enforces, and routing setup through `src/packs/inventory/ops.ts`
 * would let a bug there make these tests agree with it. The dimension-sync and
 * split-balances guarantees live in tests/inventory-ops.test.ts instead.
 */
d("inventory tables (RLS)", () => {
  const STAMP = `iso-inv-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let feedA: string;
  let lotA: string;
  let freezerA: string;
  let itemB: string;
  let lotB: string;
  let countA: string;
  let countB: string;
  let lineA: string;
  let movementA: string;
  let movementB: string;
  let billLineA: string;
  let billLineB: string;
  let allocationA: string;
  let costAdjustmentA: string;

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Inv A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Inv B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const asset = await tx
        .insert(schema.assets)
        .values({ tenantId: tenantA, kind: "equipment", name: "Freezer A" })
        .returning();
      freezerA = asset[0].id;

      const items = await tx
        .insert(schema.inventoryItems)
        .values([
          { tenantId: tenantA, name: "Layer pellets", stockingUnit: "lb" },
          { tenantId: tenantB, name: "Their hay", stockingUnit: "lb" },
        ])
        .returning();
      feedA = items[0].id;
      itemB = items[1].id;

      const lots = await tx
        .insert(schema.inventoryLots)
        .values([
          { tenantId: tenantA, itemId: feedA, code: "LP-1" },
          { tenantId: tenantB, itemId: itemB, code: "TH-1" },
        ])
        .returning();
      lotA = lots[0].id;
      lotB = lots[1].id;

      const movements = await tx
        .insert(schema.inventoryMovements)
        .values([
          {
            tenantId: tenantA,
            itemId: feedA,
            lotId: lotA,
            locationAssetId: freezerA,
            quantity: 500,
            movementKind: "receipt",
            occurredOn: "2026-08-01",
            costCents: 50_000,
          },
          {
            tenantId: tenantB,
            itemId: itemB,
            lotId: lotB,
            quantity: 20,
            movementKind: "receipt",
            occurredOn: "2026-08-01",
            costCents: 2_000,
          },
        ])
        .returning();
      movementA = movements[0].id;
      movementB = movements[1].id;

      // Slice 3b: a bill line per tenant, and an allocation joining it to that
      // tenant's own receipt. Built here under withSystem for the same reason
      // every other fixture in this file is — so a bug in the ops cannot make
      // this suite agree with it.
      const parties = await tx
        .insert(schema.parties)
        .values([
          { tenantId: tenantA, kind: "organization", displayName: "Feed Co A" },
          { tenantId: tenantB, kind: "organization", displayName: "Feed Co B" },
        ])
        .returning();
      const vendors = await tx
        .insert(schema.vendors)
        .values([
          { tenantId: tenantA, partyId: parties[0].id, name: "Feed Co A" },
          { tenantId: tenantB, partyId: parties[1].id, name: "Feed Co B" },
        ])
        .returning();
      // These fixtures are bare tenants — no accounting is provisioned here, so
      // the company a bill belongs to has to be made by hand. Nothing in this
      // suite reads the books; the entity exists only so a bill row is legal.
      const entitiesRows = await tx
        .insert(schema.entities)
        .values([
          { tenantId: tenantA, name: "Farm A", isDefault: true },
          { tenantId: tenantB, name: "Farm B", isDefault: true },
        ])
        .returning();
      const entityOf = (t: string) =>
        entitiesRows.find((e) => e.tenantId === t)!.id;
      const bills = await tx
        .insert(schema.bills)
        .values([
          {
            tenantId: tenantA,
            entityId: entityOf(tenantA),
            vendorId: vendors[0].id,
            billDate: "2026-08-02",
            createdByClerkUserId: OWNER,
          },
          {
            tenantId: tenantB,
            entityId: entityOf(tenantB),
            vendorId: vendors[1].id,
            billDate: "2026-08-02",
            createdByClerkUserId: OTHER,
          },
        ])
        .returning();
      const billLines = await tx
        .insert(schema.billLines)
        .values([
          {
            tenantId: tenantA,
            billId: bills[0].id,
            lineNo: 1,
            description: "Feed",
            amountCents: 50_000,
          },
          {
            tenantId: tenantB,
            billId: bills[1].id,
            lineNo: 1,
            description: "Feed",
            amountCents: 2_000,
          },
        ])
        .returning();
      billLineA = billLines[0].id;
      billLineB = billLines[1].id;

      const allocations = await tx
        .insert(schema.billLineStockAllocations)
        .values([
          {
            tenantId: tenantA,
            billLineId: billLineA,
            inventoryMovementId: movementA,
            quantityMatched: 500,
            receiptCostCents: 50_000,
            invoiceCostCents: 50_000,
          },
          {
            tenantId: tenantB,
            billLineId: billLineB,
            inventoryMovementId: movementB,
            quantityMatched: 20,
            receiptCostCents: 2_000,
            invoiceCostCents: 2_000,
          },
        ])
        .returning();
      allocationA = allocations[0].id;
    });
  });

  beforeAll(async () => {
    // Slice 2's tables, built the same way and for the same reason: what the
    // DATABASE enforces, not what the ops layer happens to do.
    await withSystem(async (tx) => {
      const counts = await tx
        .insert(schema.inventoryCounts)
        .values([
          { tenantId: tenantA, countedOn: "2026-08-20", countedBy: "A" },
          { tenantId: tenantB, countedOn: "2026-08-20", countedBy: "B" },
        ])
        .returning();
      countA = counts[0].id;
      countB = counts[1].id;

      const lines = await tx
        .insert(schema.inventoryCountLines)
        .values([
          {
            tenantId: tenantA,
            countId: countA,
            itemId: feedA,
            lotId: lotA,
            countedQuantity: 12,
          },
          {
            tenantId: tenantB,
            countId: countB,
            itemId: itemB,
            lotId: lotB,
            countedQuantity: 34,
          },
        ])
        .returning();
      lineA = lines[0].id;

      // Slice 3d. Same reasoning again: built by the database, not by the ops
      // layer, so a bug in `adjustLotCost` cannot make these tests agree with it.
      const corrections = await tx
        .insert(schema.inventoryCostAdjustments)
        .values([
          {
            tenantId: tenantA,
            itemId: feedA,
            lotId: lotA,
            occurredOn: "2026-08-21",
            amountCents: 6_000,
            onHandCents: 3_600,
            issuedCents: 2_400,
            quantityOnHand: 60,
            quantityReceived: 100,
            reason: "freight_omitted",
          },
          {
            tenantId: tenantB,
            itemId: itemB,
            lotId: lotB,
            occurredOn: "2026-08-21",
            amountCents: -900,
            onHandCents: -900,
            issuedCents: 0,
            quantityOnHand: 34,
            quantityReceived: 34,
            reason: "ticket_wrong",
          },
        ])
        .returning();
      costAdjustmentA = corrections[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.profiles)
        .where(inArray(schema.profiles.clerkUserId, [OWNER, MATE, OTHER]));
    });
  });

  // ---- items -----------------------------------------------------------

  it("a tenant sees only its own items", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.inventoryItems));
    expect(mine.map((i) => i.name)).toEqual(["Layer pellets"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.inventoryItems),
    );
    expect(theirs.map((i) => i.name)).toEqual(["Their hay"]);
  });

  it("cannot read, update or delete another tenant's item", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.inventoryItems)
          .where(eq(schema.inventoryItems.id, itemB)),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.inventoryItems)
          .set({ name: "Stolen" })
          .where(eq(schema.inventoryItems.id, itemB))
          .returning(),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.inventoryItems)
          .where(eq(schema.inventoryItems.id, itemB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("cannot move an item into another tenant", async () => {
    // THROWS rather than returning zero rows: the row is visible, and it is the
    // new values that leave the tenant, so WITH CHECK refuses with 42501.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.inventoryItems)
          .set({ tenantId: tenantB })
          .where(eq(schema.inventoryItems.id, feedA)),
      ),
    ).rejects.toThrow();
  });

  // ---- lots ------------------------------------------------------------

  it("a tenant sees only its own lots", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.inventoryLots));
    expect(mine.map((l) => l.code)).toEqual(["LP-1"]);
  });

  it("cannot put a lot on another tenant's item", async () => {
    // The composite FK makes it unrepresentable, so it fails even here under
    // withSystem where RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.inventoryLots)
          .values({ tenantId: tenantA, itemId: itemB, code: "TRESPASS" }),
      ),
    ).rejects.toThrow();
  });

  it("cannot parent a lot to another tenant's lot", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryLots).values({
          tenantId: tenantA,
          itemId: feedA,
          code: "CROSS",
          parentLotId: lotB,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a lot that is its own parent", async () => {
    const rows = await withSystem((tx) =>
      tx
        .select()
        .from(schema.inventoryLots)
        .where(eq(schema.inventoryLots.id, lotA)),
    );
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.inventoryLots)
          .set({ parentLotId: rows[0].id })
          .where(eq(schema.inventoryLots.id, lotA)),
      ),
    ).rejects.toThrow();
  });

  // ---- the movement ledger ---------------------------------------------

  it("the ledger is protected in its own right, not by its item's policy", async () => {
    // It would have been tempting to lean on the composite FK, since a
    // movement has no meaning without its item. That would be depending on a
    // constraint to do a policy's job — and this table IS the traceability
    // chain, the most sensitive thing the pack holds.
    const mine = await asOwner((tx) =>
      tx.select().from(schema.inventoryMovements),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].itemId).toBe(feedA);

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.inventoryMovements),
    );
    expect(theirs).toHaveLength(1);
    expect(theirs[0].itemId).toBe(itemB);
  });

  it("cannot write a movement into another tenant", async () => {
    await expect(
      asOtherTenant((tx) =>
        tx.insert(schema.inventoryMovements).values({
          tenantId: tenantA,
          itemId: feedA,
          quantity: 1,
          movementKind: "receipt",
          occurredOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot put stock in another tenant's location", async () => {
    // Locations ARE assets, and the composite FK is what stops one tenant's
    // stock sitting in another's freezer.
    await expect(
      withSystem(async (tx) => {
        const otherAsset = await tx
          .insert(schema.assets)
          .values({ tenantId: tenantB, kind: "equipment", name: "Their freezer" })
          .returning();
        return tx.insert(schema.inventoryMovements).values({
          tenantId: tenantA,
          itemId: feedA,
          quantity: 1,
          movementKind: "receipt",
          occurredOn: "2026-08-01",
          locationAssetId: otherAsset[0].id,
        });
      }),
    ).rejects.toThrow();
  });

  it("refuses a movement of zero at the database, not only in the pack", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryMovements).values({
          tenantId: tenantA,
          itemId: feedA,
          quantity: 0,
          movementKind: "receipt",
          occurredOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  // ---- shared ----------------------------------------------------------

  it("staff see the same stock as an owner — RLS is tenancy, not role", async () => {
    // Whoever is sent to fetch the ribeyes has to be able to find them. Who may
    // WRITE is gated in the pack's action layer.
    expect(
      (await asStaff((tx) => tx.select().from(schema.inventoryItems))).map(
        (i) => i.name,
      ),
    ).toEqual(["Layer pellets"]);
    expect(
      await asStaff((tx) => tx.select().from(schema.inventoryMovements)),
    ).toHaveLength(1);
  });

  // ---- counts ----------------------------------------------------------

  it("a tenant sees only its own counts and their lines", async () => {
    expect(
      (await asStaff((tx) => tx.select().from(schema.inventoryCounts))).map(
        (c) => c.countedBy,
      ),
    ).toEqual(["A"]);
    expect(
      (await asStaff((tx) => tx.select().from(schema.inventoryCountLines))).map(
        (l) => l.countedQuantity,
      ),
    ).toEqual([12]);
    expect(
      (await asOtherTenant((tx) => tx.select().from(schema.inventoryCounts))).map(
        (c) => c.countedBy,
      ),
    ).toEqual(["B"]);
  });

  it("cannot read, update or delete another tenant's count", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.inventoryCounts)
          .where(eq(schema.inventoryCounts.id, countB)),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.inventoryCounts)
          .set({ countedBy: "Stolen" })
          .where(eq(schema.inventoryCounts.id, countB))
          .returning(),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.inventoryCounts)
          .where(eq(schema.inventoryCounts.id, countB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("cannot move a count into another tenant", async () => {
    // THROWS rather than returning zero rows: the row is visible and it is the
    // new values that leave the tenant, so WITH CHECK refuses with 42501.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.inventoryCounts)
          .set({ tenantId: tenantB })
          .where(eq(schema.inventoryCounts.id, countA)),
      ),
    ).rejects.toThrow();
  });

  it("CANNOT COUNT ANOTHER TENANT'S SHELF ONTO THIS FARM'S COUNT", async () => {
    /**
     * The one that matters here. A count line is the evidence behind an
     * adjustment — it is what says the variance came from somebody walking the
     * shelves rather than from somebody typing a number they liked better. A
     * line naming another tenant's batch would post a correction to stock that
     * was never counted.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCountLines).values({
          tenantId: tenantA,
          countId: countA,
          itemId: feedA,
          lotId: lotB,
          countedQuantity: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot put a line on another tenant's count, or count their item", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCountLines).values({
          tenantId: tenantA,
          countId: countB,
          itemId: feedA,
          countedQuantity: 1,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCountLines).values({
          tenantId: tenantA,
          countId: countA,
          itemId: itemB,
          countedQuantity: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot count the same batch twice on one count", async () => {
    // Counting the same shelf twice in one walk and getting two answers is a
    // question for the person holding the clipboard, not two variances.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCountLines).values({
          tenantId: tenantA,
          countId: countA,
          itemId: feedA,
          lotId: lotA,
          countedQuantity: 99,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a count line into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.inventoryCountLines)
          .set({ tenantId: tenantB })
          .where(eq(schema.inventoryCountLines.id, lineA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses a posted status with no posted date, and the reverse", async () => {
    // Posted means BOTH. A half-finished post would leave a count claiming its
    // variances are in the ledger with nothing to say when.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCounts).values({
          tenantId: tenantA,
          countedOn: "2026-08-20",
          status: "posted",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCounts).values({
          tenantId: tenantA,
          countedOn: "2026-08-20",
          postedOn: "2026-08-20",
        }),
      ),
    ).rejects.toThrow();
  });

// ---- slice 3b: bill-to-stock allocations --------------------------------

  it("a tenant sees only its own bill-to-stock allocations", async () => {
    const mine = await asStaff((tx) =>
      tx.select().from(schema.billLineStockAllocations),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(allocationA);
    expect(
      await asOtherTenant((tx) =>
        tx.select().from(schema.billLineStockAllocations),
      ),
    ).toHaveLength(1);
  });

  it("CANNOT SETTLE ANOTHER TENANT'S DELIVERY", async () => {
    /**
     * The sharpest one here. An allocation clears a liability against a
     * receipt — pointing one across the boundary would settle this business's
     * bill using another business's stock, and the GRNI reconciliation that
     * exists to catch a mistake would report the account as balanced.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.billLineStockAllocations).values({
          tenantId: tenantA,
          billLineId: billLineA,
          inventoryMovementId: movementB,
          quantityMatched: 1,
          receiptCostCents: 100,
          invoiceCostCents: 100,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot attach an allocation to another tenant's bill line", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.billLineStockAllocations).values({
          tenantId: tenantA,
          billLineId: billLineB,
          inventoryMovementId: movementA,
          quantityMatched: 1,
          receiptCostCents: 100,
          invoiceCostCents: 100,
        }),
      ),
    ).rejects.toThrow();
  });

  it("settles a given delivery from a given line only ONCE", async () => {
    // A second match against the same pair is a correction to the first, not a
    // second settlement. Without this a double-submitted match clears GRNI twice.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.billLineStockAllocations).values({
          tenantId: tenantA,
          billLineId: billLineA,
          inventoryMovementId: movementA,
          quantityMatched: 1,
          receiptCostCents: 100,
          invoiceCostCents: 100,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a non-positive matched quantity", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.billLineStockAllocations).values({
          tenantId: tenantA,
          billLineId: billLineA,
          inventoryMovementId: movementA,
          quantityMatched: 0,
          receiptCostCents: 0,
          invoiceCostCents: 0,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move an allocation into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.billLineStockAllocations)
          .set({ tenantId: tenantB })
          .where(eq(schema.billLineStockAllocations.id, allocationA)),
      ),
    ).rejects.toThrow();
  });

  it("DIES WITH ITS BILL LINE, because a draft edit re-creates every line", async () => {
    /**
     * `updateBillDraft` deletes and re-inserts every line of a draft, so a bill
     * line id does not survive an edit. Without the cascade this table would
     * accumulate rows pointing at lines that no longer exist — and each one
     * would still be clearing GRNI.
     */
    await withSystem(async (tx) => {
      const line = await tx
        .insert(schema.billLines)
        .values({
          tenantId: tenantA,
          billId: (await tx.query.billLines.findFirst({
            where: eq(schema.billLines.id, billLineA),
          }))!.billId,
          lineNo: 99,
          description: "Doomed",
          amountCents: 100,
        })
        .returning();
      const movement = await tx
        .insert(schema.inventoryMovements)
        .values({
          tenantId: tenantA,
          itemId: feedA,
          quantity: 1,
          movementKind: "receipt",
          occurredOn: "2026-08-03",
          costCents: 100,
        })
        .returning();
      await tx.insert(schema.billLineStockAllocations).values({
        tenantId: tenantA,
        billLineId: line[0].id,
        inventoryMovementId: movement[0].id,
        quantityMatched: 1,
        receiptCostCents: 100,
        invoiceCostCents: 100,
      });
      await tx.delete(schema.billLines).where(eq(schema.billLines.id, line[0].id));
      const left = await tx
        .select()
        .from(schema.billLineStockAllocations)
        .where(
          eq(schema.billLineStockAllocations.inventoryMovementId, movement[0].id),
        );
      expect(left).toHaveLength(0);
    });
  });

// ---- slice 3d: cost corrections -----------------------------------------

  it("a tenant sees only its own cost corrections", async () => {
    const mine = await asStaff((tx) =>
      tx.select().from(schema.inventoryCostAdjustments),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(costAdjustmentA);
    expect(
      await asOtherTenant((tx) =>
        tx.select().from(schema.inventoryCostAdjustments),
      ),
    ).toHaveLength(1);
  });

  it("CANNOT CORRECT ANOTHER TENANT'S BATCH", async () => {
    /**
     * These rows feed the cost fold — `lotCarried` reads them beside the
     * movements — so one pointing across the boundary would put this business's
     * money onto another's balance sheet, and the valuation screen would report
     * it as that farm's stock. Unrepresentable rather than merely refused: the
     * composite FK fails even under `withSystem`.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCostAdjustments).values({
          tenantId: tenantA,
          itemId: feedA,
          lotId: lotB,
          occurredOn: "2026-08-21",
          amountCents: 100,
          onHandCents: 100,
          issuedCents: 0,
          quantityOnHand: 1,
          quantityReceived: 1,
          reason: "ticket_wrong",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot point a correction at another tenant's item", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCostAdjustments).values({
          tenantId: tenantA,
          itemId: itemB,
          lotId: lotA,
          occurredOn: "2026-08-21",
          amountCents: 100,
          onHandCents: 100,
          issuedCents: 0,
          quantityOnHand: 1,
          quantityReceived: 1,
          reason: "ticket_wrong",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a correction of nothing", async () => {
    // Mirrors the movement ledger's `quantity <> 0`, on the column that carries
    // the meaning here. A correction of zero is not a correction.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCostAdjustments).values({
          tenantId: tenantA,
          itemId: feedA,
          lotId: lotA,
          occurredOn: "2026-08-21",
          amountCents: 0,
          onHandCents: 0,
          issuedCents: 0,
          quantityOnHand: 1,
          quantityReceived: 1,
          reason: "ticket_wrong",
        }),
      ),
    ).rejects.toThrow();
  });

  it("REFUSES A SPLIT THAT DOES NOT ADD UP TO THE CORRECTION", async () => {
    /**
     * The two halves are derived once and then stored, so this CHECK is what
     * stops a later caller storing halves that do not account for the whole. A
     * correction whose parts fall short leaves the ledger and the batch's
     * carrying value permanently apart by the difference, with nothing anywhere
     * to say by how much.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.inventoryCostAdjustments).values({
          tenantId: tenantA,
          itemId: feedA,
          lotId: lotA,
          occurredOn: "2026-08-21",
          amountCents: 6_000,
          onHandCents: 3_600,
          issuedCents: 2_000,
          quantityOnHand: 60,
          quantityReceived: 100,
          reason: "ticket_wrong",
        }),
      ),
    ).rejects.toThrow();
  });

  it("ACCEPTS A CORRECTION DOWNWARDS, which a movement could not carry", async () => {
    /**
     * The reason this is a table of its own rather than a movement kind:
     * `inventory_movements` CHECKs `cost_cents >= 0`, and a ticket overstates as
     * easily as it understates. ADR 0012 §A.4.
     */
    const rows = await withSystem((tx) =>
      tx
        .insert(schema.inventoryCostAdjustments)
        .values({
          tenantId: tenantA,
          itemId: feedA,
          lotId: lotA,
          occurredOn: "2026-08-21",
          amountCents: -5_000,
          onHandCents: -3_000,
          issuedCents: -2_000,
          quantityOnHand: 60,
          quantityReceived: 100,
          reason: "discount_applied",
        })
        .returning(),
    );
    expect(rows[0].amountCents).toBe(-5_000);
    await withSystem((tx) =>
      tx
        .delete(schema.inventoryCostAdjustments)
        .where(eq(schema.inventoryCostAdjustments.id, rows[0].id)),
    );
  });

  it("cannot move a cost correction into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.inventoryCostAdjustments)
          .set({ tenantId: tenantB })
          .where(eq(schema.inventoryCostAdjustments.id, costAdjustmentA)),
      ),
    ).rejects.toThrow();
  });

  it("is default-deny on every table in the pack with no tenant context", async () => {
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.inventoryItems)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.inventoryLots)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.inventoryMovements),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.billLineStockAllocations),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.inventoryCounts)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.inventoryCountLines),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.inventoryCostAdjustments),
      ),
    ).toHaveLength(0);
  });
});
