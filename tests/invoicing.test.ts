import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  startReconciliation,
  toggleReconciliationLine,
  setClosedThrough,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { importTransactions } from "../src/modules/accounting/banking/import";
import {
  findMatchCandidates,
  matchTransactionToEntry,
  resetBankLinkForEntry,
  unmatchTransaction,
} from "../src/modules/accounting/banking/match";
import {
  deriveStatus,
  lineAmountCents,
  parseQuantityHundredths,
} from "../src/modules/accounting/invoicing/lines";
import {
  formatInvoiceNumber,
  parseInvoiceNumberSuffix,
} from "../src/modules/accounting/invoicing/numbering";
import { agingBucketIndex, buildArAging } from "../src/modules/accounting/invoicing/aging";
import {
  advanceMonthly,
  recurringTemplateSchema,
  createRecurringInvoice,
  generateRecurringInvoices,
} from "../src/modules/accounting/invoicing/recurring";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createInvoiceDraft,
  deleteInvoiceDraft,
  issueInvoice,
  voidInvoice,
  loadInvoiceLines,
} from "../src/modules/accounting/invoicing/invoices";
import { recordPayment, unapplyPayment } from "../src/modules/accounting/invoicing/payments";

// =====================================================================
// Pure suite
// =====================================================================

describe("line math (P15/P16)", () => {
  it("parseQuantityHundredths", () => {
    expect(parseQuantityHundredths("1")).toBe(100);
    expect(parseQuantityHundredths("2.50")).toBe(250);
    expect(parseQuantityHundredths("0")).toBeNull();
    expect(parseQuantityHundredths("1.234")).toBeNull();
    expect(parseQuantityHundredths("-1")).toBeNull();
  });
  it("lineAmountCents rounds half away from zero in integer math", () => {
    expect(lineAmountCents(100, 1500)).toBe(1500); // 1 × $15
    expect(lineAmountCents(250, 1000)).toBe(2500); // 2.5 × $10
    expect(lineAmountCents(133, 15)).toBe(20); // 1.33 × $0.15 = 19.95 → 20
    expect(lineAmountCents(133, -15)).toBe(-20); // discount symmetric
    expect(lineAmountCents(100, 0)).toBe(0);
  });
  it("deriveStatus boundaries (P2)", () => {
    expect(deriveStatus(1000, 0)).toBe("issued");
    expect(deriveStatus(1000, 999)).toBe("partial");
    expect(deriveStatus(1000, 1000)).toBe("paid");
  });
});

describe("invoice numbering (P9)", () => {
  it("parses and formats suffixes", () => {
    expect(parseInvoiceNumberSuffix("INV-0009")).toBe(9);
    expect(parseInvoiceNumberSuffix("2024-007")).toBeNull();
    expect(formatInvoiceNumber(10)).toBe("INV-0010");
    expect(formatInvoiceNumber(12345)).toBe("INV-12345"); // grows past padding
  });
});

describe("aging buckets (P17)", () => {
  const asOf = "2026-07-21";
  it("bucket boundaries", () => {
    expect(agingBucketIndex(null, asOf)).toBe(0);
    expect(agingBucketIndex("2026-07-21", asOf)).toBe(0); // due today = current
    expect(agingBucketIndex("2026-07-20", asOf)).toBe(1); // 1 day past
    expect(agingBucketIndex("2026-06-21", asOf)).toBe(1); // 30 days
    expect(agingBucketIndex("2026-06-20", asOf)).toBe(2); // 31 days
    expect(agingBucketIndex("2026-05-22", asOf)).toBe(2); // 60
    expect(agingBucketIndex("2026-05-21", asOf)).toBe(3); // 61
    expect(agingBucketIndex("2026-04-22", asOf)).toBe(3); // 90
    expect(agingBucketIndex("2026-04-21", asOf)).toBe(4); // 91
  });
  it("groups by customer with totals; paid/partial handled", () => {
    const report = buildArAging(
      [
        { invoiceId: "1", invoiceNumber: "INV-0001", customerId: "cA", customerName: "Acme", dueDate: "2026-07-01", totalCents: 10_000, paidCents: 4_000 },
        { invoiceId: "2", invoiceNumber: "INV-0002", customerId: "cA", customerName: "Acme", dueDate: null, totalCents: 5_000, paidCents: 0 },
        { invoiceId: "3", invoiceNumber: "INV-0003", customerId: "cB", customerName: "Beta", dueDate: "2026-01-01", totalCents: 2_000, paidCents: 2_000 }, // fully paid → excluded
      ],
      asOf,
    );
    expect(report.totalCents).toBe(11_000);
    expect(report.overdueCents).toBe(6_000);
    const acme = report.rows.find((r) => r.label === "Acme")!;
    expect(acme.perMemberCents).toEqual([5_000, 6_000, 0, 0, 0, 11_000]);
    expect(report.rows.at(-1)).toMatchObject({ kind: "total" });
  });
});

