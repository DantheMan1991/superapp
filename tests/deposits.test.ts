import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { createEntity, type LedgerCtx } from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { importTransactions } from "../src/modules/accounting/banking/import";
import { findMatchCandidates } from "../src/modules/accounting/banking/match";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createInvoiceDraft,
  issueInvoice,
} from "../src/modules/accounting/invoicing/invoices";
import {
  recordPayment,
  unapplyPayment,
} from "../src/modules/accounting/invoicing/payments";
import {
  depositMemo,
  listUndepositedPayments,
  recordDeposit,
  voidDeposit,
} from "../src/modules/accounting/banking/deposits";

describe("depositMemo (pure)", () => {
  it("names the one customer, or counts the payments", () => {
    expect(depositMemo([{ customerName: "Acme Rentals" }])).toBe("Deposit — Acme Rentals");
    expect(
      depositMemo([{ customerName: "Acme Rentals" }, { customerName: "Beta Farm" }]),
    ).toBe("Deposit — 2 payments");
  });
});

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * Bank deposits: payments held in Undeposited Funds banked together as one
 * entry, the feed row that matches it, and the void that undoes it.
 */
d("bank deposits (DB)", () => {
  const STAMP = `deposits-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let staff: LedgerCtx;
  let customerId: string;
  let undepositedId: string;
  let salesId: string;
  let register: { bankAccountId: string; ledgerAccountId: string; entityId: string };
  // Set by the first test, read by the rest.
  let drawer: { p1: string; p2: string; direct: string; inv1Version: number; inv1: string };
  let depositId: string;
  let entryId: string;

  /** The deposits table lets only owners write (its RLS), so the transaction says so. */
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
        lines: [
          {
            description: "Test line",
            quantity: "1",
            unitPriceCents: cents,
            incomeAccountId: salesId,
          },
        ],
      }),
    );
    return withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, { invoiceId: draft.id, expectedVersion: draft.version }),
    );
  }

  async function paid(
    invoice: { id: string; version: number },
    cents: number,
    paymentDate: string,
    depositAccountId: string,
  ) {
    return withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        paymentDate,
        amountCents: cents,
        depositAccountId,
        method: "check",
      }),
    );
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Deposits Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    staff = { tenantId, userId: "staff", role: "staff" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    customerId = (
      await withTenant(tenantId, (tx) => createCustomer(tx, owner, { name: "Acme Rentals" }))
    ).id;
    undepositedId = await accountId("1250");
    salesId = await accountId("4000");
    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Farm Checking", kind: "checking" }),
    );
    register = {
      bankAccountId: bank.bankAccount.id,
      ledgerAccountId: bank.ledgerAccount.id,
      entityId: bank.bankAccount.entityId,
    };
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("lists what waits in Undeposited Funds, oldest first, and not what went straight to the bank", async () => {
    const inv1 = await issued(30_000);
    const p1 = await paid(inv1, 30_000, "2026-09-02", undepositedId);
    const inv2 = await issued(12_500);
    const p2 = await paid(inv2, 12_500, "2026-09-01", undepositedId);
    const inv3 = await issued(5_000);
    const direct = await paid(inv3, 5_000, "2026-09-03", register.ledgerAccountId);

    const waiting = await withTenant(tenantId, (tx) => listUndepositedPayments(tx, tenantId));
    expect(waiting.map((p) => p.id)).toEqual([p2.payment.id, p1.payment.id]);
    expect(waiting[0]).toMatchObject({
      customerName: "Acme Rentals",
      invoiceNumber: inv2.invoiceNumber,
      amountCents: 12_500,
      entityId: register.entityId,
      accountId: undepositedId,
    });
    drawer = {
      p1: p1.payment.id,
      p2: p2.payment.id,
      direct: direct.payment.id,
      inv1: inv1.id,
      inv1Version: p1.invoice.version,
    };
  });

  it("records a deposit: one entry Dr the register / Cr Undeposited Funds, the payments claimed", async () => {
    const result = await asOwner((tx) =>
      recordDeposit(tx, owner, {
        bankAccountId: register.bankAccountId,
        depositDate: "2026-09-05",
        paymentIds: [drawer.p1, drawer.p2],
      }),
    );
    depositId = result.deposit.id;
    entryId = result.entryId;
    expect(result.deposit).toMatchObject({
      totalCents: 42_500,
      status: "posted",
      memo: "Deposit — 2 payments",
      entityId: register.entityId,
      bankAccountId: register.bankAccountId,
      journalEntryId: entryId,
    });

    const { entry, lines } = await withTenant(tenantId, async (tx) => ({
      entry: await tx.query.journalEntries.findFirst({
        where: and(eq(schema.journalEntries.tenantId, tenantId), eq(schema.journalEntries.id, entryId)),
      }),
      lines: await tx.query.journalLines.findMany({
        where: and(eq(schema.journalLines.tenantId, tenantId), eq(schema.journalLines.entryId, entryId)),
      }),
    }));
    expect(entry).toMatchObject({ status: "posted", source: "deposit", sourceId: depositId });
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountId === register.ledgerAccountId)?.amountCents).toBe(42_500);
    expect(lines.find((l) => l.accountId === undepositedId)?.amountCents).toBe(-42_500);

    const payments = await withTenant(tenantId, (tx) =>
      tx.query.invoicePayments.findMany({
        where: and(
          eq(schema.invoicePayments.tenantId, tenantId),
          inArray(schema.invoicePayments.id, [drawer.p1, drawer.p2, drawer.direct]),
        ),
      }),
    );
    expect(payments.find((p) => p.id === drawer.p1)?.depositId).toBe(depositId);
    expect(payments.find((p) => p.id === drawer.p2)?.depositId).toBe(depositId);
    expect(payments.find((p) => p.id === drawer.direct)?.depositId).toBeNull();
    expect(await withTenant(tenantId, (tx) => listUndepositedPayments(tx, tenantId))).toEqual([]);
  });

  it("refuses an empty slip, a payment already banked, a payment that never waited, and staff", async () => {
    const attempt = (ctx: LedgerCtx, paymentIds: string[]) =>
      asOwner((tx) =>
        recordDeposit(tx, ctx, {
          bankAccountId: register.bankAccountId,
          depositDate: "2026-09-06",
          paymentIds,
        }),
      );
    await expect(attempt(owner, [])).rejects.toMatchObject({ code: "DEPOSIT_EMPTY" });
    await expect(attempt(owner, [drawer.p1])).rejects.toMatchObject({
      code: "DEPOSIT_PAYMENT_UNAVAILABLE",
    });
    await expect(attempt(owner, [drawer.direct])).rejects.toMatchObject({
      code: "DEPOSIT_PAYMENT_UNAVAILABLE",
    });
    await expect(attempt(staff, [drawer.p1])).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Nothing above left a deposit behind.
    const count = await withTenant(tenantId, (tx) => tx.select().from(schema.deposits));
    expect(count).toHaveLength(1);
  });

  it("a deposited payment cannot be unapplied on its own", async () => {
    const payment = await withTenant(tenantId, (tx) =>
      tx.query.invoicePayments.findFirst({
        where: and(eq(schema.invoicePayments.tenantId, tenantId), eq(schema.invoicePayments.id, drawer.p1)),
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        unapplyPayment(tx, owner, { paymentId: drawer.p1, expectedVersion: payment!.version }),
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_DEPOSITED" });
  });

  it("the bank's line for the deposit matches the deposit's entry, labelled by its payments", async () => {
    await withTenant(tenantId, (tx) =>
      importTransactions(tx, owner, {
        bankAccountId: register.bankAccountId,
        txns: [
          {
            txnDate: "2026-09-06",
            description: "COUNTER DEPOSIT",
            amountCents: 42_500,
            raw: [],
            dupIndex: 0,
          },
        ],
      }),
    );
    const candidates = await withTenant(tenantId, (tx) =>
      findMatchCandidates(tx, tenantId, {
        bankAccountId: register.bankAccountId,
        ledgerAccountId: register.ledgerAccountId,
        amountCents: 42_500,
        txnDate: "2026-09-06",
      }),
    );
    expect(candidates.map((c) => c.entryId)).toContain(entryId);
    expect(candidates.find((c) => c.entryId === entryId)?.label).toBe("Deposit — 2 payments");
  });

  it("voids: the entry is void, the payments wait again, and the void is CAS-guarded", async () => {
    const result = await asOwner((tx) =>
      voidDeposit(tx, owner, { depositId, expectedVersion: 1 }),
    );
    expect(result.deposit).toMatchObject({ status: "void", version: 2 });
    expect(result.voidedEntryId).toBe(entryId);

    const entry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: and(eq(schema.journalEntries.tenantId, tenantId), eq(schema.journalEntries.id, entryId)),
      }),
    );
    expect(entry?.status).toBe("void");
    const waiting = await withTenant(tenantId, (tx) => listUndepositedPayments(tx, tenantId));
    expect(waiting.map((p) => p.id)).toEqual([drawer.p2, drawer.p1]);

    await expect(
      asOwner((tx) => voidDeposit(tx, owner, { depositId, expectedVersion: 2 })),
    ).rejects.toMatchObject({ code: "DEPOSIT_NOT_POSTED" });
    await expect(
      asOwner((tx) => voidDeposit(tx, owner, { depositId, expectedVersion: 1 })),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });

    // Back in the drawer, the payment is an ordinary one again: unapply works.
    const payment = await withTenant(tenantId, (tx) =>
      tx.query.invoicePayments.findFirst({
        where: and(eq(schema.invoicePayments.tenantId, tenantId), eq(schema.invoicePayments.id, drawer.p1)),
      }),
    );
    const undone = await withTenant(tenantId, (tx) =>
      unapplyPayment(tx, owner, { paymentId: drawer.p1, expectedVersion: payment!.version }),
    );
    expect(undone.invoice.status).toBe("issued");
  });

  it("a voided deposit's payments can be deposited again, as a new deposit", async () => {
    const again = await asOwner((tx) =>
      recordDeposit(tx, owner, {
        bankAccountId: register.bankAccountId,
        depositDate: "2026-09-07",
        memo: "Second trip to the bank",
        paymentIds: [drawer.p2],
      }),
    );
    expect(again.deposit).toMatchObject({
      totalCents: 12_500,
      memo: "Second trip to the bank",
      status: "posted",
    });
    expect(again.deposit.id).not.toBe(depositId);
  });

  it("another company's payment cannot go into this company's register (ADR 0010)", async () => {
    const oak = await withTenant(tenantId, (tx) =>
      createEntity(tx, owner, { name: "Oak Row LLC" }),
    );
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        entityId: oak.id,
        issueDate: "2026-09-01",
        dueDate: "2026-09-15",
        lines: [
          { description: "Oak line", quantity: "1", unitPriceCents: 7_000, incomeAccountId: salesId },
        ],
      }),
    );
    const oakInvoice = await withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, { invoiceId: draft.id, expectedVersion: draft.version }),
    );
    const oakPayment = await paid(oakInvoice, 7_000, "2026-09-04", undepositedId);

    // Scoped to a company, the list shows only that company's drawer.
    const oakWaiting = await withTenant(tenantId, (tx) =>
      listUndepositedPayments(tx, tenantId, { entityId: oak.id }),
    );
    expect(oakWaiting.map((p) => p.id)).toEqual([oakPayment.payment.id]);

    await expect(
      asOwner((tx) =>
        recordDeposit(tx, owner, {
          bankAccountId: register.bankAccountId,
          depositDate: "2026-09-07",
          paymentIds: [oakPayment.payment.id],
        }),
      ),
    ).rejects.toMatchObject({ code: "DEPOSIT_CROSS_COMPANY" });
  });
});
