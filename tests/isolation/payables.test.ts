import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d, seedEntity, seedParty } from "./_shared";

/**
 * Payables (session 6): RLS isolation for vendors/bills/bill_lines/
 * bill_payments plus the composite-FK smuggle matrix and the EXTENDED
 * exactly-one CHECKs on document_links (4 targets) and line_dimensions
 * (3 parents).
 */
const STAMP_PAY = `iso-pay-${process.pid}`;

interface PayFixture {
  entityId: string;
  vendorId: string;
  /** The vendor's party. Needed so the smuggling test can present a VALID FK. */
  partyId: string;
  billId: string;
  billLineId: string;
  accountId: string;
  entryId: string;
  documentId: string;
  /**
   * A customer too, because `recurring_entries` grew a `customer_id` when
   * recurring invoices folded into it — and the smuggle matrix has to cover
   * BOTH party columns, not just the one this file was written for.
   */
  customerId: string;
}

d("payables isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, PayFixture> = {};

  async function seedPayables(tenantId: string, tag: string): Promise<PayFixture> {
    return withTenant(tenantId, async (tx) => {
      const [expense] = await tx
        .insert(schema.accounts)
        .values({ tenantId, code: "6000", name: `Expense ${tag}`, accountType: "expense", subtype: "operating_expense" })
        .returning();
      const entityId = await seedEntity(tx, tenantId, tag);
      const [entry] = await tx
        .insert(schema.journalEntries)
        .values({ tenantId, entityId, entryDate: "2026-07-01", memo: `entry ${tag}`, createdByClerkUserId: `user-${tag}` })
        .returning();
      const partyId = await seedParty(tx, tenantId, `Vendor ${tag}`);
      const [vendor] = await tx
        .insert(schema.vendors)
        .values({ tenantId, partyId, name: `Vendor ${tag}` })
        .returning();
      const [bill] = await tx
        .insert(schema.bills)
        .values({ tenantId, entityId, vendorId: vendor.id, billDate: "2026-07-01", createdByClerkUserId: `user-${tag}` })
        .returning();
      const [billLine] = await tx
        .insert(schema.billLines)
        .values({ tenantId, billId: bill.id, lineNo: 1, description: `line ${tag}`, amountCents: 1000, accountId: expense.id })
        .returning();
      const customerPartyId = await seedParty(tx, tenantId, `Customer ${tag}`);
      const [customer] = await tx
        .insert(schema.customers)
        .values({ tenantId, partyId: customerPartyId, name: `Customer ${tag}` })
        .returning();
      const [doc] = await tx
        .insert(schema.documents)
        .values({ tenantId, origin: "accounting", blobPathname: `acct/${tenantId}/receipts/pay-${tag}.pdf`, fileName: `${tag}.pdf`, mimeType: "application/pdf", sizeBytes: 10, sha256: `pay-${tag}` })
        .returning();
      return {
        entityId,
        vendorId: vendor.id,
        partyId,
        billId: bill.id,
        billLineId: billLine.id,
        accountId: expense.id,
        entryId: entry.id,
        documentId: doc.id,
        customerId: customer.id,
      };
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_PAY}-a`, name: "Pay Iso A", slug: `${STAMP_PAY}-a` },
          { clerkOrgId: `${STAMP_PAY}-b`, name: "Pay Iso B", slug: `${STAMP_PAY}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedPayables(tenantA, "A");
    fx.b = await seedPayables(tenantB, "B");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on payables tables return only the tenant's rows", async () => {
    await withTenant(tenantA, async (tx) => {
      const vendors = await tx.select().from(schema.vendors);
      expect(vendors.length).toBeGreaterThan(0);
      expect(vendors.every((r) => r.tenantId === tenantA)).toBe(true);
      const bills = await tx.select().from(schema.bills);
      expect(bills.every((r) => r.tenantId === tenantA)).toBe(true);
      const lines = await tx.select().from(schema.billLines);
      expect(lines.every((r) => r.tenantId === tenantA)).toBe(true);
      const payments = await tx.select().from(schema.billPayments);
      expect(payments.every((r) => r.tenantId === tenantA)).toBe(true);
    });
  });

  it("cannot INSERT payables rows attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        // Tenant B's REAL party id, so the foreign key is satisfiable and RLS
        // is the only thing left that can refuse this row. Passing a random
        // uuid would still throw, but for the wrong reason — and a test that
        // passes for the wrong reason stops certifying anything the day the
        // policy is dropped.
        tx.insert(schema.vendors).values({
          tenantId: tenantB,
          partyId: fx.b.partyId,
          name: "smuggled vendor",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bills).values({
          tenantId: tenantB,
          entityId: fx.b.entityId,
          vendorId: fx.b.vendorId,
          billDate: "2026-07-01",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's bill cannot name B's company", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bills).values({
          tenantId: tenantA,
          entityId: fx.b.entityId,
          vendorId: fx.a.vendorId,
          billDate: "2026-07-01",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's bill cannot point at B's vendor or B's entry", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bills).values({
          tenantId: tenantA,
          entityId: fx.a.entityId,
          vendorId: fx.b.vendorId,
          billDate: "2026-07-01",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bills).values({
          tenantId: tenantA,
          entityId: fx.a.entityId,
          vendorId: fx.a.vendorId,
          journalEntryId: fx.b.entryId,
          billDate: "2026-07-01",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's bill_line cannot point at B's bill or B's account", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.billLines).values({
          tenantId: tenantA,
          billId: fx.b.billId,
          lineNo: 9,
          amountCents: 100,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.billLines).values({
          tenantId: tenantA,
          billId: fx.a.billId,
          lineNo: 9,
          amountCents: 100,
          accountId: fx.b.accountId,
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's bill_payment cannot point at B's bill or B's entry", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.billPayments).values({
          tenantId: tenantA,
          billId: fx.b.billId,
          paymentDate: "2026-07-01",
          amountCents: 100,
          paidFromAccountId: fx.a.accountId,
          journalEntryId: fx.a.entryId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.billPayments).values({
          tenantId: tenantA,
          billId: fx.a.billId,
          paymentDate: "2026-07-01",
          amountCents: 100,
          paidFromAccountId: fx.a.accountId,
          journalEntryId: fx.b.entryId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's document_link and line_dimension cannot point at B's bill rows", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentLinks).values({
          tenantId: tenantA,
          documentId: fx.a.documentId,
          billId: fx.b.billId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.lineDimensions).values({
          tenantId: tenantA,
          billLineId: fx.b.billLineId,
          dimensionType: "property",
          memberId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("extended CHECKs: exactly one target/parent still enforced", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentLinks).values({
          tenantId: tenantA,
          documentId: fx.a.documentId,
          billId: fx.a.billId,
          journalEntryId: fx.a.entryId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentLinks).values({
          tenantId: tenantA,
          documentId: fx.a.documentId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.lineDimensions).values({
          tenantId: tenantA,
          billLineId: fx.a.billLineId,
          journalLineId: crypto.randomUUID(),
          dimensionType: "property",
          memberId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant UPDATE and DELETE affect zero payables rows", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.bills)
        .set({ memo: "defaced" })
        .where(eq(schema.bills.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.vendors)
        .where(eq(schema.vendors.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  /**
   * `recurring_entries` is the second recurrence mechanism (journals and
   * bills). It carries an `auto_post` flag, so a row that crossed a tenant
   * boundary would not merely be readable — it would eventually POST into
   * somebody else's ledger by itself.
   */
  it("recurring entries are per-tenant, and cannot be smuggled across", async () => {
    const [a] = await withTenant(tenantA, (tx) =>
      tx
        .insert(schema.recurringEntries)
        .values({
          tenantId: tenantA,
          kind: "bill",
          name: "Yard rent A",
          vendorId: fx.a.vendorId,
          template: {
            kind: "bill",
            dueInDays: 30,
            lines: [{ description: "rent", amountCents: 100_000, accountId: null }],
          },
          dayOfMonth: 1,
          nextRunDate: "2026-09-01",
          createdByClerkUserId: "user-a",
        })
        .returning(),
    );
    expect(a.tenantId).toBe(tenantA);

    const seenByB = await withTenant(tenantB, (tx) =>
      tx.select().from(schema.recurringEntries),
    );
    expect(seenByB.every((r) => r.tenantId === tenantB)).toBe(true);
    expect(seenByB.some((r) => r.id === a.id)).toBe(false);

    await expect(
      withTenant(tenantB, (tx) =>
        tx.insert(schema.recurringEntries).values({
          tenantId: tenantA,
          kind: "journal",
          name: "smuggled",
          template: { kind: "journal", lines: [] },
          dayOfMonth: 1,
          nextRunDate: "2026-09-01",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: a recurring bill cannot name the OTHER tenant's vendor", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.recurringEntries).values({
          tenantId: tenantA,
          kind: "bill",
          name: "cross-tenant rent",
          vendorId: fx.b.vendorId,
          template: {
            kind: "bill",
            dueInDays: 30,
            lines: [{ description: "rent", amountCents: 1, accountId: null }],
          },
          dayOfMonth: 1,
          nextRunDate: "2026-09-01",
          createdByClerkUserId: "user-a",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: a recurring invoice cannot name the OTHER tenant's customer", async () => {
    // The vendor column has been covered since recurring bills landed; this is
    // the same hole on the column that arrived with the fold.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.recurringEntries).values({
          tenantId: tenantA,
          kind: "invoice",
          name: "cross-tenant rent charged out",
          customerId: fx.b.customerId,
          template: {
            kind: "invoice",
            dueInDays: 30,
            lines: [
              {
                description: "rent",
                quantity: "1",
                unitPriceCents: 1,
                incomeAccountId: fx.a.accountId,
              },
            ],
          },
          dayOfMonth: 1,
          nextRunDate: "2026-09-01",
          createdByClerkUserId: "user-a",
        }),
      ),
    ).rejects.toThrow();
  });

  it("default-deny: no context sees no payables rows", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return Promise.all([
        tx.select().from(schema.vendors),
        tx.select().from(schema.bills),
        tx.select().from(schema.billLines),
        tx.select().from(schema.billPayments),
        tx.select().from(schema.recurringEntries),
      ]);
    });
    for (const r of rows) expect(r).toHaveLength(0);
  });
});