describe("recurring (P11)", () => {
  it("advanceMonthly rolls months and years, keeps day", () => {
    expect(advanceMonthly("2026-01-28", 28)).toBe("2026-02-28");
    expect(advanceMonthly("2026-12-15", 15)).toBe("2027-01-15");
    expect(advanceMonthly("2026-03-01", 1)).toBe("2026-04-01");
  });
  it("template schema rejects bad shapes", () => {
    const goodLine = {
      description: "Rent",
      quantity: "1",
      unitPriceCents: 100_000,
      incomeAccountId: "00000000-0000-0000-0000-000000000000",
    };
    expect(
      recurringTemplateSchema.safeParse({ lines: [goodLine], dueInDays: 15 }).success,
    ).toBe(true);
    expect(
      recurringTemplateSchema.safeParse({ lines: [], dueInDays: 15 }).success,
    ).toBe(false);
    expect(
      recurringTemplateSchema.safeParse({ lines: [goodLine], dueInDays: -1 }).success,
    ).toBe(false);
  });
});

// =====================================================================
// DB suite
// =====================================================================

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

async function expectDbReject(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await p;
    expect.unreachable("expected the database to reject this");
  } catch (err) {
    const chain: string[] = [];
    let e: unknown = err;
    while (e) {
      chain.push(String((e as Error).message ?? e));
      e = (e as { cause?: unknown }).cause;
    }
    expect(chain.join(" | ")).toMatch(pattern);
  }
}

