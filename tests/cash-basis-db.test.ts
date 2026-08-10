import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  getBalances,
  getProfitAndLoss,
  getTrialBalance,
  type LedgerCtx,
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
      getBalances(tx, tenantId, { ...window, basis }),
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
        getTrialBalance(tx, tenantId, asOf, "cash"),
      );
      expect(tb.totalNetCents).toBe(0);
      expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
    }
  });

  it("the P&L report carries the basis through to net income", async () => {
    const accrualJan = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { ...JAN, basis: "accrual" }),
    );
    const cashJan = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { ...JAN, basis: "cash" }),
    );
    // January: 100,000 income less 50,000 expense on accrual; nothing on cash.
    expect(accrualJan.netIncomeCents).toBe(50_000);
    expect(cashJan.netIncomeCents).toBe(0);

    const cashFeb = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { ...FEB, basis: "cash" }),
    );
    expect(cashFeb.netIncomeCents).toBe(20_000); // 40,000 in, 20,000 out
  });

  it("defaults to accrual when no basis is given — nothing existing changes", async () => {
    const withoutBasis = await withTenant(tenantId, (tx) =>
      getBalances(tx, tenantId, JAN),
    );
    const explicit = await withTenant(tenantId, (tx) =>
      getBalances(tx, tenantId, { ...JAN, basis: "accrual" }),
    );
    const key = (r: { accountId: string; netCents: number }) =>
      `${r.accountId}:${r.netCents}`;
    expect(withoutBasis.map(key).sort()).toEqual(explicit.map(key).sort());
  });
});
