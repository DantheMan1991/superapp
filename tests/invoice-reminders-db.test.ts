import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import type { LedgerCtx } from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createInvoiceDraft,
  issueInvoice,
  voidInvoice,
} from "../src/modules/accounting/invoicing/invoices";
import { recordPayment } from "../src/modules/accounting/invoicing/payments";
import { remindersDueForTenant } from "../src/modules/accounting/invoicing/reminder-run";
import {
  reminderIdempotencyKey,
  reminderTestIdempotencyKey,
} from "../src/modules/accounting/invoicing/reminder-email";
import { sendTestReminder } from "../src/modules/accounting/invoicing/reminder-test";
import {
  getReminderSettings,
  listInvoiceReminders,
  setCustomerRemindersMuted,
  setInvoiceRemindersMuted,
  updateReminderSettings,
} from "../src/modules/accounting/invoicing/reminders";

/**
 * The reminder SELECTION, against a real database.
 *
 * The schedule arithmetic is pinned in `invoice-reminders.test.ts` without a
 * database. What can only be proved here is that the query actually excludes
 * what it claims to: a muted customer, a paid invoice, an offset already in
 * the send log. Those are the ways a customer gets chased when they should
 * not be, and none of them are visible to a pure test.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const OFFSETS = [-3, 0, 7, 14, 30];

d("invoice reminders (DB)", () => {
  const STAMP = `reminders-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let staff: LedgerCtx;
  let customerId: string;
  let salesAccountId: string;
  let bankLedgerAccountId: string;

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

  /** An issued invoice due on `dueDate`, for `cents`. */
  async function issuedInvoice(dueDate: string | null, cents = 50_000) {
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-06-01",
        ...(dueDate ? { dueDate } : {}),
        lines: [
          {
            description: "Test line",
            quantity: "1",
            unitPriceCents: cents,
            incomeAccountId: salesAccountId,
          },
        ],
      }),
    );
    return withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
      }),
    );
  }

  async function due(today: string, offsets: readonly number[] = OFFSETS) {
    return withTenant(tenantId, (tx) =>
      remindersDueForTenant(tx, tenantId, today, offsets),
    );
  }

  /** Write a send-log row exactly as the sweep would. */
  async function logReminder(invoiceId: string, offset: number, to = "a@b.com") {
    await withSystem(async (tx) => {
      await tx.insert(schema.outboundEmails).values([
        {
          tenantId,
          kind: "invoice_reminder",
          toAddress: to,
          toDomain: to.split("@")[1] ?? "",
          subject: "reminder",
          status: "sent",
          idempotencyKey: reminderIdempotencyKey(invoiceId, offset, to),
        },
      ]);
    });
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Reminders Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    staff = { tenantId, userId: "staff", role: "staff" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    salesAccountId = await accountId("4000");
    customerId = (
      await withTenant(tenantId, (tx) =>
        createCustomer(tx, owner, { name: "Acme Rentals" }),
      )
    ).id;
    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Checking", kind: "checking" }),
    );
    bankLedgerAccountId = bank.ledgerAccount.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  // ---------------------------------------------------------------- settings

  it("ships OFF, with nothing scheduled to send", async () => {
    // The safety default. A migration must never start mailing customers.
    const settings = await withTenant(tenantId, (tx) =>
      getReminderSettings(tx, tenantId),
    );
    expect(settings.enabled).toBe(false);
  });

  it("refuses to turn on with an empty schedule", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        updateReminderSettings(tx, owner, { enabled: true, offsets: [] }),
      ),
    ).rejects.toThrow(/REMINDER_SCHEDULE_EMPTY|at least one/i);
  });

  it("is an owner decision, not a staff one", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        updateReminderSettings(tx, staff, { enabled: true, offsets: [7] }),
      ),
    ).rejects.toThrow(/FORBIDDEN|owner/i);
  });

  it("round-trips the schedule, sorted and de-duplicated", async () => {
    const saved = await withTenant(tenantId, (tx) =>
      updateReminderSettings(tx, owner, {
        enabled: true,
        offsets: [30, -3, 7, 30, 0, 14],
      }),
    );
    expect(saved.offsets).toEqual(OFFSETS);
    const read = await withTenant(tenantId, (tx) =>
      getReminderSettings(tx, tenantId),
    );
    expect(read).toEqual({ enabled: true, offsets: OFFSETS });
  });

  // --------------------------------------------------------------- selection

  it("picks the latest applicable offset for an overdue invoice", async () => {
    const inv = await issuedInvoice("2026-06-15");
    // 2026-06-22 is 7 days past due.
    const rows = await due("2026-06-22");
    const mine = rows.find((r) => r.invoiceId === inv.id);
    expect(mine?.offset).toBe(7);
    expect(mine?.balanceCents).toBe(50_000);
  });

  it("sends nothing before the first offset comes round", async () => {
    const inv = await issuedInvoice("2026-09-01");
    const rows = await due("2026-06-22");
    expect(rows.find((r) => r.invoiceId === inv.id)).toBeUndefined();
  });

  it("never chases an invoice with no due date", async () => {
    const inv = await issuedInvoice(null);
    const rows = await due("2026-12-31");
    expect(rows.find((r) => r.invoiceId === inv.id)).toBeUndefined();
  });

  it("never chases a draft", async () => {
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId,
        issueDate: "2026-06-01",
        dueDate: "2026-06-15",
        lines: [
          {
            description: "Draft line",
            quantity: "1",
            unitPriceCents: 10_000,
            incomeAccountId: salesAccountId,
          },
        ],
      }),
    );
    const rows = await due("2026-06-22");
    expect(rows.find((r) => r.invoiceId === draft.id)).toBeUndefined();
  });

  it("never chases a voided invoice", async () => {
    const inv = await issuedInvoice("2026-06-15");
    await withTenant(tenantId, (tx) =>
      voidInvoice(tx, owner, { invoiceId: inv.id, expectedVersion: inv.version }),
    );
    const rows = await due("2026-06-22");
    expect(rows.find((r) => r.invoiceId === inv.id)).toBeUndefined();
  });

  it("chases the remaining balance after a part payment, not the total", async () => {
    const inv = await issuedInvoice("2026-06-15", 50_000);
    await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: inv.id,
        expectedVersion: inv.version,
        paymentDate: "2026-06-10",
        amountCents: 20_000,
        depositAccountId: bankLedgerAccountId,
        method: "check",
      }),
    );
    const rows = await due("2026-06-22");
    expect(rows.find((r) => r.invoiceId === inv.id)?.balanceCents).toBe(30_000);
  });

  it("stops the moment an invoice is paid in full", async () => {
    const inv = await issuedInvoice("2026-06-15", 40_000);
    await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: inv.id,
        expectedVersion: inv.version,
        paymentDate: "2026-06-10",
        amountCents: 40_000,
        depositAccountId: bankLedgerAccountId,
        method: "check",
      }),
    );
    const rows = await due("2026-06-22");
    expect(rows.find((r) => r.invoiceId === inv.id)).toBeUndefined();
  });

  // ------------------------------------------------------------------- mutes

  it("respects a muted invoice", async () => {
    const inv = await issuedInvoice("2026-06-15");
    const fresh = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({
        where: and(
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.id, inv.id),
        ),
      }),
    );
    await withTenant(tenantId, (tx) =>
      setInvoiceRemindersMuted(tx, owner, {
        invoiceId: inv.id,
        expectedVersion: fresh!.version,
        muted: true,
      }),
    );
    const rows = await due("2026-06-22");
    expect(rows.find((r) => r.invoiceId === inv.id)).toBeUndefined();
  });

  it("respects a muted customer, across every invoice they have", async () => {
    // A separate customer so muting them cannot affect the other assertions.
    const quiet = await withTenant(tenantId, (tx) =>
      createCustomer(tx, owner, { name: "Never Chase Ltd" }),
    );
    const draft = await withTenant(tenantId, (tx) =>
      createInvoiceDraft(tx, owner, {
        customerId: quiet.id,
        issueDate: "2026-06-01",
        dueDate: "2026-06-15",
        lines: [
          {
            description: "Line",
            quantity: "1",
            unitPriceCents: 25_000,
            incomeAccountId: salesAccountId,
          },
        ],
      }),
    );
    const inv = await withTenant(tenantId, (tx) =>
      issueInvoice(tx, owner, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
      }),
    );

    expect((await due("2026-06-22")).some((r) => r.invoiceId === inv.id)).toBe(
      true,
    );

    await withTenant(tenantId, (tx) =>
      setCustomerRemindersMuted(tx, owner, {
        customerId: quiet.id,
        expectedVersion: quiet.version,
        muted: true,
      }),
    );
    expect((await due("2026-06-22")).some((r) => r.invoiceId === inv.id)).toBe(
      false,
    );
  });

  // ------------------------------------------------------------- idempotency

  it("does not re-send an offset already in the log", async () => {
    const inv = await issuedInvoice("2026-06-15");
    expect((await due("2026-06-22")).find((r) => r.invoiceId === inv.id)?.offset).toBe(7);

    await logReminder(inv.id, 7);
    expect((await due("2026-06-22")).find((r) => r.invoiceId === inv.id)).toBeUndefined();

    // ...but the NEXT offset still fires when its day comes.
    expect((await due("2026-06-29")).find((r) => r.invoiceId === inv.id)?.offset).toBe(14);
  });

  it("does not let one invoice's log suppress another's", async () => {
    // The prefix bucketing is the only place a uuid boundary is enforced by
    // string matching, so it gets its own test.
    const a = await issuedInvoice("2026-06-15");
    const b = await issuedInvoice("2026-06-15");
    await logReminder(a.id, 7);

    const rows = await due("2026-06-22");
    expect(rows.find((r) => r.invoiceId === a.id)).toBeUndefined();
    expect(rows.find((r) => r.invoiceId === b.id)?.offset).toBe(7);
  });

  it("reads the send history back per invoice", async () => {
    const inv = await issuedInvoice("2026-06-15");
    await logReminder(inv.id, 0, "first@b.com");
    await logReminder(inv.id, 7, "second@b.com");

    const history = await withTenant(tenantId, (tx) =>
      listInvoiceReminders(tx, tenantId, inv.id),
    );
    expect(history.map((h) => h.offset).sort((x, y) => x - y)).toEqual([0, 7]);
    expect(history.every((h) => h.status === "sent")).toBe(true);
  });

  // ------------------------------------------------------------- test sends

  it("a TEST send never suppresses the real reminder for that offset", async () => {
    // The same property the pure test pins, proved against the real query —
    // the sweep's `like('reminder:%')` must not match `reminder-test:%`.
    const inv = await issuedInvoice("2026-06-15");
    const to = "owner@example.com";
    await withSystem(async (tx) => {
      await tx.insert(schema.outboundEmails).values([
        {
          tenantId,
          kind: "invoice_reminder_test",
          toAddress: to,
          toDomain: "example.com",
          subject: "[Test] reminder",
          status: "sent",
          idempotencyKey: reminderTestIdempotencyKey(inv.id, 7, to, "2026-06-22T08:00"),
        },
      ]);
    });

    const rows = await due("2026-06-22");
    expect(rows.find((r) => r.invoiceId === inv.id)?.offset).toBe(7);
  });

  it("a test send stays out of the customer-facing history", async () => {
    const inv = await issuedInvoice("2026-06-15");
    const to = "owner@example.com";
    await withSystem(async (tx) => {
      await tx.insert(schema.outboundEmails).values([
        {
          tenantId,
          kind: "invoice_reminder_test",
          toAddress: to,
          toDomain: "example.com",
          subject: "[Test] reminder",
          status: "sent",
          idempotencyKey: reminderTestIdempotencyKey(inv.id, 0, to, "2026-06-15T08:00"),
        },
      ]);
    });
    // The panel answers "what did the CUSTOMER receive", so a test is not it.
    const history = await withTenant(tenantId, (tx) =>
      listInvoiceReminders(tx, tenantId, inv.id),
    );
    expect(history).toHaveLength(0);
  });

  it("refuses to preview an invoice with nothing to chase", async () => {
    const noDue = await issuedInvoice(null);
    await expect(
      withTenant(tenantId, (tx) =>
        sendTestReminder(tx, owner, { invoiceId: noDue.id, nonce: "n" }),
      ),
    ).rejects.toThrow(/REMINDER_NOT_TESTABLE|due date/i);

    const paid = await issuedInvoice("2026-06-15", 10_000);
    await withTenant(tenantId, (tx) =>
      recordPayment(tx, owner, {
        invoiceId: paid.id,
        expectedVersion: paid.version,
        paymentDate: "2026-06-10",
        amountCents: 10_000,
        depositAccountId: bankLedgerAccountId,
        method: "check",
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        sendTestReminder(tx, owner, { invoiceId: paid.id, nonce: "n" }),
      ),
    ).rejects.toThrow(/REMINDER_NOT_TESTABLE|unpaid/i);
  });

  it("is an owner action", async () => {
    const inv = await issuedInvoice("2026-06-15");
    await expect(
      withTenant(tenantId, (tx) =>
        sendTestReminder(tx, staff, { invoiceId: inv.id, nonce: "n" }),
      ),
    ).rejects.toThrow(/FORBIDDEN|owner/i);
  });

  // --------------------------------------------------------------------- cap

  it("caps a batch and puts the most overdue first", async () => {
    const rows = await withTenant(tenantId, (tx) =>
      remindersDueForTenant(tx, tenantId, "2026-12-31", OFFSETS, 2),
    );
    expect(rows.length).toBeLessThanOrEqual(2);
    // Everything is far past due by December, so the latest offset wins and
    // the ordering is by how overdue each one is.
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].offset).toBeGreaterThanOrEqual(rows[i].offset);
    }
  });

  it("sends nothing at all when the schedule is empty", async () => {
    expect(await due("2026-12-31", [])).toEqual([]);
  });
});
