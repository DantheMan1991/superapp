import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { getBalances, getDefaultEntityId } from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  ENTERPRISE_DIMENSION,
  archiveEnterprise,
  createEnterprise,
} from "../src/lib/enterprises";
import { listDimensionMembers } from "../src/modules/accounting/core";
import {
  adjustLotCost,
  createItem,
  createLot,
  issueStock,
  receiveStock,
  type InventoryCtx,
} from "../src/packs/inventory/ops";
import { postServiceAccrual } from "../src/packs/inventory/ledger-ops";
import type { LedgerCtx } from "../src/modules/accounting/core";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * **THE COST SIDE REACHING THE REPORT** — enterprises slice 3.
 *
 * Slices 1 and 2 built a list and tagged things with it; nothing put an
 * enterprise on a journal line, so the P&L's Enterprise grouping showed every
 * figure under Unassigned. This is the file that proves it no longer does.
 *
 * The question every test here asks is the one the whole dimension exists for:
 * **group the ledger by enterprise and see the right money against the right
 * line of business.** `getBalances` has taken `groupByDimensionType` since
 * before slice 1, so the assertions read the real report path rather than
 * counting rows in `journal_line_dimensions`.
 *
 * **THERE IS NO BACK-FILL AND THERE CANNOT BE ONE.** Everything posted before
 * this slice carries no enterprise and cannot get one without rewriting
 * history, so these fixtures all post fresh. See the dossier.
 */
