import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { getBalances, type LedgerCtx } from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createInvoiceDraft,
  issueInvoice,
} from "../src/modules/accounting/invoicing/invoices";
import {
  formatCreditMemoNumber,
  parseCreditMemoNumberSuffix,
} from "../src/modules/accounting/invoicing/numbering";
import {
  recordPayment,
  unapplyPayment,
} from "../src/modules/accounting/invoicing/payments";
import {
  issueCreditMemo,
  voidCreditMemo,
} from "../src/modules/accounting/invoicing/credit-memos";

describe("credit memo numbering (pure)", () => {
  it("has its own series, so a credit never reads as a sale", () => {
    expect(formatCreditMemoNumber(3)).toBe("CM-0003");
    expect(parseCreditMemoNumberSuffix("CM-0003")).toBe(3);
    expect(parseCreditMemoNumberSuffix("INV-0003")).toBeNull();
  });
});

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * A credit memo posts its own entry and settles the invoice as a payment row
 * does — see the table's comment. What this suite pins is that both halves
 * happen together, that every reader agrees, and that the cash-basis lens
 * nets a credit to nothing.
 */
d("credit memos (DB)", () => {
  const STAMP = `credit-memos-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let staff: LedgerCtx;
  let customerId: string;
  let salesId: string;
  let arId: string;
  let repairsId: string;
  let bankLedgerId: string;
  const asOwner = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant(tenantId, fn, { role: "owner" });

  async function accountId(code: string): Promise<string> {
    const row = await withTenant(tenantId, (tx) =>
      tx.query.accounts.findFirst({
        where: and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, code)),
      }),
    );
    if (!row) throw new Error(`account ${code} missing`);
    return row.id;
  }

  async function issued(cents: number) {
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-09-01",
        dueDate: "2026-09-15",
        lines: [{ description: "Feed", quantity: "1", unitPriceCents: cents, incomeAccountId: salesId }],
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
        .values([{ clerkOrgId: STAMP, name: "Credit Memos Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    staff = { tenantId, userId: "staff", role: "staff" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    customerId = (
      await withTenant(tenantId, (tx) => createCustomer(tx, owner, { name: "Millbrook Restaurant" }))
    ).id;
    salesId = await accountId("4000");
    arId = await accountId("1200");
    repairsId = await accountId("6400");
    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Ops Checking", kind: "checking" }),
    );
    bankLedgerId = bank.ledgerAccount.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  let invoiceId: string;
  let invoiceVersion: number;
  let memoId: string;
  let memoPaymentId: string;
  let memoEntryId: string;

  it("issues a credit: its own entry, a settlement row, the invoice part-paid", async () => {
    const invoice = await issued(10_000);
    invoiceId = invoice.id;
    const { creditMemo, invoice: after } = await asOwner((tx) =>
      issueCreditMemo(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        amountCents: 2_000,
        incomeAccountId: salesId,
        issueDate: "2026-09-03",
        memo: "Two bags returned",
      }),
    );
    memoId = creditMemo.id;
    memoPaymentId = creditMemo.paymentId!;
    memoEntryId = creditMemo.journalEntryId;
    invoiceVersion = after.version;
    expect(creditMemo).toMatchObject({
      number: "CM-0001",
      status: "issued",
      totalCents: 2_000,
      invoiceId: invoice.id,
      customerId,
      entityId: invoice.entityId,
      incomeAccountId: salesId,
      memo: "Two bags returned",
    });
    expect(after.status).toBe("partial");

    const lines = await withTenant(tenantId, (tx) =>
      tx.query.journalLines.findMany({
        where: and(eq(schema.journalLines.tenantId, tenantId), eq(schema.journalLines.entryId, memoEntryId)),
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountId === salesId)?.amountCents).toBe(2_000);
    expect(lines.find((l) => l.accountId === arId)?.amountCents).toBe(-2_000);
    const entry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({ where: eq(schema.journalEntries.id, memoEntryId) }),
    );
    expect(entry).toMatchObject({ source: "credit_memo", sourceId: memoId, status: "posted" });

    const payment = await withTenant(tenantId, (tx) =>
      tx.query.invoicePayments.findFirst({ where: eq(schema.invoicePayments.id, memoPaymentId) }),
    );
    expect(payment).toMatchObject({
      invoiceId: invoice.id,
      amountCents: 2_000,
      method: "credit_memo",
      depositAccountId: salesId,
      journalEntryId: memoEntryId,
      memo: "CM-0001 · Two bags returned",
      depositId: null,
    });
  });

  it("refuses more than the balance, nothing, a non-income account, staff, a stale version and a draft", async () => {
    const attempt = (ctx: LedgerCtx, patch: Partial<Parameters<typeof issueCreditMemo>[2]>) =>
      asOwner((tx) =>
        issueCreditMemo(tx, ctx, {
          invoiceId,
          expectedVersion: invoiceVersion,
          amountCents: 1_000,
          incomeAccountId: salesId,
          issueDate: "2026-09-04",
          ...patch,
        }),
      );
    await expect(attempt(owner, { amountCents: 8_001 })).rejects.toMatchObject({ code: "INVOICE_OVERPAYMENT" });
    await expect(attempt(owner, { amountCents: 0 })).rejects.toMatchObject({ code: "CREDIT_MEMO_AMOUNT_INVALID" });
    await expect(attempt(owner, { incomeAccountId: repairsId })).rejects.toMatchObject({ code: "CREDIT_MEMO_ACCOUNT_INVALID" });
    await expect(attempt(staff, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(attempt(owner, { expectedVersion: invoiceVersion + 5 })).rejects.toMatchObject({ code: "STALE_VERSION" });
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-09-01",
        lines: [{ description: "Draft", quantity: "1", unitPriceCents: 500, incomeAccountId: salesId }],
      }),
    );
    await expect(
      attempt(owner, { invoiceId: draft.id, expectedVersion: draft.version, amountCents: 100 }),
    ).rejects.toMatchObject({ code: "INVOICE_NOT_OPEN" });
    // Nothing above left a memo behind.
    const memos = await withTenant(tenantId, (tx) => tx.select().from(schema.creditMemos));
    expect(memos).toHaveLength(1);
  });

  it("the settlement row cannot be unapplied on its own — the memo is voided instead", async () => {
    const payment = await withTenant(tenantId, (tx) =>
      tx.query.invoicePayments.findFirst({ where: eq(schema.invoicePayments.id, memoPaymentId) }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        unapplyPayment(tx, owner, { paymentId: memoPaymentId, expectedVersion: payment!.version }),
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_IS_CREDIT" });
  });

  it("a credit nets to nothing on cash basis: income equals the cash received, on both bases", async () => {
    const invoice = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) }),
    );
    const paid = await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId,
        expectedVersion: invoice!.version,
        paymentDate: "2026-09-05",
        amountCents: 8_000,
        depositAccountId: bankLedgerId,
        method: "check",
      }),
    );
    invoiceVersion = paid.invoice.version;
    expect(paid.invoice.status).toBe("paid");

    const income = async (basis: "accrual" | "cash") =>
      withTenant(tenantId, (tx) =>
        getBalances(tx, tenantId, {
          scope: { kind: "combined" },
          from: "2026-09-01",
          to: "2026-09-30",
          basis,
          accountIds: [salesId],
        }),
      );
    const [accrual, cash] = [await income("accrual"), await income("cash")];
    // Income is credit-normal: 10,000 invoiced less the 2,000 credited.
    expect(accrual[0]?.netCents).toBe(-8_000);
    // Cash basis: the credit's settlement row recognises 2,000 of the
    // invoice's income and the memo's entry reverses 2,000 — nothing net.
    expect(cash[0]?.netCents).toBe(-8_000);
    const arCash = await withTenant(tenantId, (tx) =>
      getBalances(tx, tenantId, {
        scope: { kind: "combined" },
        asOf: "2026-09-30",
        basis: "cash",
        accountIds: [arId],
      }),
    );
    expect(arCash[0]?.netCents ?? 0).toBe(0);
  });

  it("voids: the entry is void, the settlement row gone, the invoice owes again, the number is not reused", async () => {
    const voided = await asOwner((tx) =>
      voidCreditMemo(tx, owner, { creditMemoId: memoId, expectedVersion: 1 }),
    );
    expect(voided.creditMemo).toMatchObject({ status: "void", paymentId: null, version: 2 });
    expect(voided.invoice?.status).toBe("partial");
    expect(voided.voidedEntryId).toBe(memoEntryId);
    const entry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({ where: eq(schema.journalEntries.id, memoEntryId) }),
    );
    expect(entry?.status).toBe("void");
    const row = await withTenant(tenantId, (tx) =>
      tx.query.invoicePayments.findFirst({ where: eq(schema.invoicePayments.id, memoPaymentId) }),
    );
    expect(row).toBeUndefined();
    await expect(
      asOwner((tx) => voidCreditMemo(tx, owner, { creditMemoId: memoId, expectedVersion: 2 })),
    ).rejects.toMatchObject({ code: "CREDIT_MEMO_NOT_ISSUED" });

    // A fresh credit for the 2,000 the invoice owes again: the next number.
    const invoice = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) }),
    );
    const again = await asOwner((tx) =>
      issueCreditMemo(tx, owner, {
        invoiceId,
        expectedVersion: invoice!.version,
        amountCents: 2_000,
        incomeAccountId: salesId,
        issueDate: "2026-09-06",
      }),
    );
    expect(again.creditMemo.number).toBe("CM-0002");
    expect(again.invoice.status).toBe("paid");
  });
});
