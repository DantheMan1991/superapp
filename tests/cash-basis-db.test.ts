import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  getBalances,
  getProfitAndLoss,
  getTrialBalance,
  type LedgerCtx,
  upsertDimensionMember,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createInvoiceDraft,
  issueInvoice,
} from "../src/modules/accounting/invoicing/invoices";
import { recordPayment } from "../src/modules/accounting/invoicing/payments";
import { createVendor } from "../src/modules/accounting/payables/vendors";
import {
  approveBill,
  createBillDraft,
} from "../src/modules/accounting/payables/bills";
import { recordBillPayment } from "../src/modules/accounting/payables/payments";


/**
 * Slice 1 fixtures have one legal entity per tenant, so combined IS that
 * entity's books (ADR 0010). `tests/entities-db.test.ts` is the one that runs
 * two and proves each balances on its own.
 */
const COMBINED = { kind: "combined" } as const;

/**
 * Cash basis against the database (ADR 0007).
 *
 * The fixture is one invoice and one bill, each issued in one month and settled
 * across two later months, so accrual and cash disagree in every period and the
 * disagreement is the assertion.
 */

const d = process.env.DATABASE_URL ? describe : describe.skip;

d("cash basis (DB)", () => {
  const STAMP = `cash-basis-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let bankLedgerId: string;
  let salesId: string;
  let repairsId: string;
  let arId: string;
  let apId: string;

  async function accountId(code: string): Promise<string> {
    const row = await withTenant(tenantId, (tx) =>
      tx.query.accounts.findFirst({
        where: and(
          eq(schema.accounts.tenantId, tenantId),
          eq(schema.accounts.code, code),
        ),
      }),
    );
    if (!row) throw new Error(`account ${code} missing`);
    return row.id;
  }

  /** Net movement on one account for a window, on the given basis. */
  async function net(
    accountIdToRead: string,
    window: { from?: string; to?: string; asOf?: string },
    basis: "accrual" | "cash",
  ): Promise<number> {
    const rows = await withTenant(tenantId, (tx) =>
      getBalances(tx, tenantId, { scope: COMBINED, ...window, basis }),
    );
    return rows
      .filter((r) => r.accountId === accountIdToRead)
      .reduce((s, r) => s + r.netCents, 0);
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Cash Basis Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));

    salesId = await accountId("4000");
    repairsId = await accountId("6400");
    arId = await accountId("1200");
    apId = await accountId("2000");

    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Ops Checking", kind: "checking" }),
    );
    bankLedgerId = bank.ledgerAccount.id;

    // Invoice: 1,000.00 issued in January, paid 400 in February and 600 in March.
    const customer = await withTenant(tenantId, (tx) =>
      createCustomer(tx, owner, { name: "Flappers" }),
    );
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId: customer.id,
        issueDate: "2026-01-10",
        dueDate: "2026-02-10",
        lines: [
          {
            description: "Rent",
            quantity: "1",
            unitPriceCents: 100_000,
            incomeAccountId: salesId,
          },
        ],
      }),
    );
    let invoice = await withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, { invoiceId: draft.id, expectedVersion: draft.version }),
    );
    const pay1 = await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        paymentDate: "2026-02-15",
        amountCents: 40_000,
        depositAccountId: bankLedgerId,
        method: "check",
      }),
    );
    invoice = pay1.invoice;
    await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        paymentDate: "2026-03-15",
        amountCents: 60_000,
        depositAccountId: bankLedgerId,
        method: "check",
      }),
    );

    // Bill: 500.00 approved in January, paid 200 in February and 300 in March.
    const vendor = await withTenant(tenantId, (tx) =>
      createVendor(tx, owner, { name: "Fulton Lumber" }),
    );
    const billDraft = await withTenant(tenantId, (tx) =>
      createBillDraft(tx, owner, {
        vendorId: vendor.id,
        billDate: "2026-01-20",
        lines: [{ description: "Repairs", amountCents: 50_000, accountId: repairsId }],
      }),
    );
    let bill = await withTenant(tenantId, (tx) =>
      approveBill(tx, owner, { billId: billDraft.id, expectedVersion: billDraft.version }),
    );
    const bp1 = await withTenant(tenantId, (tx) =>
      recordBillPayment(tx, owner, {
        billId: bill.id,
        expectedVersion: bill.version,
        paymentDate: "2026-02-20",
        amountCents: 20_000,
        paidFromAccountId: bankLedgerId,
        method: "check",
      }),
    );
    bill = bp1.bill;
    await withTenant(tenantId, (tx) =>
      recordBillPayment(tx, owner, {
        billId: bill.id,
        expectedVersion: bill.version,
        paymentDate: "2026-03-20",
        amountCents: 30_000,
        paidFromAccountId: bankLedgerId,
        method: "check",
      }),
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  const JAN = { from: "2026-01-01", to: "2026-01-31" };
  const FEB = { from: "2026-02-01", to: "2026-02-28" };
  const MAR = { from: "2026-03-01", to: "2026-03-31" };

  it("accrual recognises the whole document in the month it was issued", async () => {
    expect(await net(salesId, JAN, "accrual")).toBe(-100_000);
    expect(await net(repairsId, JAN, "accrual")).toBe(50_000);
    expect(await net(salesId, FEB, "accrual")).toBe(0);
    expect(await net(repairsId, MAR, "accrual")).toBe(0);
  });

  it("cash recognises nothing in the month of issue", async () => {
    expect(await net(salesId, JAN, "cash")).toBe(0);
    expect(await net(repairsId, JAN, "cash")).toBe(0);
  });

  it("cash recognises each payment in the month the money moved", async () => {
    expect(await net(salesId, FEB, "cash")).toBe(-40_000);
    expect(await net(salesId, MAR, "cash")).toBe(-60_000);
    expect(await net(repairsId, FEB, "cash")).toBe(20_000);
    expect(await net(repairsId, MAR, "cash")).toBe(30_000);
  });

  it("recognises the document exactly once across the whole year", async () => {
    const year = { from: "2026-01-01", to: "2026-12-31" };
    expect(await net(salesId, year, "cash")).toBe(-100_000);
    expect(await net(salesId, year, "accrual")).toBe(-100_000);
    expect(await net(repairsId, year, "cash")).toBe(50_000);
    expect(await net(repairsId, year, "accrual")).toBe(50_000);
  });

  it("AR and AP carry a balance on accrual and none on cash", async () => {
    // End of February: half of each document still outstanding on accrual.
    const asOfFeb = { asOf: "2026-02-28" };
    expect(await net(arId, asOfFeb, "accrual")).toBe(60_000);
    expect(await net(apId, asOfFeb, "accrual")).toBe(-30_000);
    expect(await net(arId, asOfFeb, "cash")).toBe(0);
    expect(await net(apId, asOfFeb, "cash")).toBe(0);
  });

  it("bank movement is identical on both bases — only recognition moves", async () => {
    for (const window of [JAN, FEB, MAR]) {
      expect(await net(bankLedgerId, window, "cash")).toBe(
        await net(bankLedgerId, window, "accrual"),
      );
    }
  });

  it("a cash-basis trial balance still balances", async () => {
    for (const asOf of ["2026-01-31", "2026-02-28", "2026-03-31", "2026-12-31"]) {
      const tb = await withTenant(tenantId, (tx) =>
        getTrialBalance(tx, tenantId, asOf, COMBINED, "cash"),
      );
      expect(tb.totalNetCents).toBe(0);
      expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
    }
  });

  it("the P&L report carries the basis through to net income", async () => {
    const accrualJan = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { scope: COMBINED, ...JAN, basis: "accrual" }),
    );
    const cashJan = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { scope: COMBINED, ...JAN, basis: "cash" }),
    );
    // January: 100,000 income less 50,000 expense on accrual; nothing on cash.
    expect(accrualJan.netIncomeCents).toBe(50_000);
    expect(cashJan.netIncomeCents).toBe(0);

    const cashFeb = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { scope: COMBINED, ...FEB, basis: "cash" }),
    );
    expect(cashFeb.netIncomeCents).toBe(20_000); // 40,000 in, 20,000 out
  });

  it("defaults to accrual when no basis is given — nothing existing changes", async () => {
    const withoutBasis = await withTenant(tenantId, (tx) =>
      getBalances(tx, tenantId, { scope: COMBINED, ...JAN }),
    );
    const explicit = await withTenant(tenantId, (tx) =>
      getBalances(tx, tenantId, { scope: COMBINED, ...JAN, basis: "accrual" }),
    );
    const key = (r: { accountId: string; netCents: number }) =>
      `${r.accountId}:${r.netCents}`;
    expect(withoutBasis.map(key).sort()).toEqual(explicit.map(key).sort());
  });

  it("WITHIN ONE MEMBER, cash recognises only the tagged line's share, and never the payable leg", async () => {
    /**
     * A bill with one line tagged with a job and one not, paid in two halves.
     * Sliced to the job, the accrual side sees the tagged line in January; the
     * cash side sees the tagged line's share of each payment as the money
     * moves, and the whole of it across the year — with no AP offset, because
     * the offset carries no job and a slice is not a balanced set of books.
     */
    const job = await withTenant(tenantId, (tx) =>
      upsertDimensionMember(tx, owner, {
        dimensionType: "site",
        packEntityId: crypto.randomUUID(),
        displayName: "Job for the slice",
      }),
    );
    const vendor = await withTenant(tenantId, (tx) =>
      createVendor(tx, owner, { name: "Sliced Supply" }),
    );
    const draft = await withTenant(tenantId, (tx) =>
      createBillDraft(tx, owner, {
        vendorId: vendor.id,
        billDate: "2026-01-25",
        lines: [
          {
            description: "On the job",
            amountCents: 50_000,
            accountId: repairsId,
            dimensionMemberIds: [job.id],
          },
          { description: "Not on it", amountCents: 30_000, accountId: repairsId },
        ],
      }),
    );
    let bill = await withTenant(tenantId, (tx) =>
      approveBill(tx, owner, { billId: draft.id, expectedVersion: draft.version }),
    );
    const first = await withTenant(tenantId, (tx) =>
      recordBillPayment(tx, owner, {
        billId: bill.id,
        expectedVersion: bill.version,
        paymentDate: "2026-02-25",
        amountCents: 40_000,
        paidFromAccountId: bankLedgerId,
        method: "check",
      }),
    );
    bill = first.bill;
    await withTenant(tenantId, (tx) =>
      recordBillPayment(tx, owner, {
        billId: bill.id,
        expectedVersion: bill.version,
        paymentDate: "2026-03-25",
        amountCents: 40_000,
        paidFromAccountId: bankLedgerId,
        method: "check",
      }),
    );
    const within = (window: { from?: string; to?: string }, basis: "accrual" | "cash") =>
      withTenant(tenantId, (tx) =>
        getBalances(tx, tenantId, { scope: COMBINED, ...window, basis, withinMemberId: job.id }),
      );
    const sum = (rows: Array<{ netCents: number }>) => rows.reduce((s, r) => s + r.netCents, 0);
    const year = { from: "2026-01-01", to: "2026-12-31" };

    // Accrual: the tagged line, in the month of the bill, and nothing else.
    const accrualJan = await within(JAN, "accrual");
    expect(sum(accrualJan)).toBe(50_000);
    expect(accrualJan.every((r) => r.accountId === repairsId)).toBe(true);
    // Cash: nothing in January; the tagged share as the money moves; all of it over the year.
    expect(sum(await within(JAN, "cash"))).toBe(0);
    const feb = sum(await within(FEB, "cash"));
    const mar = sum(await within(MAR, "cash"));
    expect(feb).toBeGreaterThan(0);
    expect(feb + mar).toBe(50_000);
    const cashYear = await within(year, "cash");
    expect(sum(cashYear)).toBe(50_000);
    // No payable leg in a slice, on either basis.
    expect(cashYear.some((r) => r.accountId === apId)).toBe(false);
    expect((await within(year, "accrual")).some((r) => r.accountId === apId)).toBe(false);
  });
});