d("enterprise costing reaches the ledger", () => {
  const STAMP = `entpost-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;
  let barnId: string;
  let cogsAccountId: string;
  let inventoryAccountId: string;
  let broilersId: string;
  let beefId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const ownerCtx = (): InventoryCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const ledgerOwner = (): LedgerCtx => ({ tenantId, userId: OWNER, role: "owner" });

  /**
   * The report, exactly as `/dashboard/reports` builds it: one row per
   * (account, enterprise member), with `memberId: null` for untagged.
   */
  const byEnterprise = async (accountId: string) => {
    const rows = await asOwner((tx) =>
      getBalances(tx, tenantId, {
        scope: { kind: "combined" },
        asOf: "2027-12-31",
        accountIds: [accountId],
        groupByDimensionType: ENTERPRISE_DIMENSION,
      }),
    );
    /**
     * **`listDimensionMembers` AND NOT `enterpriseMemberIds`, because this
     * helper has to name a RETIRED line of business too.** The door is
     * active-only on purpose — that is the fix at the centre of this file — and
     * a report that stopped labelling Beef the moment Beef was retired would
     * make the last test here pass for the wrong reason.
     */
    const members = await asOwner((tx) =>
      listDimensionMembers(tx, tenantId, ENTERPRISE_DIMENSION),
    );
    const nameOf = new Map<string, string>();
    for (const m of members) {
      if (m.packEntityId === broilersId) nameOf.set(m.id, "broilers");
      if (m.packEntityId === beefId) nameOf.set(m.id, "beef");
    }
    const out = new Map<string, number>();
    for (const r of rows) {
      const key = r.memberId ? (nameOf.get(r.memberId) ?? "other") : "unassigned";
      out.set(key, (out.get(key) ?? 0) + r.netCents);
    }
    return out;
  };

  const newItem = (name: string, enterpriseId?: string | null) =>
    asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        name,
        stockingUnit: "lb",
        itemKind: "feed",
        enterpriseId,
      }),
    );

  const newLot = (
    itemId: string,
    code: string,
    enterpriseId?: string | null,
  ) =>
    asOwner((tx) =>
      createLot(tx, ownerCtx(), {
        itemId,
        code,
        source: "purchased",
        enterpriseId,
      }),
    );

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Ent Posting", slug: STAMP })
        .returning();
      return rows[0].id;
    });
    barnId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({
          tenantId,
          kind: "building",
          name: "Barn",
          isStorageLocation: true,
        })
        .returning();
      return rows[0].id;
    });
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    await withTenant(tenantId, (tx) => getDefaultEntityId(tx, tenantId));

    const accounts = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.accounts).where(eq(schema.accounts.tenantId, tenantId)),
    );
    cogsAccountId = accounts.find((a) => a.code === "5000")!.id;
    inventoryAccountId = accounts.find((a) => a.code === "1300")!.id;

    // Posting is off by default and this whole file is about what posts.
    await withSystem((tx) =>
      tx
        .update(schema.accountingSettings)
        .set({ inventoryTreatment: "capitalise" })
        .where(eq(schema.accountingSettings.tenantId, tenantId)),
    );

    const broilers = await asOwner((tx) =>
      createEnterprise(tx, ledgerOwner(), { name: "Broilers", kind: "livestock" }),
    );
    broilersId = broilers.id;
    const beef = await asOwner((tx) =>
      createEnterprise(tx, ledgerOwner(), { name: "Beef", kind: "livestock" }),
    );
    beefId = beef.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  // ---- the rule ------------------------------------------------------------

  it("CHARGES FEED TO THE PEN THAT ATE IT", async () => {
    /**
     * **THE TEST THE WHOLE SLICE IS FOR.** A bag of crumble belongs to no line
     * of business while it sits in the bin; the pen it goes down the throat of
     * belongs to exactly one. Before this, the issue posted `Dr 5000 / Cr 1300`
     * with nothing on either line and the P&L put the cost in Unassigned.
     */
    const feed = await newItem("Grower crumble");
    const feedLot = await newLot(feed.id, `FEED-${STAMP}`);
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: feed.id,
        lotId: feedLot.id,
        quantity: 100,
        costCents: 10_000,
        occurredOn: "2026-03-01",
        locationAssetId: barnId,
      }),
    );

    const birds = await newItem("Broiler chicks", broilersId);
    // The pen inherits Broilers from the item — slice 2's rule, and the one
    // this slice rests on.
    const pen = await newLot(birds.id, `PEN-${STAMP}`);
    expect(pen.enterpriseId).toBe(broilersId);

    await asOwner((tx) =>
      issueStock(tx, ownerCtx(), {
        itemId: feed.id,
        lotId: feedLot.id,
        quantity: 40,
        occurredOn: "2026-03-05",
        locationAssetId: barnId,
        issuedToLotId: pen.id,
      }),
    );

    const cogs = await byEnterprise(cogsAccountId);
    expect(cogs.get("broilers")).toBe(4_000);
    expect(cogs.get("unassigned") ?? 0).toBe(0);
  });

  it("charges a sale's cost of goods to the batch it came out of", async () => {
    /**
     * **THIS IS THE PATH `retail` ALREADY USES.** A market sale calls
     * `issueStock`, so tagging `postMovement` tags the cost of goods sold at a
     * stall by the same code that charges feed to a pen — the revenue half is
     * slice 4, and until it lands the margin is only half a sentence.
     */
    const meat = await newItem("Whole broilers", broilersId);
    const batch = await newLot(meat.id, `MEAT-${STAMP}`);
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: meat.id,
        lotId: batch.id,
        quantity: 20,
        costCents: 8_000,
        occurredOn: "2026-03-10",
        locationAssetId: barnId,
      }),
    );
    const before = (await byEnterprise(cogsAccountId)).get("broilers")!;

    await asOwner((tx) =>
      issueStock(tx, ownerCtx(), {
        itemId: meat.id,
        lotId: batch.id,
        quantity: 5,
        occurredOn: "2026-03-12",
        locationAssetId: barnId,
      }),
    );

    const cogs = await byEnterprise(cogsAccountId);
    expect(cogs.get("broilers")! - before).toBe(2_000);
  });

  it("NEVER MOVES ONE LINE OF BUSINESS'S STOCK ONTO ANOTHER'S BOOKS", async () => {
    /**
     * **THE DEFECT THIS SUITE CAUGHT, AND THE REASON THE RULE RETURNS TWO
     * VALUES.** The first version tagged both journal lines with the cost
     * bearer, on the precedent of `assets` doing that for depreciation — where
     * it is right, because an asset's expense and its accumulated depreciation
     * are always the same asset's. Stock is not like that: feeding untagged
     * crumble to a Broilers pen credited `1300` with Broilers on it, so
     * inventory grouped by enterprise read **minus $40 for Broilers** against
     * plus $100 Unassigned. Broilers never held that feed.
     *
     * Each line now carries what it describes. The two figures below are the
     * whole proof: the feed's stock stayed Unassigned while its cost went to
     * Broilers, and the meat's stock and cost are both Broilers'.
     */
    const stock = await byEnterprise(inventoryAccountId);
    // The meat batch: 8,000 in, 2,000 out, both sides Broilers'.
    expect(stock.get("broilers")).toBe(6_000);
    // The feed: 10,000 in, 4,000 issued to the pen — and it was NEVER Broilers'
    // stock, however Broilers ended up bearing the cost of eating it.
    expect(stock.get("unassigned")).toBe(6_000);
  });

  it("leaves an untagged batch untagged rather than borrowing the item's", async () => {
    /**
     * The one decision here somebody could reasonably make the other way. A
     * stored null on a lot cannot be told apart from "the item was untagged
     * when this batch was made", so falling back would silently override
     * somebody who said none. Unassigned is incomplete and visible; the other
     * way is wrong and quiet.
     */
    const item = await newItem("Tagged after the fact", beefId);
    const lot = await newLot(item.id, `LATE-${STAMP}`, null);
    expect(lot.enterpriseId).toBeNull();

    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 10,
        costCents: 5_000,
        occurredOn: "2026-03-15",
        locationAssetId: barnId,
      }),
    );
    await asOwner((tx) =>
      issueStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 10,
        occurredOn: "2026-03-16",
        locationAssetId: barnId,
      }),
    );

    const cogs = await byEnterprise(cogsAccountId);
    expect(cogs.get("beef") ?? 0).toBe(0);
    expect(cogs.get("unassigned")).toBe(5_000);
  });

  it("carries the tag onto a cost correction as well as the delivery", async () => {
    // Correcting what a batch cost is still that batch's cost. A $60
    // correction landing in Unassigned while the delivery it corrects sits
    // under Broilers is the report disagreeing with itself.
    const item = await newItem("Corrected feed", broilersId);
    const lot = await newLot(item.id, `CORR-${STAMP}`);
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 10,
        costCents: 1_000,
        occurredOn: "2026-04-01",
        locationAssetId: barnId,
      }),
    );
    const before = (await byEnterprise(inventoryAccountId)).get("broilers")!;

    await asOwner((tx) =>
      adjustLotCost(tx, ownerCtx(), {
        lotId: lot.id,
        occurredOn: "2026-04-02",
        amountCents: 6_000,
        reason: "freight",
      }),
    );

    const stock = await byEnterprise(inventoryAccountId);
    // Nothing has been issued, so the whole correction stays on hand.
    expect(stock.get("broilers")! - before).toBe(6_000);
  });

  it("puts the plant's fee where the caller says it goes", async () => {
    // `production` derives it from the batches that went into the run and
    // passes the answer down; this is the ledger end of that. A delta rather
    // than a running total, because the cost-correction test above credits the
    // consumption account and an absolute figure here would encode that.
    const before = (await byEnterprise(cogsAccountId)).get("broilers") ?? 0;
    await asOwner((tx) =>
      postServiceAccrual(tx, ownerCtx(), {
        sourceId: crypto.randomUUID(),
        amountCents: 23_500,
        occurredOn: "2026-05-01",
        locationAssetId: barnId,
        enterpriseId: broilersId,
        memo: "Processing accrued — test",
      }),
    );
    const cogs = await byEnterprise(cogsAccountId);
    expect((cogs.get("broilers") ?? 0) - before).toBe(23_500);
  });

  // ---- the trap ------------------------------------------------------------

  it("KEEPS RECORDING STOCK AFTER A LINE OF BUSINESS IS RETIRED", async () => {
    /**
     * **THE BUG THIS SLICE WOULD HAVE SHIPPED WITHOUT THE ACTIVE FILTER.**
     * `postEntry` refuses an inactive dimension member outright, and inventory
     * posts from inside `recordMovement` — so a map that offered an archived
     * member would not merely mis-tag an entry, it would fail the whole stock
     * write. Retiring Beef would have made every subsequent movement on a
     * batch still tagged Beef impossible to record: a business stopping
     * because of a report.
     *
     * `archiveDimensionMember`'s contract is what the fix implements — *"stop
     * being taggable; existing tags keep reporting"* — so the new entry goes
     * untagged and the old ones keep their member.
     */
    const item = await newItem("Retired line", beefId);
    const lot = await newLot(item.id, `RET-${STAMP}`);
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 10,
        costCents: 3_000,
        occurredOn: "2026-06-01",
        locationAssetId: barnId,
      }),
    );
    const before = await byEnterprise(inventoryAccountId);
    expect(before.get("beef")).toBe(3_000);

    await asOwner((tx) => archiveEnterprise(tx, ledgerOwner(), beefId));

    // The write that used to be impossible.
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 5,
        costCents: 1_500,
        occurredOn: "2026-06-02",
        locationAssetId: barnId,
      }),
    );

    const stock = await byEnterprise(inventoryAccountId);
    // EXISTING TAGS KEEP REPORTING: the first delivery is still Beef's, and it
    // has not moved — retiring a line of business is not a restatement.
    expect(stock.get("beef")).toBe(3_000);
    // And the new one is untagged rather than refused. A delta, because this
    // tenant is carrying untagged feed from the tests above.
    expect(
      (stock.get("unassigned") ?? 0) - (before.get("unassigned") ?? 0),
    ).toBe(1_500);
  });
});
