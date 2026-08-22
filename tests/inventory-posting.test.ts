import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { getBalances, getDefaultEntityId } from "../src/modules/accounting/core";
import { approveBill } from "../src/modules/accounting/payables/bills";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  adjustStock,
  createItem,
  createLot,
  issueStock,
  receiveStock,
  recordMovement,
  transferStock,
  type InventoryCtx,
} from "../src/packs/inventory/ops";
import {
  allocateBillLineToStock,
  inventoryTreatmentOf,
  grniPosition,
  resolveGrniAccount,
  unbilledReceipts,
  unmatchBillLine,
} from "../src/packs/inventory/ledger-ops";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * **INVENTORY REACHING THE BOOKS** — slice 3b, ADR 0012.
 *
 * The invariant this whole file exists to hold:
 *
 *     1300 Inventory  ==  the sum of what the lots carry
 *
 * If the ledger and `core/valuation.ts` ever disagree, one of them is wrong and
 * these tests say which. Everything else here is a way of getting them to
 * disagree on purpose.
 */
d("inventory posting", () => {
  const STAMP = `invpost-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId: string;
  let entityId: string;
  let inventoryAccountId: string;
  let cogsAccountId: string;
  let grniAccountId: string;
  let freezerId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const ownerCtx = (): InventoryCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const staffCtx = (): InventoryCtx => ({ tenantId, userId: STAFF, role: "staff" });

  const newItem = (name: string) =>
    asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        name,
        stockingUnit: "lb",
        itemKind: "feed",
      }),
    );

  /** The ledger's net for one account, as of well after everything here. */
  const netOf = async (accountId: string) => {
    const rows = await asOwner((tx) =>
      getBalances(tx, tenantId, {
        scope: { kind: "combined" },
        asOf: "2027-12-31",
        accountIds: [accountId],
      }),
    );
    return rows.reduce((sum, r) => sum + r.netCents, 0);
  };

  const ledgerOwner = () => ({ tenantId, userId: OWNER, role: "owner" as const });

  /** A one-line draft bill from a throwaway vendor, ready to be matched. */
  const makeBill = async (amountCents: number) => {
    const vendorId = await asOwner(async (tx) => {
      const party = await tx
        .insert(schema.parties)
        .values({ tenantId, kind: "organization", displayName: `V-${amountCents}` })
        .returning();
      const rows = await tx
        .insert(schema.vendors)
        .values({ tenantId, partyId: party[0].id, name: `V-${amountCents}` })
        .returning();
      return rows[0].id;
    });
    return asOwner(async (tx) => {
      const bill = await tx
        .insert(schema.bills)
        .values({
          tenantId,
          entityId,
          vendorId,
          billDate: "2026-09-01",
          status: "draft",
          createdByClerkUserId: OWNER,
        })
        .returning();
      const line = await tx
        .insert(schema.billLines)
        .values({
          tenantId,
          billId: bill[0].id,
          lineNo: 1,
          description: "Feed",
          amountCents,
          // `approveBill` refuses an uncoded line. Matching re-codes it to
          // GRNI; a bill approved WITHOUT matching keeps this, which is the
          // bill-first ordering.
          accountId: cogsAccountId,
        })
        .returning();
      return { billId: bill[0].id, billLineId: line[0].id };
    });
  };

  const setTreatment = (treatment: "none" | "capitalise") =>
    withSystem((tx) =>
      tx
        .update(schema.accountingSettings)
        .set({ inventoryTreatment: treatment })
        .where(eq(schema.accountingSettings.tenantId, tenantId)),
    );

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Inv Posting", slug: STAMP })
        .returning();
      return rows[0].id;
    });
    freezerId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.assets)
        .values({
          tenantId,
          kind: "equipment",
          name: "Chest freezer",
          isStorageLocation: true,
        })
        .returning();
      return rows[0].id;
    });
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    entityId = await withTenant(tenantId, (tx) => getDefaultEntityId(tx, tenantId));

    const accounts = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.accounts).where(eq(schema.accounts.tenantId, tenantId)),
    );
    inventoryAccountId = accounts.find((a) => a.code === "1300")!.id;
    cogsAccountId = accounts.find((a) => a.code === "5000")!.id;
    grniAccountId = accounts.find((a) => a.subtype === "goods_received")!.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  // ---- the default --------------------------------------------------------

  it("POSTS NOTHING AT ALL by default", async () => {
    /**
     * The decision that makes this slice safe to merge. Perpetual posting
     * rewrites how every purchase reaches the books; a tenant already keeping
     * accounts must not acquire that from a migration.
     */
    expect(await asOwner((tx) => inventoryTreatmentOf(tx, tenantId))).toBe("none");

    const item = await newItem("Default off");
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        quantity: 100,
        costCents: 20_000,
        occurredOn: "2026-01-05",
      }),
    );
    expect(await netOf(inventoryAccountId)).toBe(0);
    expect(await netOf(grniAccountId)).toBe(0);
  });

  it("provisions the GRNI account and resolves it by subtype", async () => {
    expect(await asOwner((tx) => resolveGrniAccount(tx, tenantId))).toBe(
      grniAccountId,
    );
  });

  // ---- capitalise ---------------------------------------------------------

  describe("on capitalise", () => {
    beforeAll(() => setTreatment("capitalise"));

    it("a receipt DEBITS INVENTORY and CREDITS GRNI", async () => {
      const item = await newItem("Posted feed");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 100,
          costCents: 40_000,
          occurredOn: "2026-02-01",
        }),
      );
      expect(await netOf(inventoryAccountId)).toBe(40_000);
      // Liabilities are credits, so the net is negative.
      expect(await netOf(grniAccountId)).toBe(-40_000);
    });

    it("an issue moves cost from INVENTORY to the consumption account", async () => {
      const item = await newItem("Issued feed");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 100,
          costCents: 10_000,
          occurredOn: "2026-03-01",
        }),
      );
      const before = await netOf(cogsAccountId);
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 40,
          occurredOn: "2026-03-05",
        }),
      );
      // 40 lb at $1.00 = $40.
      expect((await netOf(cogsAccountId)) - before).toBe(4_000);
    });

it("WILL NOT RELEASE COST THAT NEVER CAME IN", async () => {
      /**
       * `averageCostRate` is the average of what arrived WITH A PRICE. Applying
       * it to a quantity that includes unpriced stock invents money: 100 lb at
       * $100 plus 100 lb with no price on the ticket is a $1.00/lb rate, and
       * issuing all 200 lb used to stamp $200 against $100 that ever existed —
       * driving 1300 to a CREDIT balance with stock still on the shelf.
       *
       * The rate is left alone deliberately. Putting unpriced receipts in the
       * denominator would treat stock nobody has costed as costing nothing,
       * which is the one thing the valuation slice exists to refuse.
       */
      const item = await newItem("Half priced");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 100,
          costCents: 10_000,
          occurredOn: "2027-02-01",
          locationAssetId: freezerId,
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 100,
          occurredOn: "2027-02-02",
          locationAssetId: freezerId,
        }),
      );
      const before = await netOf(inventoryAccountId);
      const issued = await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 200,
          occurredOn: "2027-02-03",
          locationAssetId: freezerId,
        }),
      );
      // Capped at what came in, not 200 * $1.00.
      expect(issued.costCents).toBe(10_000);
      expect((await netOf(inventoryAccountId)) - before).toBe(-10_000);
    });

    it("leaves an ordinary issue alone", async () => {
      // The cap must bind ONLY when the rate would over-release. A normal item
      // with everything priced is untouched by it.
      const item = await newItem("All priced");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 100,
          costCents: 10_000,
          occurredOn: "2027-02-10",
          locationAssetId: freezerId,
        }),
      );
      const issued = await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 40,
          occurredOn: "2027-02-11",
          locationAssetId: freezerId,
        }),
      );
      expect(issued.costCents).toBe(4_000);
    });

    it("POSTS NOTHING for a receipt with no price on the ticket", async () => {
      /**
       * The same distinction `carriedValue` keeps on the valuation screen,
       * arriving in the ledger. Posting zero would say the delivery was free;
       * posting nothing says nobody has priced it, which is true.
       */
      const item = await newItem("Unpriced");
      const before = await netOf(inventoryAccountId);
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 50,
          occurredOn: "2026-04-01",
        }),
      );
      expect(await netOf(inventoryAccountId)).toBe(before);
    });

    it("POSTS NOTHING for a transfer", async () => {
      /**
       * `Dr 1300 / Cr 1300` is a row that says nothing and balances. ADR 0012
       * §A.3 — transfers, splits and merges move cost WITHIN one account.
       */
      const item = await newItem("Moved feed");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 20,
          costCents: 2_000,
          occurredOn: "2026-04-10",
        }),
      );
      const before = await netOf(inventoryAccountId);
      const entriesBefore = await asOwner((tx) =>
        tx
          .select()
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.tenantId, tenantId)),
      );
      // A REAL transfer, to a real place. The first version of this test passed
      // `null` for both locations, which `transferStock` refuses as SAME_PLACE —
      // so it asserted that nothing changed after an operation that never ran.
      // No catch here: if the transfer breaks, this test must fail.
      const moved = await asOwner((tx) =>
        transferStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 5,
          occurredOn: "2026-04-11",
          fromLocationAssetId: null,
          toLocationAssetId: freezerId,
        }),
      );
      expect(moved.out.quantity).toBe(-5);
      expect(moved.in.quantity).toBe(5);
      expect(await netOf(inventoryAccountId)).toBe(before);
      const entriesAfter = await asOwner((tx) =>
        tx
          .select()
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.tenantId, tenantId)),
      );
      expect(entriesAfter.length).toBe(entriesBefore.length);
    });

    it("posts a shrinkage adjustment against the variance account", async () => {
      const item = await newItem("Spoiled feed");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 100,
          costCents: 20_000,
          occurredOn: "2026-05-01",
        }),
      );
      const before = await netOf(cogsAccountId);
      await asOwner((tx) =>
        adjustStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: -10,
          reason: "spoilage",
          occurredOn: "2026-05-10",
        }),
      );
      // Variance defaults to the COGS account. 10 lb at $2.00.
      expect((await netOf(cogsAccountId)) - before).toBe(2_000);
    });

    it("LETS A STAFF MEMBER CAUSE A POSTING, per ADR 0011", async () => {
      /**
       * Feeding animals is a chore, and a till at a stall is worked by whoever
       * is standing at it. If the ledger refused here, the movement would be
       * recorded and its journal line refused — a half-written transaction.
       */
      const item = await newItem("Staff issued");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 1_000,
          occurredOn: "2026-06-01",
        }),
      );
      const before = await netOf(cogsAccountId);
      await withTenant(
        tenantId,
        (tx) =>
          issueStock(tx, staffCtx(), {
            itemId: item.id,
            quantity: 5,
            occurredOn: "2026-06-02",
          }),
        { role: "staff", userId: STAFF },
      );
      expect((await netOf(cogsAccountId)) - before).toBe(500);
    });

    it("IS IDEMPOTENT — one movement is one entry, forever", async () => {
      const item = await newItem("Replayed");
      const { movement } = await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 5_000,
          occurredOn: "2026-07-01",
        }),
      );
      const entries = await asOwner((tx) =>
        tx
          .select()
          .from(schema.journalEntries)
          .where(
            and(
              eq(schema.journalEntries.tenantId, tenantId),
              eq(schema.journalEntries.sourceId, movement.id),
            ),
          ),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].source).toBe("inventory_receipt");
      expect(entries[0].idempotencyKey).toBe(`inventory:inventory_receipt:${movement.id}`);
    });
  });

// ---- two companies ------------------------------------------------------

  describe("a tenant that keeps two sets of books", () => {
    /**
     * **THE DEFECT THIS BLOCK EXISTS FOR.** `postMovement` used to post to the
     * tenant's DEFAULT company, because a movement carries no entity — while the
     * bill clearing it posts to the bill's own. In a two-company tenant neither
     * GRNI ever netted: one company kept a permanent credit the reconciliation
     * called settled, the other a permanent debit, and the stock sat on the
     * wrong balance sheet. Only a consolidated view hid it.
     *
     * Every other test in this file runs single-company, so every one of them
     * passed while this was broken.
     */
    let secondEntityId: string;
    let barnId: string;
    let unownedId: string;

    beforeAll(async () => {
      await setTreatment("capitalise");
      secondEntityId = await withSystem(async (tx) => {
        const rows = await tx
          .insert(schema.entities)
          .values({ tenantId, name: "Oak Row LLC" })
          .returning();
        return rows[0].id;
      });
      barnId = await withSystem(async (tx) => {
        const rows = await tx
          .insert(schema.assets)
          .values({
            tenantId,
            kind: "building",
            name: "Oak Row barn",
            isStorageLocation: true,
            entityId: secondEntityId,
          })
          .returning();
        return rows[0].id;
      });
      // Created AFTER provisioning, so nothing adopted it into a company. The
      // fixture freezer is not this: `provisionAccounting` adopts the assets
      // that already exist, so it DOES name a company and resolving it is not
      // ambiguous at all.
      unownedId = await withSystem(async (tx) => {
        const rows = await tx
          .insert(schema.assets)
          .values({
            tenantId,
            kind: "equipment",
            name: "Unclaimed shed",
            isStorageLocation: true,
          })
          .returning();
        return rows[0].id;
      });
    });

    it("POSTS TO THE COMPANY THE PLACE BELONGS TO, not the default", async () => {
      const item = await newItem("Oak Row feed");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 5_000,
          occurredOn: "2027-01-05",
          locationAssetId: barnId,
        }),
      );
      const entries = await asOwner((tx) =>
        tx
          .select()
          .from(schema.journalEntries)
          .where(
            and(
              eq(schema.journalEntries.tenantId, tenantId),
              eq(schema.journalEntries.source, "inventory_receipt"),
              eq(schema.journalEntries.entityId, secondEntityId),
            ),
          ),
      );
      expect(entries.length).toBeGreaterThan(0);
    });

    it("REFUSES rather than guessing when the stock is nowhere in particular", async () => {
      /**
       * The rule `assets` already settled: *"a default chosen at posting time is
       * exactly the behaviour this column replaced"*. With two companies and no
       * location, there is no honest answer — so it refuses instead of
       * capitalising into whichever company happens to be first.
       */
      const item = await newItem("Homeless stock");
      await expect(
        asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: item.id,
            quantity: 10,
            costCents: 5_000,
            occurredOn: "2027-01-06",
          }),
        ),
      ).rejects.toMatchObject({ code: "ENTITY_AMBIGUOUS" });
    });

    it("refuses a place that does not say which company it belongs to", async () => {
      const item = await newItem("Nameless place");
      await expect(
        asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: item.id,
            quantity: 10,
            costCents: 5_000,
            occurredOn: "2027-01-07",
            locationAssetId: unownedId,
          }),
        ),
      ).rejects.toMatchObject({ code: "ENTITY_AMBIGUOUS" });
    });

    it("WILL NOT LET ONE COMPANY'S BILL SETTLE ANOTHER'S DELIVERY", async () => {
      const item = await newItem("Cross company");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 4_000,
          occurredOn: "2027-01-10",
          locationAssetId: barnId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      expect(open).toHaveLength(1);
      // makeBill draws on the DEFAULT company; the delivery is Oak Row's.
      const { billLineId } = await makeBill(4_000);
      await expect(
        asOwner((tx) =>
          allocateBillLineToStock(tx, ownerCtx(), {
            billLineId,
            matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
          }),
        ),
      ).rejects.toMatchObject({ code: "ENTITY_MISMATCH" });
    });

    afterAll(async () => {
      /**
       * DEACTIVATED, not deleted: entries have posted to it and the FK holds.
       * `resolveMovementEntity` filters on `is_active`, so this genuinely
       * returns the tenant to one set of books for everything after — and a
       * failed cleanup here is what made a dozen later tests report
       * ENTITY_AMBIGUOUS the first time round.
       */
      await withSystem((tx) =>
        tx
          .update(schema.entities)
          .set({ isActive: false })
          .where(eq(schema.entities.id, secondEntityId)),
      );
    });
  });

  // ---- matching a bill ----------------------------------------------------

  describe("matching a bill to stock", () => {
    beforeAll(() => setTreatment("capitalise"));

it("CLEARS GRNI TO ZERO when the bill is matched and approved", async () => {
      /**
       * The whole loop, end to end. The receipt credits GRNI; matching points
       * the bill line at it; approving debits it. A non-zero balance afterwards
       * is stock received with no invoice, or an invoice for stock that never
       * arrived — both real, both worth seeing, and neither is this case.
       */
      const item = await newItem("Full loop");
      // BEFORE the receipt: the round trip is receipt-credits then
      // bill-debits, so the baseline has to sit outside both halves.
      const grniBefore = await netOf(grniAccountId);
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 6_000,
          occurredOn: "2026-09-01",
        }),
      );
      // The receipt has credited it, and nothing has cleared that yet.
      expect((await netOf(grniAccountId)) - grniBefore).toBe(-6_000);

      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      expect(open).toHaveLength(1);
      const { billId, billLineId } = await makeBill(6_000);

      const result = await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
        }),
      );
      expect(result.allocations).toBe(1);
      expect(result.varianceCents).toBe(0);

      // Read the version rather than assume it: approveBill is compare-and-swap,
      // and a hardcoded 0 is a test that breaks the day a default changes.
      await asOwner(async (tx) => {
        const bill = await tx.query.bills.findFirst({
          where: eq(schema.bills.id, billId),
          columns: { version: true },
        });
        return approveBill(tx, ledgerOwner(), {
          billId,
          expectedVersion: bill!.version,
        });
      });

      // The receipt credited 6,000; the bill debited it back.
      expect((await netOf(grniAccountId)) - grniBefore).toBe(0);
    });

    it("reports the variance when the invoice disagrees with the ticket", async () => {
      // Ticket said $60, invoice says $65. The $5 is a fact, not a rounding.
      const item = await newItem("Priced up");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 6_000,
          occurredOn: "2026-09-10",
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billId, billLineId } = await makeBill(6_500);
      const result = await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
        }),
      );
      expect(result.varianceCents).toBe(500);

      // ...and GRNI must still clear. The receipt credited 6,000; the bill
      // debits its own 6,500. If the extra 500 has nowhere to go it parks in
      // GRNI forever, and the account stops meaning "received not invoiced".
      const grniBefore = await netOf(grniAccountId);
      await asOwner(async (tx) => {
        const bill = await tx.query.bills.findFirst({
          where: eq(schema.bills.id, billId),
          columns: { version: true },
        });
        return approveBill(tx, ledgerOwner(), {
          billId,
          expectedVersion: bill!.version,
        });
      });
      // The line was split: GRNI takes exactly what the receipt credited, and
      // the extra 500 went to the variance account instead of parking here.
      expect((await netOf(grniAccountId)) - grniBefore).toBe(6_000);
    });

    it("SPLITS ONE INVOICE ACROSS TWO DELIVERIES by what each was worth", async () => {
      /**
       * The case an item-level link could never have handled, and the reason
       * ADR 0012 has an allocation table at all. Two deliveries of the same feed
       * at different prices, one invoice: each carries its share in proportion
       * to what it cost, and the parts sum to the invoice exactly.
       */
      const item = await newItem("Two deliveries");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 3_000,
          occurredOn: "2026-10-01",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 6_000,
          occurredOn: "2026-10-02",
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      expect(open).toHaveLength(2);

      const { billLineId } = await makeBill(9_001);
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          matches: open.map((r) => ({
            movementId: r.movementId,
            quantityMatched: r.quantity,
          })),
        }),
      );
      const rows = await asOwner((tx) =>
        tx
          .select()
          .from(schema.billLineStockAllocations)
          .where(eq(schema.billLineStockAllocations.billLineId, billLineId)),
      );
      expect(rows).toHaveLength(2);
      // 1:2 by cost, and the odd cent lands on the larger remainder rather than
      // going missing.
      expect(rows.reduce((sum, r) => sum + r.invoiceCostCents, 0)).toBe(9_001);
    });

it("KEEPS A SHORT DELIVERY IN GRNI INSTEAD OF EXPENSING IT", async () => {
      /**
       * The gap between an invoice and the tickets had two meanings and was
       * always booked as one. Charged for ten bags, six arrived: the missing
       * four are not a cost, they are stock the business has paid for and does
       * not have. Expensing them cleared GRNI to zero, so the reconciliation
       * showed nothing outstanding and nobody chased the supplier.
       */
      const item = await newItem("Short delivered");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 6,
          costCents: 6_000,
          occurredOn: "2027-03-01",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      // The vendor invoiced for ten at the same rate.
      const { billId, billLineId } = await makeBill(10_000);
      const result = await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          invoiceQuantity: 10,
          matches: [{ movementId: open[0].movementId, quantityMatched: 6 }],
        }),
      );
      // Four bags at $10 that never turned up — NOT a price difference.
      expect(result.shortfallCents).toBe(4_000);
      expect(result.varianceCents).toBe(0);

      const grniBefore = await netOf(grniAccountId);
      await asOwner(async (tx) => {
        const b = await tx.query.bills.findFirst({
          where: eq(schema.bills.id, billId),
          columns: { version: true },
        });
        return approveBill(tx, ledgerOwner(), {
          billId,
          expectedVersion: b!.version,
        });
      });
      // The whole invoice hits GRNI, so the 4,000 stays there as a debit for
      // somebody to chase rather than quietly becoming cost of goods.
      expect((await netOf(grniAccountId)) - grniBefore).toBe(10_000);
    });

    it("still calls a genuine rate difference a variance", async () => {
      // Same quantity, higher rate: a real cost, and it belongs on the P&L.
      const item = await newItem("Dearer than quoted");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 6_000,
          occurredOn: "2027-03-10",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billLineId } = await makeBill(6_500);
      const result = await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          invoiceQuantity: 10,
          matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
        }),
      );
      expect(result.varianceCents).toBe(500);
      expect(result.shortfallCents).toBe(0);
    });

    it("KEEPS THE BILL'S TOTAL when part of a line is not stock", async () => {
      /**
       * "$60 feed + $10 delivery" on one line. The freight is not matched to
       * anything, and the fix is that it stays on the bill as an expense line
       * rather than the line being shrunk to the matched amount — which would
       * have taken $10 off what the vendor is owed.
       */
      const item = await newItem("With freight");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 6_000,
          occurredOn: "2027-03-20",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billId, billLineId } = await makeBill(7_000);
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          invoiceQuantity: 10,
          matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
        }),
      );
      const lines = await asOwner((tx) =>
        tx.select().from(schema.billLines).where(eq(schema.billLines.billId, billId)),
      );
      // Still $70 to the vendor: $60 against GRNI, $10 left as an expense.
      expect(lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(7_000);
    });

    it("REFUSES to match more than a delivery has left", async () => {
      const item = await newItem("Over-matched");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 1_000,
          occurredOn: "2026-11-01",
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billLineId } = await makeBill(1_000);
      await expect(
        asOwner((tx) =>
          allocateBillLineToStock(tx, ownerCtx(), {
            billLineId,
            matches: [{ movementId: open[0].movementId, quantityMatched: 11 }],
          }),
        ),
      ).rejects.toMatchObject({ code: "INSUFFICIENT" });
    });

    it("refuses a staff member — matching a bill is a DECISION", async () => {
      const item = await newItem("Staff match");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 4,
          costCents: 400,
          occurredOn: "2026-11-05",
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billLineId } = await makeBill(400);
      await expect(
        withTenant(
          tenantId,
          (tx) =>
            allocateBillLineToStock(tx, staffCtx(), {
              billLineId,
              matches: [{ movementId: open[0].movementId, quantityMatched: 4 }],
            }),
          { role: "staff", userId: STAFF },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

it("A MADE THING CREDITS CONSUMPTION, NOT GRNI", async () => {
      /**
       * The worst defect this slice had, and two independent reviewers found it
       * separately. A production run lands its outputs through `receiveStock`,
       * so every completed run used to mint a payable no supplier would ever
       * invoice — and because the run's inputs had already been charged to
       * consumption on the way in, the same pot of cost hit the P&L twice.
       *
       * A transformation does not change what the business owes anybody. Inputs
       * debit consumption on the way in, the output credits the same account on
       * the way out, and the run nets to nothing on the P&L.
       */
      const item = await newItem("Made here");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "RUN-1",
          source: "produced",
        }),
      );
      const grniBefore = await netOf(grniAccountId);
      const cogsBefore = await netOf(cogsAccountId);

      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 100,
          costCents: 20_000,
          occurredOn: "2026-12-01",
        }),
      );

      // No phantom payable...
      expect(await netOf(grniAccountId)).toBe(grniBefore);
      // ...and the cost comes back OUT of consumption, where the inputs put it.
      expect((await netOf(cogsAccountId)) - cogsBefore).toBe(-20_000);
      expect(await netOf(inventoryAccountId)).toBeGreaterThan(0);
    });

    it("POSTS FOR A COSTED MOVEMENT WRITTEN STRAIGHT THROUGH recordMovement", async () => {
      /**
       * `livestock`'s `removeHead` does exactly this when a pen is processed:
       * a negative quantity carrying the pen's cost. Posting used to hang off
       * three named ops, so that cost left the lot and never left `1300`, and
       * the meat it became was capitalised on top of it.
       */
      const item = await newItem("Straight through");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 50,
          costCents: 10_000,
          occurredOn: "2026-12-05",
        }),
      );
      const invBefore = await netOf(inventoryAccountId);
      await asOwner((tx) =>
        recordMovement(tx, ownerCtx(), {
          itemId: item.id,
          quantity: -20,
          movementKind: "processed",
          occurredOn: "2026-12-06",
          costCents: 4_000,
        }),
      );
      expect((await netOf(inventoryAccountId)) - invBefore).toBe(-4_000);
    });

    it("REFUSES TO MATCH A BILL THAT IS ALREADY APPROVED", async () => {
      /**
       * Matching rewrites the line's account and amount, and `approveBill`
       * builds its entry FROM those lines — so matching afterwards changes what
       * the bill says without changing what was posted, and the delivery ends
       * up both expensed and capitalised.
       */
      const item = await newItem("Late match");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 1_000,
          occurredOn: "2026-12-10",
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billId, billLineId } = await makeBill(1_000);
      await asOwner(async (tx) => {
        const b = await tx.query.bills.findFirst({
          where: eq(schema.bills.id, billId),
          columns: { version: true },
        });
        // Approve it BEFORE matching, which is the bill-first ordering.
        return approveBill(tx, ledgerOwner(), {
          billId,
          expectedVersion: b!.version,
        });
      });
      await expect(
        asOwner((tx) =>
          allocateBillLineToStock(tx, ownerCtx(), {
            billLineId,
            matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
          }),
        ),
      ).rejects.toMatchObject({ code: "BILL_POSTED" });
    });

    it("IS IDEMPOTENT — matching twice does not add a second variance line", async () => {
      /**
       * The allocation was conflict-protected and the variance line was not, so
       * a double-click appended a second one and inflated both AP and the
       * expense with no error anywhere.
       */
      const item = await newItem("Double matched");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 1_000,
          occurredOn: "2026-12-15",
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billId, billLineId } = await makeBill(1_200);
      const match = {
        billLineId,
        matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
      };
      await asOwner((tx) => allocateBillLineToStock(tx, ownerCtx(), match));
      await asOwner((tx) => allocateBillLineToStock(tx, ownerCtx(), match));

      const lines = await asOwner((tx) =>
        tx.select().from(schema.billLines).where(eq(schema.billLines.billId, billId)),
      );
      // One matched line and exactly ONE variance line.
      expect(lines).toHaveLength(2);
      expect(lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(1_200);
    });

    it("ACCUMULATES across two matches on one line rather than overwriting", async () => {
      /**
       * One invoice covering two deliveries, matched one at a time — which the
       * per-pair unique index explicitly anticipates. The line used to be
       * overwritten with the second call's total, stranding the first
       * delivery's GRNI credit forever.
       */
      const item = await newItem("Two calls");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 3_000,
          occurredOn: "2026-12-20",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 6_000,
          occurredOn: "2026-12-21",
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billId, billLineId } = await makeBill(9_000);
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
        }),
      );
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          matches: [{ movementId: open[1].movementId, quantityMatched: 10 }],
        }),
      );
      const line = await asOwner((tx) =>
        tx.query.billLines.findFirst({ where: eq(schema.billLines.id, billLineId) }),
      );
      // BOTH deliveries, not just the last one.
      expect(line!.amountCents).toBe(9_000);
      void billId;
    });

    it("WILL NOT MATCH A DELIVERY ENTERED AT ZERO", async () => {
      /**
       * A receipt entered at 0 credited nothing to GRNI, so there is nothing to
       * clear against it. Listing it let a whole invoice land in the variance
       * account as a "price difference" while inventory never moved.
       */
      const item = await newItem("Free delivery");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 0,
          occurredOn: "2026-12-28",
        }),
      );
      expect(
        await asOwner((tx) => unbilledReceipts(tx, tenantId, { itemId: item.id })),
      ).toHaveLength(0);
    });

it("UNPICKS A MATCH AND PUTS THE BILL BACK AS IT WAS", async () => {
      /**
       * Somebody will match the wrong delivery, and until this existed the only
       * way out was SQL. Undoing has to do three things together: release the
       * deliveries, fold the variance sibling's amount back into the line so the
       * vendor is still owed what they invoiced, and clear the GRNI coding so
       * the line is UNCODED again — which is the honest state, because the
       * alternative is guessing an expense account on the way out.
       */
      const item = await newItem("Mis-matched");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 6_000,
          occurredOn: "2027-04-01",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billId, billLineId } = await makeBill(6_500);
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          invoiceQuantity: 10,
          matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
        }),
      );
      // Matched: the delivery is off the list and the bill is two lines.
      expect(
        await asOwner((tx) => unbilledReceipts(tx, tenantId, { itemId: item.id })),
      ).toHaveLength(0);

      const result = await asOwner((tx) =>
        unmatchBillLine(tx, ownerCtx(), { billLineId }),
      );
      expect(result.released).toBe(1);

      // The delivery is back on the reconciliation...
      const reopened = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      expect(reopened).toHaveLength(1);
      expect(reopened[0].openQuantity).toBe(10);

      // ...the bill is one line again, still for what the vendor invoiced...
      const lines = await asOwner((tx) =>
        tx.select().from(schema.billLines).where(eq(schema.billLines.billId, billId)),
      );
      expect(lines).toHaveLength(1);
      expect(lines[0].amountCents).toBe(6_500);
      // ...and UNCODED, so approving it refuses until somebody says what it was.
      expect(lines[0].accountId).toBeNull();
    });

    it("refuses to unpick a bill that has already been approved", async () => {
      const item = await newItem("Approved then unpicked");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 5,
          costCents: 500,
          occurredOn: "2027-04-10",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billId, billLineId } = await makeBill(500);
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          invoiceQuantity: 5,
          matches: [{ movementId: open[0].movementId, quantityMatched: 5 }],
        }),
      );
      await asOwner(async (tx) => {
        const b = await tx.query.bills.findFirst({
          where: eq(schema.bills.id, billId),
          columns: { version: true },
        });
        return approveBill(tx, ledgerOwner(), {
          billId,
          expectedVersion: b!.version,
        });
      });
      await expect(
        asOwner((tx) => unmatchBillLine(tx, ownerCtx(), { billLineId })),
      ).rejects.toMatchObject({ code: "BILL_POSTED" });
    });

    it("refuses a staff member, the same as matching does", async () => {
      const item = await newItem("Staff unpick");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 5,
          costCents: 500,
          occurredOn: "2027-04-20",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billLineId } = await makeBill(500);
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          invoiceQuantity: 5,
          matches: [{ movementId: open[0].movementId, quantityMatched: 5 }],
        }),
      );
      await expect(
        withTenant(
          tenantId,
          (tx) => unmatchBillLine(tx, staffCtx(), { billLineId }),
          { role: "staff", userId: STAFF },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

it("REFUSES TO MATCH WHILE POSTING IS OFF", async () => {
      /**
       * Found by opening the screen on a farm that had just switched accounting
       * on. With posting off a receipt credits NOTHING to GRNI — but matching
       * still re-coded the bill line to it, and approving then posted `Dr 2050`
       * against a credit that was never made, leaving a debit in Goods Received
       * Not Invoiced that no delivery explains and nothing can ever clear.
       *
       * Only `postMovement` checked the treatment; matching did not.
       */
      await setTreatment("capitalise");
      const item = await newItem("Posted then off");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 5,
          costCents: 500,
          occurredOn: "2027-05-01",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billLineId } = await makeBill(500);

      await setTreatment("none");
      await expect(
        asOwner((tx) =>
          allocateBillLineToStock(tx, ownerCtx(), {
            billLineId,
            invoiceQuantity: 5,
            matches: [{ movementId: open[0].movementId, quantityMatched: 5 }],
          }),
        ),
      ).rejects.toMatchObject({ code: "POSTING_OFF" });
      await setTreatment("capitalise");
    });

    it("REPORTS GRNI FROM BOTH ENDS, and the gap between them", async () => {
      /**
       * The card used to show only the deliveries — the WORKING — and call it
       * what the account "should be holding". On a farm that had just switched
       * posting on it announced $700 about an account holding nothing, because
       * every one of those deliveries predated the switch and switching on does
       * not backfill.
       *
       * Reporting one number and calling it both is the failure this pack keeps
       * writing tests against, and the doc comment claimed a comparison the code
       * never made.
       */
      await setTreatment("none");
      const item = await newItem("Before the switch");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 7_000,
          occurredOn: "2027-06-01",
          locationAssetId: freezerId,
        }),
      );
      await setTreatment("capitalise");

      const position = await asOwner((tx) => grniPosition(tx, tenantId));
      // The delivery is waiting for an invoice...
      expect(position.awaitingInvoiceCents).toBeGreaterThanOrEqual(7_000);
      // ...and the difference names what never reached the books.
      expect(position.differenceCents).toBeGreaterThanOrEqual(7_000);
      expect(position.awaitingInvoiceCents - position.accountCents).toBe(
        position.differenceCents,
      );
    });

    it("matches the working to the answer once a delivery posts", async () => {
      // With posting on from the start, the two ends agree for that delivery —
      // which is what makes a difference meaningful when it appears.
      await setTreatment("capitalise");
      const before = await asOwner((tx) => grniPosition(tx, tenantId));
      const item = await newItem("After the switch");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 10,
          costCents: 2_500,
          occurredOn: "2027-06-10",
          locationAssetId: freezerId,
        }),
      );
      const after = await asOwner((tx) => grniPosition(tx, tenantId));
      expect(after.awaitingInvoiceCents - before.awaitingInvoiceCents).toBe(2_500);
      expect(after.accountCents - before.accountCents).toBe(2_500);
      // The gap is unchanged: this delivery contributed to BOTH ends.
      expect(after.differenceCents).toBe(before.differenceCents);
    });

    it("lists only receipts that credited GRNI and still have room", async () => {
      const item = await newItem("Matchable");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 12,
          costCents: 34_000,
          occurredOn: "2026-08-01",
        }),
      );
      // Unpriced: credited nothing, so there is nothing to settle against it.
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 5,
          occurredOn: "2026-08-02",
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      expect(open).toHaveLength(1);
      expect(open[0].openQuantity).toBe(12);
      expect(open[0].openCostCents).toBe(34_000);
    });
  });
});
