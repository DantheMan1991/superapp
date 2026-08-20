import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  ProductionError,
  addRunInput,
  addRunOutput,
  completeRun,
  inputBlocks,
  listRunOutputs,
  runDetail,
  startRun,
  type ProductionCtx,
} from "../src/packs/production/ops";
import {
  carriedCostByLot,
  createItem,
  issueStock,
  movementKindsForLots,
  receiveStock,
  type InventoryCtx,
} from "../src/packs/inventory/ops";
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
});
