import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  RetailError,
  createChannel,
  listChannels,
  marketDays,
  priceListFor,
  pricedCountByChannel,
  recordMarketDay,
  removePrice,
  setPrice,
  updateChannel,
  type RetailCtx,
} from "../src/packs/retail/ops";
import { createItem, type InventoryCtx } from "../src/packs/inventory/ops";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * The ops behind `retail` slice 0.
 *
 * The pure tests prove the price fold; these prove the things only a database
 * can: that a price change is a NEW ROW rather than an edit, that setting the
 * same day twice replaces rather than duplicates, and that the price list shows
 * the items nobody has priced.
 *
 * The isolation suite builds its fixtures under `withSystem` on purpose, so a
 * bug in these ops cannot make it agree with them.
 */
d("retail ops", () => {
  const STAMP = `retailops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;
  const TODAY = "2026-08-20";

  let tenantId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const ownerCtx = (): RetailCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const staffCtx = (): RetailCtx => ({ tenantId, userId: STAFF, role: "staff" });
  const inv = (): InventoryCtx => ownerCtx();

  const newItem = (name: string, unit = "lb") =>
    asOwner((tx) =>
      createItem(tx, inv(), { name, stockingUnit: unit, itemKind: "meat" }),
    );

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Retail Ops",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("prices the same item differently in two channels", async () => {
    /**
     * **THE REASON PRICE IS NOT A COLUMN ON THE ITEM.** The same pound of ground
     * beef is one price at a stall and another at the gate, and neither of them
     * is *the* price.
     */
    const beef = await newItem("Ground beef");
    const market = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), {
        name: "Saturday market",
        channelKind: "farmers_market",
      }),
    );
    const gate = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Farm gate", channelKind: "farm_store" }),
    );

    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: market.id,
        itemId: beef.id,
        priceCents: 900,
        effectiveFrom: "2026-01-01",
      }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: gate.id,
        itemId: beef.id,
        priceCents: 700,
        effectiveFrom: "2026-01-01",
      }),
    );

    const atMarket = await asOwner((tx) =>
      priceListFor(tx, tenantId, market.id, TODAY),
    );
    const atGate = await asOwner((tx) =>
      priceListFor(tx, tenantId, gate.id, TODAY),
    );
    expect(atMarket.find((p) => p.item.id === beef.id)?.current?.priceCents).toBe(900);
    expect(atGate.find((p) => p.item.id === beef.id)?.current?.priceCents).toBe(700);
  });

  it("A PRICE CHANGE IS A NEW ROW, and the old one is still readable", async () => {
    /**
     * Updating in place would answer "what do I charge" and destroy "what did I
     * charge in June" — and the second is the only version a margin report can
     * ask.
     */
    const eggs = await newItem("Eggs", "dozen");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "History market" }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: eggs.id,
        priceCents: 600,
        effectiveFrom: "2026-01-01",
      }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: eggs.id,
        priceCents: 700,
        effectiveFrom: "2026-06-01",
      }),
    );

    const list = await asOwner((tx) =>
      priceListFor(tx, tenantId, channel.id, TODAY),
    );
    const line = list.find((p) => p.item.id === eggs.id)!;
    expect(line.current?.priceCents).toBe(700);
    expect(line.history).toHaveLength(2);
    // What it was in March is still there.
    const inMarch = await asOwner((tx) =>
      priceListFor(tx, tenantId, channel.id, "2026-03-01"),
    );
    expect(inMarch.find((p) => p.item.id === eggs.id)?.current?.priceCents).toBe(600);
  });

  it("replaces rather than duplicates when the same day is set twice", async () => {
    // Two prices starting the same morning is not a change, it is a question
    // about which one is real.
    const item = await newItem("Twice priced");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Twice market" }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 500,
        effectiveFrom: TODAY,
      }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 550,
        effectiveFrom: TODAY,
      }),
    );
    const list = await asOwner((tx) =>
      priceListFor(tx, tenantId, channel.id, TODAY),
    );
    const line = list.find((p) => p.item.id === item.id)!;
    expect(line.history).toHaveLength(1);
    expect(line.current?.priceCents).toBe(550);
  });

  it("a price set AHEAD does not apply today, and is reported as coming", async () => {
    const item = await newItem("Next season");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Ahead market" }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 800,
        effectiveFrom: "2026-01-01",
      }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 850,
        effectiveFrom: "2026-12-01",
      }),
    );
    const line = (
      await asOwner((tx) => priceListFor(tx, tenantId, channel.id, TODAY))
    ).find((p) => p.item.id === item.id)!;
    expect(line.current?.priceCents).toBe(800);
    // A price entered for the future and then forgotten is what this prevents.
    expect(line.upcoming?.priceCents).toBe(850);
    expect(line.upcoming?.effectiveFrom).toBe("2026-12-01");
  });

  it("SHOWS THE ITEMS NOBODY HAS PRICED, which is half the point of the screen", async () => {
    // A farm sells six of the forty things it holds. Showing only priced rows
    // would make the gap invisible.
    const priced = await newItem("Priced thing");
    const unpriced = await newItem("Unpriced thing");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Gap market" }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: priced.id,
        priceCents: 400,
        effectiveFrom: "2026-01-01",
      }),
    );
    const list = await asOwner((tx) =>
      priceListFor(tx, tenantId, channel.id, TODAY),
    );
    const ids = list.map((p) => p.item.id);
    expect(ids).toContain(priced.id);
    expect(ids).toContain(unpriced.id);
    expect(list.find((p) => p.item.id === unpriced.id)?.current).toBeNull();
  });

  it("counts what is priced TODAY, not what has ever been priced", async () => {
    const item = await newItem("Counted later");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Count market" }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 400,
        effectiveFrom: "2027-01-01",
      }),
    );
    const counts = await asOwner((tx) =>
      pricedCountByChannel(tx, tenantId, [channel.id], TODAY),
    );
    // Set for next year, so nothing is priced here today.
    expect(counts.get(channel.id)).toBe(0);
  });

  it("removing a price uncovers whatever ran before it", async () => {
    // A price typed as $80 where the sign said $8 never applied to anything, so
    // there is nothing to compensate for — the call weights and treatments made.
    const item = await newItem("Mistyped");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Fix market" }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 800,
        effectiveFrom: "2026-01-01",
      }),
    );
    const wrong = await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 8_000,
        effectiveFrom: "2026-08-01",
      }),
    );
    await asOwner((tx) => removePrice(tx, ownerCtx(), wrong.id));

    const line = (
      await asOwner((tx) => priceListFor(tx, tenantId, channel.id, TODAY))
    ).find((p) => p.item.id === item.id)!;
    expect(line.current?.priceCents).toBe(800);
  });

  it("refuses a negative price but allows a free one", async () => {
    const item = await newItem("Free sample");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Sample market" }),
    );
    await expect(
      asOwner((tx) =>
        setPrice(tx, ownerCtx(), {
          channelId: channel.id,
          itemId: item.id,
          priceCents: -100,
          effectiveFrom: TODAY,
        }),
      ),
    ).rejects.toThrow(RetailError);
    // Free is a real price: a sample, a giveaway, a loss leader.
    const free = await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 0,
        effectiveFrom: TODAY,
      }),
    );
    expect(free.priceCents).toBe(0);
  });

  it("a closed channel keeps its prices and its history", async () => {
    const item = await newItem("Kept");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Closing market" }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents: 300,
        effectiveFrom: "2026-01-01",
      }),
    );
    await asOwner((tx) =>
      updateChannel(tx, ownerCtx(), channel.id, { status: "closed" }),
    );

    const open = await asOwner((tx) =>
      listChannels(tx, tenantId, { status: "active" }),
    );
    expect(open.map((c) => c.id)).not.toContain(channel.id);
    const line = (
      await asOwner((tx) => priceListFor(tx, tenantId, channel.id, TODAY))
    ).find((p) => p.item.id === item.id)!;
    expect(line.current?.priceCents).toBe(300);
  });

  it("records what a day cost, and folds the hours beside the money", async () => {
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Costed market" }),
    );
    await asOwner((tx) =>
      recordMarketDay(tx, ownerCtx(), {
        channelId: channel.id,
        heldOn: TODAY,
        stallFeeCents: 3_500,
        travelCents: 1_800,
        crewSize: 2,
        hours: 5,
        weather: "rained until eleven",
      }),
    );
    const days = await asOwner((tx) =>
      marketDays(tx, tenantId, { channelId: channel.id }),
    );
    expect(days).toHaveLength(1);
    expect(days[0].cost.outOfPocketCents).toBe(5_300);
    expect(days[0].cost.personHours).toBe(10);
    expect(days[0].channelName).toBe("Costed market");
  });

  it("keeps the decision/chore line: prices are the owner's, the day is anyone's", async () => {
    /**
     * A price is the number the whole business turns on, and is not something
     * whoever is standing at the stall should be able to move. What the pitch
     * cost is a chore recorded by the person who stood there.
     */
    const item = await newItem("Role tested");
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: "Roles market" }),
    );

    await expect(
      withTenant(
        tenantId,
        (tx) => createChannel(tx, staffCtx(), { name: "Nope" }),
        { role: "staff", userId: STAFF },
      ),
    ).rejects.toThrow(RetailError);
    await expect(
      withTenant(
        tenantId,
        (tx) =>
          setPrice(tx, staffCtx(), {
            channelId: channel.id,
            itemId: item.id,
            priceCents: 100,
            effectiveFrom: TODAY,
          }),
        { role: "staff", userId: STAFF },
      ),
    ).rejects.toThrow(RetailError);

    // But standing at the stall and writing down what it cost is a chore.
    const day = await withTenant(
      tenantId,
      (tx) =>
        recordMarketDay(tx, staffCtx(), {
          channelId: channel.id,
          heldOn: TODAY,
          stallFeeCents: 2_000,
        }),
      { role: "staff", userId: STAFF },
    );
    expect(day.stallFeeCents).toBe(2_000);
  });

  it("refuses a price or a day against a channel that does not exist", async () => {
    const item = await newItem("Orphan");
    const nowhere = "00000000-0000-0000-0000-000000000000";
    await expect(
      asOwner((tx) =>
        setPrice(tx, ownerCtx(), {
          channelId: nowhere,
          itemId: item.id,
          priceCents: 100,
          effectiveFrom: TODAY,
        }),
      ),
    ).rejects.toThrow(RetailError);
    await expect(
      asOwner((tx) =>
        recordMarketDay(tx, ownerCtx(), { channelId: nowhere, heldOn: TODAY }),
      ),
    ).rejects.toThrow(RetailError);
  });
});
