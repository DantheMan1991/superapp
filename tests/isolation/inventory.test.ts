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

      await tx.insert(schema.inventoryMovements).values([
        {
          tenantId: tenantA,
          itemId: feedA,
          lotId: lotA,
          locationAssetId: freezerA,
          quantity: 500,
          movementKind: "receipt",
          occurredOn: "2026-08-01",
        },
        {
          tenantId: tenantB,
          itemId: itemB,
          lotId: lotB,
          quantity: 20,
          movementKind: "receipt",
          occurredOn: "2026-08-01",
        },
      ]);
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

  it("is default-deny on all three tables with no tenant context", async () => {
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
  });
});