d("invoicing (DB)", () => {
  const STAMP = `invoicing-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let staff: LedgerCtx;
  let customerId: string;
  const acct: Record<string, string> = {};

  async function accountId(code: string): Promise<string> {
    if (acct[code]) return acct[code];
    const row = await withTenant(tenantId, (tx) =>
      tx.query.accounts.findFirst({
        where: and(
          eq(schema.accounts.tenantId, tenantId),
          eq(schema.accounts.code, code),
        ),
      }),
    );
    if (!row) throw new Error(`account ${code} missing`);
    acct[code] = row.id;
    return row.id;
  }

  const line = (cents: number, accountId: string, qty = "1") => ({
    description: "Test line",
    quantity: qty,
    unitPriceCents: cents,
    incomeAccountId: accountId,
  });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Invoicing Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    staff = { tenantId, userId: "staff", role: "staff" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    customerId = (
      await withTenant(tenantId, (tx) =>
        createCustomer(tx, owner, { name: "Acme Rentals" }),
      )
    ).id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("issues a balanced AR entry; zero and discount lines handled (T-D1)", async () => {
    const sales = await accountId("4000");
    const invoice = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-06-01",
        dueDate: "2026-06-15",
        lines: [
          line(50_000, sales),
          line(-5_000, sales), // discount
          { ...line(0, sales), description: "free note" },
        ],
      }),
    );
    expect(invoice.totalCents).toBe(45_000);
    const issued = await withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, { invoiceId: invoice.id, expectedVersion: invoice.version }),
    );
    expect(issued.status).toBe("issued");
    const entryLines = await withTenant(tenantId, (tx) =>
      tx.query.journalLines.findMany({
        where: and(
          eq(schema.journalLines.tenantId, tenantId),
          eq(schema.journalLines.entryId, issued.journalEntryId!),
        ),
      }),
    );
    // AR debit + 2 income lines (zero line skipped); sums to 0.
    expect(entryLines).toHaveLength(3);
    expect(entryLines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
    const ar = await accountId("1200");
    expect(entryLines.find((l) => l.accountId === ar)?.amountCents).toBe(45_000);
    acct.__invoiceId = issued.id;
  });

  it("payments derive status; overpayment rejected (T-D2/T-D3)", async () => {
    const invoiceId = acct.__invoiceId;
    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Ops Checking", kind: "checking" }),
    );
    acct.__bankLedger = bank.ledgerAccount.id;
    acct.__bankAccountId = bank.bankAccount.id;
    let invoice = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) }),
    );
    const p1 = await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId,
        expectedVersion: invoice!.version,
        paymentDate: "2026-06-10",
        amountCents: 20_000,
        depositAccountId: bank.ledgerAccount.id,
        method: "check",
      }),
    );
    expect(p1.invoice.status).toBe("partial");
    await expect(
      withTenant(tenantId, (tx) =>
        recordPayment(tx, owner, {
          invoiceId,
          expectedVersion: p1.invoice.version,
          paymentDate: "2026-06-11",
          amountCents: 99_999,
          depositAccountId: bank.ledgerAccount.id,
          method: "check",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVOICE_OVERPAYMENT" });
    const p2 = await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId,
        expectedVersion: p1.invoice.version,
        paymentDate: "2026-06-12",
        amountCents: 25_000,
        depositAccountId: bank.ledgerAccount.id,
        method: "bank_transfer",
      }),
    );
    expect(p2.invoice.status).toBe("paid");
    acct.__payment1 = p1.payment.id;
    acct.__payment2 = p2.payment.id;
    acct.__payment2Entry = p2.payment.journalEntryId;
  });

  it("void blocked with payments; unapply re-derives; then void works (T-D4/T-D5)", async () => {
    const invoiceId = acct.__invoiceId;
    let invoice = (await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) }),
    ))!;
    await expect(
      withTenant(tenantId, (tx) =>
        voidInvoice(tx, owner, { invoiceId, expectedVersion: invoice.version }),
      ),
    ).rejects.toMatchObject({ code: "INVOICE_HAS_PAYMENTS" });

    for (const key of ["__payment1", "__payment2"]) {
      const payment = await withTenant(tenantId, (tx) =>
        tx.query.invoicePayments.findFirst({
          where: eq(schema.invoicePayments.id, acct[key]),
        }),
      );
      const result = await withTenant(tenantId, async (tx) => {
        const r = await unapplyPayment(tx, owner, {
          paymentId: payment!.id,
          expectedVersion: payment!.version,
        });
        await resetBankLinkForEntry(tx, tenantId, r.voidedEntryId);
        return r;
      });
      expect(["issued", "partial"]).toContain(result.invoice.status);
    }
    invoice = (await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoiceId) }),
    ))!;
    expect(invoice.status).toBe("issued");
    const voided = await withTenant(tenantId, (tx) =>
      voidInvoice(tx, owner, { invoiceId, expectedVersion: invoice.version }),
    );
    expect(voided.status).toBe("void");
    // Issuance entry is now void:
    const entry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, voided.journalEntryId!),
      }),
    );
    expect(entry?.status).toBe("void");
  });

  it("reconciled deposit line blocks unapply (T-D6)", async () => {
    const sales = await accountId("4000");
    const invoice = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-06-20",
        lines: [line(10_000, sales)],
      }),
    );
    const issued = await withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, { invoiceId: invoice.id, expectedVersion: invoice.version }),
    );
    const paid = await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: issued.id,
        expectedVersion: issued.version,
        paymentDate: "2026-06-21",
        amountCents: 10_000,
        depositAccountId: acct.__bankLedger,
        method: "check",
      }),
    );
    // Reconcile the deposit line.
    const recon = await withTenant(tenantId, (tx) =>
      startReconciliation(tx, owner, {
        bankAccountId: acct.__bankAccountId,
        statementEndDate: "2026-06-30",
        statementEndBalanceCents: 10_000,
      }),
    );
    const depositLine = await withTenant(tenantId, (tx) =>
      tx.query.journalLines.findFirst({
        where: and(
          eq(schema.journalLines.tenantId, tenantId),
          eq(schema.journalLines.entryId, paid.payment.journalEntryId),
          eq(schema.journalLines.accountId, acct.__bankLedger),
        ),
      }),
    );
    await withTenant(tenantId, (tx) =>
      toggleReconciliationLine(tx, owner, {
        reconciliationId: recon.id,
        journalLineId: depositLine!.id,
        checked: true,
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        unapplyPayment(tx, owner, {
          paymentId: paid.payment.id,
          expectedVersion: paid.payment.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "ENTRY_IMMUTABLE" });
    // Uncheck to release for later tests.
    await withTenant(tenantId, (tx) =>
      toggleReconciliationLine(tx, owner, {
        reconciliationId: recon.id,
        journalLineId: depositLine!.id,
        checked: false,
      }),
    );
  });

  it("closed period blocks issuing (T-D7)", async () => {
    const sales = await accountId("4000");
    await withTenant(tenantId, (tx) =>
      setClosedThrough(tx, owner, { date: "2026-01-31" }),
    );
    const invoice = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-01-15",
        lines: [line(5_000, sales)],
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        issueInvoice(tx, owner, {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    await withTenant(tenantId, (tx) => setClosedThrough(tx, owner, { date: null }));
    await withTenant(tenantId, (tx) =>
      deleteInvoiceDraft(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
      }),
    );
  });

  it("concurrent creates get distinct numbers (T-D8)", async () => {
    const sales = await accountId("4000");
    const make = () =>
      withTenant(tenantId, (tx) =>
        createInvoiceDraft(tx, owner, {
          customerId,
          issueDate: "2026-07-01",
          lines: [line(1_000, sales)],
        }),
      );
    const [a, b] = await Promise.all([make(), make()]);
    expect(a.invoiceNumber).not.toBe(b.invoiceNumber);
  });

  it("staff can draft but not issue (P21)", async () => {
    const sales = await accountId("4000");
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, staff, {
        customerId,
        issueDate: "2026-07-02",
        lines: [line(2_000, sales)],
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        issueInvoice(tx, staff, { invoiceId: draft.id, expectedVersion: draft.version }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("recurring: catch-up drafts with period dates, cap, CAS (T-D10)", async () => {
    const sales = await accountId("4000");
    const template = await withTenant(tenantId, (tx) =>
      createRecurringInvoice(tx, owner, {
        customerId,
        name: "Rent — Test",
        dayOfMonth: 1,
        nextRunDate: "2026-05-01", // 3 periods behind (May, Jun, Jul vs late-Jul today)
        template: {
          lines: [line(120_000, sales)],
          dueInDays: 10,
        },
      }),
    );
    const result = await generateRecurringInvoices(owner);
    expect(result.errors).toHaveLength(0);
    expect(result.created).toBeGreaterThanOrEqual(3);
    const drafts = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findMany({
        where: and(
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.recurringInvoiceId, template.id),
        ),
      }),
    );
    expect(drafts.length).toBe(result.created);
    expect(drafts.every((i) => i.status === "draft")).toBe(true);
    expect(drafts.map((i) => i.issueDate).sort()[0]).toBe("2026-05-01");
    expect(drafts[0].dueDate).not.toBeNull();
    // Second run: nothing due.
    const again = await generateRecurringInvoices(owner);
    expect(again.created).toBe(0);
  });

  it("bank-feed match links WITHOUT posting; unmatch reverses; void resets (T-D11/12)", async () => {
    const sales = await accountId("4000");
    // Fresh invoice + payment landing in the bank ledger.
    const invoice = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-07-05",
        lines: [line(30_000, sales)],
      }),
    );
    const issued = await withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, { invoiceId: invoice.id, expectedVersion: invoice.version }),
    );
    const paid = await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: issued.id,
        expectedVersion: issued.version,
        paymentDate: "2026-07-06",
        amountCents: 30_000,
        depositAccountId: acct.__bankLedger,
        method: "bank_transfer",
      }),
    );
    // The same deposit arrives via the feed.
    await withTenant(tenantId, (tx) =>
      importTransactions(tx, owner, {
        bankAccountId: acct.__bankAccountId,
        txns: [
          { txnDate: "2026-07-08", description: "ACH DEPOSIT ACME", amountCents: 30_000, raw: [], dupIndex: 0 },
        ],
      }),
    );
    const [txn] = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.description, "ACH DEPOSIT ACME"),
        ),
      }),
    );
    // Candidates include the payment entry, labeled.
    const candidates = await withTenant(tenantId, (tx) =>
      findMatchCandidates(tx, tenantId, {
        ledgerAccountId: acct.__bankLedger,
        amountCents: 30_000,
        txnDate: txn.txnDate,
      }),
    );
    const target = candidates.find((c) => c.entryId === paid.payment.journalEntryId);
    expect(target).toBeDefined();
    expect(target!.label).toContain("Acme");

    const entriesBefore = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findMany({
        where: eq(schema.journalEntries.tenantId, tenantId),
      }),
    );
    await withTenant(tenantId, (tx) =>
      matchTransactionToEntry(tx, owner, {
        transactionId: txn.id,
        journalEntryId: paid.payment.journalEntryId,
      }),
    );
    const entriesAfter = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findMany({
        where: eq(schema.journalEntries.tenantId, tenantId),
      }),
    );
    expect(entriesAfter.length).toBe(entriesBefore.length); // NOTHING posted
    const linked = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findFirst({
        where: eq(schema.bankTransactions.id, txn.id),
      }),
    );
    expect(linked).toMatchObject({
      status: "posted",
      journalEntryId: paid.payment.journalEntryId,
    });
    // Candidates now exclude the linked entry.
    const candidates2 = await withTenant(tenantId, (tx) =>
      findMatchCandidates(tx, tenantId, {
        ledgerAccountId: acct.__bankLedger,
        amountCents: 30_000,
        txnDate: txn.txnDate,
      }),
    );
    expect(candidates2.some((c) => c.entryId === paid.payment.journalEntryId)).toBe(false);

    // Unmatch: link cleared, entry stays posted.
    await withTenant(tenantId, (tx) =>
      unmatchTransaction(tx, owner, { transactionId: txn.id }),
    );
    const unlinked = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findFirst({
        where: eq(schema.bankTransactions.id, txn.id),
      }),
    );
    expect(unlinked).toMatchObject({ status: "unreviewed", journalEntryId: null });
    const entryStill = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, paid.payment.journalEntryId),
      }),
    );
    expect(entryStill?.status).toBe("posted");

    // Re-match, then unapply the payment (voids entry) → P13 resets staging.
    await withTenant(tenantId, (tx) =>
      matchTransactionToEntry(tx, owner, {
        transactionId: txn.id,
        journalEntryId: paid.payment.journalEntryId,
      }),
    );
    await withTenant(tenantId, async (tx) => {
      const r = await unapplyPayment(tx, owner, {
        paymentId: paid.payment.id,
        expectedVersion: paid.payment.version,
      });
      await resetBankLinkForEntry(tx, tenantId, r.voidedEntryId);
    });
    const reset = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findFirst({
        where: eq(schema.bankTransactions.id, txn.id),
      }),
    );
    expect(reset).toMatchObject({ status: "unreviewed", journalEntryId: null });
  });

  it("draft delete cascades lines and their dimensions (T-D13)", async () => {
    const sales = await accountId("4000");
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-07-10",
        lines: [line(1_500, sales)],
      }),
    );
    const lines = await withTenant(tenantId, (tx) =>
      loadInvoiceLines(tx, tenantId, draft.id),
    );
    expect(lines).toHaveLength(1);
    await withTenant(tenantId, (tx) =>
      deleteInvoiceDraft(tx, owner, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
      }),
    );
    const gone = await withTenant(tenantId, (tx) =>
      tx.query.invoiceLines.findMany({
        where: eq(schema.invoiceLines.invoiceId, draft.id),
      }),
    );
    expect(gone).toHaveLength(0);
  });

  it("isolation: cross-tenant invoice smuggles rejected", async () => {
    const otherTenant = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: `${STAMP}-b`, name: "Other", slug: `${STAMP}-b` }])
        .returning();
      return rows[0].id;
    });
    try {
      // Tenant B cannot reference tenant A's customer (composite FK pair absent).
      await expectDbReject(
        withTenant(otherTenant, (tx) =>
          tx.insert(schema.invoices).values({
            tenantId: otherTenant,
            customerId,
            invoiceNumber: "INV-9999",
            issueDate: "2026-07-01",
            createdByClerkUserId: "attacker",
          }),
        ),
        /invoices_customer_fk|violates/,
      );
      // RLS: B sees none of A's invoicing rows.
      const visible = await withTenant(otherTenant, (tx) =>
        tx.select().from(schema.invoices),
      );
      expect(visible).toHaveLength(0);
      const customersVisible = await withTenant(otherTenant, (tx) =>
        tx.select().from(schema.customers),
      );
      expect(customersVisible).toHaveLength(0);
    } finally {
      await withSystem((tx) =>
        tx.delete(schema.tenants).where(eq(schema.tenants.id, otherTenant)),
      );
    }
  });
});
