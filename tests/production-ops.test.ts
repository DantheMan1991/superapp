import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  ProductionError,
  addRunCarcass,
  addRunInput,
  addRunOutput,
  completeRun,
  inputBlocks,
  listRunCarcasses,
  listRunOutputs,
  removeRunCarcass,
  runDetail,
  startRun,
  updateRunCarcass,
  type ProductionCtx,
} from "../src/packs/production/ops";
import {
  clearPriceItems,
  createProcessor,
  getProcessor,
  removePriceItem,
  removePriceItems,
  setPriceItem,
  setPriceItemKind,
} from "../src/packs/production/processor-ops";
import {
  addOrderLine,
  createOrder,
  getOrder,
  listOrders,
  markOrderPrinted,
  updateOrderLine,
} from "../src/packs/production/order-ops";
import { resolveBands } from "../src/packs/production/core/band";
import {
  correctRunCost,
  unmatchBillLineFromRuns,
} from "../src/packs/production/billing-ops";
import {
  createBooking,
  startRunFromBooking,
} from "../src/packs/production/booking-ops";
import {
  adjustLotCost,
  carriedCostByLot,
  createItem,
  issueStock,
  movementKindsForLots,
  receiveStock,
  type InventoryCtx,
} from "../src/packs/inventory/ops";
import { carriedValue } from "../src/packs/inventory/core/valuation";
import {
  LEDGER_EPOCH,
  createLivestockLot,
  feedReport,
  placeHead,
  recordTreatment,
  type LivestockCtx,
} from "../src/packs/livestock/ops";
import { summariseHead } from "../src/packs/livestock/core/herd";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * The ops behind `production` slice 0 — and the four claims the slice is made
 * of, each of which is invisible to a pure test:
 *
 *   1. Outputs land in `inventory` through `receiveStock`, as made-here batches.
 *   2. The input lot's ACCUMULATED cost crosses over onto them.
 *   3. Head leaves through `livestock.removeHead` and the count still
 *      reconciles.
 *   4. A run against a lot under a withdrawal is REFUSED, with the reason and
 *      the clearing date in the message.
 *
 * The isolation suite builds its fixtures under `withSystem` on purpose, so a
 * bug in these ops cannot make it agree with them. Everything above is covered
 * by nothing except this file.
 */
