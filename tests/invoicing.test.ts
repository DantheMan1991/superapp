import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  getDefaultEntityId,
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
  assertTemplateReferences,
  assertTemplateSaveable,
  createRecurringEntry,
  generateRecurringEntries,
  noteTemplateFailure,
  updateRecurringEntry,
} from "../src/modules/accounting/recurring/generate";
import {
  createCustomer,
  updateCustomer,
} from "../src/modules/accounting/invoicing/customers";
import {
  addContactPoint,
  listContactPoints,
} from "../src/lib/parties/contacts";
import { preferredContactValue } from "../src/lib/parties/contact-values";
import {
  createInvoiceDraft,
  deleteInvoiceDraft,
  issueInvoice,
  updateInvoiceDraft,
  voidInvoice,
  loadInvoiceLines,
} from "../src/modules/accounting/invoicing/invoices";
import {
  archiveDimensionMember,
  postEntry,
  upsertDimensionMember,
} from "../src/modules/accounting/core";
import { loadBillLines } from "../src/modules/accounting/payables/bills";
import { recordPayment, unapplyPayment } from "../src/modules/accounting/invoicing/payments";
import { listRecordHistory } from "../src/modules/accounting/history/list";
import { logAuditInTx } from "../src/lib/audit";

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
    expect(acme.perColumnCents).toEqual([5_000, 6_000, 0, 0, 0, 11_000]);
    expect(report.rows.at(-1)).toMatchObject({ kind: "total" });
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

  /**
   * THE CUSTOMER FORM'S EMAIL AND PHONE, after 0075 removed the columns they
   * used to be.
   *
   * These four cases are the contract of `setPreferredContactValue` reached
   * through the accounting path that actually calls it. The one that earns its
   * keep is the last: while the columns existed the sync was ADDITIVE and
   * clearing the box deliberately removed nothing, and the moment the box
   * became the contact point itself that behaviour turned from a safeguard into
   * a form that silently discards what somebody typed. If a future change makes
   * clearing a no-op again, this is the test that fails.
   */
  describe("customer contact details live on the party", () => {
    async function pointsOf(customerId: string) {
      return withTenant(tenantId, async (tx) => {
        const customer = await tx.query.customers.findFirst({
          where: and(
            eq(schema.customers.tenantId, tenantId),
            eq(schema.customers.id, customerId),
          ),
        });
        return listContactPoints(tx, tenantId, customer!.partyId);
      });
    }

    it("a new customer's address becomes a contact point on its party", async () => {
      const customer = await withTenant(tenantId, (tx) =>
        createCustomer(tx, owner, {
          name: "Contact Co",
          email: "Billing@Contact.example",
          phone: "(555) 010-2030",
        }),
      );

      const points = await pointsOf(customer.id);
      const email = points.find((p) => p.kind === "email")!;
      expect(email.value).toBe("Billing@Contact.example");
      // As typed for the person, matchable for the machine.
      expect(email.normalizedValue).toBe("billing@contact.example");
      expect(email.isPrimary).toBe(true);
      expect(email.label).toBe("billing");
      expect(
        points.find((p) => p.kind === "phone")?.normalizedValue,
      ).toBe("5550102030");
    });

    it("editing the address changes that point rather than adding a second", async () => {
      const customer = await withTenant(tenantId, (tx) =>
        createCustomer(tx, owner, {
          name: "Correction Co",
          email: "wrong@correction.example",
        }),
      );
      await withTenant(tenantId, (tx) =>
        updateCustomer(tx, owner, {
          customerId: customer.id,
          expectedVersion: customer.version,
          patch: { email: "right@correction.example" },
        }),
      );

      const emails = (await pointsOf(customer.id)).filter(
        (p) => p.kind === "email",
      );
      // Correcting a typo is one address, not two. A second row here would be
      // the additive sync coming back.
      expect(emails).toHaveLength(1);
      expect(emails[0].value).toBe("right@correction.example");
      expect(emails[0].isPrimary).toBe(true);
    });

    it("an edit that does not mention the address leaves it alone", async () => {
      const customer = await withTenant(tenantId, (tx) =>
        createCustomer(tx, owner, {
          name: "Rename Co",
          email: "keep@rename.example",
        }),
      );
      await withTenant(tenantId, (tx) =>
        updateCustomer(tx, owner, {
          customerId: customer.id,
          expectedVersion: customer.version,
          // `undefined` is not `""`: this is the shape a partial patch takes
          // when only the name was edited.
          patch: { name: "Rename Co Ltd" },
        }),
      );

      expect(preferredContactValue(await pointsOf(customer.id), "email")).toBe(
        "keep@rename.example",
      );
    });

    it("clearing the box removes THAT address and no other", async () => {
      const customer = await withTenant(tenantId, (tx) =>
        createCustomer(tx, owner, {
          name: "Clearing Co",
          email: "billing@clearing.example",
          phone: "555 111 2222",
        }),
      );
      // A colleague adds a second address somewhere else — in CRM, on the same
      // record. It is not the one the accounting form is showing.
      await withTenant(tenantId, async (tx) => {
        const c = await tx.query.customers.findFirst({
          where: and(
            eq(schema.customers.tenantId, tenantId),
            eq(schema.customers.id, customer.id),
          ),
        });
        await addContactPoint(tx, tenantId, c!.partyId, {
          kind: "email",
          value: "aoife@clearing.example",
          label: "mobile",
        });
      });

      await withTenant(tenantId, (tx) =>
        updateCustomer(tx, owner, {
          customerId: customer.id,
          expectedVersion: customer.version,
          patch: { email: "" },
        }),
      );

      const after = await pointsOf(customer.id);
      const emails = after.filter((p) => p.kind === "email");
      expect(emails.map((p) => p.value)).toEqual(["aoife@clearing.example"]);
      // The survivor inherits primary, so the record is not left with an email
      // and no main one.
      expect(emails[0].isPrimary).toBe(true);
      // And the phone is a different question that nobody asked.
      expect(preferredContactValue(after, "phone")).toBe("555 111 2222");
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
    const invoice = await withTenant(tenantId, (tx) =>
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

  describe("an invoice line's account is checked on the server", () => {
    /**
     * **NOTHING CHECKED IT UNTIL 2026-09-01.** Not existence — the composite
     * FK caught that as a raw constraint error — not activity, and not whether
     * it was an account anybody may pick. The picker offered income accounts
     * and that was the entire rule, so a client sending Checking's id got an
     * invoice whose issue would credit the bank register.
     *
     * The bill path got the same guard the same day and needed an exception
     * for a stock match. There is no invoice analogue, so this is the flat
     * rule.
     */
    it("REFUSES A BANK REGISTER, GRNI, and a control account", async () => {
      const bank = await withTenant(tenantId, (tx) =>
        createBankAccount(tx, owner, { name: "Guard Checking", kind: "checking" }),
      );
      for (const bad of [
        bank.ledgerAccount.id,
        await accountId("2050"),
        await accountId("1200"),
      ]) {
        await expect(
          withTenant(tenantId, (tx) =>
            createInvoiceDraft(tx, owner, {
              customerId,
              issueDate: "2026-06-20",
              lines: [line(5_000, bad)],
            }),
          ),
        ).rejects.toMatchObject({ code: "ACCOUNT_NOT_CODABLE" });
      }
    });

    it("refuses a missing account and an inactive one, by name", async () => {
      await expect(
        withTenant(tenantId, (tx) =>
          createInvoiceDraft(tx, owner, {
            customerId,
            issueDate: "2026-06-20",
            lines: [line(5_000, crypto.randomUUID())],
          }),
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });

      const other = await accountId("4900");
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.accounts)
          .set({ isActive: false })
          .where(eq(schema.accounts.id, other)),
      );
      try {
        await expect(
          withTenant(tenantId, (tx) =>
            createInvoiceDraft(tx, owner, {
              customerId,
              issueDate: "2026-06-20",
              lines: [line(5_000, other)],
            }),
          ),
        ).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
      } finally {
        await withTenant(tenantId, (tx) =>
          tx
            .update(schema.accounts)
            .set({ isActive: true })
            .where(eq(schema.accounts.id, other)),
        );
      }
    });

    it("ALLOWS A LIABILITY — the floor is codable, not income-typed", async () => {
      /**
       * Invoicing a customer deposit credits Unearned Revenue. The picker
       * offers income accounts as a convenience; a server rule that insisted
       * on the type would refuse a correct entry. This is the assertion that
       * says which rule the server holds.
       */
      const deposits = await accountId("2400");
      const invoice = await withTenant(tenantId, (tx) =>
        createInvoiceDraft(tx, owner, {
          customerId,
          issueDate: "2026-06-20",
          lines: [line(5_000, deposits)],
        }),
      );
      expect(invoice.totalCents).toBe(5_000);
      await withTenant(tenantId, (tx) =>
        deleteInvoiceDraft(tx, owner, {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
        }),
      );
    });

    it("checks every line, and the same bad account twice is refused once", async () => {
      // One good line does not launder a bad one, and `distinct` dedupe at the
      // top of the check does not skip a repeated offender.
      const sales = await accountId("4000");
      const grni = await accountId("2050");
      await expect(
        withTenant(tenantId, (tx) =>
          createInvoiceDraft(tx, owner, {
            customerId,
            issueDate: "2026-06-20",
            lines: [line(1_000, sales), line(2_000, grni), line(3_000, grni)],
          }),
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_NOT_CODABLE" });
    });

    it("guards the edit path too, since it re-inserts every line", async () => {
      const sales = await accountId("4000");
      const invoice = await withTenant(tenantId, (tx) =>
        createInvoiceDraft(tx, owner, {
          customerId,
          issueDate: "2026-06-20",
          lines: [line(5_000, sales)],
        }),
      );
      await expect(
        withTenant(tenantId, async (tx) =>
          updateInvoiceDraft(tx, owner, {
            invoiceId: invoice.id,
            expectedVersion: invoice.version,
            patch: {
              customerId,
              issueDate: "2026-06-20",
              lines: [line(5_000, await accountId("2050"))],
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_NOT_CODABLE" });
      await withTenant(tenantId, (tx) =>
        deleteInvoiceDraft(tx, owner, {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
        }),
      );
    });
  });

  it("closed period blocks issuing (T-D7)", async () => {
    const sales = await accountId("4000");
    await withTenant(tenantId, async (tx) =>
      setClosedThrough(tx, owner, { entityId: await getDefaultEntityId(tx, tenantId), date: "2026-01-31" }),
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
    await withTenant(tenantId, async (tx) => setClosedThrough(tx, owner, { entityId: await getDefaultEntityId(tx, tenantId), date: null }));
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

  it("an UNATTENDED run credits the schedule's author, not the caller", async () => {
    // The nightly sweep has nobody at the keyboard, and
    // `created_by_clerk_user_id` is NOT NULL — so it needs a real id rather
    // than a sentinel. Whoever wrote the schedule down is the truthful answer
    // and the only person who ever decided any of this; it also means the
    // History panel names somebody who can explain the row.
    const sales = await accountId("4000");
    const template = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.recurringEntries)
        .values({
          tenantId,
          kind: "invoice",
          name: "Attribution — Test",
          customerId,
          dayOfMonth: 2,
          nextRunDate: "2026-07-02",
          template: { kind: "invoice", lines: [line(9_900, sales)], dueInDays: 7 },
          createdByClerkUserId: "user-who-wrote-the-schedule",
        })
        .returning();
      return row;
    });
    await generateRecurringEntries(
      // A caller id that must NOT end up on the records.
      { ...owner, userId: "cron-has-no-user" },
      { unattended: true },
    );
    const drafts = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findMany({
        where: and(
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.recurringEntryId, template.id),
        ),
      }),
    );
    expect(drafts.length).toBeGreaterThan(0);
    expect(
      drafts.every((i) => i.createdByClerkUserId === "user-who-wrote-the-schedule"),
    ).toBe(true);
  });

  it("recurring invoice: catch-up drafts with period dates, cap, CAS (T-D10)", async () => {
    // Recurring invoices moved from their own table into `recurring_entries`
    // alongside journals and bills. Same guarantees, one engine: this test
    // outlived the module it was written for.
    const sales = await accountId("4000");
    const template = await withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.recurringEntries)
        .values({
          tenantId,
          kind: "invoice",
          name: "Rent — Test",
          customerId,
          dayOfMonth: 1,
          nextRunDate: "2026-05-01", // 3 periods behind (May, Jun, Jul vs late-Jul today)
          template: {
            kind: "invoice",
            lines: [line(120_000, sales)],
            dueInDays: 10,
          },
          createdByClerkUserId: owner.userId,
        })
        .returning();
      return row;
    });
    const result = await generateRecurringEntries(owner);
    expect(result.errors).toHaveLength(0);
    expect(result.created).toBeGreaterThanOrEqual(3);
    const drafts = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findMany({
        where: and(
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.recurringEntryId, template.id),
        ),
      }),
    );
    expect(drafts.length).toBe(result.created);
    expect(drafts.every((i) => i.status === "draft")).toBe(true);
    expect(drafts.map((i) => i.issueDate).sort()[0]).toBe("2026-05-01");
    expect(drafts[0].dueDate).not.toBeNull();
    // Second run: nothing due.
    const again = await generateRecurringEntries(owner);
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

  // ---- dimensions on an invoice line --------------------------------------

  /**
   * **A STANDING INSTRUCTION SAYS WHAT IT WAS FOR.**
   *
   * The last write surface to get a tag picker, and the only one where nobody
   * is watching when the tag is used: a template names its members once and a
   * sweep applies them every month at 6am. `recurringJournalLineSchema` has
   * accepted `dimensionMemberIds` and `generate.ts` has threaded them since
   * before any dimension had a member — the gap was a form that could send one.
   */
  describe("recurring templates carry their tags", () => {
    const memberOf = async (name: string) => {
      const m = await withTenant(tenantId, (tx) =>
        upsertDimensionMember(tx, owner, {
          dimensionType: "enterprise",
          packEntityId: crypto.randomUUID(),
          displayName: name,
        }),
      );
      return m.id;
    };

    const newVendor = async (name: string) =>
      withTenant(tenantId, async (tx) => {
        const [party] = await tx
          .insert(schema.parties)
          .values({ tenantId, kind: "organization", displayName: name })
          .returning();
        const [v] = await tx
          .insert(schema.vendors)
          .values({ tenantId, partyId: party.id, name })
          .returning();
        return v.id;
      });

    const addTemplate = async (values: Record<string, unknown>) =>
      withTenant(tenantId, async (tx) => {
        const [row] = await tx
          .insert(schema.recurringEntries)
          .values({
            tenantId,
            dayOfMonth: 4,
            createdByClerkUserId: owner.userId,
            ...values,
          } as never)
          .returning();
        return row;
      });

    /** Every member id tagged on the journal lines of one entry. */
    const entryTags = async (entryId: string) =>
      withTenant(tenantId, async (tx) => {
        const lines = await tx
          .select({ id: schema.journalLines.id })
          .from(schema.journalLines)
          .where(
            and(
              eq(schema.journalLines.tenantId, tenantId),
              eq(schema.journalLines.entryId, entryId),
            ),
          );
        const ids = new Set(lines.map((l) => l.id));
        const dims = await tx
          .select({
            journalLineId: schema.lineDimensions.journalLineId,
            memberId: schema.lineDimensions.memberId,
          })
          .from(schema.lineDimensions)
          .where(eq(schema.lineDimensions.tenantId, tenantId));
        return dims
          .filter((d) => d.journalLineId && ids.has(d.journalLineId))
          .map((d) => d.memberId);
      });

    it("AN AUTO-POSTING JOURNAL POSTS ITS TAG, with nobody at the keyboard", async () => {
      /**
       * The case the enterprises dossier called impossible. It is not: the
       * template line carries the member, `generate.ts` maps it onto
       * `postEntry`, and `unattended` changes only WHO the entry is credited
       * to — never the payload. So an auto-posting template tags the ledger at
       * 6am exactly as a person would have.
       */
      const cash = await accountId("1000");
      const exp = await accountId("6700");
      const broilers = await memberOf("Broilers (recurring)");
      const template = await addTemplate({
        kind: "journal",
        name: "Depreciation — tagged",
        nextRunDate: "2026-07-04",
        autoPost: true,
        template: {
          kind: "journal",
          lines: [
            { accountId: exp, amountCents: 5_000, dimensionMemberIds: [broilers] },
            { accountId: cash, amountCents: -5_000 },
          ],
        },
      });

      const result = await generateRecurringEntries(
        { ...owner, userId: "cron-has-no-user" },
        { unattended: true },
      );
      expect(result.errors).toHaveLength(0);
      expect(result.tagsDropped).toBe(0);

      const entries = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.memo, "Depreciation — tagged"),
          ),
        }),
      );
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => e.status === "posted")).toBe(true);
      for (const e of entries) {
        expect(await entryTags(e.id)).toEqual([broilers]);
      }
      expect(template.id).toBeTruthy();
    });

    it("RETIRING A MEMBER DROPS THE TAG AND DOES NOT STOP THE SCHEDULE", async () => {
      /**
       * **THE INVARIANT THE WHOLE DECISION RESTS ON.**
       *
       * Every write path refuses an inactive member, so before this a retired
       * line of business threw `DIMENSION_INVALID` inside the sweep, rolled
       * back every catch-up month with it, and left `next_run_date` where it
       * was — so it failed again the next morning, and every morning after,
       * with no screen naming a template, no last-error column, and no update
       * action to repair it with. A monthly rent bill would simply stop.
       *
       * `archiveDimensionMember`'s own contract settles which way to go:
       * "archived members stop being taggable; existing tags keep reporting".
       * Stop being TAGGABLE. The entry is still right; only its split is
       * coarser.
       *
       * Three periods behind on purpose: the drop is counted once per
       * TEMPLATE, not once per line and not once per month.
       */
      const cash = await accountId("1000");
      const exp = await accountId("6700");
      const gone = await memberOf("Wound up");
      await withTenant(tenantId, (tx) =>
        archiveDimensionMember(tx, owner, { memberId: gone }),
      );
      const template = await addTemplate({
        kind: "journal",
        name: "Retired tag — journal",
        nextRunDate: "2026-05-04", // three periods behind the suite's late-July
        autoPost: true,
        template: {
          kind: "journal",
          lines: [
            // The SAME retired member on both lines: one stale tag to fix.
            { accountId: exp, amountCents: 700, dimensionMemberIds: [gone] },
            { accountId: cash, amountCents: -700, dimensionMemberIds: [gone] },
          ],
        },
      });

      const result = await generateRecurringEntries(owner);
      expect(result.errors).toHaveLength(0);
      expect(result.tagsDropped).toBe(1);

      const entries = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.memo, "Retired tag — journal"),
          ),
        }),
      );
      expect(entries.length).toBeGreaterThanOrEqual(3);
      for (const e of entries) {
        expect(await entryTags(e.id)).toEqual([]);
      }

      // The schedule MOVED. This is the half that was breaking.
      const after = await withTenant(tenantId, (tx) =>
        tx.query.recurringEntries.findFirst({
          where: eq(schema.recurringEntries.id, template.id),
        }),
      );
      expect(after!.nextRunDate > "2026-05-04").toBe(true);
      expect(after!.lastGeneratedAt).not.toBeNull();
    });

    it("keeps the live tag on a line that also named a retired one", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6700");
      const live = await memberOf("Still trading");
      const dead = await memberOf("Also wound up");
      await withTenant(tenantId, (tx) =>
        archiveDimensionMember(tx, owner, { memberId: dead }),
      );
      await addTemplate({
        kind: "journal",
        name: "Partly retired",
        nextRunDate: "2026-07-04",
        autoPost: true,
        template: {
          kind: "journal",
          lines: [
            {
              accountId: exp,
              amountCents: 300,
              dimensionMemberIds: [live, dead],
            },
            { accountId: cash, amountCents: -300 },
          ],
        },
      });

      const result = await generateRecurringEntries(owner);
      expect(result.tagsDropped).toBe(1);
      const entries = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.memo, "Partly retired"),
          ),
        }),
      );
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(await entryTags(e.id)).toEqual([live]);
      }
    });

    describe("a template's accounts are checked where somebody is looking", () => {
      /**
       * **`createRecurringEntryAction` VALIDATED THE SHAPE AND NOTHING ELSE**
       * until 2026-09-01. Any uuid passed as an account, and the first anybody
       * heard of it was an error row in a 6am sweep that no screen shows and
       * no column keeps — the exact failure `journalTemplateBalances` was
       * written to avoid. The action now calls `assertTemplateReferences`
       * before the insert; this proves what that function refuses and, just
       * as much, what it lets through.
       */
      it("REFUSES an invoice template on a register and a bill template on GRNI", async () => {
        const bank = await withTenant(tenantId, (tx) =>
          createBankAccount(tx, owner, { name: "Template Checking", kind: "checking" }),
        );
        await expect(
          withTenant(tenantId, (tx) =>
            assertTemplateReferences(tx, tenantId, {
              kind: "invoice",
              dueInDays: 30,
              lines: [
                {
                  description: "Rent",
                  quantity: "1",
                  unitPriceCents: 10_000,
                  incomeAccountId: bank.ledgerAccount.id,
                },
              ],
            }),
          ),
        ).rejects.toMatchObject({ code: "ACCOUNT_NOT_CODABLE" });

        await expect(
          withTenant(tenantId, async (tx) =>
            assertTemplateReferences(tx, tenantId, {
              kind: "bill",
              dueInDays: 30,
              lines: [
                {
                  description: "Feed",
                  amountCents: 10_000,
                  accountId: await accountId("2050"),
                },
              ],
            }),
          ),
        ).rejects.toMatchObject({ code: "ACCOUNT_NOT_CODABLE" });
      });

      it("LETS A JOURNAL TEMPLATE NAME A REGISTER, as the hand-written journal may", async () => {
        /**
         * `isCodableAccount` is "NOT applied to the JOURNAL, deliberately" —
         * a journal has to be able to name any account. A recurring journal is
         * a journal. The only thing it may not name is an account that does
         * not exist or is switched off.
         */
        const bank = await withTenant(tenantId, (tx) =>
          createBankAccount(tx, owner, { name: "Journal Checking", kind: "checking" }),
        );
        const exp = await accountId("6700");
        await expect(
          withTenant(tenantId, (tx) =>
            assertTemplateReferences(tx, tenantId, {
              kind: "journal",
              lines: [
                { accountId: exp, amountCents: 500 },
                { accountId: bank.ledgerAccount.id, amountCents: -500 },
              ],
            }),
          ),
        ).resolves.toBeUndefined();

        await expect(
          withTenant(tenantId, (tx) =>
            assertTemplateReferences(tx, tenantId, {
              kind: "journal",
              lines: [
                { accountId: exp, amountCents: 500 },
                { accountId: crypto.randomUUID(), amountCents: -500 },
              ],
            }),
          ),
        ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });

        // Inactive is the OTHER thing a journal template may not name, and the
        // branch a future "route journals through the floor too" edit would
        // silently change.
        const other = await accountId("4900");
        await withTenant(tenantId, (tx) =>
          tx
            .update(schema.accounts)
            .set({ isActive: false })
            .where(eq(schema.accounts.id, other)),
        );
        try {
          await expect(
            withTenant(tenantId, (tx) =>
              assertTemplateReferences(tx, tenantId, {
                kind: "journal",
                lines: [
                  { accountId: exp, amountCents: 500 },
                  { accountId: other, amountCents: -500 },
                ],
              }),
            ),
          ).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
        } finally {
          await withTenant(tenantId, (tx) =>
            tx
              .update(schema.accounts)
              .set({ isActive: true })
              .where(eq(schema.accounts.id, other)),
          );
        }
      });

      it("still fails CLOSED at generation for a template that went bad after it was saved", async () => {
        /**
         * The save-time check cannot see the future: an account can be turned
         * into a register after the template names it. Generation re-checks
         * and reports the template rather than posting revenue to Checking —
         * and, as with an inactive account, produces nothing for that month.
         */
        const bank = await withTenant(tenantId, (tx) =>
          createBankAccount(tx, owner, { name: "Late Checking", kind: "checking" }),
        );
        // Inserted directly, bypassing the action — which is exactly the
        // shape of a template that was valid when saved.
        const template = await addTemplate({
          kind: "invoice",
          name: "Went bad",
          customerId,
          nextRunDate: "2026-06-04",
          template: {
            kind: "invoice",
            dueInDays: 30,
            lines: [
              {
                description: "Rent",
                quantity: "1",
                unitPriceCents: 10_000,
                incomeAccountId: bank.ledgerAccount.id,
              },
            ],
          },
        });
        const result = await generateRecurringEntries(owner);
        // Deactivated BEFORE any assertion can throw past it: a failed
        // template keeps its `next_run_date`, so left active it would stay due
        // and the tenant-wide counter test that follows would go red for this
        // test's failure rather than its own.
        await withTenant(tenantId, (tx) =>
          tx
            .update(schema.recurringEntries)
            .set({ isActive: false })
            .where(eq(schema.recurringEntries.id, template.id)),
        );
        const failed = result.errors.find((e) => e.recurringEntryId === template.id);
        expect(failed?.error).toBe("ACCOUNT_NOT_CODABLE");
        const drafts = await withTenant(tenantId, (tx) =>
          tx.query.invoices.findMany({
            where: and(
              eq(schema.invoices.tenantId, tenantId),
              eq(schema.invoices.recurringEntryId, template.id),
            ),
          }),
        );
        expect(drafts).toHaveLength(0);
      });

      it("THE OP REFUSES BEFORE THE INSERT — the line the change is about", async () => {
        /**
         * `createRecurringEntryAction` is behind `gate()`; no test can call it.
         * The validated insert is now an op so this can exist. Delete the
         * `assertTemplateReferences` call from `createRecurringEntry` and this
         * is the test that goes red.
         */
        const grni = await accountId("2050");
        const vendorId = await newVendor("Refused at save");
        await expect(
          withTenant(tenantId, (tx) =>
            createRecurringEntry(tx, owner, {
              name: "Refused at save",
              vendorId,
              dayOfMonth: 4,
              nextRunDate: "2027-06-04",
              template: {
                kind: "bill",
                dueInDays: 30,
                lines: [{ description: "Feed", amountCents: 10_000, accountId: grni }],
              },
            }),
          ),
        ).rejects.toMatchObject({ code: "ACCOUNT_NOT_CODABLE" });
        const saved = await withTenant(tenantId, (tx) =>
          tx.query.recurringEntries.findMany({
            where: and(
              eq(schema.recurringEntries.tenantId, tenantId),
              eq(schema.recurringEntries.name, "Refused at save"),
            ),
          }),
        );
        expect(saved).toHaveLength(0);

        // And the same op saves a good one, so the refusal is the guard and
        // not the op being broken.
        const ok = await withTenant(tenantId, async (tx) =>
          createRecurringEntry(tx, owner, {
            name: "Saved fine",
            vendorId,
            dayOfMonth: 4,
            nextRunDate: "2027-06-04",
            template: {
              kind: "bill",
              dueInDays: 30,
              lines: [
                { description: "Feed", amountCents: 10_000, accountId: await accountId("5000") },
              ],
            },
          }),
        );
        expect(ok.kind).toBe("bill");
        await withTenant(tenantId, (tx) =>
          tx
            .update(schema.recurringEntries)
            .set({ isActive: false })
            .where(eq(schema.recurringEntries.id, ok.id)),
        );
      });
    });

    describe("the sweep leaves a note on the row", () => {
      /**
       * **A TEMPLATE THAT FAILED AT 6AM USED TO BE UNNAMED ON EVERY SURFACE.**
       * The loop reduced the error to a code, pushed it to an array the cron
       * caller serialised and nobody read, and the list rendered the row
       * exactly as it had the day before. That is what forced the retired-tag
       * decision and what made save-time account validation matter.
       *
       * `last_error` holds the CODE and `last_error_at` the moment; a clean run
       * clears both in the same UPDATE that advances the schedule. Nothing
       * else clears them.
       */
      const rowOf = (id: string) =>
        withTenant(tenantId, (tx) =>
          tx.query.recurringEntries.findFirst({
            where: eq(schema.recurringEntries.id, id),
          }),
        );
      const pause = (id: string) =>
        withTenant(tenantId, (tx) =>
          tx
            .update(schema.recurringEntries)
            .set({ isActive: false })
            .where(eq(schema.recurringEntries.id, id)),
        );

      it("WRITES THE CODE when a template fails, and nothing when one succeeds", async () => {
        const bank = await withTenant(tenantId, (tx) =>
          createBankAccount(tx, owner, { name: "Noted Checking", kind: "checking" }),
        );
        const bad = await addTemplate({
          kind: "invoice",
          name: "Noted — bad",
          customerId,
          nextRunDate: "2026-06-04",
          template: {
            kind: "invoice",
            dueInDays: 30,
            lines: [
              {
                description: "Rent",
                quantity: "1",
                unitPriceCents: 10_000,
                incomeAccountId: bank.ledgerAccount.id,
              },
            ],
          },
        });
        const cash = await accountId("1000");
        const exp = await accountId("6700");
        const good = await addTemplate({
          kind: "journal",
          name: "Noted — good",
          nextRunDate: "2026-06-04",
          autoPost: true,
          template: {
            kind: "journal",
            lines: [
              { accountId: exp, amountCents: 700 },
              { accountId: cash, amountCents: -700 },
            ],
          },
        });

        const result = await generateRecurringEntries(owner);
        // Pause both BEFORE any assertion can throw past it, so a failure here
        // is blamed here and not on the tenant-wide counter test below.
        await pause(bad.id);
        await pause(good.id);

        const badRow = (await rowOf(bad.id))!;
        const goodRow = (await rowOf(good.id))!;
        // The relation, per template: named in errors ⇔ carries a note.
        const named = new Set(result.errors.map((e) => e.recurringEntryId));
        expect(named.has(bad.id)).toBe(true);
        expect(badRow.lastError).toBe("ACCOUNT_NOT_CODABLE");
        expect(badRow.lastErrorAt).not.toBeNull();
        // And the failure did NOT move the schedule or bump the version — the
        // note is the sweep's, and a Pause pressed on a stale page still lands.
        expect(badRow.nextRunDate).toBe("2026-06-04");
        expect(badRow.version).toBe(bad.version);

        expect(named.has(good.id)).toBe(false);
        expect(goodRow.lastError).toBe("");
        expect(goodRow.lastErrorAt).toBeNull();
        expect(goodRow.lastGeneratedAt).not.toBeNull();
      });

      it("A CLEAN RUN CLEARS IT, in the same update that advances the schedule", async () => {
        const cash = await accountId("1000");
        const exp = await accountId("6700");
        const template = await addTemplate({
          kind: "journal",
          name: "Noted — recovers",
          nextRunDate: "2026-06-04",
          autoPost: true,
          // A note left by an earlier morning, before somebody fixed the cause.
          lastError: "ACCOUNT_INACTIVE",
          lastErrorAt: new Date("2026-08-01T11:00:00Z"),
          template: {
            kind: "journal",
            lines: [
              { accountId: exp, amountCents: 800 },
              { accountId: cash, amountCents: -800 },
            ],
          },
        });
        const seeded = (await rowOf(template.id))!;
        expect(seeded.lastError).toBe("ACCOUNT_INACTIVE");
        // The precondition the clear is proved against. A raw insert drops an
        // unknown key silently, and a column that defaulted NULL would make the
        // `toBeNull()` below pass with the clear removed from the success SET.
        expect(seeded.lastErrorAt).not.toBeNull();

        const result = await generateRecurringEntries(owner);
        await pause(template.id);
        expect(result.errors.find((e) => e.recurringEntryId === template.id)).toBeUndefined();

        const row = (await rowOf(template.id))!;
        expect(row.lastError).toBe("");
        expect(row.lastErrorAt).toBeNull();
        expect(row.lastGeneratedAt).not.toBeNull();
        expect(row.nextRunDate > "2026-06-04").toBe(true);
      });

      it("NEVER OVERWRITES A ROW SOMEBODY ELSE MOVED — the CAS on the loaded version", async () => {
        /**
         * The note is written after the template's own transaction rolled
         * back, against the version the sweep LOADED. If the row moved in
         * between — a concurrent success, or once editing exists a save — the
         * note is stale and must not land. Driven directly, because the
         * interleaving cannot be produced from outside the loop.
         */
        const cash = await accountId("1000");
        const exp = await accountId("6700");
        const template = await addTemplate({
          kind: "journal",
          name: "Noted — moved",
          nextRunDate: "2027-06-04",
          isActive: false,
          template: {
            kind: "journal",
            lines: [
              { accountId: exp, amountCents: 900 },
              { accountId: cash, amountCents: -900 },
            ],
          },
        });

        const stale = await noteTemplateFailure(
          tenantId,
          { id: template.id, version: template.version + 1 },
          "UNKNOWN",
        );
        expect(stale).toBe(false);
        expect((await rowOf(template.id))!.lastError).toBe("");

        const fresh = await noteTemplateFailure(
          tenantId,
          { id: template.id, version: template.version },
          "UNKNOWN",
        );
        expect(fresh).toBe(true);
        const row = (await rowOf(template.id))!;
        expect(row.lastError).toBe("UNKNOWN");
        expect(row.lastErrorAt).not.toBeNull();
        // Still the same version: the note does not count as an edit.
        expect(row.version).toBe(template.version);
      });
    });

    describe("a standing instruction can be corrected", () => {
      /**
       * **NO UPDATE PATH OF ANY KIND EXISTED UNTIL 2026-09-01.** A wrong
       * amount, a retired tag, a mis-coded account or a typo in the name meant
       * pause it and write a new one — and after the failure note landed on the
       * row (the same day's earlier PR) there was, for the first time,
       * something visible to correct and no way to correct it.
       *
       * The op is a full replace under a version CAS. `kind` is frozen; party
       * is editable within the kind; `isActive` is not in the SET.
       */
      const rowOf = (id: string) =>
        withTenant(tenantId, (tx) =>
          tx.query.recurringEntries.findFirst({
            where: eq(schema.recurringEntries.id, id),
          }),
        );
      const pause = (id: string) =>
        withTenant(tenantId, (tx) =>
          tx
            .update(schema.recurringEntries)
            .set({ isActive: false })
            .where(eq(schema.recurringEntries.id, id)),
        );
      const journalTemplate = (cash: string, exp: string, cents: number) => ({
        kind: "journal" as const,
        lines: [
          { accountId: exp, amountCents: cents },
          { accountId: cash, amountCents: -cents },
        ],
      });

      it("THE NEXT RUN CANNOT MOVE BACK OVER MONTHS ALREADY GENERATED", async () => {
        /**
         * Invoice and bill generation carry no idempotency key — they always
         * insert — so a next-run moved from October back to June would make
         * the next sweep create four more invoices for months already
         * invoiced. The stored `next_run_date` IS the walked frontier, written
         * with `last_generated_at` under the version CAS. Delete the guard in
         * the op and this goes red.
         */
        const cash = await accountId("1000");
        const exp = await accountId("6700");
        const row = await addTemplate({
          kind: "journal",
          name: "Edited — walked",
          nextRunDate: "2026-06-04",
          template: journalTemplate(cash, exp, 1_300),
        });
        await generateRecurringEntries(owner);
        const walked = (await rowOf(row.id))!;
        await pause(row.id);
        expect(walked.lastGeneratedAt).not.toBeNull();
        expect(walked.nextRunDate > "2026-06-04").toBe(true);

        await expect(
          withTenant(tenantId, (tx) =>
            updateRecurringEntry(tx, owner, {
              id: row.id,
              expectedVersion: walked.version,
              name: walked.name,
              dayOfMonth: 4,
              nextRunDate: "2026-06-04",
              template: journalTemplate(cash, exp, 1_300),
            }),
          ),
        ).rejects.toMatchObject({ code: "RECURRING_SCHEDULE_BACKWARD" });
        // Refused means untouched — same version, same frontier.
        const after = (await rowOf(row.id))!;
        expect(after.version).toBe(walked.version);
        expect(after.nextRunDate).toBe(walked.nextRunDate);

        // Forward is fine — pause-and-resume already does that.
        const moved = await withTenant(tenantId, (tx) =>
          updateRecurringEntry(tx, owner, {
            id: row.id,
            expectedVersion: walked.version,
            name: walked.name,
            dayOfMonth: 4,
            nextRunDate: "2027-01-04",
            template: journalTemplate(cash, exp, 1_300),
          }),
        );
        expect(moved.after.nextRunDate).toBe("2027-01-04");
        expect(moved.after.version).toBe(walked.version + 1);
      });

      it("a template that has never run may be re-dated freely", async () => {
        const cash = await accountId("1000");
        const exp = await accountId("6700");
        const row = await addTemplate({
          kind: "journal",
          name: "Edited — never ran",
          nextRunDate: "2027-06-04",
          isActive: false,
          template: journalTemplate(cash, exp, 100),
        });
        expect(row.lastGeneratedAt).toBeNull();
        const { after } = await withTenant(tenantId, (tx) =>
          updateRecurringEntry(tx, owner, {
            id: row.id,
            expectedVersion: row.version,
            name: row.name,
            dayOfMonth: 4,
            nextRunDate: "2026-01-04",
            template: journalTemplate(cash, exp, 100),
          }),
        );
        expect(after.nextRunDate).toBe("2026-01-04");
      });

      it("A RETIRED TAG IS REFUSED AT SAVE — on update, and on create through the op", async () => {
        /**
         * Generation DROPS a retired tag (#338) because failing inside the
         * sweep is failing silently. A save is the one moment somebody can
         * see the tag and take it off, so a save that still names it is
         * refused, exactly as the invoice and bill edit pages refuse. This is
         * `assertTemplateSaveable`, and deliberately NOT
         * `assertTemplateReferences`, which runs at 6am. Delete the saveable
         * call from either op and its half goes red.
         */
        const cash = await accountId("1000");
        const exp = await accountId("6700");
        const gone = await withTenant(tenantId, (tx) =>
          upsertDimensionMember(tx, owner, {
            dimensionType: "enterprise",
            packEntityId: crypto.randomUUID(),
            displayName: "Wound up (edit)",
          }),
        );
        const row = await addTemplate({
          kind: "journal",
          name: "Edited — retired tag",
          nextRunDate: "2027-06-04",
          isActive: false,
          template: {
            kind: "journal",
            lines: [
              { accountId: exp, amountCents: 500, dimensionMemberIds: [gone.id] },
              { accountId: cash, amountCents: -500 },
            ],
          },
        });
        await withTenant(tenantId, (tx) =>
          archiveDimensionMember(tx, owner, { memberId: gone.id }),
        );

        const stillTagged = {
          kind: "journal" as const,
          lines: [
            { accountId: exp, amountCents: 500, dimensionMemberIds: [gone.id] },
            { accountId: cash, amountCents: -500 },
          ],
        };
        await expect(
          withTenant(tenantId, (tx) =>
            updateRecurringEntry(tx, owner, {
              id: row.id,
              expectedVersion: row.version,
              name: row.name,
              dayOfMonth: 4,
              nextRunDate: "2027-06-04",
              template: stillTagged,
            }),
          ),
        ).rejects.toMatchObject({ code: "DIMENSION_INVALID" });
        await expect(
          withTenant(tenantId, (tx) =>
            createRecurringEntry(tx, owner, {
              name: "Created — retired tag",
              dayOfMonth: 4,
              nextRunDate: "2027-06-04",
              template: stillTagged,
            }),
          ),
        ).rejects.toMatchObject({ code: "DIMENSION_INVALID" });

        // Taken off, it saves — and the sweep would have dropped it anyway.
        const { after } = await withTenant(tenantId, (tx) =>
          updateRecurringEntry(tx, owner, {
            id: row.id,
            expectedVersion: row.version,
            name: row.name,
            dayOfMonth: 4,
            nextRunDate: "2027-06-04",
            template: journalTemplate(cash, exp, 500),
          }),
        );
        expect(after.version).toBe(row.version + 1);
      });

      it("refuses a kind change, an inactive party, an unbalanced journal, a stale version and a wrong id", async () => {
        const cash = await accountId("1000");
        const exp = await accountId("6700");
        const row = await addTemplate({
          kind: "journal",
          name: "Edited — refusals",
          nextRunDate: "2027-06-04",
          isActive: false,
          template: journalTemplate(cash, exp, 250),
        });
        const base = {
          id: row.id,
          expectedVersion: row.version,
          name: row.name,
          dayOfMonth: 4,
          nextRunDate: "2027-06-04",
        };

        // kind is fixed
        const kindVendor = await newVendor("Kind change");
        await expect(
          withTenant(tenantId, (tx) =>
            updateRecurringEntry(tx, owner, {
              ...base,
              vendorId: kindVendor,
              template: {
                kind: "bill",
                dueInDays: 30,
                lines: [{ description: "x", amountCents: 250, accountId: exp }],
              },
            }),
          ),
        ).rejects.toMatchObject({ code: "RECURRING_TEMPLATE_INVALID" });

        // the same parse the sweep does: a journal that does not balance
        await expect(
          withTenant(tenantId, (tx) =>
            updateRecurringEntry(tx, owner, {
              ...base,
              template: {
                kind: "journal",
                lines: [
                  { accountId: exp, amountCents: 250 },
                  { accountId: cash, amountCents: -240 },
                ],
              },
            }),
          ),
        ).rejects.toMatchObject({ code: "RECURRING_TEMPLATE_INVALID" });

        // stale version: refused and untouched
        await expect(
          withTenant(tenantId, (tx) =>
            updateRecurringEntry(tx, owner, {
              ...base,
              expectedVersion: row.version + 5,
              name: "Should not land",
              template: journalTemplate(cash, exp, 250),
            }),
          ),
        ).rejects.toMatchObject({ code: "STALE_VERSION" });
        expect((await rowOf(row.id))!.name).toBe("Edited — refusals");

        // wrong id
        await expect(
          withTenant(tenantId, (tx) =>
            updateRecurringEntry(tx, owner, {
              ...base,
              id: crypto.randomUUID(),
              template: journalTemplate(cash, exp, 250),
            }),
          ),
        ).rejects.toMatchObject({ code: "RECURRING_NOT_FOUND" });

        // an inactive party, which used to surface only at 6am
        const vendorId = await newVendor("Retired supplier");
        const bill = await addTemplate({
          kind: "bill",
          name: "Edited — dead supplier",
          vendorId,
          nextRunDate: "2027-06-04",
          isActive: false,
          template: {
            kind: "bill",
            dueInDays: 30,
            lines: [{ description: "Feed", amountCents: 900, accountId: exp }],
          },
        });
        await withTenant(tenantId, (tx) =>
          tx
            .update(schema.vendors)
            .set({ isActive: false })
            .where(eq(schema.vendors.id, vendorId)),
        );
        await expect(
          withTenant(tenantId, (tx) =>
            updateRecurringEntry(tx, owner, {
              id: bill.id,
              expectedVersion: bill.version,
              name: bill.name,
              vendorId,
              dayOfMonth: 4,
              nextRunDate: "2027-06-04",
              template: {
                kind: "bill",
                dueInDays: 30,
                lines: [{ description: "Feed", amountCents: 950, accountId: exp }],
              },
            }),
          ),
        ).rejects.toMatchObject({ code: "VENDOR_INACTIVE" });
        await expect(
          withTenant(tenantId, (tx) =>
            assertTemplateSaveable(tx, tenantId, {
              vendorId,
              template: {
                kind: "bill",
                dueInDays: 30,
                lines: [{ description: "Feed", amountCents: 950, accountId: exp }],
              },
            }),
          ),
        ).rejects.toMatchObject({ code: "VENDOR_INACTIVE" });
      });

      it("THE ACCEPTANCE TEST: a failing template is edited, generates clean, and the note clears", async () => {
        /**
         * The two open items were one problem seen from both ends: the note
         * says a template is broken, the edit is how it gets fixed. A
         * register-as-income template fails and carries the code; edited to a
         * real income account, the next run writes the draft and clears the
         * note in the same UPDATE that advances the schedule.
         */
        const bank = await withTenant(tenantId, (tx) =>
          createBankAccount(tx, owner, { name: "Fixed Checking", kind: "checking" }),
        );
        const sales = await accountId("4000");
        const row = await addTemplate({
          kind: "invoice",
          name: "Edited — fixed",
          customerId,
          nextRunDate: "2026-06-04",
          template: {
            kind: "invoice",
            dueInDays: 30,
            lines: [
              {
                description: "Rent",
                quantity: "1",
                unitPriceCents: 10_000,
                incomeAccountId: bank.ledgerAccount.id,
              },
            ],
          },
        });
        await generateRecurringEntries(owner);
        const failed = (await rowOf(row.id))!;
        expect(failed.lastError).toBe("ACCOUNT_NOT_CODABLE");
        expect(failed.nextRunDate).toBe("2026-06-04");

        const { after } = await withTenant(tenantId, (tx) =>
          updateRecurringEntry(tx, owner, {
            id: row.id,
            expectedVersion: failed.version,
            name: failed.name,
            customerId,
            dayOfMonth: 4,
            nextRunDate: failed.nextRunDate,
            template: {
              kind: "invoice",
              dueInDays: 30,
              lines: [
                {
                  description: "Rent",
                  quantity: "1",
                  unitPriceCents: 10_000,
                  incomeAccountId: sales,
                },
              ],
            },
          }),
        );
        // An edit does NOT clear the note — "edited" is not "fixed".
        expect(after.lastError).toBe("ACCOUNT_NOT_CODABLE");

        await generateRecurringEntries(owner);
        await pause(row.id);
        const fixed = (await rowOf(row.id))!;
        expect(fixed.lastError).toBe("");
        expect(fixed.lastErrorAt).toBeNull();
        expect(fixed.nextRunDate > "2026-06-04").toBe(true);
        const drafts = await withTenant(tenantId, (tx) =>
          tx.query.invoices.findMany({
            where: and(
              eq(schema.invoices.tenantId, tenantId),
              eq(schema.invoices.recurringEntryId, row.id),
            ),
          }),
        );
        expect(drafts.length).toBeGreaterThanOrEqual(3);
      });
    });

    it("COUNTS WHAT IT WROTE, not the months it walked", async () => {
      /**
       * **`postEntry` IS IDEMPOTENT ON `recurring:<templateId>:<date>` AND THE
       * LOOP IGNORED THE ANSWER.** It incremented `created` — and `posted`,
       * and the deferral — once per period walked, whether or not the period
       * wrote anything. `createEntry` already checks `deduped` before writing
       * its audit row; this loop did not.
       *
       * It is not reachable through the schedule: `advanceMonthly` only moves
       * forward, `next_run_date` has no backward writer, and nothing else emits
       * that key prefix. So the test makes it reachable the only honest way —
       * by putting the entry for the FIRST catch-up month there in advance,
       * under the key generation will use. That is exactly the state a retried
       * or half-rolled-back run would leave, which is the case the idempotency
       * key exists for in the first place.
       *
       * **AND THE DEFERRAL IS THE HALF WORTH THE SETUP.** The first version of
       * this test asserted `deferredToDraft === 0` with no closed period
       * anywhere in reach, which cannot fail under either version of the code —
       * a tautology sitting under a docblock claiming to cover it. So the
       * fixture closes the period through July and pre-creates only June:
       *
       * | period | closed | already there | old code | new code |
       * | --- | --- | --- | --- | --- |
       * | June | yes | yes | created, deferred | nothing |
       * | July | yes | no | created, deferred | created, deferred |
       * | Aug  | no  | no | created, posted | created, posted |
       *
       * Which makes all three gates discriminating at once: revert the
       * `created` gate and it is one too many, revert the deferral gate and it
       * is two deferrals instead of one.
       *
       * June is pre-created as a DRAFT, not a posting — `assertPeriodOpen`
       * would refuse a posted entry into a closed period, and a draft is the
       * honest shape of what a half-rolled-back run leaves there anyway.
       */
      const cash = await accountId("1000");
      const exp = await accountId("6700");
      const template = await addTemplate({
        kind: "journal",
        name: "Counted once",
        nextRunDate: "2026-06-04",
        autoPost: true,
        template: {
          kind: "journal",
          lines: [
            { accountId: exp, amountCents: 1_100 },
            { accountId: cash, amountCents: -1_100 },
          ],
        },
      });

      await withTenant(tenantId, async (tx) =>
        setClosedThrough(tx, owner, {
          entityId: await getDefaultEntityId(tx, tenantId),
          date: "2026-07-31",
        }),
      );

      // June, already there under the key generation will use — a draft,
      // because its period is closed and a posting could not have landed.
      await withTenant(tenantId, async (tx) =>
        postEntry(tx, owner, {
          entityId: await getDefaultEntityId(tx, tenantId),
          status: "draft",
          entryDate: "2026-06-04",
          memo: "Counted once",
          lines: [
            { accountId: exp, amountCents: 1_100 },
            { accountId: cash, amountCents: -1_100 },
          ],
          idempotencyKey: `recurring:${template.id}:2026-06-04`,
        }),
      );

      const result = await generateRecurringEntries(owner);
      // Reset before any assertion can throw past it — T-D7's own shape.
      await withTenant(tenantId, async (tx) =>
        setClosedThrough(tx, owner, {
          entityId: await getDefaultEntityId(tx, tenantId),
          date: null,
        }),
      );
      expect(result.errors).toHaveLength(0);

      /**
       * **ASSERTED AS A RELATION, NOT AS THREE NUMBERS.** How many periods fall
       * between the template's first run and today depends on when the suite is
       * run, so `periodsWalked` is 3 this month and 4 the next — the neighbouring
       * catch-up test uses `toBeGreaterThanOrEqual` for the same reason.
       *
       * The invariant does not move: exactly one of those periods was already
       * there, so exactly one fewer record was written than periods walked. That
       * is the whole bug, stated in a form the calendar cannot break.
       */
      expect(result.periodsWalked).toBeGreaterThanOrEqual(3);
      // Exactly one period was already there, whatever the calendar says.
      expect(result.created).toBe(result.periodsWalked - 1);
      /**
       * **ONE deferral, not two.** June and July are both closed and both want
       * to post, so the old code counted a deferral for each — including June,
       * where it wrote nothing at all and would have told somebody an entry
       * was newly stuck when the run had left nothing.
       */
      expect(result.deferredToDraft).toBe(1);
      // Everything written either posted or was deferred; nothing else.
      expect(result.posted).toBe(result.created - result.deferredToDraft);

      // One entry per period, not two for the month that was already there.
      const entries = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.memo, "Counted once"),
          ),
        }),
      );
      expect(entries).toHaveLength(result.periodsWalked);
      expect(new Set(entries.map((e) => e.entryDate)).size).toBe(
        result.periodsWalked,
      );

      // And the schedule moved past every period regardless.
      const after = await withTenant(tenantId, (tx) =>
        tx.query.recurringEntries.findFirst({
          where: eq(schema.recurringEntries.id, template.id),
        }),
      );
      expect(after!.nextRunDate > "2026-08-04").toBe(true);
    });

    it("an invoice template's tag reaches the generated draft", async () => {
      const sales = await accountId("4000");
      const member = await memberOf("Market stall");
      const template = await addTemplate({
        kind: "invoice",
        name: "Tagged rent — invoice",
        customerId,
        nextRunDate: "2026-07-04",
        template: {
          kind: "invoice",
          dueInDays: 7,
          lines: [{ ...line(4_500, sales), dimensionMemberIds: [member] }],
        },
      });

      await generateRecurringEntries(owner);
      const drafts = await withTenant(tenantId, (tx) =>
        tx.query.invoices.findMany({
          where: and(
            eq(schema.invoices.tenantId, tenantId),
            eq(schema.invoices.recurringEntryId, template.id),
          ),
        }),
      );
      expect(drafts.length).toBeGreaterThan(0);
      for (const d of drafts) {
        const lines = await withTenant(tenantId, (tx) =>
          loadInvoiceLines(tx, tenantId, d.id),
        );
        expect(lines[0].dimensionMemberIds).toEqual([member]);
      }
    });

    it("a bill template's single tag reaches the generated draft", async () => {
      /**
       * The bill branch of the dialog builds ONE line, so its tag is the
       * template's rather than a line's. That is the shape, not a shortcut —
       * with exactly one line the two are the same object.
       */
      const exp = await accountId("6700");
      const vendorId = await newVendor("Feed mill (recurring)");
      const member = await memberOf("Broiler shed");
      await addTemplate({
        kind: "bill",
        name: "Tagged feed — bill",
        vendorId,
        nextRunDate: "2026-07-04",
        template: {
          kind: "bill",
          dueInDays: 14,
          lines: [
            {
              description: "Monthly feed",
              amountCents: 31_840,
              accountId: exp,
              dimensionMemberIds: [member],
            },
          ],
        },
      });

      await generateRecurringEntries(owner);
      const bills = await withTenant(tenantId, (tx) =>
        tx.query.bills.findMany({
          where: and(
            eq(schema.bills.tenantId, tenantId),
            eq(schema.bills.vendorId, vendorId),
          ),
        }),
      );
      expect(bills.length).toBeGreaterThan(0);
      for (const b of bills) {
        const lines = await withTenant(tenantId, (tx) =>
          loadBillLines(tx, tenantId, b.id),
        );
        expect(lines[0].dimensionMemberIds).toEqual([member]);
      }
    });
  });

  describe("a line says which part of the business earned it", () => {
    /**
     * **THE READ AND THE WRITE BOTH EXISTED FOR MONTHS AND NOTHING JOINED
     * THEM.** `invoiceLineSchema` has taken `dimensionMemberIds` and
     * `loadInvoiceLines` has returned them since long before any dimension had
     * a member; `issueInvoice` copies them onto the income journal line. The
     * gap was a form that could send one.
     */
    const memberId = async (name: string) => {
      const m = await withTenant(tenantId, (tx) =>
        upsertDimensionMember(tx, owner, {
          dimensionType: "enterprise",
          packEntityId: crypto.randomUUID(),
          displayName: name,
        }),
      );
      return m.id;
    };

    it("SURVIVES A DRAFT EDIT, which is the whole reason this is a test", async () => {
      /**
       * **`updateInvoiceDraft` DELETES EVERY LINE AND RE-INSERTS IT** — its own
       * comment says "whole-replace lines (dims cascade with them)". So a tag
       * is only as durable as the round trip through the form: read it back,
       * carry it, send it again. The builder's `LineRow` did not carry it and
       * the edit page's `lines.map` dropped it, so the first save of a tagged
       * draft would have wiped every tag on it. Both are fixed; this is what
       * stops them regressing.
       */
      const sales = await accountId("4000");
      const broilers = await memberId("Broilers");
      const draft = await withTenant(tenantId, (tx) =>
        createInvoiceDraft(tx, owner, {
          customerId,
          issueDate: "2026-07-20",
          lines: [{ ...line(5_000, sales), dimensionMemberIds: [broilers] }],
        }),
      );
      expect(
        (await withTenant(tenantId, (tx) => loadInvoiceLines(tx, tenantId, draft.id)))[0]
          .dimensionMemberIds,
      ).toEqual([broilers]);

      // An edit that changes something ELSE must not disturb the tag — this is
      // the form saving a description change on a tagged line.
      const read = await withTenant(tenantId, (tx) =>
        loadInvoiceLines(tx, tenantId, draft.id),
      );
      await withTenant(tenantId, (tx) =>
        updateInvoiceDraft(tx, owner, {
          invoiceId: draft.id,
          expectedVersion: draft.version,
          patch: {
            customerId,
            issueDate: "2026-07-20",
            lines: read.map((l) => ({
              description: "Renamed",
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              incomeAccountId: l.incomeAccountId,
              dimensionMemberIds: l.dimensionMemberIds,
            })),
          },
        }),
      );
      const after = await withTenant(tenantId, (tx) =>
        loadInvoiceLines(tx, tenantId, draft.id),
      );
      expect(after[0].description).toBe("Renamed");
      expect(after[0].dimensionMemberIds).toEqual([broilers]);
    });

    it("drops the tag when the edit genuinely says none", async () => {
      // The other direction: untagging has to work too, and the whole-replace
      // is what makes it free.
      const sales = await accountId("4000");
      const beef = await memberId("Beef");
      const draft = await withTenant(tenantId, (tx) =>
        createInvoiceDraft(tx, owner, {
          customerId,
          issueDate: "2026-07-21",
          lines: [{ ...line(2_500, sales), dimensionMemberIds: [beef] }],
        }),
      );
      await withTenant(tenantId, (tx) =>
        updateInvoiceDraft(tx, owner, {
          invoiceId: draft.id,
          expectedVersion: draft.version,
          patch: {
            customerId,
            issueDate: "2026-07-21",
            lines: [line(2_500, sales)],
          },
        }),
      );
      const after = await withTenant(tenantId, (tx) =>
        loadInvoiceLines(tx, tenantId, draft.id),
      );
      expect(after[0].dimensionMemberIds).toEqual([]);
    });

    it("CARRIES THE TAG ONTO THE INCOME LINE AT ISSUE, and leaves tax untagged", async () => {
      /**
       * The payoff, and the reason the tax line is asserted too: a dimension
       * answers *which part of the business earned this*, and sales tax
       * collected is money held for somebody else. `issueInvoice` already knew
       * that; this pins it now that a person can actually set a tag.
       */
      const sales = await accountId("4000");
      const pigs = await memberId("Pigs");
      const draft = await withTenant(tenantId, (tx) =>
        createInvoiceDraft(tx, owner, {
          customerId,
          issueDate: "2026-07-22",
          lines: [{ ...line(9_000, sales), dimensionMemberIds: [pigs] }],
        }),
      );
      const issued = await withTenant(tenantId, (tx) =>
        issueInvoice(tx, owner, {
          invoiceId: draft.id,
          expectedVersion: draft.version,
        }),
      );
      const tagged = await withTenant(tenantId, (tx) =>
        tx
          .select({
            accountId: schema.journalLines.accountId,
            memberId: schema.lineDimensions.memberId,
          })
          .from(schema.journalLines)
          .leftJoin(
            schema.lineDimensions,
            eq(schema.lineDimensions.journalLineId, schema.journalLines.id),
          )
          .where(eq(schema.journalLines.entryId, issued.journalEntryId!)),
      );
      const income = tagged.filter((r) => r.accountId === sales);
      expect(income).toHaveLength(1);
      expect(income[0].memberId).toBe(pigs);
      // Every other line on the entry — the receivable — carries none.
      expect(
        tagged.filter((r) => r.accountId !== sales).every((r) => r.memberId === null),
      ).toBe(true);
    });
  });


  /**
   * THE REASON `listRecordHistory` TAKES SEVERAL TARGETS.
   *
   * A payment is audited against the PAYMENT row, not the invoice, so a panel
   * filtering on the invoice alone would show "created, issued" and silently
   * omit the money — which is the half somebody opens the history for.
   */
  it("an invoice's history includes events audited against its payments", async () => {
    const sales = await accountId("4000");
    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "History Checking", kind: "checking" }),
    );
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-06-01",
        dueDate: "2026-06-30",
        lines: [line(30_000, sales)],
      }),
    );
    const issued = await withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
      }),
    );
    await withTenant(tenantId, (tx) =>
      logAuditInTx(tx, {
        action: "invoice.issued",
        tenantId,
        actorClerkUserId: owner.userId,
        targetType: "invoice",
        targetId: issued.id,
        meta: { number: issued.invoiceNumber },
      }),
    );
    const payment = await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: issued.id,
        expectedVersion: issued.version,
        paymentDate: "2026-06-10",
        amountCents: 10_000,
        depositAccountId: bank.ledgerAccount.id,
        method: "check",
      }),
    );
    await withTenant(tenantId, (tx) =>
      logAuditInTx(tx, {
        action: "invoice.payment_recorded",
        tenantId,
        actorClerkUserId: owner.userId,
        targetType: "invoice_payment",
        targetId: payment.payment.id,
        meta: { invoiceId: issued.id },
      }),
    );

    // The invoice alone finds only its own event...
    const invoiceOnly = await withTenant(tenantId, (tx) =>
      listRecordHistory(tx, tenantId, [{ type: "invoice", id: issued.id }]),
    );
    expect(invoiceOnly.map((e) => e.action)).toEqual(["invoice.issued"]);

    // ...and passing the payment too is what makes the panel complete.
    const full = await withTenant(tenantId, (tx) =>
      listRecordHistory(tx, tenantId, [
        { type: "invoice", id: issued.id },
        { type: "invoice_payment", id: payment.payment.id },
      ]),
    );
    expect(full.map((e) => e.action).sort()).toEqual([
      "invoice.issued",
      "invoice.payment_recorded",
    ]);
    // Newest first, and rendered rather than raw.
    expect(full[0].at.getTime()).toBeGreaterThanOrEqual(full[1].at.getTime());
    expect(full.map((e) => e.label)).toContain("Payment recorded");
  });

  it("a record's history never includes another record's events", async () => {
    const sales = await accountId("4000");
    const a = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-06-01",
        lines: [line(1_000, sales)],
      }),
    );
    const b = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-06-01",
        lines: [line(2_000, sales)],
      }),
    );
    await withTenant(tenantId, (tx) =>
      logAuditInTx(tx, {
        action: "invoice.draft_updated",
        tenantId,
        actorClerkUserId: owner.userId,
        targetType: "invoice",
        targetId: b.id,
      }),
    );
    const forA = await withTenant(tenantId, (tx) =>
      listRecordHistory(tx, tenantId, [{ type: "invoice", id: a.id }]),
    );
    expect(forA).toEqual([]);
  });

  it("isolation: cross-tenant invoice smuggles rejected", async () => {
    const otherTenant = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: `${STAMP}-b`, name: "Other", slug: `${STAMP}-b` }])
        .returning();
      return rows[0].id;
    });
    // B needs a company of its own, so the insert below fails on the CUSTOMER
    // foreign key rather than on a missing company — the assertion names which.
    const otherEntity = await withTenant(otherTenant, async (tx) => {
      const [e] = await tx
        .insert(schema.entities)
        .values({ tenantId: otherTenant, name: "Other Co", isDefault: true })
        .returning();
      return e.id;
    });
    try {
      // Tenant B cannot reference tenant A's customer (composite FK pair absent).
      await expectDbReject(
        withTenant(otherTenant, (tx) =>
          tx.insert(schema.invoices).values({
            tenantId: otherTenant,
            entityId: otherEntity,
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
