import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  getBalances,
  getProfitAndLoss,
  getTaxSummary,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createSalesTaxRate,
  setSalesTaxRateActive,
  updateSalesTaxRate,
} from "../src/modules/accounting/invoicing/catalogue";
import {
  createInvoiceDraft,
  issueInvoice,
  updateInvoiceDraft,
  voidInvoice,
} from "../src/modules/accounting/invoicing/invoices";
import { recordPayment } from "../src/modules/accounting/invoicing/payments";


/**
 * Slice 1 fixtures have one legal entity per tenant, so combined IS that
 * entity's books (ADR 0010). `tests/entities-db.test.ts` is the one that runs
 * two and proves each balances on its own.
 */
const COMBINED = { kind: "combined" } as const;

/**
 * Sales tax against the database: the whole path an owner walks.
 *
 * Add a rate → put it on an invoice → issue it → the liability lands in the
 * `sales_tax` account, the income is the SUBTOTAL, and the P&L never mentions
 * the tax. That last one is the assertion the feature exists to earn: tax
 * collected is money held for a tax authority, and a P&L that counts it as
 * revenue overstates profit on every taxed sale.
 */

const d = process.env.DATABASE_URL ? describe : describe.skip;

d("sales tax (DB)", () => {
  const STAMP = `sales-tax-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let bankLedgerId: string;
  let salesId: string;
  let arId: string;
  let taxAccountId: string;
  let customerId: string;
  let rateId: string;

  async function accountIdByCode(code: string): Promise<string> {
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

  /** Σ signed cents on one account for a window. */
  async function net(
    accountId: string,
    window: { from?: string; to?: string; asOf?: string },
  ): Promise<number> {
    const rows = await withTenant(tenantId, (tx) =>
      getBalances(tx, tenantId, { scope: COMBINED, ...window }),
    );
    return rows
      .filter((r) => r.accountId === accountId)
      .reduce((s, r) => s + r.netCents, 0);
  }

  /** An issued invoice: taxed materials + exempt labour, at the given rate. */
  async function issueTaxed(args: {
    issueDate: string;
    taxRateId: string | null;
    materialsCents?: number;
    labourCents?: number;
  }) {
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: args.issueDate,
        taxRateId: args.taxRateId,
        lines: [
          {
            description: "Materials",
            quantity: "1",
            unitPriceCents: args.materialsCents ?? 100_000,
            incomeAccountId: salesId,
            isTaxable: true,
          },
          {
            description: "Labour",
            quantity: "1",
            unitPriceCents: args.labourCents ?? 50_000,
            incomeAccountId: salesId,
            isTaxable: false,
          },
        ],
      }),
    );
    return withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, { invoiceId: draft.id, expectedVersion: draft.version }),
    );
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Sales Tax Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));

    salesId = await accountIdByCode("4000");
    arId = await accountIdByCode("1200");
    // BY SUBTYPE, the way the posting engine finds it — not by the 2200 the
    // template happens to use.
    const taxAccount = await withTenant(tenantId, (tx) =>
      tx.query.accounts.findFirst({
        where: and(
          eq(schema.accounts.tenantId, tenantId),
          eq(schema.accounts.subtype, "sales_tax"),
        ),
      }),
    );
    taxAccountId = taxAccount!.id;

    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Ops Checking", kind: "checking" }),
    );
    bankLedgerId = bank.ledgerAccount.id;

    const customer = await withTenant(tenantId, (tx) =>
      createCustomer(tx, owner, { name: "Bramley & Co" }),
    );
    customerId = customer.id;

    const rate = await withTenant(tenantId, (tx) =>
      createSalesTaxRate(tx, owner, { name: "State", ratePpm: 72_500 }),
    );
    rateId = rate.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("nothing is seeded — a tenant starts with no rates", async () => {
    // Unlike terms and payment methods. There is no rate that is right
    // anywhere, so provisioning one would be a wrong number on an invoice.
    // (This tenant has exactly the one the fixture created.)
    const rates = await withTenant(tenantId, (tx) =>
      tx.query.salesTaxRates.findMany({
        where: eq(schema.salesTaxRates.tenantId, tenantId),
      }),
    );
    expect(rates).toHaveLength(1);
    // The first rate a tenant creates becomes the default: a list of one with
    // nothing selected is a control that does nothing.
    expect(rates[0].isDefault).toBe(true);
  });

  it("a draft computes subtotal, tax and total", async () => {
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-04-01",
        taxRateId: rateId,
        lines: [
          {
            description: "Materials",
            quantity: "2",
            unitPriceCents: 25_000,
            incomeAccountId: salesId,
            isTaxable: true,
          },
          {
            description: "Labour",
            quantity: "1",
            unitPriceCents: 30_000,
            incomeAccountId: salesId,
            isTaxable: false,
          },
        ],
      }),
    );
    expect(draft.subtotalCents).toBe(80_000);
    // 7.25% of the taxable 50,000 only — the labour is exempt.
    expect(draft.taxCents).toBe(3_625);
    expect(draft.totalCents).toBe(83_625);
    expect(draft.taxRatePpm).toBe(72_500);
  });

  it("issuing posts Dr AR gross, Cr income net, Cr tax", async () => {
    const invoice = await issueTaxed({
      issueDate: "2026-05-01",
      taxRateId: rateId,
    });
    const window = { from: "2026-05-01", to: "2026-05-31" };

    // 100,000 taxable + 50,000 exempt = 150,000 subtotal, tax 7,250.
    expect(invoice.subtotalCents).toBe(150_000);
    expect(invoice.taxCents).toBe(7_250);
    expect(invoice.totalCents).toBe(157_250);

    // AR is debited the GROSS: it is what the customer owes.
    expect(await net(arId, window)).toBe(157_250);
    // Income is credited the SUBTOTAL only.
    expect(await net(salesId, window)).toBe(-150_000);
    // And the tax is a liability.
    expect(await net(taxAccountId, window)).toBe(-7_250);
  });

  it("the P&L shows the subtotal as income and never the tax", async () => {
    // THE ASSERTION THE FEATURE EXISTS TO EARN.
    const pnl = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { scope: COMBINED, from: "2026-05-01", to: "2026-05-31" }),
    );
    const sales = pnl.rows.find((r) => r.accountId === salesId);
    expect(sales?.cents).toBe(150_000);
    // No row anywhere on the statement is the tax account, at any depth or
    // section — not merely "the income section omits it".
    expect(pnl.rows.some((r) => r.accountId === taxAccountId)).toBe(false);
    // And the Income section total is the subtotal, not the gross — the
    // figure somebody reads off the statement.
    const totalIncome = pnl.rows.find(
      (r) => r.kind === "subtotal" && r.label === "Total Income",
    );
    expect(totalIncome?.cents).toBe(150_000);
    // Net profit likewise: an invoice of 157,250 gross earned 150,000.
    expect(pnl.netIncomeCents).toBe(150_000);
  });

  it("a partial payment does not move the tax liability", async () => {
    // Accrual: the whole liability arose at issue. The payment is Dr bank /
    // Cr AR and touches nothing else.
    const invoice = await issueTaxed({
      issueDate: "2026-06-01",
      taxRateId: rateId,
    });
    const before = await net(taxAccountId, { asOf: "2026-06-30" });
    await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        paymentDate: "2026-06-15",
        amountCents: 50_000,
        depositAccountId: bankLedgerId,
        method: "check",
      }),
    );
    expect(await net(taxAccountId, { asOf: "2026-06-30" })).toBe(before);
    // The payment reduced AR only.
    const updated = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice.id) }),
    );
    expect(updated!.status).toBe("partial");
  });

  it("overpayment is measured against the GROSS total", async () => {
    // The guard reads `totalCents`, which now includes tax — paying the
    // subtotal must not be treated as paying in full.
    const invoice = await issueTaxed({
      issueDate: "2026-06-02",
      taxRateId: rateId,
    });
    await expect(
      withTenant(tenantId, (tx) =>
        recordPayment(tx, owner, {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
          paymentDate: "2026-06-20",
          amountCents: 157_251,
          depositAccountId: bankLedgerId,
          method: "check",
        }),
      ),
    ).rejects.toThrow(/remaining/);
    // Paying exactly the gross settles it.
    const paid = await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        paymentDate: "2026-06-20",
        amountCents: 157_250,
        depositAccountId: bankLedgerId,
        method: "check",
      }),
    );
    expect(paid.invoice.status).toBe("paid");
  });

  it("voiding removes the tax with the rest of the entry", async () => {
    const invoice = await issueTaxed({
      issueDate: "2026-07-01",
      taxRateId: rateId,
    });
    const window = { from: "2026-07-01", to: "2026-07-31" };
    expect(await net(taxAccountId, window)).toBe(-7_250);
    await withTenant(tenantId, (tx) =>
      voidInvoice(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
      }),
    );
    expect(await net(taxAccountId, window)).toBe(0);
    expect(await net(salesId, window)).toBe(0);
  });

  it("an issued invoice does NOT re-price when the rate changes", async () => {
    // The freeze. `invoices.tax_rate_ppm` is a copy, so an issued document and
    // the entry posted from it both mean what they meant.
    const invoice = await issueTaxed({
      issueDate: "2026-08-01",
      taxRateId: rateId,
    });
    const window = { from: "2026-08-01", to: "2026-08-31" };
    expect(invoice.taxCents).toBe(7_250);

    const rate = await withTenant(tenantId, (tx) =>
      tx.query.salesTaxRates.findFirst({
        where: eq(schema.salesTaxRates.id, rateId),
      }),
    );
    await withTenant(tenantId, (tx) =>
      updateSalesTaxRate(tx, owner, {
        rateId,
        expectedVersion: rate!.version,
        patch: { name: "State", ratePpm: 100_000 },
      }),
    );

    const after = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice.id) }),
    );
    expect(after!.taxCents).toBe(7_250);
    expect(after!.taxRatePpm).toBe(72_500);
    expect(after!.totalCents).toBe(157_250);
    // And the ledger agrees with the document.
    expect(await net(taxAccountId, window)).toBe(-7_250);

    // Put it back for the tests that follow.
    const bumped = await withTenant(tenantId, (tx) =>
      tx.query.salesTaxRates.findFirst({
        where: eq(schema.salesTaxRates.id, rateId),
      }),
    );
    await withTenant(tenantId, (tx) =>
      updateSalesTaxRate(tx, owner, {
        rateId,
        expectedVersion: bumped!.version,
        patch: { name: "State", ratePpm: 72_500 },
      }),
    );
  });

  it("total is always subtotal + tax on a stored invoice", async () => {
    // The invariant the equality CHECK will carry once the follow-up migration
    // lands. Until then it is pinned here.
    const rows = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findMany({
        where: eq(schema.invoices.tenantId, tenantId),
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.totalCents).toBe(row.subtotalCents + row.taxCents);
    }
  });

  it("an invoice with no rate posts exactly as it always did", async () => {
    const invoice = await issueTaxed({
      issueDate: "2026-09-01",
      taxRateId: null,
    });
    const window = { from: "2026-09-01", to: "2026-09-30" };
    expect(invoice.taxCents).toBe(0);
    expect(invoice.totalCents).toBe(150_000);
    expect(await net(arId, window)).toBe(150_000);
    expect(await net(taxAccountId, window)).toBe(0);
  });

  it("refuses a deactivated rate on a write", async () => {
    const retired = await withTenant(tenantId, (tx) =>
      createSalesTaxRate(tx, owner, { name: "Old city rate", ratePpm: 30_000 }),
    );
    await withTenant(tenantId, (tx) =>
      setSalesTaxRateActive(tx, owner, {
        rateId: retired.id,
        expectedVersion: retired.version,
        active: false,
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        createInvoiceDraft(tx, owner, {
          customerId,
          issueDate: "2026-10-01",
          taxRateId: retired.id,
          lines: [
            {
              description: "Materials",
              quantity: "1",
              unitPriceCents: 10_000,
              incomeAccountId: salesId,
              isTaxable: true,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/invalid/);
  });

  it("editing a draft re-derives the tax", async () => {
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-11-01",
        taxRateId: rateId,
        lines: [
          {
            description: "Materials",
            quantity: "1",
            unitPriceCents: 100_000,
            incomeAccountId: salesId,
            isTaxable: true,
          },
        ],
      }),
    );
    expect(draft.taxCents).toBe(7_250);
    // Take the tax off entirely.
    const updated = await withTenant(tenantId, (tx) =>
      updateInvoiceDraft(tx, owner, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
        patch: {
          customerId,
          issueDate: "2026-11-01",
          taxRateId: null,
          lines: [
            {
              description: "Materials",
              quantity: "1",
              unitPriceCents: 100_000,
              incomeAccountId: salesId,
              isTaxable: true,
            },
          ],
        },
      }),
    );
    expect(updated.taxCents).toBe(0);
    expect(updated.taxRateId).toBeNull();
    expect(updated.taxRatePpm).toBe(0);
    expect(updated.totalCents).toBe(100_000);
  });

  it("the tax summary reports the taxable base and the tax by rate", async () => {
    const summary = await withTenant(tenantId, (tx) =>
      getTaxSummary(tx, tenantId, { from: "2026-05-01", to: "2026-05-31" }),
    );
    const state = summary.rows.find((r) => r.rateId === rateId)!;
    expect(state.name).toBe("State");
    // Summed from the frozen taxable lines, not divided out of the tax.
    expect(state.taxableCents).toBe(100_000);
    expect(state.exemptCents).toBe(50_000);
    expect(state.taxCents).toBe(7_250);
    // May's invoice is the first posted tax in this tenant's life, so the
    // cumulative ledger balance and the period's charge coincide here.
    expect(summary.liabilityCents).toBe(7_250);
    expect(summary.differenceCents).toBe(0);
  });

  it("the liability figure is the CUMULATIVE balance, and the difference is stated", async () => {
    // The design call this report exists for. `liabilityCents` is what is owed
    // as at `to`, which includes tax charged in earlier periods — so a non-zero
    // difference against one period's charge is NORMAL, not a fault. Reading it
    // as a mismatch is the misunderstanding the field is named to prevent.
    const summary = await withTenant(tenantId, (tx) =>
      getTaxSummary(tx, tenantId, { from: "2026-07-01", to: "2026-07-31" }),
    );
    // July's only invoice was voided, so the period charged nothing.
    expect(summary.totals.taxCents).toBe(0);
    // But May and June's tax is still sitting in the account.
    const ledger = -(await net(taxAccountId, { asOf: "2026-07-31" }));
    expect(ledger).toBeGreaterThan(0);
    expect(summary.liabilityCents).toBe(ledger);
    expect(summary.differenceCents).toBe(ledger);
  });

  it("a voided invoice is excluded from the summary entirely", async () => {
    const summary = await withTenant(tenantId, (tx) =>
      getTaxSummary(tx, tenantId, { from: "2026-07-01", to: "2026-07-31" }),
    );
    // Not "counted as zero" — absent. A void charged nothing and owes nothing.
    expect(summary.rows).toHaveLength(0);
  });
});
