import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  getBalances,
  getDefaultEntityId,
  upsertDimensionMember,
} from "../src/modules/accounting/core";
import {
  approveBill,
  loadBill,
  loadBillLines,
  updateBillDraft,
} from "../src/modules/accounting/payables/bills";
import { recordBillPayment } from "../src/modules/accounting/payables/payments";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  adjustLotCost,
  adjustStock,
  carriedCostByLot,
  clearTaxRule,
  listTaxRules,
  setTaxRule,
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
  assertPostingChangeSafe,
  inventoryTreatmentOf,
  grniPosition,
  postCostAdjustment,
  postedInventoryEntries,
  resolveGrniAccount,
  resolveServicesAccruedAccount,
  postServiceAccrual,
  unbilledReceipts,
  unmatchBillLine,
} from "../src/packs/inventory/ledger-ops";
import { carriedValue } from "../src/packs/inventory/core/valuation";
import { startRun, type ProductionCtx } from "../src/packs/production/ops";
import {
  matchBillLineToRuns,
  openProcessingAccruals,
  unmatchBillLineFromRuns,
} from "../src/packs/production/billing-ops";

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
  let bankLedgerId: string;

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
  /** The same person, in the shape `production` asks for. */
  const prodOwner = (): ProductionCtx => ({ tenantId, userId: OWNER, role: "owner" });

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
          /**
           * **`total_cents` IS A STORED COLUMN and this helper never set it**,
           * which nothing noticed until a test tried to PAY one of these bills
           * and got `BILL_OVERPAYMENT` against a remaining balance of zero.
           * `createBill` maintains it from the lines; this fixture inserts rows
           * directly, so it has to say so itself.
           */
          totalCents: amountCents,
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
      // `vendorId` too: editing the draft through `updateBillDraft` has to
      // send one, and the whole point of those tests is that the edit is
      // ordinary.
      return { billId: bill[0].id, billLineId: line[0].id, vendorId };
    });
  };

  /**
   * Approve-then-pay, so a bill has a payment the cash lens can find.
   *
   * **The paid-from has to be a REGISTER, not just an asset account with the
   * right code.** `assertPaidFromAccount` looks in `bank_accounts`, so the
   * seeded `1000 Checking Account` is refused — a real register is created in
   * `beforeAll` instead. Found by the test failing, which is the cheap way.
   */
  const payBill = async (
    billId: string,
    amountCents: number,
    paymentDate: string,
  ) => {
    return asOwner(async (tx) => {
      const bill = await tx.query.bills.findFirst({
        where: and(eq(schema.bills.tenantId, tenantId), eq(schema.bills.id, billId)),
      });
      return recordBillPayment(tx, ledgerOwner(), {
        billId,
        expectedVersion: bill!.version,
        paymentDate,
        amountCents,
        paidFromAccountId: bankLedgerId,
        method: "bank_transfer",
      });
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

    // A real bank register, because `assertPaidFromAccount` looks in
    // `bank_accounts` rather than at an account's code or type.
    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, ledgerOwner(), {
        name: "Ops Checking",
        kind: "checking",
      }),
    );
    bankLedgerId = bank.ledgerAccount.id;
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

  it("RECORDS A COST CORRECTION WITH POSTING OFF, and posts nothing", async () => {
    /**
     * **COST ACCUMULATION IS ALWAYS ON; POSTING IS THE PART A TENANT CHOOSES.**
     * The design's own split, and it applies to a correction exactly as it does
     * to a receipt: a farm that keeps no books still wants what a batch cost.
     * The row is written, the fold moves, and the ledger is untouched.
     */
    const item = await newItem("Corrected while off");
    const lot = await asOwner((tx) =>
      createLot(tx, ownerCtx(), {
        itemId: item.id,
        code: `CC-off-${Date.now()}`,
        source: "purchased",
      }),
    );
    await asOwner((tx) =>
      receiveStock(tx, ownerCtx(), {
        itemId: item.id,
        lotId: lot.id,
        quantity: 10,
        costCents: 1_000,
        occurredOn: "2026-01-06",
      }),
    );
    const row = await asOwner((tx) =>
      adjustLotCost(tx, ownerCtx(), {
        lotId: lot.id,
        amountCents: 400,
        reason: "freight_omitted",
        occurredOn: "2026-01-07",
      }),
    );
    expect(row.onHandCents).toBe(400);
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.journalEntries)
          .where(
            and(
              eq(schema.journalEntries.tenantId, tenantId),
              eq(schema.journalEntries.sourceId, row.id),
            ),
          ),
      ),
    ).toHaveLength(0);
    expect(await netOf(inventoryAccountId)).toBe(0);
    const carried = await asOwner((tx) =>
      carriedCostByLot(tx, tenantId, [lot.id]),
    );
    expect(carriedValue(carried.get(lot.id)!)).toBe(1_400);
  });

  it("lets posting be turned off while NOTHING has reached the ledger", async () => {
    /**
     * The other side of the guard, and the reason it counts entries rather than
     * refusing outright: somebody who switched it on by mistake five minutes ago
     * has stranded nothing and must not be trapped. `setTreatment` writes the
     * column directly under `withSystem`, which is what lets this reach the
     * `capitalise → none` branch before anything has posted.
     */
    expect((await asOwner((tx) => postedInventoryEntries(tx, tenantId))).entries).toBe(0);
    await setTreatment("capitalise");
    await expect(
      asOwner((tx) => assertPostingChangeSafe(tx, tenantId, "none")),
    ).resolves.toBeUndefined();
    await setTreatment("none");
  });

  it("never blocks turning posting ON", async () => {
    // Additive, and where every tenant starts. The dialog already says history
    // is not backfilled.
    await expect(
      asOwner((tx) => assertPostingChangeSafe(tx, tenantId, "capitalise")),
    ).resolves.toBeUndefined();
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

    /**
     * ── THE PROCESSING ACCRUAL ─────────────────────────────────────────────
     *
     * `production` slice 2c. It lives in this suite rather than the pack's,
     * because the pack's tenant keeps no books and the whole point of this
     * entry is what it does to a set that does.
     */
    describe("a service received and not yet invoiced", () => {
      it("provisions 2060 and resolves it by subtype", async () => {
        const id = await asOwner((tx) =>
          resolveServicesAccruedAccount(tx, tenantId),
        );
        const accounts = await asOwner((tx) =>
          tx
            .select()
            .from(schema.accounts)
            .where(eq(schema.accounts.tenantId, tenantId)),
        );
        expect(accounts.find((a) => a.id === id)?.code).toBe("2060");
      });

      it("IS NOT GRNI, and that was the decision", async () => {
        // A processing fee genuinely is money owed for something received and
        // not invoiced — and `unbilledReceipts` builds the GRNI working from
        // stock RECEIPTS, which an accrued service has none of. A balance in
        // 2050 that its own reconciliation could never explain is exactly the
        // defect `owesASupplier` was extracted to stop.
        const grni = await asOwner((tx) => resolveGrniAccount(tx, tenantId));
        const accrued = await asOwner((tx) =>
          resolveServicesAccruedAccount(tx, tenantId),
        );
        expect(accrued).not.toBe(grni);
      });

      it("DEBITS CONSUMPTION AND CREDITS 2060, which is what makes the receipt honest", async () => {
        /**
         * **THIS ENTRY EXISTS TO MAKE ANOTHER ENTRY HONEST.** A run's outputs
         * credit the consumption account for the whole pot they were costed
         * from, and the plant's share of that pot was never debited there by
         * anything. Without this, completing a run leaves a credit balance in
         * an expense account, self-correcting only if the plant's bill happens
         * to be coded to the same place.
         */
        const accrued = await asOwner((tx) =>
          resolveServicesAccruedAccount(tx, tenantId),
        );
        const cogsBefore = await netOf(cogsAccountId);
        const accruedBefore = await netOf(accrued);

        await asOwner((tx) =>
          postServiceAccrual(tx, ownerCtx(), {
            sourceId: randomUUID(),
            amountCents: 73_000,
            occurredOn: "2026-06-01",
            locationAssetId: freezerId,
            memo: "Processing accrued — KILL-1",
          }),
        );

        expect(await netOf(cogsAccountId)).toBe(cogsBefore + 73_000);
        // Liabilities are credits, so the net goes negative.
        expect(await netOf(accrued)).toBe(accruedBefore - 73_000);
      });

      it("POSTS NOTHING FOR A WAIVED FEE, because there is nothing to accrue", async () => {
        const accrued = await asOwner((tx) =>
          resolveServicesAccruedAccount(tx, tenantId),
        );
        const before = await netOf(accrued);
        const posted = await asOwner((tx) =>
          postServiceAccrual(tx, ownerCtx(), {
            sourceId: randomUUID(),
            amountCents: 0,
            occurredOn: "2026-06-02",
            locationAssetId: freezerId,
            memo: "Nothing charged",
          }),
        );
        expect(posted).toBeNull();
        expect(await netOf(accrued)).toBe(before);
      });

      it("RESOLVES THE COMPANY FROM WHERE THE STOCK WENT when the run names no place", async () => {
        /**
         * **THE DEFECT THIS TEST EXISTS FOR, found on the live `Test` tenant.**
         *
         * `resolveMovementEntity` needs a location to say whose books an entry
         * belongs to once a tenant keeps more than one set. A run started from
         * a booking never sets one — `startRunFromBooking` knows a date and a
         * plant, not a freezer — so the accrual passed null and every
         * completion with a fee refused, with a message about stock having to
         * say where it is on a run whose stock HAD said.
         *
         * This suite is the only place that could have caught it: the pack's
         * own tenant keeps one company, where a null location resolves fine.
         */
        const accrued = await asOwner((tx) =>
          resolveServicesAccruedAccount(tx, tenantId),
        );
        const before = await netOf(accrued);
        await asOwner((tx) =>
          postServiceAccrual(tx, ownerCtx(), {
            sourceId: randomUUID(),
            amountCents: 23_500,
            occurredOn: "2026-06-04",
            // What the run carried: nothing. The freezer is what the outputs
            // used, and borrowing it is the same answer the receipts just gave.
            locationAssetId: freezerId,
            memo: "Processing accrued — no place on the run",
          }),
        );
        expect(await netOf(accrued)).toBe(before - 23_500);
      });

      it("is idempotent on the run it names, so a retry cannot accrue twice", async () => {
        // The key is the run, not the moment. Completing a run happens in one
        // transaction, but a retried request that got as far as posting must
        // not double the liability.
        const accrued = await asOwner((tx) =>
          resolveServicesAccruedAccount(tx, tenantId),
        );
        const runId = randomUUID();
        const before = await netOf(accrued);
        for (let i = 0; i < 2; i++) {
          await asOwner((tx) =>
            postServiceAccrual(tx, ownerCtx(), {
              sourceId: runId,
              amountCents: 5_000,
              occurredOn: "2026-06-03",
              locationAssetId: freezerId,
              memo: "Processing accrued — RETRY",
            }),
          );
        }
        expect(await netOf(accrued)).toBe(before - 5_000);
      });
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

    describe("EDITING THE BILL AFTERWARDS", () => {
      /**
       * **THE GRNI DOUBLE-CLEAR.**
       *
       * `updateBillDraft` deleted every line of a draft and re-inserted it, and
       * `bill_line_stock_allocations` cascades off a bill line's id. So saving
       * an edit to a MATCHED bill — a memo, a typo in another line, anything —
       * threw the match away. Every ledger consequence of it stayed: the line
       * came back from the form still coded to `2050` and still carrying the
       * receipts' total, so approving still debited GRNI, while the deliveries
       * were back on the reconciliation to be matched to a second bill and
       * clear the same credit again.
       *
       * `grniPosition` then disagreed with its own account by the full amount
       * and nothing in the ledger explained the gap, which is the one thing
       * that card exists to make impossible.
       */
      const editBill = async (
        billId: string,
        vendorId: string,
        lines: Array<{
          id?: string;
          description: string;
          amountCents: number;
          accountId: string | null;
          dimensionMemberIds?: string[];
        }>,
        memo = "edited",
      ) =>
        asOwner(async (tx) => {
          const bill = await loadBill(tx, tenantId, billId);
          return updateBillDraft(tx, ledgerOwner(), {
            billId,
            expectedVersion: bill.version,
            patch: { vendorId, billDate: bill.billDate, memo, lines },
          });
        });

      it("KEEPS THE MATCH, so GRNI is cleared once and not twice", async () => {
        const item = await newItem("Edited after matching");
        const grniBefore = await netOf(grniAccountId);
        await asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: item.id,
            quantity: 10,
            costCents: 6_000,
            occurredOn: "2026-09-20",
          }),
        );
        const open = await asOwner((tx) =>
          unbilledReceipts(tx, tenantId, { itemId: item.id }),
        );
        const { billId, billLineId, vendorId } = await makeBill(6_000);
        await asOwner((tx) =>
          allocateBillLineToStock(tx, ownerCtx(), {
            billLineId,
            matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
          }),
        );

        // The ordinary edit: read the lines back exactly as the form does and
        // send them again, with a new memo.
        const read = await asOwner((tx) => loadBillLines(tx, tenantId, billId));
        await editBill(
          billId,
          vendorId,
          read.map((l) => ({
            id: l.id,
            description: l.description,
            amountCents: l.amountCents,
            accountId: l.accountId,
          })),
          "invoice arrived by post",
        );

        // The match is still there. This is the whole test.
        expect(
          await asOwner((tx) => unbilledReceipts(tx, tenantId, { itemId: item.id })),
        ).toHaveLength(0);
        expect(
          (await asOwner((tx) => loadBillLines(tx, tenantId, billId)))[0].id,
        ).toBe(billLineId);

        await asOwner(async (tx) => {
          const bill = await loadBill(tx, tenantId, billId);
          return approveBill(tx, ledgerOwner(), {
            billId,
            expectedVersion: bill.version,
          });
        });
        // Credited 6,000 by the receipt, debited 6,000 by the bill. Once.
        expect((await netOf(grniAccountId)) - grniBefore).toBe(0);

        // And there is nothing left to match to a second bill, which is the
        // half that actually doubled the clearing.
        const second = await makeBill(6_000);
        await expect(
          asOwner((tx) =>
            allocateBillLineToStock(tx, ownerCtx(), {
              billLineId: second.billLineId,
              matches: [
                { movementId: open[0].movementId, quantityMatched: 10 },
              ],
            }),
          ),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });

      it("REFUSES TO RE-PRICE a matched line, because the amount is the match's", async () => {
        /**
         * Keeping the row is not enough on its own: a line whose amount no
         * longer equals what the allocations settle debits GRNI for one figure
         * against a credit of another, and the difference sits in the account
         * meaning nothing. The account, the amount and the description are all
         * the match's — the description included, because that is the string
         * `allocateBillLineToStock` finds its variance sibling by.
         */
        const item = await newItem("Re-priced after matching");
        await asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: item.id,
            quantity: 10,
            costCents: 6_000,
            occurredOn: "2026-09-21",
          }),
        );
        const open = await asOwner((tx) =>
          unbilledReceipts(tx, tenantId, { itemId: item.id }),
        );
        const { billId, vendorId } = await makeBill(6_000);
        const firstLine = (
          await asOwner((tx) => loadBillLines(tx, tenantId, billId))
        )[0];
        await asOwner((tx) =>
          allocateBillLineToStock(tx, ownerCtx(), {
            billLineId: firstLine.id,
            matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
          }),
        );
        const read = await asOwner((tx) => loadBillLines(tx, tenantId, billId));

        await expect(
          editBill(billId, vendorId, [
            {
              id: read[0].id,
              description: read[0].description,
              amountCents: 9_000,
              accountId: read[0].accountId,
            },
          ]),
        ).rejects.toMatchObject({ code: "ACCOUNT_NOT_CODABLE" });

        // ...but a TAG on that line is not the match's business, and goes on.
        const member = await asOwner((tx) =>
          upsertDimensionMember(tx, ledgerOwner(), {
            dimensionType: "enterprise",
            packEntityId: randomUUID(),
            displayName: "Broilers (edit test)",
          }),
        );
        await editBill(billId, vendorId, [
          {
            id: read[0].id,
            description: read[0].description,
            amountCents: read[0].amountCents,
            accountId: read[0].accountId,
            dimensionMemberIds: [member.id],
          },
        ]);
        const tagged = await asOwner((tx) => loadBillLines(tx, tenantId, billId));
        expect(tagged[0].dimensionMemberIds).toEqual([member.id]);
        expect(
          await asOwner((tx) => unbilledReceipts(tx, tenantId, { itemId: item.id })),
        ).toHaveLength(0);
      });

      it("PUTS THE DELIVERY BACK when the matched line is deleted", async () => {
        /**
         * The cascade is right when the line genuinely goes: no line, no GRNI
         * debit, so the delivery is honestly un-invoiced again. It was only
         * ever wrong as a side effect of an edit.
         */
        const item = await newItem("Line deleted after matching");
        await asOwner((tx) =>
          receiveStock(tx, ownerCtx(), {
            itemId: item.id,
            quantity: 10,
            costCents: 6_000,
            occurredOn: "2026-09-22",
          }),
        );
        const open = await asOwner((tx) =>
          unbilledReceipts(tx, tenantId, { itemId: item.id }),
        );
        const { billId, billLineId, vendorId } = await makeBill(6_000);
        await asOwner((tx) =>
          allocateBillLineToStock(tx, ownerCtx(), {
            billLineId,
            matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
          }),
        );

        await editBill(billId, vendorId, [
          {
            description: "Something else entirely",
            amountCents: 6_000,
            accountId: cogsAccountId,
          },
        ]);

        const back = await asOwner((tx) =>
          unbilledReceipts(tx, tenantId, { itemId: item.id }),
        );
        expect(back).toHaveLength(1);
        expect(back[0].openCostCents).toBe(6_000);
      });
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

    it("GIVES THE VARIANCE LINE THE TAG OF THE LINE IT VARIES FROM", async () => {
      /**
       * **A ROW A PERSON CAN NOW TAG, AND WHOSE TAG WOULD BE EATEN.** The
       * matcher REPLACES this sibling on every re-match — deliberately, so a
       * double submit cannot append two — so a tag set on it by hand would
       * disappear the next time another delivery joined the bill. And it is a
       * real P&L line: `varianceAccountId` defaults to the consumption account,
       * so losing the tag moves money out of an enterprise column into
       * Unassigned.
       *
       * Inheriting the matched line's is both the right answer — a delivery
       * that cost more than the ticket said is that line of business's cost —
       * and the only durable one. Same rule `splitLot` had to learn.
       */
      const member = await asOwner((tx) =>
        upsertDimensionMember(tx, ledgerOwner(), {
          dimensionType: "enterprise",
          packEntityId: randomUUID(),
          displayName: "Broilers",
        }),
      );
      const item = await newItem("Variance tag");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `VART-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 10,
          costCents: 6_000,
          occurredOn: "2026-10-01",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      const { billId, billLineId } = await makeBill(6_500);
      // Tag the matched line, the way the builder now lets somebody do.
      await asOwner((tx) =>
        tx.insert(schema.lineDimensions).values({
          tenantId,
          billLineId,
          dimensionType: "enterprise",
          memberId: member.id,
        }),
      );

      const result = await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
        }),
      );
      expect(result.varianceCents).toBe(500);

      const lines = await asOwner((tx) => loadBillLines(tx, tenantId, billId));
      const variance = lines.find((l) => /difference/i.test(l.description))!;
      expect(variance).toBeDefined();
      expect(variance.dimensionMemberIds).toEqual([member.id]);

      // AND IT SURVIVES A RE-MATCH, which is the case that made this necessary:
      // the sibling is deleted and rebuilt, so an inherited tag is re-derived
      // while a hand-set one would be gone.
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          matches: [{ movementId: open[0].movementId, quantityMatched: 10 }],
        }),
      );
      const after = await asOwner((tx) => loadBillLines(tx, tenantId, billId));
      const variance2 = after.find((l) => /difference/i.test(l.description))!;
      expect(variance2.dimensionMemberIds).toEqual([member.id]);
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
      // DIFFERENTIAL, not absolute: this file shares one tenant and every test
      // before this one has left something in both figures. What matters is
      // what THIS delivery does to them.
      await setTreatment("capitalise");
      const before = await asOwner((tx) => grniPosition(tx, tenantId));

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

      const after = await asOwner((tx) => grniPosition(tx, tenantId));
      // It is waiting for an invoice...
      expect(after.awaitingInvoiceCents - before.awaitingInvoiceCents).toBe(7_000);
      // ...but it never reached the books, so only one end moved...
      expect(after.accountCents).toBe(before.accountCents);
      // ...and the gap grew by exactly what did not post.
      expect(after.differenceCents - before.differenceCents).toBe(7_000);
      expect(after.awaitingInvoiceCents - after.accountCents).toBe(
        after.differenceCents,
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

it("NOBODY INVOICES YOU FOR WHAT YOU MADE", async () => {
      /**
       * Found on the live app. A kill day's output was sitting in "deliveries
       * with no invoice yet" beside a lumber bill — inviting somebody to match
       * the two.
       *
       * A produced lot credits the CONSUMPTION account, not GRNI, so there is
       * nothing against it for a bill to clear. `postMovement` already knew
       * that; `unbilledReceipts` did not, and the two now share one predicate so
       * they cannot drift again.
       */
      await setTreatment("capitalise");
      const item = await newItem("Kill day output");
      const made = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "KILL-1",
          source: "produced",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: made.id,
          quantity: 100,
          costCents: 9_000,
          occurredOn: "2027-07-01",
          locationAssetId: freezerId,
        }),
      );
      expect(
        await asOwner((tx) => unbilledReceipts(tx, tenantId, { itemId: item.id })),
      ).toHaveLength(0);
    });

    it("still lists what a supplier DID sell you", async () => {
      // The filter must not swallow the ordinary case it sits next to.
      const item = await newItem("Bought in");
      const bought = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "DELIVERY-1",
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: bought.id,
          quantity: 50,
          costCents: 4_000,
          occurredOn: "2027-07-05",
          locationAssetId: freezerId,
        }),
      );
      const open = await asOwner((tx) =>
        unbilledReceipts(tx, tenantId, { itemId: item.id }),
      );
      expect(open).toHaveLength(1);
      expect(open[0].openCostCents).toBe(4_000);
    });

    it("treats stock with no batch as bought, the same as posting does", async () => {
      // A receipt with no lot is almost always a delivery, and `postMovement`
      // credits GRNI for it — so the list has to agree or the two ends diverge.
      const item = await newItem("No batch bought");
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          quantity: 20,
          costCents: 1_500,
          occurredOn: "2027-07-10",
          locationAssetId: freezerId,
        }),
      );
      expect(
        await asOwner((tx) => unbilledReceipts(tx, tenantId, { itemId: item.id })),
      ).toHaveLength(1);
    });

    it("keeps the GRNI working and answer able to agree", async () => {
      /**
       * The knock-on. With made goods in the working, the two ends could never
       * meet and the difference would be permanently overstated — and blamed on
       * "deliveries from before the switch", which is the one explanation the
       * card offers.
       */
      const before = await asOwner((tx) => grniPosition(tx, tenantId));
      const item = await newItem("Made, not bought");
      const made = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: "KILL-2",
          source: "produced",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: made.id,
          quantity: 10,
          costCents: 5_000,
          occurredOn: "2027-07-20",
          locationAssetId: freezerId,
        }),
      );
      const after = await asOwner((tx) => grniPosition(tx, tenantId));
      // It changed neither end, so the gap between them is untouched.
      expect(after.awaitingInvoiceCents).toBe(before.awaitingInvoiceCents);
      expect(after.accountCents).toBe(before.accountCents);
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

    // ---- slice 3d: correcting what a batch cost -------------------------

    /**
     * **THE INVARIANT, RESTATED FOR CORRECTIONS.** ADR 0012:
     *
     *     original stamped cost + appended corrections − cost issued out
     *       = the batch's carrying value  (== core/valuation.ts carriedValue)
     *
     * Every test below measures the ledger and `carriedCostByLot` and expects
     * them to move together. Differentially, because this file shares one
     * tenant: an absolute assertion about `1300` here is a claim about every
     * test above it as much as about itself.
     */
    const carriedOf = async (lotId: string) => {
      const map = await asOwner((tx) => carriedCostByLot(tx, tenantId, [lotId]));
      const cost = map.get(lotId)!;
      return { cost, value: carriedValue(cost) };
    };

    it("A CORRECTION RAISES WHAT THE BATCH IS CARRIED AT", async () => {
      const item = await newItem("Corrected feed");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-up-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 100,
          costCents: 34_000,
          occurredOn: "2026-10-01",
          locationAssetId: freezerId,
        }),
      );
      const inventoryBefore = await netOf(inventoryAccountId);
      const cogsBefore = await netOf(cogsAccountId);

      const row = await asOwner((tx) =>
        adjustLotCost(tx, ownerCtx(), {
          lotId: lot.id,
          amountCents: 6_000,
          reason: "freight_omitted",
          occurredOn: "2026-10-05",
        }),
      );

      // Nothing has left the batch, so the whole correction stays with it.
      expect(row.onHandCents).toBe(6_000);
      expect(row.issuedCents).toBe(0);
      expect((await netOf(inventoryAccountId)) - inventoryBefore).toBe(6_000);
      // The credit is the variance account, which DEFAULTS to consumption.
      expect((await netOf(cogsAccountId)) - cogsBefore).toBe(-6_000);
      expect((await carriedOf(lot.id)).value).toBe(40_000);
    });

    it("does NOT credit GRNI, because matching could never clear it", async () => {
      /**
       * The one decision in this posting that had a plausible alternative, and
       * the reason it was refused. Matching clears GRNI at the RECEIPT's
       * stamped cost, which a correction does not change — so a credit put here
       * is one nothing can ever debit, and it would show up on the
       * reconciliation card blamed on "deliveries from before the switch".
       */
      const item = await newItem("Grni untouched");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-grni-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 10,
          costCents: 1_000,
          occurredOn: "2026-10-10",
          locationAssetId: freezerId,
        }),
      );
      const before = await asOwner((tx) => grniPosition(tx, tenantId));
      await asOwner((tx) =>
        adjustLotCost(tx, ownerCtx(), {
          lotId: lot.id,
          amountCents: 250,
          reason: "ticket_wrong",
          occurredOn: "2026-10-11",
        }),
      );
      const after = await asOwner((tx) => grniPosition(tx, tenantId));
      // Both ends of the reconciliation are where they were, so the gap is too.
      expect(after.accountCents).toBe(before.accountCents);
      expect(after.awaitingInvoiceCents).toBe(before.awaitingInvoiceCents);
      expect(after.differenceCents).toBe(before.differenceCents);
    });

    it("SPLITS BY WHAT HAS ALREADY BEEN ISSUED, and stores the split", async () => {
      const item = await newItem("Half eaten");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-split-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 100,
          costCents: 10_000,
          occurredOn: "2026-11-01",
          locationAssetId: freezerId,
        }),
      );
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 40,
          occurredOn: "2026-11-02",
          locationAssetId: freezerId,
        }),
      );
      const inventoryBefore = await netOf(inventoryAccountId);
      const cogsBefore = await netOf(cogsAccountId);

      const row = await asOwner((tx) =>
        adjustLotCost(tx, ownerCtx(), {
          lotId: lot.id,
          amountCents: 6_000,
          reason: "ticket_wrong",
          occurredOn: "2026-11-05",
        }),
      );

      expect(row.onHandCents).toBe(3_600);
      expect(row.issuedCents).toBe(2_400);
      // STORED, not re-derivable later: what the ledger believed at the moment
      // somebody corrected it.
      expect(row.quantityOnHand).toBe(60);
      expect(row.quantityReceived).toBe(100);

      /**
       * Only the on-hand half reaches the balance sheet. With the variance
       * account defaulting to consumption, the issued half debits and the
       * credit offsets it, so the entry nets to `Dr 1300 3,600 / Cr 5000 3,600`
       * — and the batch's carrying value moves by exactly the same 3,600.
       */
      expect((await netOf(inventoryAccountId)) - inventoryBefore).toBe(3_600);
      expect((await netOf(cogsAccountId)) - cogsBefore).toBe(-3_600);
      // 10,000 purchased − 4,000 issued out + 3,600 corrected = 9,600.
      expect((await carriedOf(lot.id)).value).toBe(9_600);
    });

    it("A BATCH COSTED ONLY BY A CORRECTION IS NOT 'No cost recorded'", async () => {
      /**
       * **THE EGGS-AT-$0.00 BUG THROUGH A NEW DOOR, and the reason this slice
       * had to touch two files.** A delivery that arrives with nothing on the
       * paperwork is recorded uncosted, and the correction that supplies its
       * price is not a movement — so purchased, consumed and released are all
       * zero while the batch carries real money. `carriedValue` decided "was
       * this ever costed" from those three alone, and `production/ops.ts` asked
       * the same question independently in a different shape.
       */
      const item = await newItem("Priceless on arrival");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-none-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 30,
          // No price on the ticket. This is the case ADR 0012 §A.4 names first.
          occurredOn: "2026-11-10",
          locationAssetId: freezerId,
        }),
      );
      // Before the correction it is honestly unknown, NOT zero.
      expect((await carriedOf(lot.id)).value).toBeNull();

      await asOwner((tx) =>
        adjustLotCost(tx, ownerCtx(), {
          lotId: lot.id,
          amountCents: 4_500,
          reason: "no_price_on_ticket",
          occurredOn: "2026-11-12",
        }),
      );
      const after = await carriedOf(lot.id);
      expect(after.cost.purchasedCents).toBe(0);
      expect(after.cost.adjustedOnHandCents).toBe(4_500);
      expect(after.value).toBe(4_500);
    });

    it("TAKES A CORRECTION DOWNWARDS, which a movement's CHECK forbids", async () => {
      const item = await newItem("Overcharged");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-down-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 50,
          costCents: 15_000,
          occurredOn: "2026-11-20",
          locationAssetId: freezerId,
        }),
      );
      const inventoryBefore = await netOf(inventoryAccountId);
      await asOwner((tx) =>
        adjustLotCost(tx, ownerCtx(), {
          lotId: lot.id,
          amountCents: -5_000,
          reason: "discount_applied",
          occurredOn: "2026-11-21",
        }),
      );
      expect((await netOf(inventoryAccountId)) - inventoryBefore).toBe(-5_000);
      expect((await carriedOf(lot.id)).value).toBe(10_000);
    });

    it("names its own entry source, and is idempotent by it", async () => {
      const item = await newItem("Sourced");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-src-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 5,
          costCents: 500,
          occurredOn: "2026-11-25",
          locationAssetId: freezerId,
        }),
      );
      const row = await asOwner((tx) =>
        adjustLotCost(tx, ownerCtx(), {
          lotId: lot.id,
          amountCents: 100,
          reason: "ticket_wrong",
          occurredOn: "2026-11-26",
        }),
      );
      const entries = await asOwner((tx) =>
        tx
          .select()
          .from(schema.journalEntries)
          .where(
            and(
              eq(schema.journalEntries.tenantId, tenantId),
              eq(schema.journalEntries.sourceId, row.id),
            ),
          ),
      );
      expect(entries).toHaveLength(1);
      // NOT `inventory_adjustment`: that source means a quantity moved, and its
      // sourceId points at a movement rather than at one of these rows.
      expect(entries[0].source).toBe("inventory_cost_adjustment");

      // Re-posting the same correction returns the same entry rather than a
      // second one — the idempotency key is the row's id.
      const again = await asOwner((tx) =>
        postCostAdjustment(tx, ownerCtx(), {
          adjustmentId: row.id,
          itemId: item.id,
          lotId: lot.id,
          lotCode: lot.code,
          occurredOn: "2026-11-26",
          onHandCents: row.onHandCents,
          issuedCents: row.issuedCents,
        }),
      );
      expect(again?.entryId).toBe(entries[0].id);
    });

    it("posts NOTHING for a correction that nets within one account", async () => {
      /**
       * A batch entirely issued out, in a tenant whose variance account is the
       * consumption account — which is the default. `Dr 5000 / Cr 5000` says
       * nothing and `postEntry` refuses a zero-amount line, so the correction is
       * recorded and posts no entry at all. The fold agrees: the on-hand half is
       * zero, so the batch's carrying value does not move either.
       */
      const item = await newItem("All gone");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-nil-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 20,
          costCents: 2_000,
          occurredOn: "2026-12-01",
          locationAssetId: freezerId,
        }),
      );
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 20,
          occurredOn: "2026-12-02",
          locationAssetId: freezerId,
        }),
      );
      const inventoryBefore = await netOf(inventoryAccountId);
      const cogsBefore = await netOf(cogsAccountId);
      const row = await asOwner((tx) =>
        adjustLotCost(tx, ownerCtx(), {
          lotId: lot.id,
          amountCents: 700,
          reason: "freight_omitted",
          occurredOn: "2026-12-03",
        }),
      );
      expect(row.onHandCents).toBe(0);
      expect(row.issuedCents).toBe(700);
      expect(
        await asOwner((tx) =>
          tx
            .select()
            .from(schema.journalEntries)
            .where(
              and(
                eq(schema.journalEntries.tenantId, tenantId),
                eq(schema.journalEntries.sourceId, row.id),
              ),
            ),
        ),
      ).toHaveLength(0);
      expect((await netOf(inventoryAccountId)) - inventoryBefore).toBe(0);
      expect((await netOf(cogsAccountId)) - cogsBefore).toBe(0);
      // Zero, and it is a REAL zero now: somebody has said what this cost.
      expect((await carriedOf(lot.id)).value).toBe(0);
    });

    it("refuses a staff member — re-stating a cost is a DECISION", async () => {
      const item = await newItem("Staff refused");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-staff-${Date.now()}`,
          source: "purchased",
        }),
      );
      await expect(
        withTenant(
          tenantId,
          (tx) =>
            adjustLotCost(tx, staffCtx(), {
              lotId: lot.id,
              amountCents: 100,
              reason: "ticket_wrong",
              occurredOn: "2026-12-05",
            }),
          { role: "staff", userId: STAFF },
        ),
      ).rejects.toThrow(/owner/i);
    });

    it("refuses a correction of nothing", async () => {
      const item = await newItem("Zero refused");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-zero-${Date.now()}`,
          source: "purchased",
        }),
      );
      await expect(
        asOwner((tx) =>
          adjustLotCost(tx, ownerCtx(), {
            lotId: lot.id,
            amountCents: 0,
            reason: "ticket_wrong",
            occurredOn: "2026-12-05",
          }),
        ),
      ).rejects.toThrow();
    });

    // ---- a method is not a toggle (ADR 0013 A.6) ------------------------

    it("REFUSES TO TURN POSTING OFF ONCE IT HAS POSTED", async () => {
      /**
       * **Turning it off strands the balance sheet**, and nothing said so until
       * this. `postMovement` returns null on `none`, so issues stop crediting
       * Inventory while everything already capitalised stays there, relieved by
       * nothing, as the stock behind it is eaten.
       *
       * The switch's copy always said it does not backfill. Nobody had said it
       * does not unwind either, which is the more expensive half.
       */
      const posted = await asOwner((tx) => postedInventoryEntries(tx, tenantId));
      expect(posted.entries).toBeGreaterThan(0);
      expect(posted.firstOn).not.toBeNull();

      await expect(
        asOwner((tx) => assertPostingChangeSafe(tx, tenantId, "none")),
      ).rejects.toThrow(/leave that cost sitting in Inventory/i);
    });

    it("allows the change that is not a change", async () => {
      // Setting it to what it already is asks nothing of the books.
      await expect(
        asOwner((tx) => assertPostingChangeSafe(tx, tenantId, "capitalise")),
      ).resolves.toBeUndefined();
    });

    it("counts every source this pack posts under, not just receipts", async () => {
      /**
       * The guard under-counting is the failure that matters: it presents as
       * the switch ALLOWING a change it should refuse. Cost corrections post
       * under a fourth source added in slice 3d, and a list that missed it would
       * still look right on a tenant that had only ever received stock.
       */
      const sources = await asOwner((tx) =>
        tx
          .selectDistinct({ source: schema.journalEntries.source })
          .from(schema.journalEntries)
          .where(
            and(
              eq(schema.journalEntries.tenantId, tenantId),
              eq(schema.journalEntries.status, "posted"),
            ),
          ),
      );
      const inventorySources = sources
        .map((r) => r.source)
        .filter((x) => x.startsWith("inventory_"));
      expect(inventorySources).toContain("inventory_cost_adjustment");
      const counted = await asOwner((tx) =>
        postedInventoryEntries(tx, tenantId),
      );
      // Every inventory-sourced entry in the tenant is inside the count.
      const [{ n }] = await asOwner((tx) =>
        tx
          .select({ n: sql<string>`count(*)` })
          .from(schema.journalEntries)
          .where(
            and(
              eq(schema.journalEntries.tenantId, tenantId),
              eq(schema.journalEntries.status, "posted"),
              inArray(schema.journalEntries.source, inventorySources),
            ),
          ),
      );
      expect(counted.entries).toBe(Number(n));
    });


    // ---- slice 3d iii: the lens that applies a rule -----------------------

    /**
     * **THE INVARIANT THIS SLICE RESTS ON: THE REPORT STILL BALANCES.**
     * ADR 0007 names an unbalanced cash-basis report as the failure to design
     * against, and a lens that drops entries and re-points lines is the most
     * direct way to cause one. Every test below asserts it, because the
     * trial balance is the only thing that would ever notice.
     */
    const balanceAt = async (basis: "accrual" | "cash", asOf: string) =>
      asOwner((tx) =>
        getBalances(tx, tenantId, {
          scope: { kind: "combined" },
          asOf,
          basis,
        }),
      );
    const balanceOf = (basis: "accrual" | "cash") =>
      balanceAt(basis, "2027-12-31");
    const netAcross = (rows: { netCents: number }[]) =>
      rows.reduce((sum, r) => sum + r.netCents, 0);
    const netOfIn = (rows: { accountId: string; netCents: number }[], id: string) =>
      rows.filter((r) => r.accountId === id).reduce((s, r) => s + r.netCents, 0);

    it("DOES NOTHING AT ALL when nothing has been elected", async () => {
      // The common case, and it must stay the common case: no rows, no lens,
      // and the cash report is whatever it was before this slice existed.
      const before = await balanceOf("cash");
      expect(netAcross(before)).toBe(0);
      expect(await asOwner((tx) => listTaxRules(tx, tenantId))).toHaveLength(0);
    });

    it("MOVES THE COST TO THE PAYMENT DATE, AND STILL BALANCES", async () => {
      /**
       * The whole slice in one test. A delivery is received, matched to a bill,
       * approved and paid, and the feed is eaten.
       *
       * On `consumed` the cash report carries the stock as an asset and the
       * cost lands when it is issued. On `paid` neither of those entries exists
       * at all and the bill line is recognised under the FEED account instead
       * of Goods Received Not Invoiced.
       */
      const item = await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: "Lens feed",
          stockingUnit: "lb",
          itemKind: "lens_feed",
        }),
      );
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `LENS-${Date.now()}`,
          source: "purchased",
        }),
      );
      const receipt = await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 100,
          costCents: 20_000,
          occurredOn: "2027-03-01",
          locationAssetId: freezerId,
        }),
      );
      const { billId, billLineId } = await makeBill(20_000);
      await asOwner((tx) =>
        allocateBillLineToStock(tx, ownerCtx(), {
          billLineId,
          matches: [
            { movementId: receipt.movement.id, quantityMatched: 100 },
          ],
        }),
      );
      await asOwner(async (tx) => {
        const bill = await tx.query.bills.findFirst({
          where: and(
            eq(schema.bills.tenantId, tenantId),
            eq(schema.bills.id, billId),
          ),
        });
        return approveBill(tx, ledgerOwner(), {
          billId,
          expectedVersion: bill!.version,
        });
      });
      await payBill(billId, 20_000, "2027-04-15");
      await asOwner((tx) =>
        issueStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 100,
          occurredOn: "2027-03-20",
          locationAssetId: freezerId,
        }),
      );

      const onConsumed = await balanceOf("cash");
      expect(netAcross(onConsumed)).toBe(0);
      /**
       * **A MID-DATE SNAPSHOT IS THE ONLY WAY TO SEE THE ASSET AT ALL.** By the
       * end of the year this batch has been received AND fully issued, so its
       * contribution to Inventory nets to zero under either rule and an
       * end-date assertion proves nothing. Between the receipt and the issue it
       * is $200 on the balance sheet under `consumed` and must be nothing at
       * all under `paid`.
       */
      const midConsumed = await balanceAt("cash", "2027-03-10");
      expect(netAcross(midConsumed)).toBe(0);

      // Now the election. The account it substitutes TO is the thing a report
      // is useless without, per ADR 0013 A.5.
      const feedExpense = await asOwner(async (tx) => {
        const rows = await tx
          .insert(schema.accounts)
          .values({
            tenantId,
            code: "6101",
            name: "Feed",
            accountType: "expense",
          })
          .returning();
        return rows[0].id;
      });
      await asOwner((tx) =>
        setTaxRule(tx, ownerCtx(), {
          itemKind: "lens_feed",
          timingRule: "paid",
          expenseAccountId: feedExpense,
          decidedBy: "Their accountant",
        }),
      );

      const onPaid = await balanceOf("cash");
      const midPaid = await balanceAt("cash", "2027-03-10");
      // **THE INVARIANT, at both dates.** Entries dropped whole, lines moved
      // sideways, so nothing can have gone out of balance.
      expect(netAcross(onPaid)).toBe(0);
      expect(netAcross(midPaid)).toBe(0);

      // The cost is on the feed account now, and it was not before.
      expect(netOfIn(onConsumed, feedExpense)).toBe(0);
      expect(netOfIn(onPaid, feedExpense)).toBe(20_000);
      /**
       * **AND IT CAME OFF CONSUMPTION**, measured differentially because this
       * file shares one tenant: an absolute assertion about `5000` here would
       * be a claim about every test above it as much as about this one.
       */
      expect(
        netOfIn(onConsumed, cogsAccountId) - netOfIn(onPaid, cogsAccountId),
      ).toBe(20_000);

      // The stock never reached the balance sheet at all — visible only in the
      // window where it was actually sitting there.
      expect(
        netOfIn(midConsumed, inventoryAccountId) -
          netOfIn(midPaid, inventoryAccountId),
      ).toBe(20_000);
      expect(
        netOfIn(midPaid, grniAccountId) - netOfIn(midConsumed, grniAccountId),
      ).toBe(20_000);

      // **THE ACCRUAL BOOKS ARE UNTOUCHED**, which is the property `getBalances`
      // documents about itself and the reason the lens declines on accrual
      // rather than answering ADR 0013's open question in code.
      const accrual = await balanceOf("accrual");
      expect(netAcross(accrual)).toBe(0);
      expect(netOfIn(accrual, feedExpense)).toBe(0);
    });

    it("REFUSES TO REPORT into an account that has been retired", async () => {
      /**
       * **THE STATE THAT CAN ACTUALLY ARISE**, and the first version of this
       * test did not use it. It recorded a rule with no account at all — which
       * `setTaxRule` refused as soon as the save-time guard landed, so the test
       * broke on CI at its own setup. A guard whose test needs a fixture the app
       * cannot produce is guarding the wrong thing.
       *
       * This chart never hard-deletes a referenced account; it deactivates. So
       * the reachable failure is a rule pointed at a retired account, and a
       * report that quietly recognised cost into one would balance, look
       * ordinary, and put money somewhere the business had stopped using.
       */
      await asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          name: "Homeless",
          stockingUnit: "lb",
          itemKind: "no_home",
        }),
      );
      const retired = await asOwner(async (tx) => {
        const rows = await tx
          .insert(schema.accounts)
          .values({
            tenantId,
            code: "6199",
            name: "Retired feed",
            accountType: "expense",
          })
          .returning();
        return rows[0].id;
      });
      await asOwner((tx) =>
        setTaxRule(tx, ownerCtx(), {
          itemKind: "no_home",
          timingRule: "paid",
          expenseAccountId: retired,
        }),
      );
      // Recorded against a live account, the report is fine.
      await expect(balanceOf("cash")).resolves.toBeDefined();

      await asOwner((tx) =>
        tx
          .update(schema.accounts)
          .set({ isActive: false })
          .where(
            and(
              eq(schema.accounts.tenantId, tenantId),
              eq(schema.accounts.id, retired),
            ),
          ),
      );
      await expect(balanceOf("cash")).rejects.toThrow(/no longer active/i);
      // And it says which lens failed rather than surfacing a raw query error.
      await expect(balanceOf("cash")).rejects.toThrow(/inventory/i);
      await asOwner((tx) => clearTaxRule(tx, ownerCtx(), "no_home"));
    });

    it("keeps a correction out of a valuation dated before it", async () => {
      /**
       * Filtered by `occurred_on` exactly as the movements are. A balance sheet
       * dated June must not see August's correction, for the same reason it must
       * not see August's feed.
       */
      const item = await newItem("As of");
      const lot = await asOwner((tx) =>
        createLot(tx, ownerCtx(), {
          itemId: item.id,
          code: `CC-asof-${Date.now()}`,
          source: "purchased",
        }),
      );
      await asOwner((tx) =>
        receiveStock(tx, ownerCtx(), {
          itemId: item.id,
          lotId: lot.id,
          quantity: 10,
          costCents: 1_000,
          occurredOn: "2027-01-05",
          locationAssetId: freezerId,
        }),
      );
      await asOwner((tx) =>
        adjustLotCost(tx, ownerCtx(), {
          lotId: lot.id,
          amountCents: 300,
          reason: "freight_omitted",
          occurredOn: "2027-02-05",
        }),
      );
      const inJanuary = await asOwner((tx) =>
        carriedCostByLot(tx, tenantId, [lot.id], "2027-01-31"),
      );
      expect(carriedValue(inJanuary.get(lot.id)!)).toBe(1_000);
      const inFebruary = await asOwner((tx) =>
        carriedCostByLot(tx, tenantId, [lot.id], "2027-02-28"),
      );
      expect(carriedValue(inFebruary.get(lot.id)!)).toBe(1_300);
    });
  });

  /**
   * SLICE 2d. **THE THIRD LINE OF THE ENTRY 2c LEFT UNBUILT.**
   *
   * These live here rather than in `production-ops.test.ts` for the reason the
   * accrual's own tests do: that pack's test tenant keeps no books, and the
   * whole point of matching is what it does to a set that does. The accrual and
   * the thing that clears it now sit in one file, which is where they belong.
   */
  describe("the plant's bill, matched to the run", () => {
    beforeAll(() => setTreatment("capitalise"));

    /** A run with a fee accrued against it, and nothing yet clearing it. */
    const accruedRun = async (amountCents: number, code: string) => {
      const run = await asOwner((tx) =>
        startRun(tx, prodOwner(), {
          code: `${code}-${Date.now()}`,
          startedOn: "2026-09-01",
        }),
      );
      await asOwner((tx) =>
        postServiceAccrual(tx, ownerCtx(), {
          sourceId: run.id,
          amountCents,
          occurredOn: "2026-09-01",
          locationAssetId: freezerId,
          memo: `Processing accrued — ${run.code}`,
        }),
      );
      return run;
    };

    it("CLEARS 2060 TO ZERO when the bill is matched and approved", async () => {
      /**
       * **THE CLAIM THE WHOLE SLICE RESTS ON.** Completing the run credited
       * 2060; matching points the bill line at it; approving debits it back. A
       * non-zero balance afterwards is processing nobody has been invoiced for
       * — which is what the account is for, and is not this case.
       */
      const accrued = await asOwner((tx) =>
        resolveServicesAccruedAccount(tx, tenantId),
      );
      const before = await netOf(accrued);
      const run = await accruedRun(22_370, "CLEAR");
      // The accrual has credited it, and nothing has cleared that yet.
      expect((await netOf(accrued)) - before).toBe(-22_370);

      const open = await asOwner((tx) =>
        openProcessingAccruals(tx, tenantId, { runIds: [run.id] }),
      );
      expect(open).toHaveLength(1);
      expect(open[0].openCents).toBe(22_370);

      const { billId, billLineId } = await makeBill(22_370);
      const result = await asOwner((tx) =>
        matchBillLineToRuns(tx, prodOwner(), { billLineId, runIds: [run.id] }),
      );
      expect(result.accruedCents).toBe(22_370);
      expect(result.varianceCents).toBe(0);

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

      // The run credited 22,370; the bill debited it back.
      expect((await netOf(accrued)) - before).toBe(0);
      // And the run stops being offered, because it has nothing left to settle.
      const after = await asOwner((tx) =>
        openProcessingAccruals(tx, tenantId, { runIds: [run.id] }),
      );
      expect(after).toHaveLength(0);
    });

    it("SURVIVES AN EDIT TO THE BILL, so the accrual is cleared once", async () => {
      /**
       * **THE SAME DEFECT, ONE ACCOUNT ALONG.**
       * `production_run_bill_allocations` cascades off a bill line's id exactly
       * as the stock allocations do, so the whole-replace in `updateBillDraft`
       * unmatched every run on a bill the moment somebody saved a memo — while
       * the line came back still coded to `2060` and still carrying what was
       * accrued. The plant's bill cleared the accrual and the run went back on
       * `openProcessingAccruals` to be billed again.
       *
       * `2060` was not even on the unpickable list when this was found, which
       * is why the guard covers it now: a person could type their way into the
       * same state without a match at all.
       */
      const accrued = await asOwner((tx) =>
        resolveServicesAccruedAccount(tx, tenantId),
      );
      const before = await netOf(accrued);
      const run = await accruedRun(22_370, "EDITED");
      const { billId, billLineId, vendorId } = await makeBill(22_370);
      await asOwner((tx) =>
        matchBillLineToRuns(tx, prodOwner(), { billLineId, runIds: [run.id] }),
      );

      const read = await asOwner((tx) => loadBillLines(tx, tenantId, billId));
      await asOwner(async (tx) => {
        const bill = await loadBill(tx, tenantId, billId);
        return updateBillDraft(tx, ledgerOwner(), {
          billId,
          expectedVersion: bill.version,
          patch: {
            vendorId,
            billDate: bill.billDate,
            memo: "plant emailed the invoice",
            lines: read.map((l) => ({
              id: l.id,
              description: l.description,
              amountCents: l.amountCents,
              accountId: l.accountId,
            })),
          },
        });
      });

      expect(
        await asOwner((tx) =>
          openProcessingAccruals(tx, tenantId, { runIds: [run.id] }),
        ),
      ).toHaveLength(0);

      await asOwner(async (tx) => {
        const bill = await loadBill(tx, tenantId, billId);
        return approveBill(tx, ledgerOwner(), {
          billId,
          expectedVersion: bill.version,
        });
      });
      expect((await netOf(accrued)) - before).toBe(0);
    });

    it("PUTS THE DIFFERENCE ON A SIBLING LINE so 2060 still clears exactly", async () => {
      /**
       * **$223.70 QUOTED, $235.00 BILLED — the live `Test` case.** A single line
       * for the invoice total would debit 2060 by more than the run ever
       * credited and leave $11.30 sitting there meaning nothing. The matched
       * line carries exactly what was accrued, a sibling carries the rest, and
       * AP is unaffected because the two still sum to the invoice.
       */
      const accrued = await asOwner((tx) =>
        resolveServicesAccruedAccount(tx, tenantId),
      );
      const before = await netOf(accrued);
      const run = await accruedRun(22_370, "VARIANCE");

      const { billId, billLineId } = await makeBill(23_500);
      const result = await asOwner((tx) =>
        matchBillLineToRuns(tx, prodOwner(), { billLineId, runIds: [run.id] }),
      );
      expect(result.accruedCents).toBe(22_370);
      expect(result.varianceCents).toBe(1_130);

      const lines = await asOwner((tx) =>
        tx
          .select()
          .from(schema.billLines)
          .where(eq(schema.billLines.billId, billId)),
      );
      expect(lines).toHaveLength(2);
      // The two still sum to what the plant charged.
      expect(lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(23_500);
      const matched = lines.find((l) => l.id === billLineId)!;
      expect(matched.amountCents).toBe(22_370);
      expect(matched.accountId).toBe(accrued);
      const sibling = lines.find((l) => l.id !== billLineId)!;
      expect(sibling.amountCents).toBe(1_130);
      /**
       * **UNCODED ON PURPOSE.** A processing overcharge may be a rate rise, a
       * service nobody asked for, or a mistake to query, and this pack must not
       * decide which. Coding it is the ordinary path for any bill line — and
       * `approveBill` refusing an uncoded one is what forces somebody to.
       */
      expect(sibling.accountId).toBeNull();

      await asOwner(async (tx) => {
        await tx
          .update(schema.billLines)
          .set({ accountId: cogsAccountId })
          .where(eq(schema.billLines.id, sibling.id));
        const bill = await tx.query.bills.findFirst({
          where: eq(schema.bills.id, billId),
          columns: { version: true },
        });
        return approveBill(tx, ledgerOwner(), {
          billId,
          expectedVersion: bill!.version,
        });
      });

      // 2060 clears EXACTLY, and the $11.30 went to the P&L rather than sitting
      // in a liability nothing could ever explain.
      expect((await netOf(accrued)) - before).toBe(0);
    });

    it("splits one bill line across two kill days by what each accrued", async () => {
      const a = await accruedRun(10_000, "SPLIT-A");
      const b = await accruedRun(30_000, "SPLIT-B");
      const { billLineId } = await makeBill(44_000);
      const result = await asOwner((tx) =>
        matchBillLineToRuns(tx, prodOwner(), {
          billLineId,
          runIds: [a.id, b.id],
        }),
      );
      expect(result.accruedCents).toBe(40_000);
      expect(result.varianceCents).toBe(4_000);

      const allocations = await asOwner((tx) =>
        tx
          .select()
          .from(schema.productionRunBillAllocations)
          .where(eq(schema.productionRunBillAllocations.billLineId, billLineId)),
      );
      expect(allocations).toHaveLength(2);
      // Split in the ratio the runs accrued in — 1:3 — and the parts sum to the
      // whole, which is what `rollCents` is for.
      const billed = new Map(allocations.map((x) => [x.runId, x.billedCents]));
      expect(billed.get(a.id)).toBe(11_000);
      expect(billed.get(b.id)).toBe(33_000);
      expect([...billed.values()].reduce((s, v) => s + v, 0)).toBe(44_000);
    });

    it("REFUSES A RUN A BILL ALREADY COVERS, so an accrual cannot clear twice", async () => {
      const run = await accruedRun(5_000, "TWICE");
      const first = await makeBill(5_000);
      await asOwner((tx) =>
        matchBillLineToRuns(tx, prodOwner(), {
          billLineId: first.billLineId,
          runIds: [run.id],
        }),
      );
      const second = await makeBill(5_000);
      await expect(
        asOwner((tx) =>
          matchBillLineToRuns(tx, prodOwner(), {
            billLineId: second.billLineId,
            runIds: [run.id],
          }),
        ),
      ).rejects.toThrow(/nothing left to settle/);
    });

    it("refuses to match an already-approved bill", async () => {
      // Matching rewrites the line and `approveBill` builds its entry FROM the
      // lines, so matching afterwards changes what the bill says without
      // changing what posted.
      const run = await accruedRun(4_000, "APPROVED");
      const { billId, billLineId } = await makeBill(4_000);
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
      await expect(
        asOwner((tx) =>
          matchBillLineToRuns(tx, prodOwner(), { billLineId, runIds: [run.id] }),
        ),
      ).rejects.toThrow(/already approved/);
    });

    it("unpicks a match, and the sibling's money comes home", async () => {
      // Somebody will match the wrong kill day. Unpicking undoes all three
      // things matching did, or the bill is left in a state no screen explains.
      const run = await accruedRun(8_000, "UNPICK");
      const { billId, billLineId } = await makeBill(9_000);
      await asOwner((tx) =>
        matchBillLineToRuns(tx, prodOwner(), { billLineId, runIds: [run.id] }),
      );
      const released = await asOwner((tx) =>
        unmatchBillLineFromRuns(tx, prodOwner(), { billLineId }),
      );
      expect(released.released).toBe(1);

      const lines = await asOwner((tx) =>
        tx
          .select()
          .from(schema.billLines)
          .where(eq(schema.billLines.billId, billId)),
      );
      expect(lines).toHaveLength(1);
      expect(lines[0].amountCents).toBe(9_000);
      expect(lines[0].accountId).toBeNull();
      // And the run is offered again.
      const open = await asOwner((tx) =>
        openProcessingAccruals(tx, tenantId, { runIds: [run.id] }),
      );
      expect(open[0]?.openCents).toBe(8_000);
    });

    it("reads what is open from the LEDGER, not from the run's fee column", async () => {
      /**
       * A run whose fee was typed but never accrued — a tenant with posting off,
       * or a plant that waived it — has nothing to settle. Building the list off
       * `processing_fee_cents` would offer it and then fail at match time.
       */
      const run = await asOwner((tx) =>
        startRun(tx, prodOwner(), {
          code: `NOACCRUAL-${Date.now()}`,
          startedOn: "2026-09-02",
        }),
      );
      const open = await asOwner((tx) =>
        openProcessingAccruals(tx, tenantId, { runIds: [run.id] }),
      );
      expect(open).toEqual([]);
    });
  });
});
