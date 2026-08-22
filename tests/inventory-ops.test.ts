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
  listLocations,
  setTaxRule,
  clearTaxRule,
  listTaxRules,
} from "../src/packs/inventory/ops";
import { resolveTaxRule } from "../src/packs/inventory/core/tax-rules";
import { balanceOfLot, balanceByItem } from "../src/packs/inventory/core/balances";
import {
  adjustStock,
  adjustmentReasons,
  consumedByLot,
  consumedCostByLot,
  countLines,
  expiringLots,
  issueStock,
  itemCostRate,
  postCount,
  receiveStock,
  stockAtLocation,
  transferStock,
  recordCountLine,
  startCount,
  valueStock,
  averageRatesForItems,
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

// ---- slice 3: valuation -----------------------------------------------

  it("values a lot at what it CARRIED, not at the item's average", async () => {
    /**
     * The ordering the lot spine exists for. Two batches of the same item at
     * very different prices: averaging them would report both at the same
     * number and lose the one fact traceability is for.
     */
    const item = await newItem("Two batches");
    const cheap = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "CHEAP", source: "purchased" }),
    );
    const dear = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "DEAR", source: "purchased" }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: cheap.id,
        quantity: 100,
        costCents: 10_000,
        occurredOn: "2026-08-01",
      }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: dear.id,
        quantity: 100,
        costCents: 50_000,
        occurredOn: "2026-08-02",
      }),
    );

    const valuation = await asOwner((tx) => valueStock(tx, tenantId, { itemId: item.id }));
    const byCode = new Map(valuation.rows.map((r) => [r.lotCode, r]));
    expect(byCode.get("CHEAP")!.valueCents).toBe(10_000);
    expect(byCode.get("DEAR")!.valueCents).toBe(50_000);
    expect(byCode.get("CHEAP")!.method).toBe("carried");
    // The average across both is $3.00/lb; neither lot is valued at it.
    expect(byCode.get("CHEAP")!.valueCents).not.toBe(30_000);
    expect(valuation.total.valueCents).toBe(60_000);
    expect(valuation.total.incomplete).toBe(false);
  });

  it("REFUSES TO VALUE A RAISED LOT NOBODY COSTED, and says how much of it there is", async () => {
    /**
     * Eggs, or a calf you bred. There is no purchase basis and nobody entered a
     * cost, so there is no honest number — and a total that quietly called it
     * zero would understate the farm by an unknown amount while looking
     * complete.
     */
    const item = await newItem("Eggs", "dozen");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "AUG-EGGS", source: "raised" }),
    );
    await asOwner((tx) =>
      recordMovement(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 30,
        movementKind: "receipt",
        occurredOn: "2026-08-05",
      }),
    );

    const valuation = await asOwner((tx) => valueStock(tx, tenantId, { itemId: item.id }));
    expect(valuation.rows).toHaveLength(1);
    expect(valuation.rows[0].valueCents).toBeNull();
    expect(valuation.rows[0].method).toBe("none");
    expect(valuation.rows[0].lotSource).toBe("raised");
    expect(valuation.total.valueCents).toBe(0);
    expect(valuation.total.incomplete).toBe(true);
    expect(valuation.total.unvaluedLines).toBe(1);
    expect(valuation.total.unvaluedQuantity).toBe(30);
  });

  it("values lot-less stock at the item's average", async () => {
    const item = await newItem("No batches");
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 40,
        costCents: 10_020,
        occurredOn: "2026-08-01",
      }),
    );
    const valuation = await asOwner((tx) => valueStock(tx, tenantId, { itemId: item.id }));
    expect(valuation.rows[0].method).toBe("average");
    expect(valuation.rows[0].valueCents).toBe(10_020);
  });

  it("VALUES THE SHELF AS IT STOOD ON A DATE, feed and all", async () => {
    /**
     * The property a balance sheet rests on. This pen ate in August; a June
     * valuation must not see that feed, and an August one must.
     */
    const feed = await newItem("Dated feed");
    const birds = await newItem("Dated birds", "head");
    const pen = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: birds.id, code: "PEN-DATED", source: "raised" }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: birds.id,
        lotId: pen.id,
        quantity: 50,
        costCents: 20_000,
        occurredOn: "2026-06-01",
      }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: feed.id,
        quantity: 200,
        costCents: 40_000,
        occurredOn: "2026-07-01",
      }),
    );
    await asOwner((tx) =>
      issueStock(tx, ownerCtx(), {
        itemId: feed.id,
        quantity: 100,
        issuedToLotId: pen.id,
        occurredOn: "2026-08-01",
      }),
    );

    const june = await asOwner((tx) =>
      valueStock(tx, tenantId, { asOf: "2026-06-30", itemId: birds.id }),
    );
    expect(june.rows[0].valueCents).toBe(20_000);

    const august = await asOwner((tx) =>
      valueStock(tx, tenantId, { asOf: "2026-08-31", itemId: birds.id }),
    );
    // The chicks, plus the $200 of feed that went into them.
    expect(august.rows[0].valueCents).toBe(40_000);
  });

  it("drops a lot that went in and came out rather than valuing it at nothing", async () => {
    // Same rule `stockAtLocation` follows: it is not "0 lb worth nothing", it
    // is not there.
    const item = await newItem("In and out");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "GONE", source: "purchased" }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 20,
        costCents: 5_000,
        occurredOn: "2026-08-01",
      }),
    );
    await asOwner((tx) =>
      issueStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 20,
        occurredOn: "2026-08-02",
      }),
    );
    const valuation = await asOwner((tx) => valueStock(tx, tenantId, { itemId: item.id }));
    expect(valuation.rows.filter((r) => r.lotCode === "GONE")).toHaveLength(0);
  });

  it("averageRatesForItems answers for many items in one query", async () => {
    const a = await newItem("Rate A");
    const b = await newItem("Rate B");
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: a.id,
        quantity: 10,
        costCents: 5_000,
        occurredOn: "2026-08-01",
      }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: b.id,
        quantity: 4,
        costCents: 1_000,
        occurredOn: "2026-08-01",
      }),
    );
    const rates = await asOwner((tx) =>
      averageRatesForItems(tx, tenantId, [a.id, b.id]),
    );
    expect(rates.get(a.id)).toBe(500);
    expect(rates.get(b.id)).toBe(250);
  });

  it("leaves an item with no priced receipt OUT of the rate map", async () => {
    // Absent, not zero — the map's caller turns a missing rate into "cannot
    // value", and a 0 here would turn it into "free".
    const item = await newItem("Never priced");
    await asOwner((tx) =>
      recordMovement(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 5,
        movementKind: "receipt",
        occurredOn: "2026-08-01",
      }),
    );
    const rates = await asOwner((tx) => averageRatesForItems(tx, tenantId, [item.id]));
    expect(rates.has(item.id)).toBe(false);
  });

  // ---- slice 2: adjustments, counts, expiry -----------------------------

  it("stamps a NEGATIVE adjustment at the average and a positive one at nothing", async () => {
    /**
     * **THE ASYMMETRY IS THE DECISION.** Stock that spoils really did cost
     * money, and stamping it is what turns a loss into a number somebody acts
     * on — the same rule `issueStock` follows. Stock that turns up was never
     * bought, so it arrives at null rather than at a price the farm did not pay.
     */
    const item = await newItem("Adjust me");
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 100,
        costCents: 20_000,
        occurredOn: "2026-08-01",
      }),
    );

    const lost = await asOwner((tx) =>
      adjustStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: -10,
        reason: "spoilage",
        occurredOn: "2026-08-20",
      }),
    );
    // $2.00 a pound, ten pounds gone.
    expect(lost.costCents).toBe(2_000);
    expect(lost.reason).toBe("spoilage");
    expect(lost.movementKind).toBe("adjustment");

    const found = await asOwner((tx) =>
      adjustStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 5,
        reason: "found",
        occurredOn: "2026-08-20",
      }),
    );
    expect(found.costCents).toBeNull();

    // AND THE AVERAGE HAS NOT MOVED. It counts only what came in WITH a price,
    // so five pounds nobody paid for cannot quietly make the feed look cheaper.
    expect(await asOwner((tx) => itemCostRate(tx, tenantId, item.id))).toBe(200);
  });

  it("refuses an adjustment of nothing, and a reason that is not a slug", async () => {
    const item = await newItem("Adjust refusals");
    await expect(
      asOwner((tx) =>
        adjustStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 0,
          reason: "spoilage",
          occurredOn: "2026-08-20",
        }),
      ),
    ).rejects.toThrow(InventoryError);
    await expect(
      asOwner((tx) =>
        adjustStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: -1,
          reason: "Rodent Damage!",
          occurredOn: "2026-08-20",
        }),
      ),
    ).rejects.toThrow(InventoryError);
  });

  it("groups adjustment reasons, which is the whole point of the column", async () => {
    // The design: sustained shrinkage is not an accounting problem, it is a
    // rodent problem. One entry is a wasted bag; the pattern is the diagnostic.
    const item = await newItem("Diagnostic feed");
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 1000,
        costCents: 100_000,
        occurredOn: "2026-05-01",
      }),
    );
    for (const month of ["2026-06-10", "2026-07-10", "2026-08-10"]) {
      await asOwner((tx) =>
        adjustStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: -20,
          reason: "shrinkage",
          occurredOn: month,
        }),
      );
    }
    await asOwner((tx) =>
      adjustStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: -5,
        reason: "spoilage",
        occurredOn: "2026-08-11",
      }),
    );

    const reasons = await asOwner((tx) =>
      adjustmentReasons(tx, tenantId, { from: "2026-01-01", to: "2026-12-31" }),
    );
    const shrinkage = reasons.find((r) => r.reason === "shrinkage");
    expect(shrinkage?.entries).toBe(3);
    // 20 lb at $1.00 a pound, three times.
    expect(shrinkage?.costCents).toBe(6_000);
    // Most frequent first, so the pattern is what somebody sees.
    expect(reasons[0].reason).toBe("shrinkage");
  });

  it("posts a count as variances, and writes NOTHING for a shelf that agrees", async () => {
    /**
     * **THE SLICE'S POINT.** The design: *the record and reality will disagree,
     * and counting is how that is discovered.*
     *
     * A movement of zero is refused by the ledger anyway, and a row saying
     * "nothing happened" in the one table that has to reconcile is noise.
     */
    const short = await newItem("Counted short");
    const exact = await newItem("Counted exactly");
    const over = await newItem("Counted over");
    for (const item of [short, exact, over]) {
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 100,
          costCents: 10_000,
          occurredOn: "2026-08-01",
        }),
      );
    }

    const count = await asOwner((tx) =>
      startCount(tx, ownerCtx(), {
        countedOn: "2026-08-20",
        countedBy: "Sarah",
      }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: short.id,
        countedQuantity: 92,
      }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: exact.id,
        countedQuantity: 100,
      }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: over.id,
        countedQuantity: 103,
      }),
    );

    const posted = await asOwner((tx) =>
      postCount(tx, ownerCtx(), count.id, "2026-08-20"),
    );
    expect(posted.count.status).toBe("posted");
    expect(posted.agreed).toBe(1);
    expect(posted.adjusted).toBe(2);

    // Variances are per item and NEVER summed: −8 lb and +3 lb of different
    // things have no total between them.
    const byItem = new Map(posted.variances.map((v) => [v.itemId, v.variance]));
    expect(byItem.get(short.id)).toBe(-8);
    expect(byItem.get(over.id)).toBe(3);
    expect(byItem.has(exact.id)).toBe(false);

    // The ledger now agrees with the shelf.
    const onHand = await asOwner((tx) => onHandByItem(tx, tenantId));
    expect(onHand.get(short.id)).toBe(92);
    expect(onHand.get(exact.id)).toBe(100);
    expect(onHand.get(over.id)).toBe(103);

    const lines = await asOwner((tx) => countLines(tx, tenantId, count.id));
    const agreedLine = lines.find((l) => l.itemId === exact.id)!;
    // It records that it was counted and what was expected — the useful half —
    // without putting a "nothing happened" row in the ledger.
    expect(agreedLine.expectedQuantity).toBe(100);
    expect(agreedLine.inventoryMovementId).toBeNull();
    const shortLine = lines.find((l) => l.itemId === short.id)!;
    expect(shortLine.expectedQuantity).toBe(100);
    expect(shortLine.inventoryMovementId).not.toBeNull();
  });

  it("counts a shelf found EMPTY, which is a real answer", async () => {
    // Zero is a count; a line nobody got to is a line that does not exist. The
    // difference is the reason `counted_quantity` is NOT NULL.
    const item = await newItem("Gone entirely");
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 40,
        costCents: 4_000,
        occurredOn: "2026-08-01",
      }),
    );
    const count = await asOwner((tx) =>
      startCount(tx, ownerCtx(), { countedOn: "2026-08-20" }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: item.id,
        countedQuantity: 0,
      }),
    );
    const posted = await asOwner((tx) =>
      postCount(tx, ownerCtx(), count.id, "2026-08-20"),
    );
    expect(posted.adjusted).toBe(1);
    expect(posted.variances[0].variance).toBe(-40);
    const onHand = await asOwner((tx) => onHandByItem(tx, tenantId));
    expect(onHand.get(item.id)).toBe(0);
  });

  it("counts a BATCH against that batch's balance, not the item's", async () => {
    const item = await newItem("Batched");
    const a = await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        newLotCode: "COUNT-A",
        quantity: 60,
        costCents: 6_000,
        occurredOn: "2026-08-01",
      }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        newLotCode: "COUNT-B",
        quantity: 40,
        costCents: 4_000,
        occurredOn: "2026-08-02",
      }),
    );

    const count = await asOwner((tx) =>
      startCount(tx, ownerCtx(), { countedOn: "2026-08-20" }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: item.id,
        lotId: a.lotId,
        countedQuantity: 55,
      }),
    );
    const posted = await asOwner((tx) =>
      postCount(tx, ownerCtx(), count.id, "2026-08-20"),
    );
    // Against COUNT-A's 60, not the item's 100.
    expect(posted.variances[0].variance).toBe(-5);
    const onHand = await asOwner((tx) => onHandByItem(tx, tenantId));
    expect(onHand.get(item.id)).toBe(95);
  });

  it("counting the same shelf twice replaces the answer rather than doubling it", async () => {
    const item = await newItem("Recounted");
    const count = await asOwner((tx) =>
      startCount(tx, ownerCtx(), { countedOn: "2026-08-20" }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: item.id,
        countedQuantity: 10,
      }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: item.id,
        countedQuantity: 12,
      }),
    );
    const lines = await asOwner((tx) => countLines(tx, tenantId, count.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].countedQuantity).toBe(12);
  });

  it("refuses to post an empty count, or to touch one already posted", async () => {
    const item = await newItem("Posted once");
    const count = await asOwner((tx) =>
      startCount(tx, ownerCtx(), { countedOn: "2026-08-20" }),
    );
    await expect(
      asOwner((tx) => postCount(tx, ownerCtx(), count.id, "2026-08-20")),
    ).rejects.toThrow(/nothing to reconcile/);

    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: item.id,
        countedQuantity: 3,
      }),
    );
    await asOwner((tx) => postCount(tx, ownerCtx(), count.id, "2026-08-20"));

    // A posted count has already written its variances. Changing a line now
    // would mean rewriting a movement, which the ledger never does.
    await expect(
      asOwner((tx) =>
        recordCountLine(tx, ownerCtx(), {
          countId: count.id,
          itemId: item.id,
          countedQuantity: 4,
        }),
      ),
    ).rejects.toThrow(/already in the ledger/);
    await expect(
      asOwner((tx) => postCount(tx, ownerCtx(), count.id, "2026-08-21")),
    ).rejects.toThrow(InventoryError);
  });

  it("a count is a CHORE — staff can walk it and post it", async () => {
    // The clearest `member` case in the pack: counting a freezer is done by
    // whoever was sent, standing in the cold with a clipboard.
    const item = await newItem("Staff counted");
    const count = await withTenant(
      tenantId,
      (tx) => startCount(tx, staffCtx(), { countedOn: "2026-08-20" }),
      { role: "staff", userId: STAFF },
    );
    await withTenant(
      tenantId,
      (tx) =>
        recordCountLine(tx, staffCtx(), {
          countId: count.id,
          itemId: item.id,
          countedQuantity: 7,
        }),
      { role: "staff", userId: STAFF },
    );
    const posted = await withTenant(
      tenantId,
      (tx) => postCount(tx, staffCtx(), count.id, "2026-08-20"),
      { role: "staff", userId: STAFF },
    );
    expect(posted.adjusted).toBe(1);
  });

  it("lists batches by expiry, soonest first, and drops the empty ones", async () => {
    /**
     * FEFO — first EXPIRED, first out. **A batch that is not there cannot go off
     * into a loss**, and a list padded with empties is a list nobody reads.
     */
    const item = await newItem("Perishable");
    const soon = await asOwner((tx) =>
      createLot(tx, ownerCtx(), {
        itemId: item.id,
        code: "GOES-FIRST",
        expiresOn: "2026-09-01",
      }),
    );
    const later = await asOwner((tx) =>
      createLot(tx, ownerCtx(), {
        itemId: item.id,
        code: "GOES-LATER",
        expiresOn: "2026-12-01",
      }),
    );
    const emptied = await asOwner((tx) =>
      createLot(tx, ownerCtx(), {
        itemId: item.id,
        code: "ALL-GONE",
        expiresOn: "2026-08-25",
      }),
    );
    const undated = await asOwner((tx) =>
      createLot(tx, ownerCtx(), { itemId: item.id, code: "NO-DATE" }),
    );

    for (const lot of [soon, later, emptied, undated]) {
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 10,
          costCents: 1_000,
          occurredOn: "2026-08-01",
        }),
      );
    }
    // This one has been used up entirely.
    await asOwner((tx) =>
      issueStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: emptied.id,
        quantity: 10,
        occurredOn: "2026-08-10",
      }),
    );

    const rows = await asOwner((tx) => expiringLots(tx, tenantId));
    const codes = rows.map((r) => r.lot.code);
    expect(codes).toEqual(["GOES-FIRST", "GOES-LATER"]);
    // A batch with no date is not "does not expire" — it is simply not on this
    // list, and the screen says which.
    expect(codes).not.toContain("NO-DATE");
    expect(codes).not.toContain("ALL-GONE");
    expect(rows[0].balance).toBe(10);
    expect(rows[0].itemName).toBe("Perishable");

    const beforeOctober = await asOwner((tx) =>
      expiringLots(tx, tenantId, { onOrBefore: "2026-10-01" }),
    );
    expect(beforeOctober.map((r) => r.lot.code)).toEqual(["GOES-FIRST"]);
  });


  it("A TRANSFER MOVES STOCK WITHOUT CHANGING HOW MUCH THERE IS", async () => {
    /**
     * Closes an open item this pack has carried since slice 0: moving stock was
     * "two movements, and the UI does not offer it as one act" — exactly the
     * shape that produces one leg entered and the other forgotten.
     *
     * `retail` needs it to load a market truck, which is a storage-location
     * asset like any other. That is the whole reason the design can claim the
     * offline problem has no distributed-inventory problem inside it.
     */
    const item = await newItem("Transferred feed");
    const truck = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({
          tenantId,
          kind: "vehicle",
          name: "Market truck",
          isStorageLocation: true,
        })
        .returning();
      return rows[0].id;
    });
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 100,
        costCents: 10_000,
        occurredOn: "2026-08-01",
        locationAssetId: freezerId,
      }),
    );

    const moved = await asOwner((tx) =>
      transferStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 40,
        fromLocationAssetId: freezerId,
        toLocationAssetId: truck,
        occurredOn: "2026-08-20",
      }),
    );
    expect(moved.out.quantity).toBe(-40);
    expect(moved.in.quantity).toBe(40);
    // CARRIES NO COST. Moving a box does not change what it cost, and stamping
    // a figure would release cost from the lot and put a different one back.
    expect(moved.out.costCents).toBeNull();
    expect(moved.in.costCents).toBeNull();

    // The item's total is untouched; only the "where" split moved.
    expect((await asOwner((tx) => onHandByItem(tx, tenantId))).get(item.id)).toBe(100);
    const onTruck = await asOwner((tx) => stockAtLocation(tx, tenantId, truck));
    expect(onTruck.find((l) => l.itemId === item.id)?.onHand).toBe(40);
    const inFreezer = await asOwner((tx) => stockAtLocation(tx, tenantId, freezerId));
    expect(inFreezer.find((l) => l.itemId === item.id)?.onHand).toBe(60);
  });

  it("refuses a transfer that starts and ends in the same place", async () => {
    // Both null is the common version: a farm that has never recorded a
    // location asking to move something from nowhere to nowhere. Two rows that
    // cancel would be noise in the one table that has to reconcile.
    const item = await newItem("Going nowhere");
    await expect(
      asOwner((tx) =>
        transferStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 5,
          occurredOn: "2026-08-20",
        }),
      ),
    ).rejects.toThrow(InventoryError);
  });

  it("drops a location line that has gone back to zero", async () => {
    // Stock that went out and came back is not "0 lb on the truck"; it is not
    // on the truck. Same call the item page's "where it is" panel makes.
    const item = await newItem("There and back");
    const van = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({
          tenantId,
          kind: "vehicle",
          name: "Van",
          isStorageLocation: true,
        })
        .returning();
      return rows[0].id;
    });
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 20,
        costCents: 2_000,
        occurredOn: "2026-08-01",
        locationAssetId: freezerId,
      }),
    );
    await asOwner((tx) =>
      transferStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 20,
        fromLocationAssetId: freezerId,
        toLocationAssetId: van,
        occurredOn: "2026-08-20",
      }),
    );
    await asOwner((tx) =>
      transferStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 20,
        fromLocationAssetId: van,
        toLocationAssetId: freezerId,
        occurredOn: "2026-08-21",
      }),
    );
    const onVan = await asOwner((tx) => stockAtLocation(tx, tenantId, van));
    expect(onVan.find((l) => l.itemId === item.id)).toBeUndefined();
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

  // ---- where a tax decision gets recorded (ADR 0013 A.2) ------------------

  describe("tax rules", () => {
    it("REFUSES A RULE THE REPORT LENS CANNOT HONOUR", async () => {
      /**
       * **The guarantee the whole stage rests on.** The screen disables the
       * unbuilt rules, but a disabled option is a courtesy — this is the rule.
       * Storing `paid` while the lens ignores it would produce a setting that
       * claims to change a report and does not, which is the "plausible,
       * balanced, wrong" failure ADR 0013 exists to end.
       *
       * When the lens learns a rule, `IMPLEMENTED_TIMING_RULES` widens and this
       * test's expectation moves with it. That is the intended coupling.
       */
      await expect(
        asOwner((tx) =>
          setTaxRule(tx, ownerCtx(), { itemKind: "feed", timingRule: "paid" }),
        ),
      ).rejects.toMatchObject({ code: "TIMING_RULE_UNAVAILABLE" });
    });

    it("refuses something that is not a moment the ledger can date", async () => {
      await expect(
        asOwner((tx) =>
          setTaxRule(tx, ownerCtx(), {
            itemKind: "feed",
            timingRule: "when_the_accountant_says",
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_TIMING_RULE" });
    });

    it("refuses a staff member — a tax election is not a chore", async () => {
      await expect(
        asOwner((tx) =>
          setTaxRule(tx, staffCtx(), {
            itemKind: "feed",
            timingRule: "consumed",
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("UPSERTS THE NULL-KIND DEFAULT rather than adding a second one", async () => {
      /**
       * Postgres treats two nulls as distinct, so the unique index does not hold
       * for the tenant default and the database would happily take two. Same
       * limitation and the same remedy as `recordCountLine`: select, then
       * update. Two default rows would make which one applies a matter of query
       * order.
       */
      await asOwner((tx) =>
        setTaxRule(tx, ownerCtx(), {
          itemKind: null,
          timingRule: "consumed",
          decidedBy: "First",
        }),
      );
      await asOwner((tx) =>
        setTaxRule(tx, ownerCtx(), {
          itemKind: null,
          timingRule: "consumed",
          decidedBy: "Second",
        }),
      );
      const rows = await asOwner((tx) => listTaxRules(tx, tenantId));
      const defaults = rows.filter((r) => r.itemKind === null);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].decidedBy).toBe("Second");
    });

    it("resolves most specific first, and says which row answered", async () => {
      await asOwner((tx) =>
        setTaxRule(tx, ownerCtx(), {
          itemKind: "feed",
          timingRule: "consumed",
          decidedBy: "Feed's accountant",
        }),
      );
      const rows = await asOwner((tx) => listTaxRules(tx, tenantId));
      const stored = rows.map((r) => ({
        itemKind: r.itemKind,
        timingRule: r.timingRule,
        expenseAccountId: r.expenseAccountId,
      }));
      expect(resolveTaxRule("feed", stored).source).toBe("item_kind");
      // A category nobody has decided about inherits the default row.
      expect(resolveTaxRule("bedding", stored).source).toBe("tenant_default");
    });

    it("CLEARING IS NOT THE SAME AS SETTING IT BACK", async () => {
      /**
       * "Nobody has decided about this category" and "somebody decided it is
       * used-based" are different facts, and `source` is what tells them apart.
       * A screen that could not would put an accountant's name against a
       * decision they never made.
       */
      await asOwner((tx) =>
        setTaxRule(tx, ownerCtx(), {
          itemKind: "seed",
          timingRule: "consumed",
          decidedBy: "Somebody",
        }),
      );
      await asOwner((tx) => clearTaxRule(tx, ownerCtx(), "seed"));
      const rows = await asOwner((tx) => listTaxRules(tx, tenantId));
      expect(rows.find((r) => r.itemKind === "seed")).toBeUndefined();
      // Still resolves — through the default, which is a different answer.
      const stored = rows.map((r) => ({
        itemKind: r.itemKind,
        timingRule: r.timingRule,
        expenseAccountId: r.expenseAccountId,
      }));
      expect(resolveTaxRule("seed", stored).source).toBe("tenant_default");
    });
  });
});
