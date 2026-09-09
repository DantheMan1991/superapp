import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  InventoryError,
  LOT_DIMENSION,
  archiveItem,
  closeLot,
  countEntries,
  createItem,
  createLot,
  getItem,
  listEntries,
  listItems,
  listLots,
  mergeLot,
  movementRowsForItem,
  onHandByItem,
  recordMovement,
  reopenLot,
  restoreItem,
  splitLot,
  updateItem,
  updateLot,
  lotAncestry,
  type InventoryCtx,
  listLocations,
  NO_ENTERPRISE_FILTER,
  setTaxRule,
  clearTaxRule,
  listTaxRules,
} from "../src/packs/inventory/ops";
import { createEnterprise } from "../src/lib/enterprises";
import { resolveTaxRule } from "../src/packs/inventory/core/tax-rules";
import {
  balanceByItem,
  balanceByLocation,
  balanceOfLot,
} from "../src/packs/inventory/core/balances";
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
  weightRatesForItems,
  adjustLotWeight,
  weightAdjustmentsForLots,
  lineCountsByCount,
  listKindsInUse,
  onHandByPlace,
  NO_PLACE,
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

  describe("NARROWING THE VALUATION", () => {
    /**
     * The three filters are the hub's three, with the same URL grammar and the
     * same words. Place is the one that changes what `Worth` MEANS, and the
     * screen says so — see the share tests below.
     */
    it("narrows by kind, and the total follows the rows", async () => {
      const feed = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: "Narrow feed",
          stockingUnit: "lb",
          itemKind: "feed",
        }),
      );
      const med = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: "Narrow medicine",
          stockingUnit: "floz",
          itemKind: "medicine",
        }),
      );
      for (const item of [feed, med]) {
        await asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: item.id,
            quantity: 10,
            costCents: 5_000,
            occurredOn: "2026-08-01",
          }),
        );
      }
      const all = await asOwner((tx) => valueStock(tx, tenantId));
      const onlyFeed = await asOwner((tx) =>
        valueStock(tx, tenantId, { kind: "medicine" }),
      );
      expect(all.rows.some((r) => r.itemName === "Narrow feed")).toBe(true);
      expect(onlyFeed.rows.some((r) => r.itemName === "Narrow feed")).toBe(false);
      expect(onlyFeed.rows.some((r) => r.itemName === "Narrow medicine")).toBe(true);
      // The total is the rows' total, not the whole business's.
      expect(onlyFeed.total.valueCents).toBe(
        onlyFeed.rows.reduce((sum, r) => sum + (r.valueCents ?? 0), 0),
      );
    });

    it("READS THE BATCH'S LINE OF BUSINESS OVER THE ITEM'S", async () => {
      /**
       * `inventory_lots.enterprise_id` exists because feed belongs to no one
       * part of a business while the pen it was fed to belongs to exactly one.
       * A filter reading only the item's would answer a different question from
       * the P&L it is being checked against.
       */
      const broilers = await asOwner((tx) =>
        createEnterprise(tx, ownerCtx(), { name: `Broilers ${STAMP}` }),
      );
      const pigs = await asOwner((tx) =>
        createEnterprise(tx, ownerCtx(), { name: `Pigs ${STAMP}` }),
      );
      const item = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: "Tagged feed",
          stockingUnit: "lb",
          itemKind: "feed",
          enterpriseId: broilers.id,
        }),
      );
      // The batch says otherwise, and the batch wins.
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "TAG-PIGS",
          enterpriseId: pigs.id,
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 10,
          costCents: 5_000,
          occurredOn: "2026-08-01",
        }),
      );
      const asPigs = await asOwner((tx) =>
        valueStock(tx, tenantId, { enterpriseId: pigs.id }),
      );
      const asBroilers = await asOwner((tx) =>
        valueStock(tx, tenantId, { enterpriseId: broilers.id }),
      );
      expect(asPigs.rows.some((r) => r.lotCode === "TAG-PIGS")).toBe(true);
      expect(asBroilers.rows.some((r) => r.lotCode === "TAG-PIGS")).toBe(false);
    });

    it("finds what nobody tagged, which is a real answer", async () => {
      const item = await newItem("Untagged feed");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 4,
          costCents: 1_000,
          occurredOn: "2026-08-01",
        }),
      );
      const untagged = await asOwner((tx) =>
        valueStock(tx, tenantId, { enterpriseId: NO_ENTERPRISE_FILTER }),
      );
      expect(untagged.rows.some((r) => r.itemName === "Untagged feed")).toBe(true);
    });

    it("SPLITS A BATCH'S COST BY HOW MUCH OF IT IS IN THE PLACE", async () => {
      /**
       * Nothing anywhere records what a shelf of a batch cost, so the quantity
       * there is used as the share of the quantity everywhere. This batch cost
       * $100.00 for 40 lb; a quarter of it is in the truck, so the truck holds
       * a quarter of the money.
       */
      const truck = await withSystem(async (tx) => {
        const rows = await tx
          .insert(schema.assets)
          .values({
            tenantId,
            kind: "equipment",
            name: `Share truck ${STAMP}`,
            isStorageLocation: true,
          })
          .returning();
        return rows[0].id;
      });
      const item = await newItem("Shared feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "SHARE-1" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 40,
          costCents: 10_000,
          occurredOn: "2026-08-01",
        }),
      );
      await asOwner((tx) =>
        transferStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 10,
          toLocationAssetId: truck,
          occurredOn: "2026-08-02",
        }),
      );

      const whole = await asOwner((tx) =>
        valueStock(tx, tenantId, { itemId: item.id }),
      );
      expect(whole.rows[0]).toMatchObject({
        quantity: 40,
        valueCents: 10_000,
        method: "carried",
      });

      const atTruck = await asOwner((tx) =>
        valueStock(tx, tenantId, { itemId: item.id, locationAssetId: truck }),
      );
      expect(atTruck.rows).toHaveLength(1);
      expect(atTruck.rows[0]).toMatchObject({
        quantity: 10,
        valueCents: 2_500,
        method: "share",
      });

      // And the rest is still where it was, unplaced.
      const unplaced = await asOwner((tx) =>
        valueStock(tx, tenantId, { itemId: item.id, locationAssetId: NO_PLACE }),
      );
      expect(unplaced.rows[0]).toMatchObject({
        quantity: 30,
        valueCents: 7_500,
        method: "share",
      });
      // The two places add back to the whole, which is the property that makes
      // the apportionment worth doing at all.
      expect(
        (atTruck.total.valueCents ?? 0) + (unplaced.total.valueCents ?? 0),
      ).toBe(whole.total.valueCents);
    });

    it("says CANNOT BE SPLIT rather than inventing a share, and counts it as missing", async () => {
      /**
       * Nine in the truck and minus nine unplaced nets to nothing. There is no
       * share of nothing, and the batch HAS a cost — so `none` would be a lie
       * about a batch nobody costed while a zero would be a lie about its
       * worth. The line lands in the same "what this figure leaves out" count
       * the page is built around.
       */
      const truck = await withSystem(async (tx) => {
        const rows = await tx
          .insert(schema.assets)
          .values({
            tenantId,
            kind: "equipment",
            name: `Unsplit truck ${STAMP}`,
            isStorageLocation: true,
          })
          .returning();
        return rows[0].id;
      });
      const item = await newItem("Unsplittable feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "UNSPLIT-1" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 9,
          costCents: 4_500,
          occurredOn: "2026-08-01",
        }),
      );
      // Moved to the truck, then issued from nowhere — a real sequence, and it
      // leaves the batch at zero overall with nine standing in one place.
      await asOwner((tx) =>
        transferStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 9,
          toLocationAssetId: truck,
          occurredOn: "2026-08-02",
        }),
      );
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 9,
          occurredOn: "2026-08-03",
        }),
      );

      const atTruck = await asOwner((tx) =>
        valueStock(tx, tenantId, { itemId: item.id, locationAssetId: truck }),
      );
      expect(atTruck.rows[0]).toMatchObject({
        quantity: 9,
        valueCents: null,
        method: "unsplit",
      });
      expect(atTruck.total).toMatchObject({
        unvaluedLines: 1,
        unvaluedQuantity: 9,
        incomplete: true,
      });
    });

    it("leaves the whole-business valuation exactly as it was", async () => {
      // Every existing caller passes no place, so no share is taken and the
      // answer is the one it has always been.
      const item = await newItem("Unnarrowed feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "PLAIN-1" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 20,
          costCents: 8_000,
          occurredOn: "2026-08-01",
        }),
      );
      const valuation = await asOwner((tx) =>
        valueStock(tx, tenantId, { itemId: item.id }),
      );
      expect(valuation.rows[0]).toMatchObject({
        valueCents: 8_000,
        method: "carried",
        locationAssetId: null,
      });
    });
  });

  describe("THE WHOLE HISTORY", () => {
    /**
     * Every figure in this pack is a fold over these rows and nothing writes a
     * balance down, so this is not a log of what the pack did — it IS the
     * record, and until slice 9 it could only be read one item at a time,
     * twenty five rows deep.
     */
    it("is a TOTAL order, so a page boundary never shows a row twice or never", async () => {
      /**
       * `occurred_on` is a DATE and `created_at` ties inside one transaction —
       * a split writes its out and in legs with one `now()`. Without the id
       * tiebreak, two queries with `offset` can disagree about which of two
       * equal rows is on which page. Every page here is walked and the union
       * has to be exactly the set, with no repeats.
       */
      const item = await newItem("Paged feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "PAGE-1" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 100,
          occurredOn: "2026-08-01",
        }),
      );
      // Five splits on ONE day, each writing two rows in one transaction: ten
      // rows with the same date, in pairs sharing created_at.
      for (let i = 1; i <= 5; i += 1) {
        await asOwner((tx) =>
          splitLot(tx, ownerCtx(), {
            lotId: lot.id,
            quantity: 2,
            newCode: `PAGE-1-${i}`,
            occurredOn: "2026-08-01",
          }),
        );
      }
      const total = await asOwner((tx) =>
        countEntries(tx, tenantId, { itemId: item.id }),
      );
      expect(total).toBe(11);

      const seen = new Set<string>();
      for (let page = 0; page * 3 < total; page += 1) {
        const rows = await asOwner((tx) =>
          listEntries(tx, tenantId, { itemId: item.id, limit: 3, offset: page * 3 }),
        );
        for (const row of rows) {
          expect(seen.has(row.movement.id)).toBe(false);
          seen.add(row.movement.id);
        }
      }
      expect(seen.size).toBe(11);
    });

    it("names the batch it left and the batch that ate it", async () => {
      const feed = await newItem("Named feed");
      const birds = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: "Named birds",
          stockingUnit: "head",
          itemKind: "livestock",
        }),
      );
      const pen = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: birds.id, code: "PEN-EATS" }),
      );
      const bag = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: feed.id, code: "BAG-EATEN" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: feed.id,
          lotId: bag.id,
          quantity: 50,
          occurredOn: "2026-08-01",
        }),
      );
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: feed.id,
          lotId: bag.id,
          issuedToLotId: pen.id,
          quantity: 10,
          occurredOn: "2026-08-02",
        }),
      );
      const [newest] = await asOwner((tx) =>
        listEntries(tx, tenantId, { itemId: feed.id, limit: 1 }),
      );
      expect(newest).toMatchObject({
        itemName: "Named feed",
        unit: "lb",
        lotCode: "BAG-EATEN",
        consumerCode: "PEN-EATS",
      });
      expect(newest.movement.quantity).toBe(-10);
    });

    it("searches the note, the reason and both batch codes, and a typed % is a %", async () => {
      const item = await newItem("Searchable feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "FIND-ME" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 20,
          occurredOn: "2026-08-01",
          notes: "ticket said 100% organic",
        }),
      );
      await asOwner((tx) =>
        adjustStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: -2,
          reason: "spoilage",
          occurredOn: "2026-08-03",
        }),
      );
      const mine = (rows: { movement: { itemId: string } }[]) =>
        rows.filter((r) => r.movement.itemId === item.id);

      expect(mine(await asOwner((tx) => listEntries(tx, tenantId, { q: "find-me" })))).toHaveLength(2);
      expect(mine(await asOwner((tx) => listEntries(tx, tenantId, { q: "organic" })))).toHaveLength(1);
      expect(mine(await asOwner((tx) => listEntries(tx, tenantId, { q: "spoil" })))).toHaveLength(1);
      // `%` typed by a person means the character. Unescaped it matches every
      // row, and `100% organic` is exactly the note somebody would type.
      expect(mine(await asOwner((tx) => listEntries(tx, tenantId, { q: "100%" })))).toHaveLength(1);
      expect(mine(await asOwner((tx) => listEntries(tx, tenantId, { q: "999%" })))).toHaveLength(0);
      // And the count agrees with the list, always.
      expect(await asOwner((tx) => countEntries(tx, tenantId, { q: "organic", itemId: item.id }))).toBe(1);
    });

    it("narrows by kind and by place, and a hand-typed place is NO rows", async () => {
      const truck = await withSystem(async (tx) => {
        const rows = await tx
          .insert(schema.assets)
          .values({
            tenantId,
            kind: "equipment",
            name: `Log truck ${STAMP}`,
            isStorageLocation: true,
          })
          .returning();
        return rows[0].id;
      });
      const med = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: "Logged medicine",
          stockingUnit: "floz",
          itemKind: "medicine",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: med.id,
          quantity: 5,
          occurredOn: "2026-08-01",
          locationAssetId: truck,
        }),
      );
      const asMedicine = await asOwner((tx) =>
        listEntries(tx, tenantId, { kind: "medicine", itemId: med.id }),
      );
      expect(asMedicine).toHaveLength(1);
      expect(asMedicine[0].placeName).toBe(`Log truck ${STAMP}`);
      expect(
        await asOwner((tx) => listEntries(tx, tenantId, { kind: "feed", itemId: med.id })),
      ).toHaveLength(0);
      expect(
        await asOwner((tx) =>
          listEntries(tx, tenantId, { locationAssetId: truck, itemId: med.id }),
        ),
      ).toHaveLength(1);
      expect(
        await asOwner((tx) =>
          listEntries(tx, tenantId, { locationAssetId: NO_PLACE, itemId: med.id }),
        ),
      ).toHaveLength(0);
      // `?place=all` typed into the address bar. Not every row, and not a 500.
      expect(
        await asOwner((tx) => listEntries(tx, tenantId, { locationAssetId: "all" })),
      ).toEqual([]);
      expect(
        await asOwner((tx) => countEntries(tx, tenantId, { locationAssetId: "all" })),
      ).toBe(0);
    });
  });

  it("valueStock answers a hand-typed id with NO rows rather than a 500", async () => {
    /**
     * Slice 8 sent `?place=` and `?enterprise=` straight to uuid columns, and
     * Postgres refuses `invalid input syntax for type uuid` rather than
     * returning nothing — so `?place=all` in the address bar took the whole
     * valuation page down. The same rule `listItems` already had on its
     * enterprise filter: a malformed id is no rows, which is what a valid id
     * from another tenant already produces.
     */
    const byPlace = await asOwner((tx) =>
      valueStock(tx, tenantId, { locationAssetId: "all" }),
    );
    expect(byPlace.rows).toEqual([]);
    expect(byPlace.total.incomplete).toBe(false);
    const byEnterprise = await asOwner((tx) =>
      valueStock(tx, tenantId, { enterpriseId: "not-a-uuid" }),
    );
    expect(byEnterprise.rows).toEqual([]);
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

  it("refuses to post a count before the day it was walked, in a sentence", async () => {
    // The table CHECKs the same thing; the op says it first so the screen can
    // name the day instead of "something went wrong".
    const item = await newItem("Posted early");
    const count = await asOwner((tx) =>
      startCount(tx, ownerCtx(), { countedOn: "2026-08-20" }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: count.id,
        itemId: item.id,
        countedQuantity: 3,
      }),
    );
    await expect(
      asOwner((tx) => postCount(tx, ownerCtx(), count.id, "2026-08-19")),
    ).rejects.toThrow(/on or after the day it was counted/);
    // Still a draft, so the same walk posts on the right day.
    const posted = await asOwner((tx) =>
      postCount(tx, ownerCtx(), count.id, "2026-08-20"),
    );
    expect(posted.count.status).toBe("posted");
  });

  it("counts every walk's shelves in one query", async () => {
    const item = await newItem("Shelf counted");
    const walked = await asOwner((tx) =>
      startCount(tx, ownerCtx(), { countedOn: "2026-08-20" }),
    );
    const empty = await asOwner((tx) =>
      startCount(tx, ownerCtx(), { countedOn: "2026-08-21" }),
    );
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: walked.id,
        itemId: item.id,
        countedQuantity: 1,
      }),
    );
    // The same shelf again replaces rather than adds, so it is still one.
    await asOwner((tx) =>
      recordCountLine(tx, ownerCtx(), {
        countId: walked.id,
        itemId: item.id,
        countedQuantity: 2,
      }),
    );
    const byCount = await asOwner((tx) => lineCountsByCount(tx, tenantId));
    expect(byCount.get(walked.id)).toBe(1);
    // A walk with nothing written down is absent, which the page reads as 0.
    expect(byCount.has(empty.id)).toBe(false);
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

  it("moves stock from nowhere into a place — a placing, not a refusal", async () => {
    // A farm that has just started recording places has stock with none.
    // Moving that into the freezer is the commonest move it will make, and the
    // Move door offers `Not recorded` as a From for exactly this.
    const item = await newItem("Placed late");
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 20,
        occurredOn: "2026-08-01",
      }),
    );
    await asOwner((tx) =>
      transferStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 8,
        fromLocationAssetId: null,
        toLocationAssetId: freezerId,
        occurredOn: "2026-08-02",
      }),
    );
    const rows = await asOwner((tx) => movementRowsForItem(tx, tenantId, item.id));
    const byPlace = balanceByLocation(rows);
    expect(byPlace.find((b) => b.locationAssetId === freezerId)?.quantity).toBe(8);
    expect(byPlace.find((b) => b.locationAssetId === null)?.quantity).toBe(12);
    // The item's total does not move: a move is two legs that cancel.
    expect(balanceByItem(rows).get(item.id)).toBe(20);
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

  it("answers WHAT IS IN THIS PLACE in one query, and keeps the unplaced honest", async () => {
    const item = await newItem("Placed feed");
    const truck = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({
          tenantId,
          kind: "equipment",
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
        occurredOn: "2026-08-01",
        locationAssetId: freezerId,
      }),
    );
    await asOwner((tx) =>
      transferStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 30,
        fromLocationAssetId: freezerId,
        toLocationAssetId: truck,
        occurredOn: "2026-08-02",
      }),
    );
    // A delivery nobody placed: kept, under its own key, so the parts still
    // add up to the item's 105.
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 5,
        occurredOn: "2026-08-03",
      }),
    );
    // In and straight back out again: not "0 on the truck", not on the truck.
    const gone = await newItem("Came and went");
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: gone.id,
        quantity: 4,
        occurredOn: "2026-08-01",
        locationAssetId: truck,
      }),
    );
    await asOwner((tx) =>
      issueStock(tx, ownerCtx(), {
        itemId: gone.id,
        quantity: 4,
        occurredOn: "2026-08-02",
        locationAssetId: truck,
      }),
    );

    const byPlace = await asOwner((tx) => onHandByPlace(tx, tenantId));
    expect(byPlace.get(freezerId)?.get(item.id)).toBe(70);
    expect(byPlace.get(truck)?.get(item.id)).toBe(30);
    expect(byPlace.get(NO_PLACE)?.get(item.id)).toBe(5);
    expect(byPlace.get(truck)?.has(gone.id) ?? false).toBe(false);
  });

  it("counts kinds over the same population the list shows", async () => {
    const gone = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        name: "Kind gone",
        stockingUnit: "each",
        itemKind: "kindtest",
      }),
    );
    await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        name: "Kind live",
        stockingUnit: "each",
        itemKind: "kindtest",
      }),
    );
    await asOwner((tx) => archiveItem(tx, ownerCtx(), gone.id));
    const all = await asOwner((tx) => listKindsInUse(tx, tenantId));
    const active = await asOwner((tx) =>
      listKindsInUse(tx, tenantId, { status: "active" }),
    );
    expect(all.find((k) => k.kind === "kindtest")?.count).toBe(2);
    // The list hides retired things unless asked, so the pill does too.
    expect(active.find((k) => k.kind === "kindtest")?.count).toBe(1);
  });

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

  describe("PUTTING A BATCH RIGHT", () => {
    /**
     * Everything here writes columns that have existed since slice 0 and
     * touches no movement. What a batch IS can be corrected; what happened to
     * it is the ledger and stays as recorded.
     */
    it("corrects the code, the dates and the notes, and moves no stock", async () => {
      const item = await newItem("Correctable feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "TPYO-1",
          openedOn: "2026-09-01",
          expiresOn: "2026-09-30",
          notes: "first",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 40,
          occurredOn: "2026-09-01",
        }),
      );

      const updated = await asOwner((tx) =>
        updateLot(tx, ownerCtx(), lot.id, {
          code: "  TYPO-1  ",
          openedOn: "2026-09-02",
          expiresOn: "2026-10-15",
          notes: "  put right  ",
        }),
      );
      expect(updated.code).toBe("TYPO-1");
      expect(updated.openedOn).toBe("2026-09-02");
      expect(updated.expiresOn).toBe("2026-10-15");
      expect(updated.notes).toBe("put right");

      // The ledger is untouched: same rows, same balance.
      const rows = await asOwner((tx) =>
        movementRowsForItem(tx, tenantId, item.id),
      );
      expect(rows).toHaveLength(1);
      expect(balanceOfLot(rows, lot.id)).toBe(40);
    });

    it("clears the expiry when it is set to null, rather than leaving it", async () => {
      // Blank means two things the pack does not tell apart — nobody dated it,
      // and it does not go off — and a batch dated by mistake needs the second.
      const item = await newItem("Twine");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "TWINE-1",
          expiresOn: "2026-09-30",
        }),
      );
      const updated = await asOwner((tx) =>
        updateLot(tx, ownerCtx(), lot.id, { expiresOn: null }),
      );
      expect(updated.expiresOn).toBeNull();
    });

    it("RENAMES THE COST OBJECT WITH IT", async () => {
      /**
       * The batch code is half of the dimension member's display name. A batch
       * renamed here and still called the old thing on a journal line would be
       * two answers to one question.
       */
      const item = await newItem("Renamed feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "OLD-CODE" }),
      );
      await asOwner((tx) =>
        updateLot(tx, ownerCtx(), lot.id, { code: "NEW-CODE" }),
      );
      const member = (await lotMembers()).find((m) => m.packEntityId === lot.id);
      expect(member?.displayName).toBe("Renamed feed · NEW-CODE");
      // Renamed, never re-minted: the same row, so every existing tag follows.
      expect((await lotMembers()).filter((m) => m.packEntityId === lot.id))
        .toHaveLength(1);
    });

    it("RENAMING THE ITEM RENAMES EVERY BATCH OF IT", async () => {
      /**
       * The mirror of the test above, and the half that was missing: without
       * it a business that renamed an item got a picker listing both names.
       */
      const item = await newItem("Broiler chicks");
      const first = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "HATCH-1" }),
      );
      const second = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "HATCH-2" }),
      );
      await asOwner((tx) =>
        updateItem(tx, ownerCtx(), item.id, { name: "Cornish Cross" }),
      );
      const members = await lotMembers();
      expect(members.find((m) => m.packEntityId === first.id)?.displayName).toBe(
        "Cornish Cross · HATCH-1",
      );
      expect(members.find((m) => m.packEntityId === second.id)?.displayName).toBe(
        "Cornish Cross · HATCH-2",
      );
    });

    it("refuses an empty code", async () => {
      const item = await newItem("Nameless feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "HAS-A-CODE" }),
      );
      await expect(
        asOwner((tx) => updateLot(tx, ownerCtx(), lot.id, { code: "   " })),
      ).rejects.toMatchObject({ code: "LOT_INVALID" });
    });

    it("lets WHERE FROM be fixed before anything moves, and not after", async () => {
      /**
       * `recordMovement` reads `lot.source` to decide the CREDIT side of a
       * receipt, and stamps that decision into the entry at the time. Before
       * the first movement there is nothing to disagree with and it is a typo;
       * afterwards the batch would describe itself one way while its own
       * postings say the other.
       */
      const item = await newItem("Raised feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "SRC-1" }),
      );
      expect(lot.source).toBe("purchased");

      const fixed = await asOwner((tx) =>
        updateLot(tx, ownerCtx(), lot.id, { source: "raised" }),
      );
      expect(fixed.source).toBe("raised");

      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 10,
          occurredOn: "2026-09-01",
        }),
      );
      await expect(
        asOwner((tx) =>
          updateLot(tx, ownerCtx(), lot.id, { source: "produced" }),
        ),
      ).rejects.toMatchObject({ code: "LOT_INVALID" });

      // And the same call with the SAME source is not a change, so it passes —
      // otherwise saving the dialog without touching the picker would fail.
      const again = await asOwner((tx) =>
        updateLot(tx, ownerCtx(), lot.id, { source: "raised", notes: "ok" }),
      );
      expect(again.source).toBe("raised");
      expect(again.notes).toBe("ok");
    });

    it("REFUSES TO CLOSE A BATCH WITH STOCK STILL IN IT", async () => {
      /**
       * Closing archives the cost object, so a batch with stock in it would be
       * hidden by it while the valuation went on counting it. `livestock` has
       * refused this at its own door since its slice; the guard is now where
       * the archiving happens.
       */
      const item = await newItem("Still full", "lb");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "FULL-1" }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 25,
          occurredOn: "2026-09-01",
        }),
      );
      await expect(
        asOwner((tx) => closeLot(tx, ownerCtx(), lot.id)),
      ).rejects.toMatchObject({
        code: "LOT_INVALID",
        // The sentence carries the figure and its unit, so the reader knows
        // how much has to be accounted for.
        message:
          "25 pounds is still in this batch — record what happened to it first",
      });
      // Still open, and its cost object still active.
      const stillOpen = await asOwner((tx) =>
        listLots(tx, tenantId, { itemId: item.id }),
      );
      expect(stillOpen.find((l) => l.id === lot.id)?.status).toBe("open");

      // Empty it and the same call goes through.
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 25,
          occurredOn: "2026-09-02",
        }),
      );
      const closed = await asOwner((tx) => closeLot(tx, ownerCtx(), lot.id));
      expect(closed.status).toBe("closed");
    });

    it("lets a batch BELOW ZERO be closed, on purpose", async () => {
      /**
       * A batch at minus five hides nothing, and refusing it would strand a
       * business that issued feed it never recorded a delivery for — the same
       * reason negative stock is allowed in the first place.
       */
      const item = await newItem("Overdrawn", "lb");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "NEG-1" }),
      );
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 5,
          occurredOn: "2026-09-01",
        }),
      );
      const closed = await asOwner((tx) => closeLot(tx, ownerCtx(), lot.id));
      expect(closed.status).toBe("closed");
    });

    it("REOPENING PUTS THE COST OBJECT BACK", async () => {
      /**
       * **THE ASYMMETRY THIS EXISTS TO CLOSE.** Closing archives the member;
       * for as long as the only reopen lived in `livestock` it set the status
       * column directly and left the member archived, so a batch the screen
       * showed as open had its cost object switched off —
       * `assertDimensionsUsable` refuses to post against one of those.
       */
      const item = await newItem("Reopened feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "AGAIN-1" }),
      );
      await asOwner((tx) => closeLot(tx, ownerCtx(), lot.id));
      expect(
        (await lotMembers()).find((m) => m.packEntityId === lot.id)?.isActive,
      ).toBe(false);

      const reopened = await asOwner((tx) => reopenLot(tx, ownerCtx(), lot.id));
      expect(reopened.status).toBe("open");
      const member = (await lotMembers()).find((m) => m.packEntityId === lot.id);
      expect(member?.isActive).toBe(true);
      expect(member?.displayName).toBe("Reopened feed · AGAIN-1");
    });

    it("is the owner's, both ways", async () => {
      const item = await newItem("Guarded feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "GUARD-1" }),
      );
      await expect(
        asOwner((tx) => updateLot(tx, staffCtx(), lot.id, { code: "NOPE" })),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        asOwner((tx) => reopenLot(tx, staffCtx(), lot.id)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
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

  describe("what a batch weighs", () => {
    it("records the weight on the receipt and reads it back per LOT", async () => {
      // The whole slice in one test: two runs of the same item packed
      // differently, and the rate that comes back is each batch's own. One
      // figure across the item would be true of neither, which is exactly the
      // item-level drift `averageCostRate` is stuck with.
      const item = await newItem("Ground beef", "pkg");
      const light = await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          newLotCode: "PACKED-1LB",
          quantity: 38,
          weightLb: 47.5,
          occurredOn: "2026-08-20",
        }),
      );
      const heavy = await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          newLotCode: "PACKED-2LB",
          quantity: 10,
          weightLb: 25,
          occurredOn: "2026-08-21",
        }),
      );
      const { byItem, byLot } = await asOwner((tx) =>
        weightRatesForItems(tx, tenantId, [item.id]),
      );
      expect(byLot.get(light.lotId!)).toBeCloseTo(1.25, 10);
      expect(byLot.get(heavy.lotId!)).toBeCloseTo(2.5, 10);
      // The item's own figure is the quantity-weighted blend, and is the
      // fallback for a line with no batch — 72.5 lb over 48 packages.
      expect(byItem.get(item.id)).toBeCloseTo(72.5 / 48, 10);
    });

    it("leaves a batch nobody weighed OUT of the map, rather than at zero", async () => {
      // UNWEIGHED IS NOT ZERO, at the read boundary and not only in the fold.
      const item = await newItem("Unweighed packs", "pkg");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          newLotCode: "NO-SCALE",
          quantity: 12,
          occurredOn: "2026-08-20",
        }),
      );
      const { byItem, byLot } = await asOwner((tx) =>
        weightRatesForItems(tx, tenantId, [item.id]),
      );
      expect(byItem.has(item.id)).toBe(false);
      expect(byLot.size).toBe(0);
    });

    it("REFUSES a weight on something going out", async () => {
      // A weight belongs to stock arriving. `core/weight.ts` folds only
      // inbound movements, so one recorded here would be read by nothing while
      // looking exactly like a number that meant something.
      const item = await newItem("Outbound weight", "pkg");
      await expect(
        asOwner((tx) =>
          recordMovement(tx, ownerCtx(), {
            itemId: item.id,
            quantity: -5,
            weightLb: 6.25,
            movementKind: "issue",
            occurredOn: "2026-08-20",
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_WEIGHT" });
    });

    it("refuses a weight of nothing, because that is not a measurement", async () => {
      const item = await newItem("Zero weight", "pkg");
      await expect(
        asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: item.id,
            newLotCode: "ZERO",
            quantity: 5,
            weightLb: 0,
            occurredOn: "2026-08-20",
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_WEIGHT" });
    });

    it("carries no weight through a transfer, and that is the design", async () => {
      // A transfer moves a box without re-weighing it. The pounds at a
      // location are the batch's rate applied to what is there — which is why
      // there is no weight parameter on `transferStock` to forget to pass.
      const item = await newItem("Moved packs", "pkg");
      const received = await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          newLotCode: "MOVED",
          quantity: 20,
          weightLb: 25,
          occurredOn: "2026-08-20",
          locationAssetId: freezerId,
        }),
      );
      await asOwner((tx) =>
        transferStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: received.lotId,
          quantity: 8,
          fromLocationAssetId: freezerId,
          toLocationAssetId: null,
          occurredOn: "2026-08-21",
        }),
      );
      // Both transfer legs carried nothing, so the rate is still the receipt's.
      const { byLot } = await asOwner((tx) =>
        weightRatesForItems(tx, tenantId, [item.id]),
      );
      expect(byLot.get(received.lotId!)).toBeCloseTo(1.25, 10);
    });
  });

  describe("which line of business it belongs to", () => {
    /**
     * Slice 2 of profit-per-enterprise. **Two rules, and the second is the one
     * that does the work later:** an item can name a line of business, and a
     * batch INHERITS it unless told otherwise.
     */
    async function anEnterprise(name: string) {
      return asOwner((tx) =>
        createEnterprise(tx, ownerCtx(), { name: `${name}-${process.pid}` }),
      );
    }

    it("tags an item, and the filter finds it", async () => {
      const ent = await anEnterprise("Broilers");
      const item = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: `Tagged feed ${process.pid}`,
          stockingUnit: "lb",
          enterpriseId: ent.id,
        }),
      );
      const found = await asOwner((tx) =>
        listItems(tx, tenantId, { enterprise: ent.id }),
      );
      expect(found.map((i) => i.id)).toEqual([item.id]);
    });

    it("A BATCH INHERITS ITS ITEM'S, which is what makes feed cost land right", async () => {
      /**
       * The rule slice 3 rests on. A farm that has tagged "Broiler chicks" as
       * Broilers must not have to say so again on every hatch — and the batch
       * is where the costing reads it from.
       */
      const ent = await anEnterprise("Inherit");
      const item = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: `Inheriting item ${process.pid}`,
          stockingUnit: "head",
          enterpriseId: ent.id,
        }),
      );
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: `INH-${process.pid}` }),
      );
      expect(lot.enterpriseId).toBe(ent.id);
    });

    it("lets a batch OVERRIDE it, including back to none", async () => {
      // `undefined` means "not said" and `null` means "said none" — the
      // distinction the whole pack keeps, and the reason the column is on both.
      const ent = await anEnterprise("Override");
      const other = await anEnterprise("Elsewhere");
      const item = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: `Override item ${process.pid}`,
          stockingUnit: "head",
          enterpriseId: ent.id,
        }),
      );
      const moved = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `OVR-${process.pid}`,
          enterpriseId: other.id,
        }),
      );
      expect(moved.enterpriseId).toBe(other.id);

      const none = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `NONE-${process.pid}`,
          enterpriseId: null,
        }),
      );
      expect(none.enterpriseId).toBeNull();
    });

    it("FINDS WHAT IS NOT TAGGED, which is the question after tagging anything", async () => {
      const untagged = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: `Untagged ${process.pid}`,
          stockingUnit: "lb",
        }),
      );
      const found = await asOwner((tx) =>
        listItems(tx, tenantId, { enterprise: "none" }),
      );
      expect(found.map((i) => i.id)).toContain(untagged.id);
      expect(found.every((i) => i.enterpriseId === null)).toBe(true);
    });

    it("RETURNS NOTHING for a filter that is not a uuid, rather than 500ing", async () => {
      /**
       * **A HAND-TYPED `?enterprise=` USED TO CRASH THE WHOLE HUB.** The value
       * went straight into a `uuid` column, and Postgres raises
       * `invalid input syntax for type uuid` rather than matching nothing — so
       * a stale or garbled link took out the inventory page rather than showing
       * an empty list. Found by typing `?enterprise=all` while driving it.
       *
       * Nothing rather than everything: a valid uuid belonging to another
       * tenant already returns nothing here, so a malformed one behaving the
       * same way is the consistent answer, and showing the full list under a
       * bar claiming to be filtered would be the worse lie.
       */
      for (const bad of ["all", "undefined", "Broilers", "123"]) {
        const found = await asOwner((tx) =>
          listItems(tx, tenantId, { enterprise: bad }),
        );
        expect(found).toEqual([]);
      }
    });

    it("REFUSES ANOTHER TENANT'S, and the composite FK is what refuses it", async () => {
      // Unrepresentable rather than merely refused by application code: this
      // fails at the constraint, so it would fail under `withSystem` too.
      let otherTenant = "";
      await withSystem(async (tx) => {
        const rows = await tx
          .insert(schema.tenants)
          .values({
            clerkOrgId: `${STAMP}-ent-other`,
            name: "Ent Other",
            slug: `${STAMP}-ent-other`,
          })
          .returning();
        otherTenant = rows[0].id;
      });
      const theirs = await withTenant(
        otherTenant,
        (tx) =>
          createEnterprise(
            tx,
            { tenantId: otherTenant, userId: OWNER, role: "owner" },
            { name: "Theirs" },
          ),
        { role: "owner", userId: OWNER },
      );
      await expect(
        asOwner((tx) =>
          createItem(tx, ownerCtx(), {
            name: `Cross tenant ${process.pid}`,
            stockingUnit: "lb",
            enterpriseId: theirs.id,
          }),
        ),
      ).rejects.toThrow();
      await withSystem((tx) =>
        tx.delete(schema.tenants).where(eq(schema.tenants.id, otherTenant)),
      );
    });
  });

  describe("narrowing the list", () => {
    /**
     * **THE FILTER BAR'S READ LAYER, which shipped in slice 0 and had no
     * control until 2026-08-25.** The kind filter answers "just feed" and "just
     * animals"; the search answers the question that cuts ACROSS kinds, because
     * chicken feed, live broilers and packaged chicken are three kinds and one
     * enterprise.
     */
    // A FRESH PREFIX PER CALL. These items are never deleted between tests, so
    // a shared stamp makes the second test see the first one's three rows.
    let batch = 0;
    async function namedItems() {
      batch += 1;
      const stamp = `search-${process.pid}-${batch}`;
      await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: `${stamp} Broiler chicks`,
          stockingUnit: "head",
          itemKind: "livestock",
        }),
      );
      await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: `${stamp} Whole broilers`,
          stockingUnit: "pkg",
          itemKind: "meat",
        }),
      );
      await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: `${stamp} Grower crumble`,
          stockingUnit: "lb",
          itemKind: "feed",
        }),
      );
      return stamp;
    }

    it("finds by name ACROSS kinds, which is what a kind filter cannot do", async () => {
      const stamp = await namedItems();
      const found = await asOwner((tx) =>
        listItems(tx, tenantId, { search: "broiler" }),
      );
      const mine = found.filter((i) => i.name.startsWith(stamp));
      // A bird on the hoof and a bird in a bag: two kinds, one enterprise.
      expect(mine.map((i) => i.itemKind).sort()).toEqual(["livestock", "meat"]);
    });

    it("is case-insensitive and matches the middle of a name", async () => {
      const stamp = await namedItems();
      const found = await asOwner((tx) =>
        listItems(tx, tenantId, { search: "CRUMB" }),
      );
      expect(found.filter((i) => i.name.startsWith(stamp))).toHaveLength(1);
    });

    it("combines with the kind filter rather than replacing it", async () => {
      const stamp = await namedItems();
      const found = await asOwner((tx) =>
        listItems(tx, tenantId, { search: "broiler", kind: "meat" }),
      );
      const mine = found.filter((i) => i.name.startsWith(stamp));
      expect(mine).toHaveLength(1);
      expect(mine[0].name).toContain("Whole broilers");
    });

    it("TREATS % AND _ AS CHARACTERS, not as wildcards", async () => {
      /**
       * Unescaped, a search box is a way to match every row by typing one key.
       * `_` is the worse of the two: it matches any single character, so
       * "cr_mble" would quietly return the crumble and nothing about the result
       * would look wrong.
       */
      const stamp = await namedItems();
      const pct = await asOwner((tx) => listItems(tx, tenantId, { search: "%" }));
      expect(pct.filter((i) => i.name.startsWith(stamp))).toHaveLength(0);
      const underscore = await asOwner((tx) =>
        listItems(tx, tenantId, { search: "Gr_wer" }),
      );
      expect(underscore.filter((i) => i.name.startsWith(stamp))).toHaveLength(0);
    });

    it("ignores a blank or whitespace-only term rather than matching nothing", async () => {
      // An empty box is not a filter. Pushing `''` through `ilike '%%'` happens
      // to work, but a term of spaces would search for spaces.
      const stamp = await namedItems();
      const blank = await asOwner((tx) => listItems(tx, tenantId, { search: "   " }));
      expect(
        blank.filter((i) => i.name.startsWith(stamp)).length,
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it("puts an archived item back, because retiring one is a judgement", async () => {
    // Archiving with no way back is a trap, and it was one for as long as
    // `archiveItem` had no caller: the item strands where only a query
    // parameter can see it. The round trip has to land on 'active'.
    const item = await newItem("Second thoughts");
    await asOwner((tx) => archiveItem(tx, ownerCtx(), item.id));
    expect((await asOwner((tx) => getItem(tx, tenantId, item.id)))?.status).toBe(
      "archived",
    );
    await asOwner((tx) => restoreItem(tx, ownerCtx(), item.id));
    expect((await asOwner((tx) => getItem(tx, tenantId, item.id)))?.status).toBe(
      "active",
    );
  });

  it("keeps restoring an item with the OWNER, like retiring one", async () => {
    const item = await newItem("Staff restore");
    await asOwner((tx) => archiveItem(tx, ownerCtx(), item.id));
    await expect(
      asOwner((tx) => restoreItem(tx, staffCtx(), item.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
    it("starts the delivery's batch with its date, in the one act", async () => {
      // A delivery IS a batch, and a dated one arrives dated — meat, medicine.
      const item = await newItem("Dated on arrival");
      const { lotId } = await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          newLotCode: "ARRIVED-DATED",
          newLotExpiresOn: "2026-10-01",
          quantity: 12,
          occurredOn: "2026-09-09",
        }),
      );
      const lots = await asOwner((tx) =>
        listLots(tx, tenantId, { itemId: item.id }),
      );
      expect(lots).toHaveLength(1);
      expect(lots[0].id).toBe(lotId);
      expect(lots[0].expiresOn).toBe("2026-10-01");
      expect(lots[0].openedOn).toBe("2026-09-09");
      expect(balanceOfLot(
        await asOwner((tx) => movementRowsForItem(tx, tenantId, item.id)),
        lotId!,
      )).toBe(12);
    });

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
          setTaxRule(tx, ownerCtx(), {
            itemKind: "feed",
            timingRule: "later_of_paid_and_consumed",
          }),
        ),
      ).rejects.toMatchObject({
        code: "TIMING_RULE_UNAVAILABLE",
        // And the sentence names what the reports DO apply, read from
        // IMPLEMENTED_TIMING_RULES rather than restated — see
        // tests/inventory-tax-rules.test.ts for why that matters.
        message: expect.stringContaining(
          'Today they apply "when it is used" and "when it is paid for".',
        ),
      });
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

    it("REFUSES A SUBSTITUTING RULE WITH NOWHERE TO PUT THE COST", async () => {
      /**
       * Found by driving: the rule saved happily with no account, and the
       * refusal arrived later on a REPORT — a long way from the decision that
       * caused it, and on a screen whose reader may not be whoever chose.
       *
       * The report still refuses too. That is not redundancy: an account can be
       * deactivated after a rule was recorded, so the late check is the only one
       * that can be sure. This one just means the common case fails where
       * somebody can fix it.
       */
      await expect(
        asOwner((tx) =>
          setTaxRule(tx, ownerCtx(), {
            itemKind: "feed",
            timingRule: "paid",
            expenseAccountId: null,
          }),
        ),
      ).rejects.toMatchObject({ code: "TAX_RULE_NEEDS_ACCOUNT" });
    });

    it("asks for no account under the rule that needs none", async () => {
      // `consumed` substitutes nothing, so demanding an account would make a
      // tenant answer a question their rule never asks.
      await expect(
        asOwner((tx) =>
          setTaxRule(tx, ownerCtx(), {
            itemKind: "feed",
            timingRule: "consumed",
            expenseAccountId: null,
          }),
        ),
      ).resolves.toMatchObject({ timingRule: "consumed" });
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

  /**
   * Correcting what a batch weighs — 2026-09-08. The person states the truth
   * and the op stores the difference, derived against what the ledger reads at
   * that moment.
   */
  describe("correcting what a batch weighs", () => {
    const receive = (
      itemId: string,
      lotId: string,
      quantity: number,
      weightLb: number | null,
    ) =>
      asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId,
          lotId,
          quantity,
          weightLb,
          occurredOn: "2026-09-08",
        }),
      );

    it("states the truth, stores the difference, and the fold reads through it", async () => {
      const item = await newItem("Ground beef (weights)", "pkg");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "BAXTER", source: "raised" }),
      );
      // The founder's two receipts, as they were typed: 1 lb in all, twice.
      await receive(item.id, lot.id, 1, 1);
      await receive(item.id, lot.id, 5, 1);
      const before = await asOwner((tx) => weightRatesForItems(tx, tenantId, [item.id]));
      expect(before.byLot.get(lot.id)).toBeCloseTo(2 / 6, 10);
      expect(before.byLotDetail.get(lot.id)).toEqual({ quantityWeighed: 6, recordedLb: 2 });

      const row = await asOwner((tx) =>
        adjustLotWeight(tx, ownerCtx(), {
          lotId: lot.id,
          basis: "each",
          weightLb: 1,
          reason: "mistyped",
          occurredOn: "2026-09-08",
        }),
      );
      expect(row.deltaLb).toBe(4);
      expect(row.recordedLb).toBe(2);
      expect(row.quantityWeighed).toBe(6);

      const after = await asOwner((tx) => weightRatesForItems(tx, tenantId, [item.id]));
      expect(after.byLot.get(lot.id)).toBe(1);
      // Unlike a cost correction, a weight correction DOES move the item
      // figure: pounds on hand is a shelf estimate nothing was stamped from.
      expect(after.byItem.get(item.id)).toBe(1);
      expect(after.byLotDetail.get(lot.id)).toEqual({ quantityWeighed: 6, recordedLb: 6 });

      const listed = await asOwner((tx) => weightAdjustmentsForLots(tx, tenantId, [lot.id]));
      expect(listed.map((c) => c.id)).toEqual([row.id]);
    });

    it("derives the delta against what the ledger reads NOW, earlier corrections included", async () => {
      const item = await newItem("Sausage (weights)", "pkg");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "SAUS", source: "raised" }),
      );
      await receive(item.id, lot.id, 4, 2);
      await asOwner((tx) =>
        adjustLotWeight(tx, ownerCtx(), {
          lotId: lot.id,
          basis: "total",
          weightLb: 4,
          reason: "reweighed",
          occurredOn: "2026-09-08",
        }),
      );
      // Reads 4 lb now. "1.5 lb each" is 6 lb: +2 on 4, not +4 on the receipt's 2.
      const second = await asOwner((tx) =>
        adjustLotWeight(tx, ownerCtx(), {
          lotId: lot.id,
          basis: "each",
          weightLb: 1.5,
          reason: "reweighed",
          occurredOn: "2026-09-08",
        }),
      );
      expect(second.recordedLb).toBe(4);
      expect(second.deltaLb).toBe(2);
    });

    it("REFUSES a batch nobody weighed, and a correction that changes nothing", async () => {
      const item = await newItem("Bacon (weights)", "pkg");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "BACON", source: "raised" }),
      );
      await receive(item.id, lot.id, 3, null);
      await expect(
        asOwner((tx) =>
          adjustLotWeight(tx, ownerCtx(), {
            lotId: lot.id,
            basis: "each",
            weightLb: 1,
            reason: "mistyped",
            occurredOn: "2026-09-08",
          }),
        ),
      ).rejects.toMatchObject({ code: "LOT_UNWEIGHED" });

      await receive(item.id, lot.id, 2, 3);
      await expect(
        asOwner((tx) =>
          adjustLotWeight(tx, ownerCtx(), {
            lotId: lot.id,
            basis: "total",
            weightLb: 3,
            reason: "mistyped",
            occurredOn: "2026-09-08",
          }),
        ),
      ).rejects.toMatchObject({ code: "WEIGHT_UNCHANGED" });
      // Only the two weighed packages count: 3 lb over 2, not over 5.
      const rates = await asOwner((tx) => weightRatesForItems(tx, tenantId, [item.id]));
      expect(rates.byLotDetail.get(lot.id)).toEqual({ quantityWeighed: 2, recordedLb: 3 });
    });

    it("is the owner's to do", async () => {
      const item = await newItem("Chops (weights)", "pkg");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), { itemId: item.id, code: "CHOPS", source: "raised" }),
      );
      await receive(item.id, lot.id, 2, 2);
      await expect(
        asOwner((tx) =>
          adjustLotWeight(tx, staffCtx(), {
            lotId: lot.id,
            basis: "each",
            weightLb: 1.5,
            reason: "mistyped",
            occurredOn: "2026-09-08",
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
