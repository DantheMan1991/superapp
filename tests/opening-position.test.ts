import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { getBalances, getDefaultEntityId, setBooksStartOn } from "../src/modules/accounting/core";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import { recordPayment } from "../src/modules/accounting/invoicing/payments";
import { createVendor } from "../src/modules/accounting/payables/vendors";
import { recordBillPayment } from "../src/modules/accounting/payables/payments";
import {
  getOpeningPosition,
  recordOpeningBill,
  recordOpeningInvoice,
} from "../src/modules/accounting/opening/position";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";

/**
 * The opening position (ADR 0037), run as an owner through real RLS.
 *
 * What this file certifies: an open invoice or bill needs the day and must be
 * dated before it; issuing one posts the receivable (or payable) against
 * Opening Balance Equity ON the day, not income on its own date; on the
 * accrual basis the new books never show that income, while on the cash basis
 * the collection is this year's income under the line's own account; and the
 * page's read lists the documents and shows the plug.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const START = "2026-01-01";

d("opening position", () => {
  const STAMP = `opening-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;
  let entityId: string;
  let customerId: string;
  let vendorId: string;
  let bankLedgerId: string;
  let ar: string;
  let ap: string;
  let obe: string;
  let income: string;
  let expense: string;

  const ctx = () => ({ tenantId, userId: OWNER, role: "owner" as const });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const scope = () => ({ kind: "one" as const, entityId });
  const net = (rows: Array<{ accountId: string; netCents: number }>, accountId: string) =>
    rows.find((r) => r.accountId === accountId)?.netCents ?? 0;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Opening Farm", slug: STAMP })
        .returning();
      tenantId = tenant.id;
      await tx
        .insert(schema.tenantModules)
        .values([{ tenantId, moduleId: "accounting", enabled: true }])
        .onConflictDoNothing();
    });
    await asOwner(async (tx) => {
      await provisionAccounting(tx, tenantId);
      entityId = await getDefaultEntityId(tx, tenantId);
      customerId = (await createCustomer(tx, ctx(), { name: "Maple Street Market" })).id;
      vendorId = (await createVendor(tx, ctx(), { name: "Tractor Supply" })).id;
      bankLedgerId = (
        await createBankAccount(tx, ctx(), { name: "Farm Checking", kind: "checking" })
      ).ledgerAccount.id;
      const accounts = await tx.query.accounts.findMany({
        where: eq(schema.accounts.tenantId, tenantId),
      });
      const by = (pred: (a: (typeof accounts)[number]) => boolean) => accounts.find(pred)!.id;
      ar = by((a) => a.subtype === "accounts_receivable" && a.isSystem);
      ap = by((a) => a.subtype === "accounts_payable" && a.isSystem);
      obe = by((a) => a.subtype === "opening_balance" && a.isSystem);
      income = by((a) => a.accountType === "income" && a.isActive);
      expense = by((a) => a.accountType === "expense" && a.isActive);
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("an open invoice needs the day, and must be dated before it", async () => {
    const input = {
      entityId,
      partyId: customerId,
      documentDate: "2025-11-15",
      dueDate: "2025-12-15",
      amountCents: 50_000,
      accountId: income,
    };
    await expect(asOwner((tx) => recordOpeningInvoice(tx, ctx(), input))).rejects.toMatchObject({
      code: "BOOKS_START_UNSET",
    });
    await asOwner((tx) => setBooksStartOn(tx, ctx(), { entityId, date: START }));
    await expect(
      asOwner((tx) =>
        recordOpeningInvoice(tx, ctx(), { ...input, documentDate: START, dueDate: null }),
      ),
    ).rejects.toMatchObject({ code: "OPENING_NOT_BEFORE_START" });
    // Nothing half-made: the refused draft was rolled back with its issue.
    expect(
      await asOwner((tx) =>
        tx.query.invoices.findMany({ where: eq(schema.invoices.tenantId, tenantId) }),
      ),
    ).toHaveLength(0);
  });

  it("issuing posts the receivable against Opening Balance Equity on the day, never income", async () => {
    const invoice = await asOwner((tx) =>
      recordOpeningInvoice(tx, ctx(), {
        entityId,
        partyId: customerId,
        number: "INV-2025-118",
        documentDate: "2025-11-15",
        dueDate: "2025-12-15",
        amountCents: 50_000,
        accountId: income,
      }),
    );
    expect(invoice).toMatchObject({
      status: "issued",
      isOpening: true,
      issueDate: "2025-11-15",
      dueDate: "2025-12-15",
      totalCents: 50_000,
    });

    const entry = await asOwner((tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, invoice.journalEntryId!),
      }),
    );
    expect(entry).toMatchObject({ entryDate: START, source: "invoice", status: "posted" });
    const lines = await asOwner((tx) =>
      tx.query.journalLines.findMany({ where: eq(schema.journalLines.entryId, entry!.id) }),
    );
    expect(lines.map((l) => [l.accountId, l.amountCents]).sort()).toEqual(
      [
        [ar, 50_000],
        [obe, -50_000],
      ].sort(),
    );

    const onTheDay = await asOwner((tx) =>
      getBalances(tx, tenantId, { scope: scope(), asOf: START }),
    );
    expect(net(onTheDay, ar)).toBe(50_000);
    expect(net(onTheDay, obe)).toBe(-50_000);
    expect(net(onTheDay, income)).toBe(0);
  });

  it("when it is paid, the cash basis counts the line's income in that month and accrual never does", async () => {
    const invoice = (
      await asOwner((tx) =>
        tx.query.invoices.findMany({ where: eq(schema.invoices.tenantId, tenantId) }),
      )
    )[0];
    await asOwner((tx) =>
      recordPayment(tx, ctx(), {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        paymentDate: "2026-01-20",
        amountCents: 50_000,
        depositAccountId: bankLedgerId,
        method: "check",
      }),
    );
    const january = { scope: scope(), from: "2026-01-01", to: "2026-01-31" };
    const cash = await asOwner((tx) => getBalances(tx, tenantId, { ...january, basis: "cash" }));
    expect(net(cash, income)).toBe(-50_000);
    expect(net(cash, bankLedgerId)).toBe(50_000);
    expect(net(cash, ar)).toBe(0);

    const accrual = await asOwner((tx) => getBalances(tx, tenantId, { ...january, basis: "accrual" }));
    expect(net(accrual, income)).toBe(0);
    // Receivable on the day, collected in January: nets to nothing.
    expect(net(accrual, ar)).toBe(0);
    expect(net(accrual, bankLedgerId)).toBe(50_000);
  });

  it("an open bill mirrors it: payable against Opening Balance Equity on the day, expense on the cash basis when paid", async () => {
    const bill = await asOwner((tx) =>
      recordOpeningBill(tx, ctx(), {
        entityId,
        partyId: vendorId,
        number: "7781",
        documentDate: "2025-12-01",
        dueDate: "2025-12-31",
        amountCents: 30_000,
        accountId: expense,
      }),
    );
    expect(bill).toMatchObject({ status: "approved", isOpening: true, billDate: "2025-12-01" });
    const lines = await asOwner((tx) =>
      tx.query.journalLines.findMany({ where: eq(schema.journalLines.entryId, bill.journalEntryId!) }),
    );
    expect(lines.map((l) => [l.accountId, l.amountCents]).sort()).toEqual(
      [
        [obe, 30_000],
        [ap, -30_000],
      ].sort(),
    );
    const entry = await asOwner((tx) =>
      tx.query.journalEntries.findFirst({ where: eq(schema.journalEntries.id, bill.journalEntryId!) }),
    );
    expect(entry?.entryDate).toBe(START);

    await asOwner((tx) =>
      recordBillPayment(tx, ctx(), {
        billId: bill.id,
        expectedVersion: bill.version,
        paymentDate: "2026-01-25",
        amountCents: 30_000,
        paidFromAccountId: bankLedgerId,
        method: "check",
      }),
    );
    const january = { scope: scope(), from: "2026-01-01", to: "2026-01-31" };
    const cash = await asOwner((tx) => getBalances(tx, tenantId, { ...january, basis: "cash" }));
    expect(net(cash, expense)).toBe(30_000);
    const accrual = await asOwner((tx) => getBalances(tx, tenantId, { ...january, basis: "accrual" }));
    expect(net(accrual, expense)).toBe(0);
  });

  it("the position lists both documents and names the plug", async () => {
    const position = await asOwner((tx) => getOpeningPosition(tx, tenantId, entityId));
    expect(position.booksStartOn).toBe(START);
    expect(position.invoices.map((i) => [i.number, i.customerName, i.status, i.totalCents])).toEqual([
      ["INV-2025-118", "Maple Street Market", "paid", 50_000],
    ]);
    expect(position.bills.map((b) => [b.number, b.vendorName, b.status, b.totalCents])).toEqual([
      ["7781", "Tractor Supply", "paid", 30_000],
    ]);
    expect(position.obeAccountId).toBe(obe);
    // As of the day itself, before either was paid: the receivable, the
    // payable, and the plug that balances them.
    const rows = position.standing!.rows;
    expect(rows.find((r) => r.account.id === ar)?.debitCents).toBe(50_000);
    expect(rows.find((r) => r.account.id === ap)?.creditCents).toBe(30_000);
    expect(rows.find((r) => r.account.id === obe)?.creditCents).toBe(20_000);
    expect(position.standing!.totalDebitCents).toBe(position.standing!.totalCreditCents);
  });

  it("an ordinary invoice still posts income on its own date", async () => {
    const invoices = await asOwner((tx) =>
      tx.query.invoices.findMany({
        where: and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.isOpening, false)),
      }),
    );
    expect(invoices).toHaveLength(0);
  });
});
