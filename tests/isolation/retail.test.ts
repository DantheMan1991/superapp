import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `retail` RLS — channels, prices and days of selling.
 *
 * **`retail_prices` IS THE SENSITIVE ONE.** It is not a settings row: it is an
 * effective-dated record of what this business charged on a given day, and once
 * sales hang off it in slice 1 it becomes the evidence behind every revenue
 * figure. A price from another tenant appearing here would not merely expose a
 * number — it would silently restate what this farm's own sales were worth.
 *
 * The composite FKs are what make the cross-tenant shapes UNREPRESENTABLE rather
 * than merely refused: a price on another tenant's item, a price in another
 * tenant's channel, and a day of selling at somebody else's stall all fail even
 * under `withSystem`, where RLS is not watching.
 */
d("retail tables (RLS)", () => {
  const STAMP = `iso-retail-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let itemA: string;
  let itemB: string;
  let channelA: string;
  let channelB: string;
  let priceA: string;
  let dayA: string;
  let dayB: string;
  let saleA: string;
  let saleB: string;
  let lineA: string;
  let movementA: string;
  let movementB: string;
  let stockoutA: string;

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
          { clerkOrgId: `${STAMP}-a`, name: "Retail A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Retail B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const items = await tx
        .insert(schema.inventoryItems)
        .values([
          { tenantId: tenantA, name: "A beef", stockingUnit: "lb" },
          { tenantId: tenantB, name: "B beef", stockingUnit: "lb" },
        ])
        .returning();
      itemA = items[0].id;
      itemB = items[1].id;

      const channels = await tx
        .insert(schema.retailChannels)
        .values([
          { tenantId: tenantA, name: "A market" },
          { tenantId: tenantB, name: "B market" },
        ])
        .returning();
      channelA = channels[0].id;
      channelB = channels[1].id;

      const prices = await tx
        .insert(schema.retailPrices)
        .values([
          {
            tenantId: tenantA,
            channelId: channelA,
            itemId: itemA,
            priceCents: 900,
            effectiveFrom: "2026-01-01",
          },
          {
            tenantId: tenantB,
            channelId: channelB,
            itemId: itemB,
            priceCents: 700,
            effectiveFrom: "2026-01-01",
          },
        ])
        .returning();
      priceA = prices[0].id;

      const days = await tx
        .insert(schema.retailMarketDays)
        .values([
          {
            tenantId: tenantA,
            channelId: channelA,
            heldOn: "2026-08-20",
            stallFeeCents: 3_500,
          },
          {
            tenantId: tenantB,
            channelId: channelB,
            heldOn: "2026-08-20",
            stallFeeCents: 2_500,
          },
        ])
        .returning();
      dayA = days[0].id;
      dayB = days[1].id;

      // Slice 1's tables, built the same way and for the same reason: what the
      // DATABASE enforces, not what the ops layer happens to do.
      const movements = await tx
        .insert(schema.inventoryMovements)
        .values([
          {
            tenantId: tenantA,
            itemId: itemA,
            quantity: -2,
            movementKind: "issue",
            occurredOn: "2026-08-20",
          },
          {
            tenantId: tenantB,
            itemId: itemB,
            quantity: -2,
            movementKind: "issue",
            occurredOn: "2026-08-20",
          },
        ])
        .returning();
      movementA = movements[0].id;
      movementB = movements[1].id;

      const sales = await tx
        .insert(schema.retailSales)
        .values([
          {
            tenantId: tenantA,
            clientRef: "till-a-1",
            channelId: channelA,
            marketDayId: dayA,
            soldAt: new Date("2026-08-20T10:00:00Z"),
          },
          {
            tenantId: tenantB,
            clientRef: "till-b-1",
            channelId: channelB,
            marketDayId: dayB,
            soldAt: new Date("2026-08-20T10:00:00Z"),
          },
        ])
        .returning();
      saleA = sales[0].id;
      saleB = sales[1].id;

      const lines = await tx
        .insert(schema.retailSaleLines)
        .values([
          {
            tenantId: tenantA,
            saleId: saleA,
            itemId: itemA,
            quantity: 2,
            unitPriceCents: 900,
            inventoryMovementId: movementA,
          },
          {
            tenantId: tenantB,
            saleId: saleB,
            itemId: itemB,
            quantity: 2,
            unitPriceCents: 700,
            inventoryMovementId: movementB,
          },
        ])
        .returning();
      lineA = lines[0].id;

      const stockouts = await tx
        .insert(schema.retailStockouts)
        .values([
          {
            tenantId: tenantA,
            marketDayId: dayA,
            itemId: itemA,
            noticedAt: new Date("2026-08-20T11:00:00Z"),
          },
          {
            tenantId: tenantB,
            marketDayId: dayB,
            itemId: itemB,
            noticedAt: new Date("2026-08-20T11:00:00Z"),
          },
        ])
        .returning();
      stockoutA = stockouts[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  // ---- channels ---------------------------------------------------------

  it("a tenant sees only its own channels", async () => {
    expect(
      (await asOwner((tx) => tx.select().from(schema.retailChannels))).map(
        (c) => c.name,
      ),
    ).toEqual(["A market"]);
    expect(
      (await asOtherTenant((tx) => tx.select().from(schema.retailChannels))).map(
        (c) => c.name,
      ),
    ).toEqual(["B market"]);
  });

  it("cannot read, update or delete another tenant's channel", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.retailChannels)
          .where(eq(schema.retailChannels.id, channelB)),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.retailChannels)
          .set({ name: "Stolen" })
          .where(eq(schema.retailChannels.id, channelB))
          .returning(),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.retailChannels)
          .where(eq(schema.retailChannels.id, channelB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("cannot move a channel into another tenant", async () => {
    // THROWS rather than returning zero rows: the row is visible and it is the
    // new values that leave the tenant, so WITH CHECK refuses with 42501.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.retailChannels)
          .set({ tenantId: tenantB })
          .where(eq(schema.retailChannels.id, channelA)),
      ),
    ).rejects.toThrow();
  });

  // ---- prices -----------------------------------------------------------

  it("a tenant sees only its own prices", async () => {
    expect(
      (await asStaff((tx) => tx.select().from(schema.retailPrices))).map(
        (p) => p.priceCents,
      ),
    ).toEqual([900]);
  });

  it("CANNOT PRICE ANOTHER TENANT'S ITEM", async () => {
    /**
     * The one that matters most here. A price row is what says this business
     * charged this much for this thing — and once sales reference it, it is the
     * evidence behind every revenue figure. Naming another tenant's item would
     * make that claim about stock this farm never held.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailPrices).values({
          tenantId: tenantA,
          channelId: channelA,
          itemId: itemB,
          priceCents: 100,
          effectiveFrom: "2026-02-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot price into another tenant's channel", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailPrices).values({
          tenantId: tenantA,
          channelId: channelB,
          itemId: itemA,
          priceCents: 100,
          effectiveFrom: "2026-02-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot set two prices for one item in one channel on one day", async () => {
    // Two prices starting the same morning is not a change, it is a question
    // about which one is real.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailPrices).values({
          tenantId: tenantA,
          channelId: channelA,
          itemId: itemA,
          priceCents: 950,
          effectiveFrom: "2026-01-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a negative price at the database, not only in the ops", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailPrices).values({
          tenantId: tenantA,
          channelId: channelA,
          itemId: itemA,
          priceCents: -1,
          effectiveFrom: "2026-03-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a price into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.retailPrices)
          .set({ tenantId: tenantB })
          .where(eq(schema.retailPrices.id, priceA)),
      ),
    ).rejects.toThrow();
  });

  // ---- market days ------------------------------------------------------

  it("a tenant sees only its own days of selling", async () => {
    expect(
      (await asStaff((tx) => tx.select().from(schema.retailMarketDays))).map(
        (m) => m.stallFeeCents,
      ),
    ).toEqual([3_500]);
  });

  it("cannot record a day at another tenant's channel", async () => {
    // The quieter leak and still real: the whole purpose of the table is to
    // tell a market worth standing at from a dud, and another farm's stall fees
    // would answer that question wrong.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailMarketDays).values({
          tenantId: tenantA,
          channelId: channelB,
          heldOn: "2026-08-21",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a day of selling into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.retailMarketDays)
          .set({ tenantId: tenantB })
          .where(eq(schema.retailMarketDays.id, dayA)),
      ),
    ).rejects.toThrow();
  });

  // ---- default deny -----------------------------------------------------


  // ---- sales ------------------------------------------------------------

  it("a tenant sees only its own sales and their lines", async () => {
    expect(
      (await asStaff((tx) => tx.select().from(schema.retailSales))).map(
        (s) => s.clientRef,
      ),
    ).toEqual(["till-a-1"]);
    expect(
      (await asStaff((tx) => tx.select().from(schema.retailSaleLines))).map(
        (l) => l.unitPriceCents,
      ),
    ).toEqual([900]);
    expect(
      (await asOtherTenant((tx) => tx.select().from(schema.retailSales))).map(
        (s) => s.clientRef,
      ),
    ).toEqual(["till-b-1"]);
  });

  it("cannot read, update or delete another tenant's sale", async () => {
    expect(
      await asOwner((tx) =>
        tx.select().from(schema.retailSales).where(eq(schema.retailSales.id, saleB)),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.retailSales)
          .set({ notes: "Stolen" })
          .where(eq(schema.retailSales.id, saleB))
          .returning(),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.retailSales)
          .where(eq(schema.retailSales.id, saleB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("TWO TENANTS MAY USE THE SAME CLIENT REF", async () => {
    /**
     * The uniqueness that makes a replay safe is per TENANT, and it has to be:
     * two farms' tills are separate devices minting separate ids, and a
     * collision across the boundary would refuse one of them a sale it really
     * made. Same ref, different tenant, both fine.
     */
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.retailSales)
        .values({
          tenantId: tenantB,
          clientRef: "till-a-1",
          channelId: channelB,
          soldAt: new Date("2026-08-20T12:00:00Z"),
        })
        .returning();
      expect(rows).toHaveLength(1);
      await tx
        .delete(schema.retailSales)
        .where(eq(schema.retailSales.id, rows[0].id));
    });
  });

  it("cannot post the same client ref twice within a tenant", async () => {
    // The whole point of the column: a retried flush lands once.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailSales).values({
          tenantId: tenantA,
          clientRef: "till-a-1",
          channelId: channelA,
          soldAt: new Date("2026-08-20T13:00:00Z"),
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot sell into another tenant's channel or day", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailSales).values({
          tenantId: tenantA,
          channelId: channelB,
          soldAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailSales).values({
          tenantId: tenantA,
          channelId: channelA,
          marketDayId: dayB,
          soldAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a sale into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.retailSales)
          .set({ tenantId: tenantB })
          .where(eq(schema.retailSales.id, saleA)),
      ),
    ).rejects.toThrow();
  });

  // ---- sale lines -------------------------------------------------------

  it("CANNOT SELL ANOTHER TENANT'S STOCK", async () => {
    /**
     * The sharpest one in this file. A sale line is revenue with a stock issue
     * behind it — pointing at another tenant's movement would book this
     * business's money against that one's goods.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailSaleLines).values({
          tenantId: tenantA,
          saleId: saleA,
          itemId: itemA,
          quantity: 1,
          unitPriceCents: 100,
          inventoryMovementId: movementB,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailSaleLines).values({
          tenantId: tenantA,
          saleId: saleA,
          itemId: itemB,
          quantity: 1,
          unitPriceCents: 100,
          inventoryMovementId: movementA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot put a line on another tenant's sale", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailSaleLines).values({
          tenantId: tenantA,
          saleId: saleB,
          itemId: itemA,
          quantity: 1,
          unitPriceCents: 100,
          inventoryMovementId: movementA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot sell the same stock issue twice", async () => {
    // One movement is one line, the same rule a production run input follows.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailSaleLines).values({
          tenantId: tenantA,
          saleId: saleA,
          itemId: itemA,
          quantity: 1,
          unitPriceCents: 100,
          inventoryMovementId: movementA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a sale line into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.retailSaleLines)
          .set({ tenantId: tenantB })
          .where(eq(schema.retailSaleLines.id, lineA)),
      ),
    ).rejects.toThrow();
  });

  // ---- stockouts --------------------------------------------------------

  it("a tenant sees only its own stockouts", async () => {
    expect(
      await asStaff((tx) => tx.select().from(schema.retailStockouts)),
    ).toHaveLength(1);
  });

  it("cannot record running out on another tenant's day", async () => {
    // The only record anywhere of revenue that was NOT taken.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailStockouts).values({
          tenantId: tenantA,
          marketDayId: dayB,
          itemId: itemA,
          noticedAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot record running out of the same thing twice on one day", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.retailStockouts).values({
          tenantId: tenantA,
          marketDayId: dayA,
          itemId: itemA,
          noticedAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a stockout into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.retailStockouts)
          .set({ tenantId: tenantB })
          .where(eq(schema.retailStockouts.id, stockoutA)),
      ),
    ).rejects.toThrow();
  });
  it("is default-deny on every table in the pack with no tenant context", async () => {
    // FORCE ROW LEVEL SECURITY: an unknown tenant sees nothing, even for the
    // connection's own role.
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.retailChannels)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.retailPrices)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.retailMarketDays),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.retailSales)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.retailSaleLines)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.retailStockouts)),
    ).toHaveLength(0);
  });
});
