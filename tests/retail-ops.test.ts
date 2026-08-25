import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  RetailError,
  createChannel,
  dayTill,
  listChannels,
  marketDays,
  moveStockToTruck,
  priceListFor,
  pricedCountByChannel,
  recordMarketDay,
  recordSale,
  recordStockout,
  removePrice,
  returnStockFromTruck,
  setPrice,
  takingsByDay,
  truckStock,
  updateChannel,
  updateMarketDay,
  voidSale,
  type RetailCtx,
} from "../src/packs/retail/ops";
import {
  createItem,
  onHandByItem,
  receiveStock,
  type InventoryCtx,
} from "../src/packs/inventory/ops";

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
  let truckId: string;
  let barnId: string;

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
      // A market truck is an asset flagged as somewhere stock is kept — no new
      // concept, which is the whole reason the offline problem has no
      // distributed-inventory problem inside it.
      const assetRows = await tx
        .insert(schema.assets)
        .values([
          {
            tenantId,
            kind: "vehicle",
            name: "Market truck",
            isStorageLocation: true,
          },
          {
            tenantId,
            kind: "building",
            name: "Barn",
            isStorageLocation: true,
          },
        ])
        .returning();
      truckId = assetRows[0].id;
      barnId = assetRows[1].id;
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


  // ---- slice 1: the truck, the till, the tin ----------------------------

  /** A channel with one priced item and stock in the barn. The pilot's shape. */
  async function stall(name: string, priceCents = 550) {
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name, channelKind: "farmers_market" }),
    );
    const item = await newItem(`${name} beef`);
    await asOwner((tx) =>
      receiveStock(tx, inv(), {
        itemId: item.id,
        quantity: 100,
        costCents: 20_000,
        occurredOn: "2026-08-01",
        locationAssetId: barnId,
      }),
    );
    await asOwner((tx) =>
      setPrice(tx, ownerCtx(), {
        channelId: channel.id,
        itemId: item.id,
        priceCents,
        effectiveFrom: "2026-01-01",
      }),
    );
    const day = await asOwner((tx) =>
      recordMarketDay(tx, ownerCtx(), {
        channelId: channel.id,
        heldOn: TODAY,
        stallFeeCents: 3_500,
        travelCents: 1_800,
        crewSize: 2,
        hours: 5,
      }),
    );
    return { channel, item, day };
  }

  it("LOADING THE TRUCK IS A TRANSFER — the app knows exactly what left", async () => {
    /**
     * The design's answer to the offline problem, and it is a data-model answer
     * rather than a client one: the truck is a mobile inventory location, so
     * nothing is shared and nothing can conflict.
     */
    const { item } = await stall("Transfer market");
    await asOwner((tx) =>
      moveStockToTruck(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 40,
        fromLocationAssetId: barnId,
        truckAssetId: truckId,
        occurredOn: TODAY,
      }),
    );

    const onTruck = await asOwner((tx) => truckStock(tx, tenantId, truckId));
    expect(onTruck.find((l) => l.itemId === item.id)?.onHand).toBe(40);

    // AND THE ITEM'S TOTAL HAS NOT MOVED. A transfer relocates; it does not
    // create or destroy, which is the property the whole ledger rests on.
    const onHand = await asOwner((tx) => onHandByItem(tx, tenantId));
    expect(onHand.get(item.id)).toBe(100);

    // Unsold stock comes back.
    await asOwner((tx) =>
      returnStockFromTruck(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 15,
        truckAssetId: truckId,
        toLocationAssetId: barnId,
        occurredOn: TODAY,
      }),
    );
    const after = await asOwner((tx) => truckStock(tx, tenantId, truckId));
    expect(after.find((l) => l.itemId === item.id)?.onHand).toBe(25);
    expect((await asOwner((tx) => onHandByItem(tx, tenantId))).get(item.id)).toBe(100);
  });

  it("A SALE DRAWS THE STOCK OFF THE TRUCK AND STAMPS THE PRICE CHARGED", async () => {
    const { channel, item, day } = await stall("Selling market");
    await asOwner((tx) =>
      moveStockToTruck(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 40,
        fromLocationAssetId: barnId,
        truckAssetId: truckId,
        occurredOn: TODAY,
      }),
    );

    const result = await asOwner((tx) =>
      recordSale(tx, ownerCtx(), {
        clientRef: "sale-one",
        channelId: channel.id,
        marketDayId: day.id,
        soldAt: new Date(`${TODAY}T10:30:00Z`),
        paymentMethod: "cash",
        locationAssetId: truckId,
        // A market haggles: charged at $5.00, not the $5.50 on the list.
        lines: [{ itemId: item.id, quantity: 2.35, unitPriceCents: 500 }],
      }),
    );
    expect(result.alreadyPosted).toBe(false);
    // 2.35 × 500 = 1175 exactly.
    expect(result.totalCents).toBe(1_175);
    expect(result.lines[0].unitPriceCents).toBe(500);

    // The truck is lighter, and the item's total is genuinely lower — a sale
    // leaves the business, unlike a transfer.
    const onTruck = await asOwner((tx) => truckStock(tx, tenantId, truckId));
    expect(onTruck.find((l) => l.itemId === item.id)?.onHand).toBe(37.65);
    expect((await asOwner((tx) => onHandByItem(tx, tenantId))).get(item.id)).toBe(97.65);
  });

  it("POSTING THE SAME SALE TWICE TAKES THE MONEY ONCE", async () => {
    /**
     * **THE REASON `client_ref` IS IN THE SCHEMA BEFORE ANY OFFLINE CODE
     * EXISTS.** A till at a signal-less market queues its sales and flushes them
     * later; a flush whose request arrived but whose reply did not WILL be
     * retried, and there is no way for the till to know the difference. Without
     * this the customer is charged twice and the stock issued twice with it.
     */
    const { channel, item, day } = await stall("Replay market");
    await asOwner((tx) =>
      moveStockToTruck(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 40,
        fromLocationAssetId: barnId,
        truckAssetId: truckId,
        occurredOn: TODAY,
      }),
    );

    const send = () =>
      asOwner((tx) =>
        recordSale(tx, ownerCtx(), {
          clientRef: "queued-sale-42",
          channelId: channel.id,
          marketDayId: day.id,
          soldAt: new Date(`${TODAY}T11:00:00Z`),
          // The truck, or the issue comes off "nowhere" and the truck never
          // depletes — which is correct for a farm-gate sale and wrong here.
          locationAssetId: truckId,
          lines: [{ itemId: item.id, quantity: 4, unitPriceCents: 550 }],
        }),
      );

    const first = await send();
    const second = await send();
    const third = await send();

    expect(first.alreadyPosted).toBe(false);
    expect(second.alreadyPosted).toBe(true);
    expect(third.alreadyPosted).toBe(true);
    // Same sale, same id, same total, every time.
    expect(second.sale.id).toBe(first.sale.id);
    expect(second.totalCents).toBe(first.totalCents);

    // ONE sale on the day, and the stock left ONCE.
    const till = await asOwner((tx) => dayTill(tx, tenantId, day.id));
    expect(till!.sales).toHaveLength(1);
    const onTruck = await asOwner((tx) => truckStock(tx, tenantId, truckId));
    expect(onTruck.find((l) => l.itemId === item.id)?.onHand).toBe(36);
  });

  it("two sales without a client ref are two sales, not a collision", async () => {
    // A server-side sale has no till behind it. Multiple nulls must stay
    // distinct or a farm store could only ever record one sale.
    const { channel, item, day } = await stall("Server market");
    await asOwner((tx) =>
      moveStockToTruck(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 40,
        fromLocationAssetId: barnId,
        truckAssetId: truckId,
        occurredOn: TODAY,
      }),
    );
    for (const n of [1, 2]) {
      await asOwner((tx) =>
        recordSale(tx, ownerCtx(), {
          channelId: channel.id,
          marketDayId: day.id,
          soldAt: new Date(`${TODAY}T1${n}:00:00Z`),
          locationAssetId: truckId,
          lines: [{ itemId: item.id, quantity: 1, unitPriceCents: 550 }],
        }),
      );
    }
    const till = await asOwner((tx) => dayTill(tx, tenantId, day.id));
    expect(till!.sales).toHaveLength(2);
  });

  it("gives the day its takings, its margin and its cash count", async () => {
    /**
     * **PROFIT PER SELLING DAY, which slice 0 could only answer half of.**
     */
    const { channel, item, day } = await stall("Reconciled market");
    await asOwner((tx) =>
      moveStockToTruck(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 50,
        fromLocationAssetId: barnId,
        truckAssetId: truckId,
        occurredOn: TODAY,
      }),
    );
    // $110 cash and $55 card.
    await asOwner((tx) =>
      recordSale(tx, ownerCtx(), {
        channelId: channel.id,
        marketDayId: day.id,
        soldAt: new Date(`${TODAY}T10:00:00Z`),
        paymentMethod: "cash",
        locationAssetId: truckId,
        lines: [{ itemId: item.id, quantity: 20, unitPriceCents: 550 }],
      }),
    );
    await asOwner((tx) =>
      recordSale(tx, ownerCtx(), {
        channelId: channel.id,
        marketDayId: day.id,
        soldAt: new Date(`${TODAY}T12:00:00Z`),
        paymentMethod: "card",
        locationAssetId: truckId,
        lines: [{ itemId: item.id, quantity: 10, unitPriceCents: 550 }],
      }),
    );
    await asOwner((tx) =>
      updateMarketDay(tx, ownerCtx(), day.id, {
        openingFloatCents: 5_000,
        cashCountedCents: 16_000,
      }),
    );

    const till = await asOwner((tx) => dayTill(tx, tenantId, day.id));
    expect(till!.takings.totalCents).toBe(16_500);
    expect(till!.takings.cashCents).toBe(11_000);
    expect(till!.takings.otherCents).toBe(5_500);
    // $165.00 less $53.00 to stand there.
    expect(till!.result.marginCents).toBe(11_200);
    // Ten person-hours.
    expect(till!.result.perPersonHourCents).toBe(1_120);
    // Float $50 + $110 cash = $160 expected; $160 counted.
    expect(till!.cash.expectedCents).toBe(16_000);
    expect(till!.cash.varianceCents).toBe(0);
    expect(till!.cash.uncounted).toBe(false);

    // And the list page's fold agrees with the day page's.
    const byDay = await asOwner((tx) => takingsByDay(tx, tenantId, [day.id]));
    expect(byDay.get(day.id)?.totalCents).toBe(16_500);
    expect(byDay.get(day.id)?.cashCents).toBe(11_000);
  });

  it("records running out of something, once per item per day", async () => {
    // Nothing else in the system can tell selling out at closing time from
    // running dry at eleven, and the two are worth completely different amounts.
    const { item, day } = await stall("Sold out market");
    await asOwner((tx) =>
      recordStockout(tx, ownerCtx(), {
        marketDayId: day.id,
        itemId: item.id,
        noticedAt: new Date(`${TODAY}T11:00:00Z`),
      }),
    );
    // A second tap corrects the time rather than creating a second event.
    await asOwner((tx) =>
      recordStockout(tx, ownerCtx(), {
        marketDayId: day.id,
        itemId: item.id,
        noticedAt: new Date(`${TODAY}T11:30:00Z`),
      }),
    );
    const till = await asOwner((tx) => dayTill(tx, tenantId, day.id));
    expect(till!.stockouts).toHaveLength(1);
    expect(till!.stockouts[0].noticedAt.toISOString()).toContain("11:30");
  });

  it("voiding a sale LEAVES THE STOCK ISSUE BEHIND, on purpose", async () => {
    /**
     * The call `livestock` made when a treatment is removed and the medicine has
     * already left the shelf. The goods went over the table; unwriting the
     * movement would rewrite what happened. `inventory` slice 2's adjustment is
     * the remedy — and for the first time in this repo, it exists.
     */
    const { channel, item, day } = await stall("Voided market");
    await asOwner((tx) =>
      moveStockToTruck(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 40,
        fromLocationAssetId: barnId,
        truckAssetId: truckId,
        occurredOn: TODAY,
      }),
    );
    const sale = await asOwner((tx) =>
      recordSale(tx, ownerCtx(), {
        channelId: channel.id,
        marketDayId: day.id,
        soldAt: new Date(`${TODAY}T10:00:00Z`),
        locationAssetId: truckId,
        lines: [{ itemId: item.id, quantity: 5, unitPriceCents: 550 }],
      }),
    );
    await asOwner((tx) => voidSale(tx, ownerCtx(), sale.sale.id));

    const till = await asOwner((tx) => dayTill(tx, tenantId, day.id));
    expect(till!.sales).toHaveLength(0);
    expect(till!.takings.totalCents).toBe(0);
    // The stock is still gone. That is the loose end, and it is deliberate.
    const onTruck = await asOwner((tx) => truckStock(tx, tenantId, truckId));
    expect(onTruck.find((l) => l.itemId === item.id)?.onHand).toBe(35);
  });

  it("refuses an empty sale and a negative price", async () => {
    const { channel, item, day } = await stall("Refusing market");
    await expect(
      asOwner((tx) =>
        recordSale(tx, ownerCtx(), {
          channelId: channel.id,
          marketDayId: day.id,
          soldAt: new Date(),
          lines: [],
        }),
      ),
    ).rejects.toThrow(/not a sale/);
    await expect(
      asOwner((tx) =>
        recordSale(tx, ownerCtx(), {
          channelId: channel.id,
          marketDayId: day.id,
          soldAt: new Date(),
          lines: [{ itemId: item.id, quantity: 1, unitPriceCents: -1 }],
        }),
      ),
    ).rejects.toThrow(RetailError);
  });

  it("a till is a CHORE — staff can sell, load and count", async () => {
    // A point of sale only the owner could operate is a point of sale nobody
    // uses. Setting the price stays the owner's; taking the money does not.
    const { channel, item, day } = await stall("Crew market");
    await withTenant(
      tenantId,
      (tx) =>
        moveStockToTruck(tx, staffCtx(), {
          itemId: item.id,
          quantity: 10,
          fromLocationAssetId: barnId,
          truckAssetId: truckId,
          occurredOn: TODAY,
        }),
      { role: "staff", userId: STAFF },
    );
    const sale = await withTenant(
      tenantId,
      (tx) =>
        recordSale(tx, staffCtx(), {
          channelId: channel.id,
          marketDayId: day.id,
          soldAt: new Date(),
          locationAssetId: truckId,
          lines: [{ itemId: item.id, quantity: 2, unitPriceCents: 550 }],
        }),
      { role: "staff", userId: STAFF },
    );
    expect(sale.totalCents).toBe(1_100);
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
  /**
   * **A MARKET DAY IS OPENED, THEN CLOSED.** Slice 0 built the row as a
   * retrospective cost record; slice 1 hung the till off it, which made it the
   * thing you create BEFORE you can sell. The dialog never caught up: it asked
   * how long you stood there and what the weather did before either had
   * happened, and collected the float — the one fact you know at seven in the
   * morning — at the end, inside "Count the tin".
   *
   * The forms are two moments now. The risk that creates is this test: the
   * closing form submits EVERY field, so a mis-read prefill would silently
   * blank whatever the opening form set.
   */
  it("opens with what you know, closes with what you learned, and blanks nothing", async () => {
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: `${STAMP} two moments` }),
    );

    // Morning: where, when, the float in the tin, the fee if paid upfront.
    const opened = await asOwner((tx) =>
      recordMarketDay(tx, ownerCtx(), {
        channelId: channel.id,
        heldOn: TODAY,
        openingFloatCents: 5_000,
        stallFeeCents: 3_500,
      }),
    );
    expect(opened.openingFloatCents).toBe(5_000);
    expect(opened.stallFeeCents).toBe(3_500);
    // Nothing retrospective has been invented on the way in.
    expect(opened.cashCountedCents).toBeNull();
    expect(opened.hours).toBeNull();
    expect(opened.travelCents).toBeNull();
    expect(opened.crewSize).toBeNull();

    // Evening: everything only knowable once the stall is packed away. The
    // form resubmits the opening fields too, so they must survive unchanged.
    const closed = await asOwner((tx) =>
      updateMarketDay(tx, ownerCtx(), opened.id, {
        openingFloatCents: 5_000,
        stallFeeCents: 3_500,
        cashCountedCents: 13_750,
        travelCents: 1_800,
        crewSize: 2,
        hours: 5,
        weather: "rained until eleven",
      }),
    );
    expect(closed.openingFloatCents).toBe(5_000);
    expect(closed.stallFeeCents).toBe(3_500);
    expect(closed.cashCountedCents).toBe(13_750);
    expect(closed.travelCents).toBe(1_800);
    expect(closed.crewSize).toBe(2);
    expect(Number(closed.hours)).toBe(5);
    expect(closed.weather).toBe("rained until eleven");
  });

  it("A BLANK COUNT IS STILL NOT A ZERO COUNT after the forms were merged", async () => {
    /**
     * The rule the cash panel has always turned on: not counted and
     * counted-and-right are different facts, and a screen that read one as the
     * other would report every uncounted day as balanced. Merging the tin into
     * the close form is exactly where that could have been lost.
     */
    const channel = await asOwner((tx) =>
      createChannel(tx, ownerCtx(), { name: `${STAMP} blank count` }),
    );
    const day = await asOwner((tx) =>
      recordMarketDay(tx, ownerCtx(), {
        channelId: channel.id,
        heldOn: TODAY,
        openingFloatCents: 5_000,
      }),
    );
    const closedWithoutCounting = await asOwner((tx) =>
      updateMarketDay(tx, ownerCtx(), day.id, {
        cashCountedCents: null,
        hours: 4,
      }),
    );
    expect(closedWithoutCounting.cashCountedCents).toBeNull();
    expect(Number(closedWithoutCounting.hours)).toBe(4);

    // And zero is a real answer, distinct from never having counted.
    const countedEmpty = await asOwner((tx) =>
      updateMarketDay(tx, ownerCtx(), day.id, { cashCountedCents: 0 }),
    );
    expect(countedEmpty.cashCountedCents).toBe(0);
  });
  /**
   * **A TRUCK IS LOADED WITH MANY THINGS AT ONCE, AND ALL OF THEM OR NONE.**
   *
   * The form takes a line per thing and the action runs the lot inside ONE
   * `withTenant` transaction. This is the reason it has to: nine lines where
   * the fifth fails must not leave four on the truck. The farmer drives off
   * believing they have stock the ledger says is still in the yard, and the
   * till then counts down from a number that was never true — and because the
   * till counts locally, nothing would catch it until the day-end variance.
   *
   * The transaction is the action's, so this reproduces the action's shape
   * rather than calling it: several `moveStockToTruck` calls in one `tx`, one
   * of which throws.
   */
  it("a load that fails partway leaves NOTHING on the truck", async () => {
    const truck = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({
          tenantId,
          kind: "vehicle",
          name: `${STAMP} atomic truck`,
          isStorageLocation: true,
        })
        .returning();
      return rows[0];
    });

    const beef = await asOwner((tx) =>
      createItem(tx, inv(), {
        name: `${STAMP} atomic beef`,
        stockingUnit: "lb",
      }),
    );
    await asOwner((tx) =>
      receiveStock(tx, inv(), {
        itemId: beef.id,
        newLotCode: `${STAMP}-atomic`,
        quantity: 30,
        occurredOn: TODAY,
      }),
    );

    // Two good lines and one impossible one. `transferStock` refuses a move
    // that starts and ends in the same place, which is the cheapest way to make
    // exactly one line throw.
    await expect(
      asOwner(async (tx) => {
        await moveStockToTruck(tx, ownerCtx(), {
          itemId: beef.id,
          quantity: 10,
          truckAssetId: truck.id,
          occurredOn: TODAY,
        });
        await moveStockToTruck(tx, ownerCtx(), {
          itemId: beef.id,
          quantity: 5,
          truckAssetId: truck.id,
          occurredOn: TODAY,
        });
        await moveStockToTruck(tx, ownerCtx(), {
          itemId: beef.id,
          quantity: 5,
          // Same place at both ends: not a move.
          fromLocationAssetId: truck.id,
          truckAssetId: truck.id,
          occurredOn: TODAY,
        });
      }),
    ).rejects.toThrow();

    // The two that "succeeded" went back with the one that did not.
    const onTruck = await asOwner((tx) =>
      truckStock(tx, tenantId, truck.id),
    );
    expect(onTruck).toEqual([]);
  });

  it("a load of several different things puts all of them on", async () => {
    const truck = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({
          tenantId,
          kind: "vehicle",
          name: `${STAMP} full truck`,
          isStorageLocation: true,
        })
        .returning();
      return rows[0];
    });

    const made: { id: string }[] = [];
    for (const name of ["cuts", "birds", "produce"]) {
      const item = await asOwner((tx) =>
        createItem(tx, inv(), {
          name: `${STAMP} ${name}`,
          stockingUnit: "lb",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, inv(), {
          itemId: item.id,
          newLotCode: `${STAMP}-${name}`,
          quantity: 20,
          occurredOn: TODAY,
        }),
      );
      made.push(item);
    }

    await asOwner(async (tx) => {
      for (const item of made) {
        await moveStockToTruck(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 7,
          truckAssetId: truck.id,
          occurredOn: TODAY,
        });
      }
    });

    const onTruck = await asOwner((tx) => truckStock(tx, tenantId, truck.id));
    expect(onTruck).toHaveLength(3);
    expect(onTruck.every((line) => line.onHand === 7)).toBe(true);
  });
});