d("production ops", () => {
  const STAMP = `prodops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;
  const TODAY = "2026-08-20";

  let tenantId: string;
  let freezerId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const ownerCtx = (): ProductionCtx => ({
    tenantId,
    userId: OWNER,
    role: "owner",
  });
  const staffCtx = (): ProductionCtx => ({
    tenantId,
    userId: STAFF,
    role: "staff",
  });
  const inv = (): InventoryCtx => ownerCtx();
  const ls = (): LivestockCtx => ownerCtx();

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Production Ops",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
      const asset = await tx
        .insert(schema.assets)
        .values({
          tenantId,
          kind: "equipment",
          name: "Chest freezer",
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

  /** A pen of broilers with chicks bought and feed eaten. The pilot's shape. */
  async function penWithCost(code: string, head: number) {
    return asOwner(async (tx) => {
      const { lot, inventoryLotId } = await createLivestockLot(tx, ls(), {
        newItemName: `Broilers ${code}`,
        code,
        species: "poultry",
        sex: "mixed",
      });
      const birds = await tx.query.inventoryLots.findFirst({
        where: and(
          eq(schema.inventoryLots.tenantId, tenantId),
          eq(schema.inventoryLots.id, inventoryLotId),
        ),
      });
      await placeHead(tx, ls(), {
        itemId: birds!.itemId,
        inventoryLotId,
        head,
        occurredOn: "2026-06-01",
      });

      // Feed bought, and fed to this pen. `issueStock` stamps the cost at the
      // average as it stands — the loop `inventory` slice 1 closed.
      const feed = await createItem(tx, inv(), {
        name: `Grower ${code}`,
        stockingUnit: "lb",
        itemKind: "feed",
      });
      await receiveStock(tx, inv(), {
        itemId: feed.id,
        newLotCode: `FEED-${code}`,
        quantity: 1000,
        costCents: 50_000,
        occurredOn: "2026-06-01",
      });
      await issueStock(tx, inv(), {
        itemId: feed.id,
        quantity: 800,
        issuedToLotId: inventoryLotId,
        occurredOn: "2026-07-01",
      });

      return { livestockLotId: lot.id, inventoryLotId, itemId: birds!.itemId };
    });
  }

  async function meatItem(name: string, unit = "lb") {
    return asOwner((tx) =>
      createItem(tx, inv(), { name, stockingUnit: unit, itemKind: "meat" }),
    );
  }

  it("lands outputs in inventory carrying the pen's accumulated cost", async () => {
    /**
     * **THE SLICE, END TO END.** 200 birds with $400 of feed on them go into a
     * run; 300 lb of whole birds and 40 lb of offal come out; and the $400
     * arrives on the two receipts split by weight.
     *
     * The pen's cost is NOT the item average — that would price a bird at what
     * the chick cost and throw away eight weeks of feed, which is the one number
     * the enterprise is judged on.
     */
    const pen = await penWithCost("PEN-COST", 200);
    const birds = await meatItem("Whole birds");
    const offal = await meatItem("Offal");

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), {
        code: "KILL-1",
        runKind: "butchering",
        startedOn: TODAY,
      }),
    );

    await asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: pen.itemId,
          lotId: pen.inventoryLotId,
          quantity: 200,
          weightLb: 1200,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );

    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: birds.id,
        quantity: 300,
        locationAssetId: freezerId,
      }),
    );
    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: offal.id,
        quantity: 40,
      }),
    );

    const result = await asOwner((tx) =>
      completeRun(tx, ownerCtx(), run.id, TODAY),
    );
    // 800 lb of a 1000 lb delivery at 50 cents = $400, and it all came across.
    expect(result.potCents).toBe(40_000);
    expect(result.basis).toBe("weight");
    expect(result.landed).toBe(2);
    expect(result.unpricedInputs).toBe(0);

    const outputs = await asOwner((tx) => listRunOutputs(tx, tenantId, run.id));
    for (const output of outputs) {
      expect(output.lotId).not.toBeNull();
      expect(output.inventoryMovementId).not.toBeNull();
    }

    const detail = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    // The pieces sum to the pot EXACTLY. Anything else means the freezer holds
    // a different amount of money than the run took off the shelf.
    expect(detail!.landedCents).toBe(40_000);
    const byItem = new Map(
      detail!.outputs.map((o) => [o.itemName, o.costCents]),
    );
    // 300 lb and 40 lb — 300/340 and 40/340 of $400.
    expect(byItem.get("Whole birds")).toBe(35_294);
    expect(byItem.get("Offal")).toBe(4706);

    // And it landed as a MADE-HERE batch, which slice 3 cannot infer later.
    const lots = await asOwner((tx) =>
      tx.query.inventoryLots.findMany({
        where: and(
          eq(schema.inventoryLots.tenantId, tenantId),
          eq(schema.inventoryLots.itemId, birds.id),
        ),
      }),
    );
    expect(lots).toHaveLength(1);
    expect(lots[0].source).toBe("produced");
    expect(lots[0].code).toBe("KILL-1");
  });

  it("takes head out through livestock's own ledger, and the count reconciles", async () => {
    const pen = await penWithCost("PEN-HEAD", 210);
    const birds = await meatItem("Birds head");

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "KILL-HEAD", startedOn: TODAY }),
    );
    await asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: pen.itemId,
          lotId: pen.inventoryLotId,
          quantity: 150,
          weightLb: 900,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );

    const movements = await asOwner((tx) =>
      movementKindsForLots(tx, tenantId, [pen.inventoryLotId]),
    );
    const rows = movements.get(pen.inventoryLotId) ?? [];
    // ONE ledger, and the kind is livestock's own.
    expect(rows.filter((r) => r.movementKind === "processed")).toHaveLength(1);

    const summary = summariseHead(rows);
    expect(summary.intake).toBe(210);
    expect(summary.removed).toBe(150);
    // Processing is not mortality. 60 birds still standing.
    expect(summary.died).toBe(0);
    expect(summary.balance).toBe(60);

    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: birds.id,
        quantity: 600,
      }),
    );
    await asOwner((tx) => completeRun(tx, ownerCtx(), run.id, TODAY));
  });

  it("does not charge one and a half pens across two kill days", async () => {
    /**
     * The partial-processing bug, proved on the real ledger rather than in the
     * fold. Half a pen on Saturday, the rest a fortnight later: the pen's
     * accumulated cost never goes down, so the second run must pro-rate what is
     * LEFT rather than what was spent.
     */
    const pen = await penWithCost("PEN-HALF", 200);
    const birds = await meatItem("Birds half");

    async function halfRun(code: string, head: number, out: number) {
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), { code, startedOn: TODAY }),
      );
      await asOwner((tx) =>
        addRunInput(
          tx,
          ownerCtx(),
          {
            runId: run.id,
            itemId: pen.itemId,
            lotId: pen.inventoryLotId,
            quantity: head,
            weightLb: head * 6,
            occurredOn: TODAY,
          },
          TODAY,
        ),
      );
      await asOwner((tx) =>
        addRunOutput(tx, ownerCtx(), {
          runId: run.id,
          itemId: birds.id,
          quantity: out,
        }),
      );
      return asOwner((tx) => completeRun(tx, ownerCtx(), run.id, TODAY));
    }

    const first = await halfRun("KILL-A", 100, 300);
    const second = await halfRun("KILL-B", 100, 300);
    expect(first.potCents).toBe(20_000);
    expect(second.potCents).toBe(20_000);
    expect(first.potCents + second.potCents).toBe(40_000);

    const carried = await asOwner((tx) =>
      carriedCostByLot(tx, tenantId, [pen.inventoryLotId]),
    );
    // Everything spent on the pen has now left it.
    expect(carried.get(pen.inventoryLotId)!.remainingCents).toBe(0);
  });

  it("REFUSES a run against a lot under a withdrawal, with the date in the message", async () => {
    /**
     * **THE ENFORCEMENT POINT `livestock` SLICE 3 WAS BUILT A SLICE EARLY FOR.**
     * Until this existed the clock was loud on four screens and refused nothing.
     */
    const pen = await penWithCost("PEN-DRUG", 40);
    await asOwner((tx) =>
      recordTreatment(tx, ls(), {
        livestockLotId: pen.livestockLotId,
        treatedOn: "2026-08-15",
        product: "Penicillin G",
        route: "injection",
        meatWithdrawalDays: 21,
        withdrawalSource: "label",
      }),
    );

    const blocks = await asOwner((tx) =>
      inputBlocks(tx, tenantId, [pen.inventoryLotId], TODAY),
    );
    const block = blocks.get(pen.inventoryLotId);
    expect(block?.slug).toBe("livestock");
    expect(block?.clearsOn).toBe("2026-09-05");

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "KILL-BLOCKED", startedOn: TODAY }),
    );
    const attempt = asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: pen.itemId,
          lotId: pen.inventoryLotId,
          quantity: 40,
          weightLb: 240,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );
    await expect(attempt).rejects.toThrow(/2026-09-05/);
    await expect(attempt).rejects.toThrow(/Penicillin G/);

    // And nothing left the pen.
    const movements = await asOwner((tx) =>
      movementKindsForLots(tx, tenantId, [pen.inventoryLotId]),
    );
    expect(
      (movements.get(pen.inventoryLotId) ?? []).filter(
        (m) => m.movementKind === "processed",
      ),
    ).toHaveLength(0);
  });

  it("REFUSES a lot whose withdrawal period nobody looked up", async () => {
    // An unknown is not a zero. `blocksProcessing` is true for both, and the
    // whole point of the guard is that it does not relax into "probably fine".
    const pen = await penWithCost("PEN-UNKNOWN", 20);
    await asOwner((tx) =>
      recordTreatment(tx, ls(), {
        livestockLotId: pen.livestockLotId,
        treatedOn: "2026-08-18",
        product: "Something from the shelf",
        route: "water",
        withdrawalSource: "none_stated",
      }),
    );

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "KILL-UNKNOWN", startedOn: TODAY }),
    );
    await expect(
      asOwner((tx) =>
        addRunInput(
          tx,
          ownerCtx(),
          {
            runId: run.id,
            itemId: pen.itemId,
            lotId: pen.inventoryLotId,
            quantity: 20,
            weightLb: 120,
            occurredOn: TODAY,
          },
          TODAY,
        ),
      ),
    ).rejects.toThrow(/never looked up/);
  });

  it("lets an ordinary stock lot straight through — no handler claims it", async () => {
    // A bakery running a run over purchased flour meets no guard at all, which
    // is why `production` does not require `livestock`.
    const flour = await meatItem("Flour", "lb");
    const loaves = await meatItem("Sourdough", "each");
    await asOwner((tx) =>
      receiveStock(tx, inv(), {
        itemId: flour.id,
        newLotCode: "FLOUR-1",
        quantity: 100,
        costCents: 6000,
        occurredOn: "2026-08-01",
      }),
    );
    const flourLot = await asOwner((tx) =>
      tx.query.inventoryLots.findFirst({
        where: and(
          eq(schema.inventoryLots.tenantId, tenantId),
          eq(schema.inventoryLots.code, "FLOUR-1"),
        ),
      }),
    );

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "BAKE-1", runKind: "baking", startedOn: TODAY }),
    );
    await asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: flour.id,
          lotId: flourLot!.id,
          quantity: 50,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );
    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: loaves.id,
        quantity: 60,
      }),
    );

    const result = await asOwner((tx) =>
      completeRun(tx, ownerCtx(), run.id, TODAY),
    );
    // 50 lb of a 100 lb delivery at 60 cents = $30, issued at the item average.
    expect(result.potCents).toBe(3000);
    // Nobody weighed a loaf, but sixty loaves are counted the same way, so the
    // split is by count. A bakery has always costed like this.
    expect(result.basis).toBe("quantity");

    const detail = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    expect(detail!.landedCents).toBe(3000);
    // 50 lb in and 60 loaves out. Nobody weighed a loaf, so there is no ratio
    // to state — a pound and a loaf have none between them — and the screen
    // says so rather than inventing one. The cost still split by count, which
    // is the point: the roll and the yield have different requirements.
    expect(detail!.yieldResult.refusedBecause).toBe("NO_OUTPUT_WEIGHTS");
  });

  it("folds the yield from the weights and refuses when one is missing", async () => {
    const pen = await penWithCost("PEN-YIELD", 1);
    const hanging = await meatItem("Hanging beef");
    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "KILL-YIELD", startedOn: TODAY }),
    );
    await asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: pen.itemId,
          lotId: pen.inventoryLotId,
          quantity: 1,
          weightLb: 1150,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );
    // Nothing out yet.
    let detail = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    expect(detail!.yieldResult.refusedBecause).toBe("NO_OUTPUTS");

    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: hanging.id,
        quantity: 690,
      }),
    );
    detail = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    // The design's own steer: 690 of 1,150.
    expect(detail!.yieldResult.yield?.inLb).toBe(1150);
    expect(detail!.yieldResult.yield?.outLb).toBe(690);
    expect(detail!.yieldResult.yield?.ratio).toBeCloseTo(0.6, 4);
  });

  it("stamps NOTHING RECORDED rather than a confident zero", async () => {
    /**
     * **FOUND BY DRIVING, and there was a passing test over the wrong
     * behaviour**: every other case here uses a pen with feed on it, so a pen
     * with no priced chicks and no feed issued was never exercised. Its
     * accumulated cost is 0, and stamping that says the birds were free. They
     * were not — nobody has said what they cost, which is the unpriced case this
     * pack already reports honestly.
     */
    const item = await meatItem("Bare birds", "head");
    const bareLot = await asOwner(async (tx) => {
      const { inventoryLotId } = await createLivestockLot(tx, ls(), {
        itemId: item.id,
        code: "PEN-BARE",
        species: "poultry",
      });
      await placeHead(tx, ls(), {
        itemId: item.id,
        inventoryLotId,
        head: 30,
        occurredOn: "2026-06-01",
      });
      return inventoryLotId;
    });

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "KILL-BARE", startedOn: TODAY }),
    );
    await asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: item.id,
          lotId: bareLot,
          quantity: 30,
          weightLb: 180,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );

    const detail = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    expect(detail!.inputs[0].costCents).toBeNull();
    expect(detail!.unpricedInputs).toBe(1);
    expect(detail!.potCents).toBe(0);
  });

  it("STAMPS A PEN COSTED ONLY BY A CORRECTION", async () => {
    /**
     * **THE TWIN OF THE TEST ABOVE, and the reason ADR 0012 §A.4 had to touch
     * this file at all.** A cost correction is not a movement, so a batch whose
     * only money is an appended correction has purchased, consumed and released
     * all at zero — indistinguishable, to the test above, from a pen nobody has
     * costed. It would have stamped NULL on meat carrying real money, while the
     * valuation screen called the same batch "No cost recorded": the eggs-at-
     * $0.00 bug arriving through a new door, in two files at once.
     *
     * The predicate is `inventory`'s `hasRecordedCost` now, shared rather than
     * restated here, so the two cannot answer differently again.
     */
    const item = await meatItem("Corrected birds", "head");
    const lotId = await asOwner(async (tx) => {
      const { inventoryLotId } = await createLivestockLot(tx, ls(), {
        itemId: item.id,
        code: "PEN-CORRECTED",
        species: "poultry",
      });
      await placeHead(tx, ls(), {
        itemId: item.id,
        inventoryLotId,
        head: 40,
        occurredOn: "2026-06-01",
      });
      return inventoryLotId;
    });
    // Nothing priced anywhere: the chicks arrived with no invoice.
    expect(
      carriedValue(
        (await asOwner((tx) => carriedCostByLot(tx, tenantId, [lotId]))).get(
          lotId,
        )!,
      ),
    ).toBeNull();

    await asOwner((tx) =>
      adjustLotCost(tx, inv(), {
        lotId,
        amountCents: 20_000,
        reason: "no_price_on_ticket",
        occurredOn: "2026-06-02",
      }),
    );

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "KILL-CORRECTED", startedOn: TODAY }),
    );
    await asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: item.id,
          lotId,
          quantity: 20,
          weightLb: 120,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );

    const detail = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    // Half the pen, so half of the $200 the correction supplied.
    expect(detail!.inputs[0].costCents).toBe(10_000);
    expect(detail!.unpricedInputs).toBe(0);
  });

  it("STOPS THE PEN CLAIMING COST THAT LEFT WITH THE MEAT", async () => {
    /**
     * **THE DEFECT FOUND BY DRIVING SLICE 0 ON THE LIVE APP, 2026-08-20.**
     *
     * BATCH-2 carried $141.67 of feed across 197 birds — 72 cents a head. A run
     * took 100 of them, and $43.15, into the freezer. The lot page went on
     * showing the whole $141.67 against the 97 birds left: **$1.46 a head**,
     * twice as expensive, because the numerator sat still while the denominator
     * halved. Read literally, the farm had paid for that feed twice.
     *
     * This is the cross-pack half of the fix, and it needs the real ledger: the
     * pure test in `livestock-feed.test.ts` proves the fold, and only this
     * proves that `production` stamping a cost on the way out is what
     * `feedReport` reads back as released.
     */
    const pen = await penWithCost("PEN-RELEASE", 200);
    const birds = await meatItem("Released birds");

    const before = await asOwner((tx) =>
      feedReport(tx, tenantId, { from: LEDGER_EPOCH, to: TODAY }),
    );
    const rowBefore = before.lots.find((l) => l.lotId === pen.livestockLotId)!;
    expect(rowBefore.totalCents).toBe(40_000);
    expect(rowBefore.releasedCents).toBe(0);
    expect(rowBefore.remainingCents).toBe(40_000);
    // $400 over 200 birds standing.
    expect(rowBefore.centsPerHead).toBe(200);

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "KILL-RELEASE", startedOn: TODAY }),
    );
    await asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: pen.itemId,
          lotId: pen.inventoryLotId,
          quantity: 100,
          weightLb: 600,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );
    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: birds.id,
        quantity: 360,
      }),
    );
    await asOwner((tx) => completeRun(tx, ownerCtx(), run.id, TODAY));

    const after = await asOwner((tx) =>
      feedReport(tx, tenantId, { from: LEDGER_EPOCH, to: TODAY }),
    );
    const rowAfter = after.lots.find((l) => l.lotId === pen.livestockLotId)!;

    // The feed was still fed, so the bill is unchanged...
    expect(rowAfter.totalCents).toBe(40_000);
    // ...but half of it is in the freezer now.
    expect(rowAfter.releasedCents).toBe(20_000);
    expect(rowAfter.remainingCents).toBe(20_000);
    expect(rowAfter.head).toBe(100);
    // **THE NUMBER THAT WAS WRONG.** $200 over the 100 standing, not $400.
    expect(rowAfter.centsPerHead).toBe(200);
    // And the comparison figure does not budge: what this batch cost to raise
    // is not changed by some of it being processed and sold on.
    expect(rowAfter.centsPerHeadPlaced).toBe(rowBefore.centsPerHeadPlaced);
  });

  it("refuses to finish a run with nothing to land", async () => {
    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "KILL-EMPTY", startedOn: TODAY }),
    );
    await expect(
      asOwner((tx) => completeRun(tx, ownerCtx(), run.id, TODAY)),
    ).rejects.toThrow(ProductionError);
  });

  it("refuses to add to a run that has already landed", async () => {
    const flour = await meatItem("Flour closed", "lb");
    const loaves = await meatItem("Loaves closed", "each");
    await asOwner((tx) =>
      receiveStock(tx, inv(), {
        itemId: flour.id,
        newLotCode: "FLOUR-CLOSED",
        quantity: 10,
        costCents: 1000,
        occurredOn: "2026-08-01",
      }),
    );
    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "BAKE-CLOSED", startedOn: TODAY }),
    );
    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: loaves.id,
        quantity: 10,
      }),
    );
    await asOwner((tx) => completeRun(tx, ownerCtx(), run.id, TODAY));

    await expect(
      asOwner((tx) =>
        addRunOutput(tx, ownerCtx(), {
          runId: run.id,
          itemId: loaves.id,
          quantity: 1,
        }),
      ),
    ).rejects.toThrow(/already in stock/);
  });

  it("keeps the decision/chore line: staff record, owners start and finish", async () => {
    // `completeRun` creates a lot per output and `upsertDimensionMember`
    // requires the owner, so a staff completion would land stock whose cost
    // object did not exist and which no report could group by.
    await expect(
      withTenant(
        tenantId,
        (tx) => startRun(tx, staffCtx(), { code: "NOPE", startedOn: TODAY }),
        { role: "staff", userId: STAFF },
      ),
    ).rejects.toThrow(ProductionError);

    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), { code: "CREW-DAY", startedOn: TODAY }),
    );
    const loaves = await meatItem("Crew loaves", "each");
    // A chore, and the person holding the box is not the owner.
    const output = await withTenant(
      tenantId,
      (tx) =>
        addRunOutput(tx, staffCtx(), {
          runId: run.id,
          itemId: loaves.id,
          quantity: 4,
        }),
      { role: "staff", userId: STAFF },
    );
    expect(output.lotCode).toBe("CREW-DAY");

    await expect(
      withTenant(tenantId, (tx) => completeRun(tx, staffCtx(), run.id, TODAY), {
        role: "staff",
        userId: STAFF,
      }),
    ).rejects.toThrow(ProductionError);
  });

  /**
   * ── THE KILL SHEET (slice 1a) ────────────────────────────────────────────
   *
   * Three things here cannot be seen by a pure test and are the reason this
   * block exists:
   *
   *   1. **`head_in` is read off the INPUT's ledger row**, so the sheet is
   *      reconciled against what actually left the pen rather than against a
   *      number somebody retyped.
   *   2. **A finished run still accepts a sheet.** Everything else on this pack
   *      refuses once the cost has landed; the sheet arrives days later and
   *      posts nothing, so it must not.
   *   3. **The merged row is what gets validated**, not the patch — the trap
   *      `livestock` hit on treatments, reachable here one field at a time.
   */
  async function penForSheet(
    code: string,
    head: number,
    liveLb: number,
    /** Who did it. Absent is on-farm, which is what most of these tests want. */
    processorId?: string,
  ) {
    const pen = await penWithCost(code, head);
    const run = await asOwner((tx) =>
      startRun(tx, ownerCtx(), {
        code: `SHEET-${code}`,
        runKind: "butchering",
        startedOn: TODAY,
        processorId: processorId ?? null,
      }),
    );
    const input = await asOwner((tx) =>
      addRunInput(
        tx,
        ownerCtx(),
        {
          runId: run.id,
          itemId: pen.itemId,
          lotId: pen.inventoryLotId,
          quantity: head,
          weightLb: liveLb,
          occurredOn: TODAY,
        },
        TODAY,
      ),
    );
    return { pen, run, input };
  }

  it("folds both stage ratios off the sheet, with the condemned out of each", async () => {
    /**
     * **THE SLICE, END TO END.** 100 birds go in at 600 lb on the farm's own
     * scale. The plant weighs them: 97 pass at 582 lb live and hang at 407.4 lb,
     * three are condemned for airsacculitis.
     *
     * Dressing is 407.4 / 582 — the condemned birds in NEITHER number, which is
     * the only honest way to leave them out. Cutting is the boxes over the same
     * 407.4. And the OVERALL yield's denominator is untouched at 600, because
     * slice 0 chose to state it plainly and a run that lost one to condemnation
     * should read low visibly rather than be quietly corrected.
     */
    const { run, input } = await penForSheet("SHEET-A", 100, 600);
    const birds = await meatItem("Sheet broilers");

    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: birds.id,
        quantity: 300,
      }),
    );
    await asOwner((tx) =>
      addRunCarcass(tx, ownerCtx(), {
        runId: run.id,
        runInputId: input.id,
        headCount: 97,
        liveLb: 582,
        hangingLb: 407.4,
      }),
    );
    await asOwner((tx) =>
      addRunCarcass(tx, ownerCtx(), {
        runId: run.id,
        runInputId: input.id,
        headCount: 3,
        liveLb: 18,
        condemned: true,
        condemnReason: "airsacculitis",
      }),
    );

    const detail = await asOwner((tx) =>
      runDetail(tx, tenantId, run.id, TODAY),
    );

    expect(detail!.tally.headIn).toBe(100);
    expect(detail!.tally.headOnSheet).toBe(100);
    expect(detail!.tally.headUnaccounted).toBe(0);
    expect(detail!.tally.headCondemned).toBe(3);
    expect(detail!.tally.byReason).toEqual([
      { reason: "airsacculitis", head: 3 },
    ]);

    expect(detail!.dressing.dressing?.liveSource).toBe("plant");
    expect(detail!.dressing.dressing?.includesCondemned).toBe(false);
    expect(detail!.dressing.dressing?.fromLb).toBe(582);
    expect(detail!.dressing.dressing?.toLb).toBe(407.4);

    expect(detail!.cutting.cutting?.fromLb).toBe(407.4);
    expect(detail!.cutting.cutting?.toLb).toBe(300);

    // Untouched by the sheet, and deliberately so.
    expect(detail!.yieldResult.yield?.inLb).toBe(600);
    expect(detail!.yieldResult.yield?.outLb).toBe(300);
  });

  it("reconciles the sheet against the head that actually left the pen", async () => {
    // `head_in` comes from the input's own ledger row. Sixty carcasses under a
    // hundred birds' boxes is the case that reads OVER 100% if nothing refuses.
    const { run, input } = await penForSheet("SHEET-B", 100, 600);
    const birds = await meatItem("Short sheet broilers");

    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: birds.id,
        quantity: 300,
      }),
    );
    await asOwner((tx) =>
      addRunCarcass(tx, ownerCtx(), {
        runId: run.id,
        runInputId: input.id,
        headCount: 60,
        hangingLb: 252,
      }),
    );

    const detail = await asOwner((tx) =>
      runDetail(tx, tenantId, run.id, TODAY),
    );
    expect(detail!.tally.headUnaccounted).toBe(40);
    expect(detail!.dressing.refusedBecause).toBe("SHEET_INCOMPLETE");
    expect(detail!.cutting.refusedBecause).toBe("SHEET_INCOMPLETE");

    // Finish the sheet and both answers arrive, with nothing else changed.
    await asOwner((tx) =>
      addRunCarcass(tx, ownerCtx(), {
        runId: run.id,
        runInputId: input.id,
        headCount: 40,
        hangingLb: 168,
      }),
    );
    const after = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    expect(after!.tally.headUnaccounted).toBe(0);
    expect(after!.dressing.dressing?.toLb).toBe(420);
    expect(after!.dressing.dressing?.liveSource).toBe("farm");
    expect(after!.cutting.cutting?.fromLb).toBe(420);
  });

  it("ACCEPTS A SHEET ON A FINISHED RUN, and moves no money doing it", async () => {
    /**
     * **THE ONE THING ON THIS PACK A COMPLETE RUN STILL TAKES.** The design says
     * the sheet arrives days after the run, from a party who is not this farm —
     * so a sheet that could only be entered before the boxes landed would be a
     * sheet that was never entered. It posts nothing, which is what makes that
     * safe: the landed cost is identical before and after.
     */
    const { run, input } = await penForSheet("SHEET-C", 50, 300);
    const birds = await meatItem("Late sheet broilers");

    await asOwner((tx) =>
      addRunOutput(tx, ownerCtx(), {
        runId: run.id,
        itemId: birds.id,
        quantity: 210,
      }),
    );
    await asOwner((tx) => completeRun(tx, ownerCtx(), run.id, TODAY));

    const before = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    expect(before!.run.status).toBe("complete");
    expect(before!.dressing.refusedBecause).toBe("NO_SHEET");

    await asOwner((tx) =>
      addRunCarcass(tx, ownerCtx(), {
        runId: run.id,
        runInputId: input.id,
        headCount: 50,
        liveLb: 295,
        hangingLb: 210,
      }),
    );

    const after = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
    expect(after!.dressing.dressing?.fromLb).toBe(295);
    expect(after!.dressing.dressing?.toLb).toBe(210);
    // Nothing about the money moved. The sheet explains the run; it does not
    // restate it.
    expect(after!.landedCents).toBe(before!.landedCents);
    expect(after!.potCents).toBe(before!.potCents);
  });

  it("refuses an input belonging to a different run", async () => {
    // The FK only says the input exists. Attributing this farm's carcasses to
    // the wrong pen is the one claim the traceability chain exists to prevent.
    const first = await penForSheet("SHEET-D", 10, 60);
    const second = await penForSheet("SHEET-E", 10, 60);

    await expect(
      asOwner((tx) =>
        addRunCarcass(tx, ownerCtx(), {
          runId: first.run.id,
          runInputId: second.input.id,
          headCount: 1,
        }),
      ),
    ).rejects.toThrow(/which of this run's inputs/);
  });

  it("refuses a hanging weight on a condemned carcass, and on the way in", async () => {
    const { run, input } = await penForSheet("SHEET-F", 10, 60);
    await expect(
      asOwner((tx) =>
        addRunCarcass(tx, ownerCtx(), {
          runId: run.id,
          runInputId: input.id,
          headCount: 1,
          condemned: true,
          hangingLb: 4,
        }),
      ),
    ).rejects.toThrow(/nothing off it can be sold/);
  });

  it("validates the MERGED row on a correction, not the patch", async () => {
    /**
     * The trap `livestock` hit on treatments, and it is reachable here one field
     * at a time: condemning a line that already carries a hanging weight, or
     * adding a weight to a line that is still condemned. Validating the patch
     * alone would let either through and leave a condemned carcass with pounds
     * on it — which is exactly the row the CHECK exists to forbid.
     */
    const { run, input } = await penForSheet("SHEET-G", 10, 60);
    const carcass = await asOwner((tx) =>
      addRunCarcass(tx, ownerCtx(), {
        runId: run.id,
        runInputId: input.id,
        headCount: 1,
        hangingLb: 40,
      }),
    );

    await expect(
      asOwner((tx) =>
        updateRunCarcass(tx, ownerCtx(), carcass.id, { condemned: true }),
      ),
    ).rejects.toThrow(/nothing off it can be sold/);

    // Clearing the weight in the same act is what a condemnation actually is.
    const condemned = await asOwner((tx) =>
      updateRunCarcass(tx, ownerCtx(), carcass.id, {
        condemned: true,
        hangingLb: null,
        condemnReason: "bruising",
      }),
    );
    expect(condemned.disposition).toBe("condemned");
    expect(condemned.hangingLb).toBeNull();
    expect(condemned.condemnReason).toBe("bruising");

    // And passing it again drops the cause, because a reason on a passed line
    // is a sentence about something that did not happen.
    const passed = await asOwner((tx) =>
      updateRunCarcass(tx, ownerCtx(), carcass.id, { condemned: false }),
    );
    expect(passed.disposition).toBe("passed");
    expect(passed.condemnReason).toBe("");
  });

  it("lets a member transcribe, correct and remove a line", async () => {
    // Copying somebody else's piece of paper into a form decides nothing and
    // creates no cost object, so it is a chore rather than an owner's job.
    const { run, input } = await penForSheet("SHEET-H", 10, 60);
    const asStaff = <T,>(fn: (tx: Tx) => Promise<T>) =>
      withTenant(tenantId, fn, { role: "staff", userId: STAFF });

    const carcass = await asStaff((tx) =>
      addRunCarcass(tx, staffCtx(), {
        runId: run.id,
        runInputId: input.id,
        tag: "A-114",
        headCount: 1,
        hangingLb: 40,
      }),
    );
    expect(carcass.tag).toBe("A-114");

    const corrected = await asStaff((tx) =>
      updateRunCarcass(tx, staffCtx(), carcass.id, { hangingLb: 42 }),
    );
    expect(corrected.hangingLb).toBe(42);
    // A correction is in place — there is no second row, because a weight typed
    // wrong never happened.
    expect(await asStaff((tx) => listRunCarcasses(tx, tenantId, run.id))).toHaveLength(
      1,
    );

    await asStaff((tx) => removeRunCarcass(tx, staffCtx(), carcass.id));
    expect(await asStaff((tx) => listRunCarcasses(tx, tenantId, run.id))).toHaveLength(
      0,
    );
  });

  it("refuses a line covering no head at all", async () => {
    const { run, input } = await penForSheet("SHEET-I", 10, 60);
    await expect(
      asOwner((tx) =>
        addRunCarcass(tx, ownerCtx(), {
          runId: run.id,
          runInputId: input.id,
          headCount: 0,
        }),
      ),
    ).rejects.toThrow(/at least one head/);
  });

  /**
   * ── THE ITEMISED PRICE LIST ────────────────────────────────────────────────
   *
   * The claims here are all about a table that did not exist until a rate sheet
   * proved that three fee columns could not hold one. None of them is visible
   * to a pure test: the upsert, the refusals and the sheet order are all
   * database behaviour.
   */
  describe("what a processor charges, line by line", () => {
    const makeProcessor = async (name: string) =>
      asOwner((tx) => createProcessor(tx, ownerCtx(), { name }));

    it("records a menu as a menu — several prices for one animal", async () => {
      // **THE WHOLE POINT.** Quartered $1.05 and eight-piece $1.25 are two
      // rows. Under the old shape there was one cutting column per animal, so
      // the honest answer was to record neither and leave both as prose.
      const processor = await makeProcessor("Menu Poultry");
      for (const [label, price] of [
        ["Quartered", 105],
        ["8 Pcs Cut", 125],
        ["Deboning Thighs", 65],
      ] as const) {
        await asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            kind: "poultry",
            category: "cutting",
            label,
            priceCents: price,
            unit: "head",
          }),
        );
      }
      const detail = await asOwner((tx) =>
        getProcessor(tx, tenantId, processor.id),
      );
      expect(detail?.priceItems.map((i) => i.priceCents)).toEqual([
        125, 65, 105,
      ]);
      expect(detail?.priceItems.every((i) => i.unit === "head")).toBe(true);
    });

    it("corrects a price rather than adding a second one for the same thing", async () => {
      // An upsert on (processor, kind, label), which is what makes next year's
      // rate sheet re-readable over this year's: the same labels come back with
      // new figures and correct what is on file rather than doubling it.
      const processor = await makeProcessor("Upsert Meats");
      const first = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          kind: "cattle",
          category: "cutting",
          label: "Cut and wrap",
          priceCents: 85,
          unit: "hanging_lb",
        }),
      );
      const second = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          kind: "cattle",
          category: "cutting",
          label: "Cut and wrap",
          priceCents: 90,
          unit: "hanging_lb",
        }),
      );
      expect(second.id).toBe(first.id);
      expect(second.priceCents).toBe(90);
      const detail = await asOwner((tx) =>
        getProcessor(tx, tenantId, processor.id),
      );
      expect(detail?.priceItems).toHaveLength(1);
    });

    it("keeps the SAME LABEL for two animals apart", async () => {
      // "Slaughter" for cattle and "Slaughter" for swine are two prices, and
      // the unique index is on (kind, label) rather than label alone precisely
      // so the second does not overwrite the first.
      const processor = await makeProcessor("Two Species Packing");
      for (const [kind, price] of [
        ["cattle", 9500],
        ["swine", 6500],
      ] as const) {
        await asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            kind,
            category: "slaughter",
            label: "Slaughter",
            priceCents: price,
            unit: "head",
          }),
        );
      }
      const detail = await asOwner((tx) =>
        getProcessor(tx, tenantId, processor.id),
      );
      expect(detail?.priceItems.map((i) => i.priceCents)).toEqual([9500, 6500]);
    });

    it("keeps NULL apart from zero, because they are different answers", async () => {
      // An unquoted price is a question nobody asked; a zero says they waived
      // it. The rule the whole pack applies to money, at the one table where a
      // rate sheet routinely says "call us".
      const processor = await makeProcessor("Null Not Zero Abattoir");
      const unquoted = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          category: "extra",
          label: "Smoking",
          unit: "finished_lb",
        }),
      );
      expect(unquoted.priceCents).toBeNull();
      const waived = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          category: "extra",
          label: "Disposal",
          priceCents: 0,
          unit: "flat",
        }),
      );
      expect(waived.priceCents).toBe(0);
    });

    it("refuses a unit the app cannot interpret", async () => {
      const processor = await makeProcessor("Bad Unit Butchers");
      await expect(
        asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            category: "cutting",
            label: "Cutting",
            priceCents: 105,
            unit: "per_animal",
          }),
        ),
      ).rejects.toThrow(/what the price is per/);
    });

    it("refuses a price for something unnamed, and a negative one", async () => {
      const processor = await makeProcessor("Refusals Ltd");
      await expect(
        asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            label: "   ",
            unit: "head",
          }),
        ),
      ).rejects.toThrow(/name what they charge for/);
      await expect(
        asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            label: "Slaughter",
            unit: "head",
            priceCents: -1,
          }),
        ),
      ).rejects.toThrow(/cannot be negative/);
    });

    it("REFUSES A PRICE FROM STAFF, as it refuses a handle", async () => {
      // Transcribing a kill sheet is a chore and is MEMBER. What a plant
      // charges is the terms of a commercial relationship, and the contrast is
      // deliberate.
      const processor = await makeProcessor("Owner Only Meats");
      await expect(
        withTenant(
          tenantId,
          (tx) =>
            setPriceItem(tx, staffCtx(), processor.id, {
              label: "Slaughter",
              unit: "head",
              priceCents: 9500,
            }),
          { role: "staff", userId: STAFF },
        ),
      ).rejects.toThrow(ProductionError);
    });

    it("reads the sheet in the order the paper reads", async () => {
      // Animal, then the sheet's own grouping, then the plant's own words —
      // and a category nobody anticipated sorts LAST rather than first, because
      // the rank is over an open taxonomy.
      const processor = await makeProcessor("Sheet Order Processing");
      for (const [category, label] of [
        ["brining", "Brine"],
        ["packaging", "Vacuum pack"],
        ["slaughter", "Slaughter"],
        ["cutting", "Cut and wrap"],
      ] as const) {
        await asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            kind: "cattle",
            category,
            label,
            unit: "head",
            priceCents: 100,
          }),
        );
      }
      const detail = await asOwner((tx) =>
        getProcessor(tx, tenantId, processor.id),
      );
      expect(detail?.priceItems.map((i) => i.category)).toEqual([
        "slaughter",
        "cutting",
        "packaging",
        "brining",
      ]);
    });

    it("MOVES MANY ROWS ONTO ONE ANIMAL AT ONCE", async () => {
      // **108 ROWS ARRIVED MIS-FILED**, because the sheet says "Duck & Geese"
      // and the reader could not map that to one animal. Fixing that one row at
      // a time is not a thing anybody does, so the list would stay wrong.
      const processor = await makeProcessor("Bulk Move Poultry");
      const ids: string[] = [];
      for (const label of ["Quartered", "Split", "Debone Thighs"]) {
        const row = await asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            category: "cutting",
            label,
            priceCents: 105,
            unit: "head",
          }),
        );
        expect(row.kind).toBe("");
        ids.push(row.id);
      }

      const result = await asOwner((tx) =>
        setPriceItemKind(tx, ownerCtx(), ids, "duck"),
      );
      expect(result).toEqual({ moved: 3, clashed: [] });

      const detail = await asOwner((tx) =>
        getProcessor(tx, tenantId, processor.id),
      );
      expect(detail?.priceItems.every((i) => i.kind === "duck")).toBe(true);
    });

    it("LEAVES A ROW ALONE WHEN THE MOVE WOULD COLLIDE, and names it", async () => {
      // The unique index is `(processor, kind, label)`, so moving "Quartered"
      // onto an animal that already prices "Quartered" cannot happen. Refusing
      // the whole batch would be worse than moving what can move — but the
      // caller has to be told WHICH, because the fix is to rename or remove the
      // one already there.
      const processor = await makeProcessor("Collide Poultry");
      const already = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          kind: "duck",
          category: "cutting",
          label: "Quartered",
          priceCents: 105,
          unit: "head",
        }),
      );
      const loose = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          category: "cutting",
          label: "Quartered",
          priceCents: 150,
          unit: "head",
        }),
      );
      const alsoLoose = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          category: "cutting",
          label: "Split",
          priceCents: 105,
          unit: "head",
        }),
      );

      const result = await asOwner((tx) =>
        setPriceItemKind(tx, ownerCtx(), [loose.id, alsoLoose.id], "duck"),
      );
      expect(result.moved).toBe(1);
      expect(result.clashed).toEqual(["Quartered"]);

      // The one that could not move is untouched, not lost.
      const detail = await asOwner((tx) =>
        getProcessor(tx, tenantId, processor.id),
      );
      const stillLoose = detail?.priceItems.find((i) => i.id === loose.id);
      expect(stillLoose?.kind).toBe("");
      expect(stillLoose?.priceCents).toBe(150);
      expect(already.id).not.toBe(loose.id);
    });

    it("CLEARS A WHOLE LIST so a rate sheet can be re-read over it", async () => {
      // **THE UPSERT IS WHY THIS EXISTS.** A re-read that corrects the ANIMAL
      // writes a new row and leaves the old one, so reading the sheet again
      // would have taken `Test` from 108 items to 183.
      const processor = await makeProcessor("Replace Me Packing");
      for (const label of ["Slaughter", "Quartered", "Vacuum pack"]) {
        await asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            label,
            unit: "head",
            priceCents: 100,
          }),
        );
      }
      const removed = await asOwner((tx) =>
        clearPriceItems(tx, ownerCtx(), processor.id),
      );
      expect(removed).toBe(3);
      const detail = await asOwner((tx) =>
        getProcessor(tx, tenantId, processor.id),
      );
      expect(detail?.priceItems).toEqual([]);
    });

    it("CLEARING A PRICE LIST DOES NOT TOUCH WHAT AN ORDER WAS QUOTED", async () => {
      // **THE SNAPSHOT IS WHY DELETING IS SAFE.** A price item is a quote with
      // no history behind it; what an order was quoted lives on the order line
      // and survives this untouched, which is the whole reason it is copied
      // there. Without that, replacing a list would rewrite last October.
      const processor = await makeProcessor("Snapshot Survives Meats");
      const kill = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          kind: "cattle",
          category: "slaughter",
          label: "Slaughter",
          priceCents: 9500,
          unit: "head",
        }),
      );
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-SURVIVE",
          startedOn: TODAY,
          processorId: processor.id,
        }),
      );
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
        }),
      );
      await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, { priceItemId: kill.id }),
      );

      await asOwner((tx) => clearPriceItems(tx, ownerCtx(), processor.id));

      const after = await asOwner((tx) => getOrder(tx, tenantId, order.id));
      expect(after?.lines).toHaveLength(1);
      expect(after?.lines[0].label).toBe("Slaughter");
      expect(after?.lines[0].unitPriceCents).toBe(9500);
      expect(after?.lines[0].priceItemId).toBeNull();
    });

    it("takes many prices off at once", async () => {
      const processor = await makeProcessor("Bulk Remove Packing");
      const ids: string[] = [];
      for (const label of ["A", "B", "C"]) {
        const row = await asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            label,
            unit: "flat",
            priceCents: 100,
          }),
        );
        ids.push(row.id);
      }
      expect(
        await asOwner((tx) => removePriceItems(tx, ownerCtx(), ids.slice(0, 2))),
      ).toBe(2);
      const detail = await asOwner((tx) =>
        getProcessor(tx, tenantId, processor.id),
      );
      expect(detail?.priceItems.map((i) => i.label)).toEqual(["C"]);
    });

    it("takes the price off a processor when the processor goes", async () => {
      // The cascade, and it is what stops a price outliving the plant that
      // quoted it.
      const processor = await makeProcessor("Gone Tomorrow Packing");
      await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          label: "Slaughter",
          unit: "head",
          priceCents: 9500,
        }),
      );
      await withSystem((tx) =>
        tx
          .delete(schema.productionProcessors)
          .where(eq(schema.productionProcessors.id, processor.id)),
      );
      const left = await asOwner((tx) =>
        tx
          .select()
          .from(schema.productionProcessorPriceItems)
          .where(
            eq(
              schema.productionProcessorPriceItems.processorId,
              processor.id,
            ),
          ),
      );
      expect(left).toHaveLength(0);
    });
  });

  /**
   * ── THE CUT SHEET AND THE FEE IT PRICES ────────────────────────────────────
   *
   * The claims a pure test cannot see: the snapshot, the refusals that need two
   * tables to disagree, and — the one that matters most — the plant's bill
   * landing in the pot the outputs are costed from.
   */
  describe("the cut sheet, and what the plant charged", () => {
    // Transcribing a kill sheet is a chore and is MEMBER — the contrast with
    // the owner-only price list is deliberate.
    const asStaff = <T,>(fn: (tx: Tx) => Promise<T>) =>
      withTenant(tenantId, fn, { role: "staff", userId: STAFF });

    const plantWithRates = async (name: string) => {
      const processor = await asOwner((tx) =>
        createProcessor(tx, ownerCtx(), { name }),
      );
      const kill = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          kind: "cattle",
          category: "slaughter",
          label: "Slaughter",
          priceCents: 9500,
          unit: "head",
        }),
      );
      const cut = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          kind: "cattle",
          category: "cutting",
          label: "Cut and wrap",
          priceCents: 90,
          unit: "hanging_lb",
        }),
      );
      const pack = await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          category: "packaging",
          label: "Vacuum pack",
          priceCents: 35,
          unit: "package",
        }),
      );
      return { processor, kill, cut, pack };
    };

    it("SNAPSHOTS THE PRICE AND THEN STOPS LOOKING AT IT", async () => {
      // **THE RULE THE WHOLE TABLE RESTS ON.** A rate sheet updated in March
      // must not restate what an October order was quoted, which is the same
      // stamping rule a movement's cost follows — and it is what keeps "they
      // charged more than they quoted" answerable a year later.
      const { processor, kill } = await plantWithRates("Snapshot Meats");
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-SNAP",
          startedOn: TODAY,
          processorId: processor.id,
        }),
      );
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
          title: "Retained half",
        }),
      );
      const line = await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, { priceItemId: kill.id }),
      );
      expect(line.unitPriceCents).toBe(9500);
      expect(line.unit).toBe("head");
      expect(line.label).toBe("Slaughter");

      // The plant puts its rates up.
      await asOwner((tx) =>
        setPriceItem(tx, ownerCtx(), processor.id, {
          kind: "cattle",
          category: "slaughter",
          label: "Slaughter",
          priceCents: 11_000,
          unit: "head",
        }),
      );
      const after = await asOwner((tx) =>
        getOrder(tx, tenantId, order.id),
      );
      expect(after?.lines[0].unitPriceCents).toBe(9500);
    });

    it("REFUSES A SHEET QUOTING ANOTHER PLANT'S RATE", async () => {
      // No constraint can say this: the link runs order → processor and line →
      // price item → processor, and Postgres has no way to insist the two ends
      // meet. An order handed to Miller's carrying Valley Poultry's per-bird
      // cutting fee is a number nobody could account for later.
      const mine = await plantWithRates("Ours Packing");
      const theirs = await plantWithRates("Theirs Packing");
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-CROSS",
          startedOn: TODAY,
          processorId: mine.processor.id,
        }),
      );
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: mine.processor.id,
          runId: run.id,
        }),
      );
      await expect(
        asOwner((tx) =>
          addOrderLine(tx, ownerCtx(), order.id, {
            priceItemId: theirs.kill.id,
          }),
        ),
      ).rejects.toThrow(/belongs to somebody else/);
    });

    it("keeps an instruction line, which has no price at all", async () => {
      const { processor } = await plantWithRates("Instruction Abattoir");
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-INSTR",
          startedOn: TODAY,
          processorId: processor.id,
        }),
      );
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
        }),
      );
      const line = await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, {
          label: "Grind the chuck",
          notes: "80/20, one pound packs",
        }),
      );
      expect(line.unitPriceCents).toBeNull();
      expect(line.unit).toBeNull();
    });

    it("keeps a deleted price's LINE, and only forgets where it came from", async () => {
      // `SET NULL (price_item_id)`, the Postgres 15 column-list form. CASCADE
      // would have deleted last October's order line because somebody tidied
      // this year's rate sheet — the evidence rather than the reference.
      const { processor, kill } = await plantWithRates("Tidy Up Meats");
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-TIDY",
          startedOn: TODAY,
          processorId: processor.id,
        }),
      );
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
        }),
      );
      await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, { priceItemId: kill.id }),
      );
      await asOwner((tx) => removePriceItem(tx, ownerCtx(), kill.id));

      const after = await asOwner((tx) => getOrder(tx, tenantId, order.id));
      expect(after?.lines).toHaveLength(1);
      expect(after?.lines[0].priceItemId).toBeNull();
      expect(after?.lines[0].unitPriceCents).toBe(9500);
    });

    it("carries the sheets from a booking onto the run it becomes", async () => {
      // The sheet goes over WITH the animals, months before a run exists.
      // Leaving it on the booking would strand it, and a sheet nothing can find
      // is a sheet nobody priced.
      const { processor } = await plantWithRates("Booked Ahead Packing");
      const booking = await asOwner((tx) =>
        createBooking(tx, ownerCtx(), {
          processorId: processor.id,
          bookedFor: TODAY,
          kind: "cattle",
          headCount: 2,
        }),
      );
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          bookingId: booking.id,
          title: "Smith's half",
        }),
      );
      expect(order.runId).toBeNull();

      const started = await asOwner((tx) =>
        startRunFromBooking(tx, ownerCtx(), booking.id, {
          code: "SHEET-BOOKED",
          startedOn: TODAY,
        }),
      );
      expect(started.ordersMoved).toBe(1);
      const after = await asOwner((tx) => getOrder(tx, tenantId, order.id));
      expect(after?.order.runId).toBe(started.runId);
    });

    it("THE FEE REACHES THE MEAT — flat per animal plus per pound", async () => {
      // **THE POINT OF THE SLICE.** Before this the pot was the animals'
      // accumulated cost alone, so ground beef out of a $95-a-head kill carried
      // the feed and nothing for the killing.
      const { processor, kill, cut } = await plantWithRates("Cost Reaches Meats");
      const { run, input } = await penForSheet("FEE-A", 2, 1000, processor.id);
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
        }),
      );
      await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, { priceItemId: kill.id }),
      );
      await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, { priceItemId: cut.id }),
      );
      // The plant's sheet: two head, 600 lb hanging between them.
      await asStaff((tx) =>
        addRunCarcass(tx, staffCtx(), {
          runId: run.id,
          runInputId: input.id,
          headCount: 2,
          liveLb: 1000,
          hangingLb: 600,
        }),
      );

      const detail = await asOwner((tx) =>
        runDetail(tx, tenantId, run.id, TODAY),
      );
      // 2 head at $95 = $190, plus 600 lb at $0.90 = $540. $730 quoted.
      expect(detail?.quotedFee?.cents).toBe(73_000);

      const outputItem = await meatItem("Ground beef", "lb");
      await asOwner((tx) =>
        addRunOutput(tx, ownerCtx(), {
          runId: run.id,
          itemId: outputItem.id,
          lotCode: "FEE-A-OUT",
          quantity: 420,
          locationAssetId: freezerId,
        }),
      );

      const before = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
      const inputsCents = before!.potCents;
      const result = await asOwner((tx) =>
        completeRun(tx, ownerCtx(), run.id, TODAY, 73_000),
      );
      expect(result.processingFeeCents).toBe(73_000);
      // The pot is what went in PLUS what the plant charged, and the meat
      // landed carrying all of it.
      expect(result.potCents).toBe(inputsCents + 73_000);

      const after = await asOwner((tx) => runDetail(tx, tenantId, run.id, TODAY));
      expect(after?.landedCents).toBe(inputsCents + 73_000);
      expect(after?.run.processingFeeCents).toBe(73_000);
    });

    it("REFUSES A FEE ON A RUN NOBODY WAS PAID FOR", async () => {
      // `processor_id` null means the farm did it itself, and its own labour is
      // deliberately recorded and not costed. A figure here would put a made-up
      // wage into the price of the meat through the back door.
      const { run } = await penForSheet("FEE-ONFARM", 2, 1000);
      const outputItem = await meatItem("On-farm beef", "lb");
      await asOwner((tx) =>
        addRunOutput(tx, ownerCtx(), {
          runId: run.id,
          itemId: outputItem.id,
          lotCode: "FEE-ONFARM-OUT",
          quantity: 400,
          locationAssetId: freezerId,
        }),
      );
      await expect(
        asOwner((tx) => completeRun(tx, ownerCtx(), run.id, TODAY, 50_000)),
      ).rejects.toThrow(/done here/);
    });

    it("keeps NULL apart from zero on the run, because they are different answers", async () => {
      // Null is a run nobody costed; zero says the plant did it for nothing.
      const { processor } = await plantWithRates("Waived Packing");
      const { run } = await penForSheet("FEE-NULL", 1, 500, processor.id);
      const outputItem = await meatItem("Unpriced beef", "lb");
      await asOwner((tx) =>
        addRunOutput(tx, ownerCtx(), {
          runId: run.id,
          itemId: outputItem.id,
          lotCode: "FEE-NULL-OUT",
          quantity: 300,
          locationAssetId: freezerId,
        }),
      );
      const result = await asOwner((tx) =>
        completeRun(tx, ownerCtx(), run.id, TODAY),
      );
      expect(result.processingFeeCents).toBeNull();
    });

    it("reports a line it could not price rather than quietly leaving it out", async () => {
      // A quote showing $730 with no mention of the vacuum packing nobody has
      // counted is worse than one showing nothing: it looks finished.
      const { processor, kill, pack } = await plantWithRates("Uncounted Meats");
      const { run, input } = await penForSheet("FEE-UNC", 1, 600, processor.id);
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
        }),
      );
      await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, { priceItemId: kill.id }),
      );
      await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, { priceItemId: pack.id }),
      );
      await asStaff((tx) =>
        addRunCarcass(tx, staffCtx(), {
          runId: run.id,
          runInputId: input.id,
          headCount: 1,
          hangingLb: 350,
        }),
      );

      const detail = await asOwner((tx) =>
        runDetail(tx, tenantId, run.id, TODAY),
      );
      expect(detail?.quotedFee?.cents).toBe(9500);
      expect(detail?.quotedFee?.unpriced.map((l) => l.label)).toEqual([
        "Vacuum pack",
      ]);

      // Counted, and now it prices.
      const line = detail!.orders[0].lines.find(
        (l) => l.label === "Vacuum pack",
      )!;
      await asOwner((tx) =>
        updateOrderLine(tx, ownerCtx(), line.id, { quantity: 40 }),
      );
      const after = await asOwner((tx) =>
        runDetail(tx, tenantId, run.id, TODAY),
      );
      expect(after?.quotedFee?.cents).toBe(9500 + 40 * 35);
      expect(after?.quotedFee?.unpriced).toEqual([]);
    });

    it("REFUSES THE SAME PRICED OPTION TWICE ON ONE SHEET", async () => {
      // **FOUND BY DRIVING, 2026-08-23.** The picker went on offering an option
      // already on the sheet and nothing refused a second line for it — and
      // `feeTotal` sums every line, so "Slaughter" twice would silently DOUBLE
      // what the plant appeared to have charged, on the figure that goes into
      // the cost of the meat.
      const { processor, kill } = await plantWithRates("Twice Over Meats");
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-TWICE",
          startedOn: TODAY,
          processorId: processor.id,
        }),
      );
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
        }),
      );
      await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), order.id, { priceItemId: kill.id }),
      );
      await expect(
        asOwner((tx) =>
          addOrderLine(tx, ownerCtx(), order.id, { priceItemId: kill.id }),
        ),
      ).rejects.toThrow(/already on this sheet/);
    });

    it("allows the same option on TWO sheets, which is the ordinary case", async () => {
      // The design's *one animal, two cut sheets*: a half sold to a customer and
      // the retained half are both slaughtered. The refusal above is scoped to
      // the order and must not reach across a run.
      const { processor, kill } = await plantWithRates("Two Halves Packing");
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-HALVES",
          startedOn: TODAY,
          processorId: processor.id,
        }),
      );
      const theirs = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
          title: "Customer half",
        }),
      );
      const ours = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
          title: "Retained half",
        }),
      );
      await asOwner((tx) =>
        addOrderLine(tx, ownerCtx(), theirs.id, { priceItemId: kill.id }),
      );
      await expect(
        asOwner((tx) =>
          addOrderLine(tx, ownerCtx(), ours.id, { priceItemId: kill.id }),
        ),
      ).resolves.toBeDefined();
    });

    it("allows as many INSTRUCTIONS as somebody has opinions", async () => {
      // The index is partial for this reason: an instruction has no price item,
      // and "grind the chuck" beside "keep the heart" is two of them.
      const { processor } = await plantWithRates("Opinions Abattoir");
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-OPINIONS",
          startedOn: TODAY,
          processorId: processor.id,
        }),
      );
      const order = await asOwner((tx) =>
        createOrder(tx, ownerCtx(), {
          processorId: processor.id,
          runId: run.id,
        }),
      );
      for (const label of ["Grind the chuck", "Keep the heart", "Save the fat"]) {
        await asOwner((tx) =>
          addOrderLine(tx, ownerCtx(), order.id, { label }),
        );
      }
      const detail = await asOwner((tx) => getOrder(tx, tenantId, order.id));
      expect(detail?.lines).toHaveLength(3);
    });

    it("A RUN STARTED BY HAND CAN NAME A PLANT, which it could not before", async () => {
      // **THE GAP DRIVING FOUND.** The processing path existed from slice 1d and
      // only `startRunFromBooking` ever set it, so a run started any other way
      // was always on-farm — survivable while it drove a badge, and not once the
      // cut sheet and the processing fee hung off it. A farm that drove the
      // animals over without recording a booking could not say what it was
      // charged.
      const { processor } = await plantWithRates("By Hand Packing");
      const run = await asOwner((tx) =>
        startRun(tx, ownerCtx(), {
          code: "SHEET-BYHAND",
          startedOn: TODAY,
          processorId: processor.id,
        }),
      );
      expect(run.processorId).toBe(processor.id);

      // And the consequence: it can carry a sheet and a fee.
      await expect(
        asOwner((tx) =>
          createOrder(tx, ownerCtx(), {
            processorId: processor.id,
            runId: run.id,
          }),
        ),
      ).resolves.toBeDefined();
    });

    /**
     * SLICE 2d, the half that does NOT need books. What matching does to the
     * ledger is pinned in `inventory-posting.test.ts`, where a tenant keeps a
     * set; what is here is the correction's own arithmetic — how a difference is
     * apportioned across the batches that came out, and why pressing twice moves
     * nothing the second time.
     */
    describe("moving the meat's cost to what the plant billed", () => {
      /** A finished run with one priced input and one output that landed. */
      const costedRun = async (code: string, potCents: number) => {
        const grain = await asOwner((tx) =>
          createItem(tx, ownerCtx(), {
            name: `Grain ${code}`,
            stockingUnit: "lb",
            itemKind: "feed",
          }),
        );
        const meat = await asOwner((tx) =>
          createItem(tx, ownerCtx(), {
            name: `Meat ${code}`,
            stockingUnit: "lb",
            itemKind: "meat",
          }),
        );
        await asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: grain.id,
            newLotCode: `LOT-${code}`,
            quantity: 100,
            costCents: potCents,
            occurredOn: TODAY,
          }),
        );
        const lot = await asOwner((tx) =>
          tx.query.inventoryLots.findFirst({
            where: and(
              eq(schema.inventoryLots.tenantId, tenantId),
              eq(schema.inventoryLots.code, `LOT-${code}`),
            ),
          }),
        );
        const run = await asOwner((tx) =>
          startRun(tx, ownerCtx(), { code, startedOn: TODAY }),
        );
        await asOwner((tx) =>
          addRunInput(
            tx,
            ownerCtx(),
            {
              runId: run.id,
              itemId: grain.id,
              lotId: lot!.id,
              quantity: 100,
              occurredOn: TODAY,
            },
            TODAY,
          ),
        );
        await asOwner((tx) =>
          addRunOutput(tx, ownerCtx(), {
            runId: run.id,
            itemId: meat.id,
            quantity: 50,
          }),
        );
        await asOwner((tx) => completeRun(tx, ownerCtx(), run.id, TODAY));
        const outputs = await asOwner((tx) =>
          listRunOutputs(tx, tenantId, run.id),
        );
        return { run, lotId: outputs[0].lotId as string };
      };

      /** A draft bill line, and an allocation tying it to the run. */
      const allocate = async (
        runId: string,
        accruedCents: number,
        billedCents: number,
      ) =>
        asOwner(async (tx) => {
          const party = await tx
            .insert(schema.parties)
            .values({
              tenantId,
              kind: "organization",
              displayName: `Plant ${accruedCents}-${billedCents}`,
            })
            .returning();
          const vendor = await tx
            .insert(schema.vendors)
            .values({
              tenantId,
              partyId: party[0].id,
              name: `Plant ${accruedCents}-${billedCents}`,
            })
            .returning();
          const entity = await tx
            .insert(schema.entities)
            .values({ tenantId, name: `Books ${accruedCents}-${billedCents}` })
            .returning();
          const bill = await tx
            .insert(schema.bills)
            .values({
              tenantId,
              entityId: entity[0].id,
              vendorId: vendor[0].id,
              billDate: TODAY,
              createdByClerkUserId: OWNER,
              totalCents: billedCents,
            })
            .returning();
          const line = await tx
            .insert(schema.billLines)
            .values({
              tenantId,
              billId: bill[0].id,
              lineNo: 1,
              description: "Killing and cutting",
              amountCents: billedCents,
            })
            .returning();
          await tx.insert(schema.productionRunBillAllocations).values({
            tenantId,
            billLineId: line[0].id,
            runId,
            accruedCents,
            billedCents,
          });
          return line[0].id;
        });

      it("MOVES THE BATCH'S COST BY WHAT THE PLANT BILLED OVER THE ACCRUAL", async () => {
        // The live `Test` shape: accrued $223.70, billed $235.00, so the meat
        // should carry $11.30 more than it landed with.
        const { run, lotId } = await costedRun("BILL-UP", 22_370);
        await allocate(run.id, 22_370, 23_500);

        const before = await asOwner((tx) =>
          carriedCostByLot(tx, tenantId, [lotId], TODAY),
        );
        const result = await asOwner((tx) =>
          correctRunCost(tx, ownerCtx(), { runId: run.id, occurredOn: TODAY }),
        );
        expect(result.movedCents).toBe(1_130);
        expect(result.lots).toBe(1);

        const after = await asOwner((tx) =>
          carriedCostByLot(tx, tenantId, [lotId], TODAY),
        );
        expect(carriedValue(after.get(lotId)!)).toBe(
          carriedValue(before.get(lotId)!)! + 1_130,
        );
      });

      it("MOVES NOTHING THE SECOND TIME, which is what `corrected_cents` is for", async () => {
        // Without it a second press would move the cost twice and no screen
        // could say whether it had been done at all.
        const { run } = await costedRun("BILL-TWICE", 10_000);
        await allocate(run.id, 10_000, 11_000);
        const first = await asOwner((tx) =>
          correctRunCost(tx, ownerCtx(), { runId: run.id, occurredOn: TODAY }),
        );
        expect(first.movedCents).toBe(1_000);
        await expect(
          asOwner((tx) =>
            correctRunCost(tx, ownerCtx(), { runId: run.id, occurredOn: TODAY }),
          ),
        ).rejects.toThrow(/already carries what the plant billed/);
      });

      it("moves the cost DOWN when the plant billed less than was accrued", async () => {
        const { run, lotId } = await costedRun("BILL-DOWN", 20_000);
        await allocate(run.id, 20_000, 18_000);
        const before = await asOwner((tx) =>
          carriedCostByLot(tx, tenantId, [lotId], TODAY),
        );
        const result = await asOwner((tx) =>
          correctRunCost(tx, ownerCtx(), { runId: run.id, occurredOn: TODAY }),
        );
        expect(result.movedCents).toBe(-2_000);
        const after = await asOwner((tx) =>
          carriedCostByLot(tx, tenantId, [lotId], TODAY),
        );
        expect(carriedValue(after.get(lotId)!)).toBe(
          carriedValue(before.get(lotId)!)! - 2_000,
        );
      });

      it("refuses when no bill has been matched, and when the bill agreed", async () => {
        const unmatched = await costedRun("BILL-NONE", 5_000);
        await expect(
          asOwner((tx) =>
            correctRunCost(tx, ownerCtx(), {
              runId: unmatched.run.id,
              occurredOn: TODAY,
            }),
          ),
        ).rejects.toThrow(/no bill has been matched/);

        const agreed = await costedRun("BILL-EXACT", 5_000);
        await allocate(agreed.run.id, 5_000, 5_000);
        await expect(
          asOwner((tx) =>
            correctRunCost(tx, ownerCtx(), {
              runId: agreed.run.id,
              occurredOn: TODAY,
            }),
          ),
        ).rejects.toThrow(/already carries what the plant billed/);
      });

      it("REFUSES TO UNPICK A MATCH WHOSE COST HAS ALREADY MOVED", async () => {
        // Unpicking would put the accrual back as unsettled while the meat keeps
        // a cost that came from this very match — two records disagreeing about
        // one bill. The way back is another correction, not an erasure.
        const { run } = await costedRun("BILL-STUCK", 9_000);
        const billLineId = await allocate(run.id, 9_000, 9_500);
        await asOwner((tx) =>
          correctRunCost(tx, ownerCtx(), { runId: run.id, occurredOn: TODAY }),
        );
        await expect(
          asOwner((tx) =>
            unmatchBillLineFromRuns(tx, ownerCtx(), { billLineId }),
          ),
        ).rejects.toThrow(/already been moved/);
      });
    });

    it("refuses a sheet attached to neither a date nor a run", async () => {
      const { processor } = await plantWithRates("Unattached Packing");
      await expect(
        asOwner((tx) =>
          createOrder(tx, ownerCtx(), { processorId: processor.id }),
        ),
      ).rejects.toThrow(/which date or which run/);
    });

    /**
     * SLICE 2f. The lookup the app should have been doing, against the real
     * index — the pure resolution is pinned in `production.test.ts`, and what is
     * here is everything that needs the unique key to be a unique key.
     */
    describe("the app does the lookup", () => {
      /** One breed's ladder off the real sheet: six bands, one label. */
      const bandedPlant = async (name: string) => {
        const processor = await asOwner((tx) =>
          createProcessor(tx, ownerCtx(), { name }),
        );
        const bands: Array<[number, number | null, number]> = [
          [50, 100, 350],
          [101, 250, 325],
          [251, 500, 300],
          [501, 1000, 275],
          [1001, 1500, 260],
          [1501, null, 250],
        ];
        for (const [headMin, headMax, priceCents] of bands) {
          await asOwner((tx) =>
            setPriceItem(tx, ownerCtx(), processor.id, {
              kind: "chicken",
              category: "slaughter",
              label: "Slaughter",
              variant: "Cornish Cross",
              headMin,
              headMax,
              priceCents,
              unit: "head",
            }),
          );
        }
        return processor;
      };

      it("HOLDS 24 ROWS THAT ALL CARRY ONE LABEL", async () => {
        // The reason the unique index had to change. Take the band out of the
        // label and all 24 cells of a 4-breed by 6-band grid collide on
        // (tenant, processor, kind, label) — so the variant and the band's floor
        // are in the key, and both are NOT NULL because Postgres treats two
        // nulls as distinct and a nullable column in a unique index constrains
        // nothing at all.
        const processor = await bandedPlant("Matrix Poultry");
        for (const variant of ["Freedom Ranger", "Heritage", "Broad Breasted"]) {
          for (const [headMin, headMax] of [
            [50, 100],
            [101, 250],
            [251, 500],
            [501, 1000],
            [1001, 1500],
            [1501, null],
          ] as Array<[number, number | null]>) {
            await asOwner((tx) =>
              setPriceItem(tx, ownerCtx(), processor.id, {
                kind: "chicken",
                category: "slaughter",
                label: "Slaughter",
                variant,
                headMin,
                headMax,
                priceCents: 400,
                unit: "head",
              }),
            );
          }
        }
        const detail = await asOwner((tx) =>
          getProcessor(tx, tenantId, processor.id),
        );
        const slaughter = (detail?.priceItems ?? []).filter(
          (i) => i.label === "Slaughter",
        );
        expect(slaughter).toHaveLength(24);
        // And they read in the order the paper does: breed, then the ladder.
        expect(
          slaughter
            .filter((i) => i.variant === "Cornish Cross")
            .map((i) => i.headMin),
        ).toEqual([50, 101, 251, 501, 1001, 1501]);
      });

      it("still corrects rather than duplicates, band by band", async () => {
        // The upsert has to go on working with the wider key, or a re-read of
        // next year's sheet doubles the whole grid instead of restating it.
        const processor = await bandedPlant("Reread Poultry");
        await asOwner((tx) =>
          setPriceItem(tx, ownerCtx(), processor.id, {
            kind: "chicken",
            category: "slaughter",
            label: "Slaughter",
            variant: "Cornish Cross",
            headMin: 501,
            headMax: 1000,
            priceCents: 289,
            unit: "head",
          }),
        );
        const detail = await asOwner((tx) =>
          getProcessor(tx, tenantId, processor.id),
        );
        expect(detail?.priceItems).toHaveLength(6);
        expect(
          detail?.priceItems.find((i) => i.headMin === 501)?.priceCents,
        ).toBe(289);
      });

      it("refuses a band that ends before it starts", async () => {
        const processor = await bandedPlant("Backwards Poultry");
        await expect(
          asOwner((tx) =>
            setPriceItem(tx, ownerCtx(), processor.id, {
              kind: "chicken",
              category: "slaughter",
              label: "Slaughter",
              variant: "Muddle",
              headMin: 250,
              headMax: 100,
              priceCents: 300,
              unit: "head",
            }),
          ),
        ).rejects.toThrow(/cannot end before it starts/);
      });

      it("SNAPSHOTS 800 BIRDS AT $2.75 AND SAYS WHICH BAND IT USED", async () => {
        // The claim the whole slice rests on. The band decides WHICH price gets
        // snapshotted; the snapshot itself is unchanged, and `core/fee.ts` never
        // sees any of this — putting the lookup in the fee would make a rate
        // change move last October's sheet.
        const processor = await bandedPlant("Eight Hundred Poultry");
        const run = await asOwner((tx) =>
          startRun(tx, ownerCtx(), {
            code: "BAND-800",
            startedOn: TODAY,
            processorId: processor.id,
          }),
        );
        const order = await asOwner((tx) =>
          createOrder(tx, ownerCtx(), {
            processorId: processor.id,
            runId: run.id,
            kind: "chicken",
            headCount: 800,
          }),
        );
        const detail = await asOwner((tx) =>
          getProcessor(tx, tenantId, processor.id),
        );
        const resolved = resolveBands(
          (detail?.priceItems ?? []).map((i) => ({
            id: i.id,
            kind: i.kind,
            category: i.category,
            label: i.label,
            variant: i.variant,
            headMin: i.headMin,
            headMax: i.headMax,
            priceCents: i.priceCents,
            unit: i.unit,
            minimumCents: i.minimumCents,
          })),
          800,
        );
        expect(resolved).toHaveLength(1);
        expect(resolved[0].chosen?.priceCents).toBe(275);

        const line = await asOwner((tx) =>
          addOrderLine(tx, ownerCtx(), order.id, {
            priceItemId: resolved[0].chosen?.id,
          }),
        );
        expect(line.unitPriceCents).toBe(275);
        // The label is what survives the rate sheet being replaced, so it has to
        // carry what told this row apart from its 23 siblings.
        expect(line.label).toBe("Slaughter · Cornish Cross · 501 to 1000 head");
      });

      it("REFUSES A BAND THAT DOES NOT COVER THE SHEET'S OWN HEAD COUNT", async () => {
        // "If you show up with less than 50 chickens, we do not offer cutting,
        // whole birds only." Reported, never rounded to the nearest band.
        const processor = await bandedPlant("Forty Bird Poultry");
        const run = await asOwner((tx) =>
          startRun(tx, ownerCtx(), {
            code: "BAND-40",
            startedOn: TODAY,
            processorId: processor.id,
          }),
        );
        const order = await asOwner((tx) =>
          createOrder(tx, ownerCtx(), {
            processorId: processor.id,
            runId: run.id,
            kind: "chicken",
            headCount: 40,
          }),
        );
        const detail = await asOwner((tx) =>
          getProcessor(tx, tenantId, processor.id),
        );
        const smallest = (detail?.priceItems ?? []).find((i) => i.headMin === 50);
        await expect(
          asOwner((tx) =>
            addOrderLine(tx, ownerCtx(), order.id, {
              priceItemId: smallest?.id,
            }),
          ),
        ).rejects.toThrow(/does not cover 40 head/);
      });

      it("lets a sheet with no head count quote a band by hand", async () => {
        // A sheet written before anybody has counted has nothing to check
        // against, so choosing the band deliberately is the honest way to write
        // the line and nothing refuses it.
        const processor = await bandedPlant("Uncounted Poultry");
        const run = await asOwner((tx) =>
          startRun(tx, ownerCtx(), {
            code: "BAND-NONE",
            startedOn: TODAY,
            processorId: processor.id,
          }),
        );
        const order = await asOwner((tx) =>
          createOrder(tx, ownerCtx(), {
            processorId: processor.id,
            runId: run.id,
            kind: "chicken",
          }),
        );
        const detail = await asOwner((tx) =>
          getProcessor(tx, tenantId, processor.id),
        );
        const band = (detail?.priceItems ?? []).find((i) => i.headMin === 1501);
        const line = await asOwner((tx) =>
          addOrderLine(tx, ownerCtx(), order.id, { priceItemId: band?.id }),
        );
        expect(line.unitPriceCents).toBe(250);
        expect(line.label).toBe(
          "Slaughter · Cornish Cross · 1501 head and over",
        );
      });

      it("moves a whole grid onto one animal without reporting false clashes", async () => {
        // `keyOf` had to grow the variant and the floor with the index. Without
        // them all six bands read as one key and the bulk move would report five
        // collisions where nothing collides.
        const processor = await asOwner((tx) =>
          createProcessor(tx, ownerCtx(), { name: "Unsorted Poultry" }),
        );
        for (const [headMin, headMax] of [
          [50, 100],
          [101, 250],
          [251, 500],
        ] as Array<[number, number | null]>) {
          await asOwner((tx) =>
            setPriceItem(tx, ownerCtx(), processor.id, {
              category: "slaughter",
              label: "Slaughter",
              variant: "Cornish Cross",
              headMin,
              headMax,
              priceCents: 300,
              unit: "head",
            }),
          );
        }
        const before = await asOwner((tx) =>
          getProcessor(tx, tenantId, processor.id),
        );
        const result = await asOwner((tx) =>
          setPriceItemKind(
            tx,
            ownerCtx(),
            (before?.priceItems ?? []).map((i) => i.id),
            "chicken",
          ),
        );
        expect(result).toEqual({ moved: 3, clashed: [] });
      });

      it("stamps a sheet as printed, and says nothing until it is", async () => {
        // A DATE rather than a status, because a status somebody has to advance
        // is a status nobody advances. Printing is the moment you would want it
        // recorded, so the print button is the only thing that writes it.
        const { processor } = await plantWithRates("Printed Packing");
        const run = await asOwner((tx) =>
          startRun(tx, ownerCtx(), {
            code: "PRINTED",
            startedOn: TODAY,
            processorId: processor.id,
          }),
        );
        const order = await asOwner((tx) =>
          createOrder(tx, ownerCtx(), {
            processorId: processor.id,
            runId: run.id,
          }),
        );
        expect(order.printedAt).toBeNull();

        // MEMBER, like every other write on this table: printing a sheet and
        // walking it out to the trailer is the yard's job.
        const at = new Date("2026-08-23T15:04:05.000Z");
        const stamped = await asStaff((tx) =>
          markOrderPrinted(tx, staffCtx(), order.id, at),
        );
        expect(stamped.printedAt?.toISOString()).toBe(at.toISOString());

        // Reprinting after a line changed overwrites: the version that went over
        // is the last one, and the first printing is not a fact anybody needs
        // back.
        const again = new Date("2026-08-24T09:00:00.000Z");
        const restamped = await asStaff((tx) =>
          markOrderPrinted(tx, staffCtx(), order.id, again),
        );
        expect(restamped.printedAt?.toISOString()).toBe(again.toISOString());
      });

      it("carries the day a sheet is for, so a list of them can be written", async () => {
        // The read the front door needed and did not have: every screen listing
        // sheets had to join for the day itself, so the list that would have
        // made them findable could not be written without one.
        const { processor } = await plantWithRates("Findable Packing");
        const booking = await asOwner((tx) =>
          createBooking(tx, ownerCtx(), {
            processorId: processor.id,
            bookedFor: "2026-09-15",
          }),
        );
        const order = await asOwner((tx) =>
          createOrder(tx, ownerCtx(), {
            processorId: processor.id,
            bookingId: booking.id,
            title: "Findable",
          }),
        );
        const detail = await asOwner((tx) => getOrder(tx, tenantId, order.id));
        expect(detail?.bookedFor).toBe("2026-09-15");
        expect(detail?.run).toBeNull();

        const listed = await asOwner((tx) => listOrders(tx, tenantId));
        expect(
          listed.find((e) => e.order.id === order.id)?.bookedFor,
        ).toBe("2026-09-15");
      });
    });
  });
});
