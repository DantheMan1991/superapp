import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { livestockAttentionSource } from "../src/packs/livestock/attention/source";
import {
  createLivestockLot,
  placeHead,
  recordDailyCheck,
  recordTreatment,
  splitIntoIndividuals,
  updateTreatment,
  type LivestockCtx,
} from "../src/packs/livestock/ops";
import { createItem } from "../src/packs/inventory/ops";

/**
 * What the barn contributes to the morning digest and to What needs you.
 *
 * Run as a person through real RLS, the way the digest runs it. The
 * arithmetic is pinned in `tests/livestock.test.ts`; what this file certifies
 * is that the reads compose — the pen fold, the last-check map and the
 * withdrawal funnel all feeding one `collect` — and that every item clears
 * itself the moment the thing it asks for is done.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("livestock attention source", () => {
  const STAMP = `att-barn-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const TODAY = "2026-09-08";

  let tenantId: string;
  let itemId: string;

  const ctx = (): LivestockCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const collect = (today = TODAY) =>
    asOwner((tx) =>
      livestockAttentionSource.collect(tx, {
        tenantId,
        userId: OWNER,
        role: "staff",
        today,
      }),
    );

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Barn", slug: STAMP })
        .returning();
      tenantId = tenant.id;
    });
    itemId = (
      await asOwner((tx) =>
        createItem(tx, ctx(), {
          name: "Feeder pigs",
          stockingUnit: "head",
          itemKind: "livestock",
        }),
      )
    ).id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  const newPen = async (code: string, head: number) => {
    const made = await asOwner((tx) =>
      createLivestockLot(tx, ctx(), { itemId, code, species: "swine" }),
    );
    if (head > 0) {
      await asOwner((tx) =>
        placeHead(tx, ctx(), {
          itemId,
          inventoryLotId: made.inventoryLotId,
          head,
          occurredOn: "2026-08-01",
        }),
      );
    }
    return made;
  };

  it("an empty farm owes nothing, and an empty pen is not a missed round", async () => {
    expect(await collect()).toEqual([]);
    await newPen("EMPTY", 0);
    expect(await collect()).toEqual([]);
  });

  it("a pen nobody has looked at is the round, overdue, and clears when the round is walked", async () => {
    const pen = await newPen("HOGS-A", 5);
    let items = await collect();
    expect(items.map((i) => i.key)).toEqual(["livestock_round:stale"]);
    expect(items[0].title).toBe("HOGS-A has never been looked at");
    expect(items[0].urgency).toBe("overdue");

    // Looked at yesterday: today's round is still to come, so nothing is owed.
    await asOwner((tx) =>
      recordDailyCheck(tx, ctx(), { livestockLotId: pen.lot.id, loggedOn: "2026-09-07" }),
    );
    expect(await collect()).toEqual([]);

    // Two days on with no check since: the round was missed.
    items = await collect("2026-09-09");
    expect(items[0]?.title).toBe("HOGS-A has not been looked at for 2 days");
  });

  it("a pen whose animals are all named is still a pen to look at", async () => {
    // Its own ledger is empty once the head are named out, but the animals
    // stand in it — the population fold every screen makes, made here too.
    const pen = await newPen("NAMED-PEN", 2);
    await asOwner((tx) =>
      splitIntoIndividuals(tx, ctx(), {
        livestockLotId: pen.lot.id,
        names: ["Rosie", "Hazel"],
        identifierKind: "name",
        occurredOn: "2026-08-05",
      }),
    );
    // Every other pen on the farm is checked today, so the only stale one is
    // this pen — and its named animals are NOT raised on their own.
    await asOwner(async (tx) => {
      const lots = await tx.query.livestockLots.findMany({
        where: eq(schema.livestockLots.tenantId, tenantId),
      });
      for (const lot of lots) {
        if (lot.id === pen.lot.id) continue;
        await recordDailyCheck(tx, ctx(), { livestockLotId: lot.id, loggedOn: TODAY });
      }
    });
    const items = await collect();
    expect(items.map((i) => i.title)).toEqual(["NAMED-PEN has never been looked at"]);
  });

  it("a withdrawal nobody looked up is owed until the label is read; the clearing day is announced", async () => {
    const pen = await newPen("TREATED", 4);
    await asOwner((tx) =>
      recordDailyCheck(tx, ctx(), { livestockLotId: pen.lot.id, loggedOn: TODAY }),
    );
    const treatment = await asOwner((tx) =>
      recordTreatment(tx, ctx(), {
        livestockLotId: pen.lot.id,
        treatedOn: "2026-09-01",
        product: "Tylan",
        route: "water",
        withdrawalSource: "none_stated",
      }),
    );
    let items = (await collect()).filter((i) => i.key.includes(pen.lot.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: `livestock_withdrawal_unknown:${pen.lot.id}`,
      title: "TREATED's withdrawal was never looked up",
      urgency: "overdue",
      href: `/dashboard/m/livestock/${pen.lot.id}`,
    });

    // The label read at last: seven days from the 1st clears on the 8th —
    // today — which is the other line worth a morning.
    await asOwner((tx) =>
      updateTreatment(tx, ctx(), treatment.id, {
        meatWithdrawalDays: 7,
        withdrawalSource: "label",
      }),
    );
    items = (await collect()).filter((i) => i.key.includes(pen.lot.id));
    expect(items.map((i) => [i.key, i.title, i.urgency])).toEqual([
      [`livestock_withdrawal_clears:${pen.lot.id}`, "TREATED clears withdrawal today", "today"],
    ]);
    // Yesterday it was tomorrow's news; the day after it is nobody's.
    expect(
      (await collect("2026-09-07")).find((i) => i.key.includes(pen.lot.id))?.title,
    ).toBe("TREATED clears withdrawal tomorrow");
    expect((await collect("2026-09-09")).find((i) => i.key.includes(pen.lot.id))).toBeUndefined();
  });
});
