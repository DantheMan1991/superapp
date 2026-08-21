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

  it("is default-deny on all three tables with no tenant context", async () => {
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
  });
});
