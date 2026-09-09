import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { inventoryAttentionSource } from "../src/packs/inventory/attention/source";
import {
  createItem,
  expiringLots,
  issueStock,
  postCount,
  receiveStock,
  recordCountLine,
  startCount,
  updateItem,
  type InventoryCtx,
} from "../src/packs/inventory/ops";

/**
 * What the stockroom contributes to the morning digest and to What needs you.
 *
 * Run as a person through real RLS, the way the digest runs it. The
 * arithmetic is pinned in `tests/inventory-attention.test.ts`; what this file
 * certifies is that the reads compose — levels, dated batches, draft counts
 * — and that every item clears itself the moment the thing it asks for is
 * done. The invoice line needs posting switched on and a chart of accounts,
 * which `tests/inventory-posting.test.ts` builds; it is pinned there in pure
 * form and not repeated here.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("inventory attention source", () => {
  const STAMP = `att-stock-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const TODAY = "2026-09-09";

  let tenantId: string;

  const ctx = (): InventoryCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const collect = (role: "owner" | "staff" = "staff") =>
    asOwner((tx) =>
      inventoryAttentionSource.collect(tx, {
        tenantId,
        userId: OWNER,
        role,
        today: TODAY,
      }),
    );

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Stockroom", slug: STAMP })
        .returning();
      tenantId = tenant.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("says nothing about an empty stockroom", async () => {
    expect(await collect()).toEqual([]);
  });

  it("raises low stock at the reorder point, then below zero instead, and clears on a delivery", async () => {
    const feed = await asOwner((tx) =>
      createItem(tx, ctx(), {
        name: "Layer pellets",
        stockingUnit: "lb",
        itemKind: "feed",
        reorderPoint: 100,
      }),
    );
    // Never recorded is not "down to" anything.
    expect((await collect()).filter((i) => i.key.endsWith(feed.id))).toEqual([]);

    await asOwner((tx) =>
      receiveStock(tx, ctx(), { itemId: feed.id, quantity: 60, occurredOn: "2026-09-01" }),
    );
    let mine = (await collect()).filter((i) => i.key.endsWith(feed.id));
    expect(mine.map((i) => [i.key, i.title, i.urgency])).toEqual([
      [`inventory-low:${feed.id}`, "Layer pellets is down to 60 pounds", "soon"],
    ]);
    expect(mine[0].detail).toBe("Reorder at 100 pounds");
    expect(mine[0].href).toBe(`/dashboard/m/inventory/${feed.id}`);

    // Used before the delivery that covered it was entered: below zero
    // replaces low, and goes to everybody.
    await asOwner((tx) =>
      issueStock(tx, ctx(), { itemId: feed.id, quantity: 80, occurredOn: "2026-09-02" }),
    );
    mine = (await collect("staff")).filter((i) => i.key.endsWith(feed.id));
    expect(mine.map((i) => [i.key, i.urgency])).toEqual([
      [`inventory-negative:${feed.id}`, "today"],
    ]);
    expect(mine[0].title).toBe("Layer pellets is below zero");

    // The delivery arrives: 180 on hand, above the point — both lines gone.
    await asOwner((tx) =>
      receiveStock(tx, ctx(), { itemId: feed.id, quantity: 200, occurredOn: "2026-09-03" }),
    );
    expect((await collect()).filter((i) => i.key.endsWith(feed.id))).toEqual([]);

    // Taking the reorder point away takes the line with it.
    await asOwner((tx) =>
      issueStock(tx, ctx(), { itemId: feed.id, quantity: 150, occurredOn: "2026-09-04" }),
    );
    expect((await collect()).map((i) => i.key)).toContain(`inventory-low:${feed.id}`);
    await asOwner((tx) => updateItem(tx, ctx(), feed.id, { reorderPoint: null }));
    expect((await collect()).filter((i) => i.key.endsWith(feed.id))).toEqual([]);
  });

  it("raises a batch past its date while it has stock, and lets it go once it is gone", async () => {
    const med = await asOwner((tx) =>
      createItem(tx, ctx(), { name: "Penicillin G", stockingUnit: "floz", itemKind: "medicine" }),
    );
    const { lotId } = await asOwner((tx) =>
      receiveStock(tx, ctx(), {
        itemId: med.id,
        newLotCode: "PEN-OLD",
        newLotExpiresOn: "2026-09-01",
        quantity: 2,
        occurredOn: "2026-08-01",
      }),
    );
    const before = (await collect()).find((i) => i.key === `inventory-expiry:${lotId}`);
    expect(before).toMatchObject({
      title: "PEN-OLD of Penicillin G is past its date",
      urgency: "overdue",
      dueOn: "2026-09-01",
      href: `/dashboard/m/inventory/${med.id}`,
    });

    // Thrown away: nothing on hand, nothing to go off.
    await asOwner((tx) =>
      issueStock(tx, ctx(), { itemId: med.id, lotId, quantity: 2, occurredOn: "2026-09-09" }),
    );
    expect((await collect()).map((i) => i.key)).not.toContain(`inventory-expiry:${lotId}`);
  });

  it("does not let used-up dated batches eat the budget", async () => {
    /**
     * **THE TRUNCATION THAT WOULD HAVE MADE THIS LINE GO SILENT.** `expiringLots`
     * applies its `limit` in SQL, oldest-expiry first, and used to drop the
     * empty batches in JS afterwards — so a business with enough consumed dated
     * batches spent the whole budget on them and the one going off this week
     * was never fetched. PEN-OLD above is exactly that: dated 2026-09-01 and
     * emptied by the test before this one. With a budget of ONE row it must
     * still be the batch that has stock that comes back.
     */
    const med = await asOwner((tx) =>
      createItem(tx, ctx(), {
        name: "Penicillin G (next)",
        stockingUnit: "floz",
        itemKind: "medicine",
      }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ctx(), {
        itemId: med.id,
        newLotCode: "PEN-NEXT",
        newLotExpiresOn: "2026-09-12",
        quantity: 5,
        occurredOn: "2026-09-09",
      }),
    );
    const page = await asOwner((tx) =>
      expiringLots(tx, tenantId, { onOrBefore: "2026-09-16", limit: 1 }),
    );
    expect(page.map((r) => r.lot.code)).toEqual(["PEN-NEXT"]);
    // And the digest says it, three days out.
    const line = (await collect()).find((i) => i.key === `inventory-expiry:${page[0].lot.id}`);
    expect(line).toMatchObject({
      title: "PEN-NEXT of Penicillin G (next) goes off in 3 days",
      urgency: "soon",
    });
  });

  it("raises a walked count left two weeks, not an empty one, and clears on posting", async () => {
    const item = await asOwner((tx) =>
      createItem(tx, ctx(), { name: "Cartons", stockingUnit: "each", itemKind: "supply" }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ctx(), { itemId: item.id, quantity: 40, occurredOn: "2026-08-01" }),
    );
    const empty = await asOwner((tx) => startCount(tx, ctx(), { countedOn: "2026-08-01" }));
    const walked = await asOwner((tx) => startCount(tx, ctx(), { countedOn: "2026-08-20" }));
    await asOwner((tx) =>
      recordCountLine(tx, ctx(), { countId: walked.id, itemId: item.id, countedQuantity: 40 }),
    );
    const fresh = await asOwner((tx) => startCount(tx, ctx(), { countedOn: "2026-09-01" }));
    await asOwner((tx) =>
      recordCountLine(tx, ctx(), { countId: fresh.id, itemId: item.id, countedQuantity: 40 }),
    );

    const keys = (await collect()).map((i) => i.key);
    expect(keys).toContain(`inventory-count:${walked.id}`);
    expect(keys).not.toContain(`inventory-count:${empty.id}`);
    expect(keys).not.toContain(`inventory-count:${fresh.id}`);
    const line = (await collect()).find((i) => i.key === `inventory-count:${walked.id}`);
    expect(line).toMatchObject({
      title: "A count from 2026-08-20 has not been posted",
      detail: "Everywhere · 1 shelf written down · 20 days ago",
      urgency: "today",
      href: `/dashboard/m/inventory/counts/${walked.id}`,
    });

    await asOwner((tx) => postCount(tx, ctx(), walked.id, "2026-09-09"));
    expect((await collect()).map((i) => i.key)).not.toContain(`inventory-count:${walked.id}`);
  });
});
