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
  issueStock,
  receiveStock,
  transferStock,
  type InventoryCtx,
} from "../src/packs/inventory/ops";
import {
  allocateBillLineToStock,
  inventoryTreatmentOf,
  resolveGrniAccount,
  unbilledReceipts,
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
      expect(entries[0].idempotencyKey).toBe(`inventory:receipt:${movement.id}`);
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
          invoiceCostCents: 6_000,
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
          invoiceCostCents: 6_500,
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
          invoiceCostCents: 9_001,
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
            invoiceCostCents: 1_000,
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
              invoiceCostCents: 400,
              matches: [{ movementId: open[0].movementId, quantityMatched: 4 }],
            }),
          { role: "staff", userId: STAFF },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
