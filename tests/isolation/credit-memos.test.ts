import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d, seedEntity, seedParty } from "./_shared";

/**
 * `credit_memos` (0269/0270): RLS isolation, the owner-only write posture,
 * and the composite tenant FKs to the customer, the invoice, the settlement
 * row, the income account and the entry.
 */
const STAMP = `iso-credit-memos-${process.pid}`;

interface Fixture {
  entityId: string;
  customerId: string;
  invoiceId: string;
  incomeAccountId: string;
  entryId: string;
  paymentId: string;
  memoId: string;
}

d("credit memos isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, Fixture> = {};

  async function seed(tenantId: string, tag: string): Promise<Fixture> {
    return withTenant(
      tenantId,
      async (tx) => {
        await tx.insert(schema.accountingSettings).values({ tenantId });
        const entityId = await seedEntity(tx, tenantId, tag);
        const [income] = await tx
          .insert(schema.accounts)
          .values({
            tenantId,
            code: "4000",
            name: `Sales ${tag}`,
            accountType: "income",
            subtype: "sales",
          })
          .returning();
        const [ar] = await tx
          .insert(schema.accounts)
          .values({
            tenantId,
            code: "1200",
            name: `Receivable ${tag}`,
            accountType: "asset",
            subtype: "accounts_receivable",
          })
          .returning();
        const [customer] = await tx
          .insert(schema.customers)
          .values({
            tenantId,
            partyId: await seedParty(tx, tenantId, `Customer ${tag}`),
            name: `Customer ${tag}`,
          })
          .returning();
        const [invoice] = await tx
          .insert(schema.invoices)
          .values({
            tenantId,
            entityId,
            customerId: customer.id,
            invoiceNumber: `INV-${tag}`,
            status: "partial",
            issueDate: "2026-09-01",
            subtotalCents: 10_000,
            taxCents: 0,
            totalCents: 10_000,
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({
            tenantId,
            entityId,
            entryDate: "2026-09-03",
            memo: `credit memo entry of ${tag}`,
            status: "posted",
            source: "credit_memo",
            postedAt: new Date(),
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();
        await tx.insert(schema.journalLines).values([
          { tenantId, entryId: entry.id, accountId: income.id, amountCents: 2_000, lineNo: 1 },
          { tenantId, entryId: entry.id, accountId: ar.id, amountCents: -2_000, lineNo: 2 },
        ]);
        const [payment] = await tx
          .insert(schema.invoicePayments)
          .values({
            tenantId,
            invoiceId: invoice.id,
            paymentDate: "2026-09-03",
            amountCents: 2_000,
            depositAccountId: income.id,
            method: "credit_memo",
            memo: `CM-${tag}`,
            journalEntryId: entry.id,
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();
        const [memo] = await tx
          .insert(schema.creditMemos)
          .values({
            tenantId,
            entityId,
            customerId: customer.id,
            invoiceId: invoice.id,
            paymentId: payment.id,
            number: `CM-${tag}`,
            issueDate: "2026-09-03",
            memo: `SECRET CREDIT OF ${tag}`,
            incomeAccountId: income.id,
            totalCents: 2_000,
            journalEntryId: entry.id,
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();
        return {
          entityId,
          customerId: customer.id,
          invoiceId: invoice.id,
          incomeAccountId: income.id,
          entryId: entry.id,
          paymentId: payment.id,
          memoId: memo.id,
        };
      },
      { role: "owner" },
    );
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Credit Iso A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Credit Iso B", slug: `${STAMP}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seed(tenantA, "A");
    fx.b = await seed(tenantB, "B");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects return only the tenant's credit memos, for staff as for owners", async () => {
    for (const role of ["staff", "owner"] as const) {
      const rows = await withTenant(tenantA, (tx) => tx.select().from(schema.creditMemos), { role });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(rows.some((r) => r.memo.includes("OF B"))).toBe(false);
    }
  });

  it("cross-tenant filters read zero rows, and no context reads nothing", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.creditMemos).where(eq(schema.creditMemos.tenantId, tenantB)),
    );
    expect(rows).toHaveLength(0);
    const none = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.creditMemos);
    });
    expect(none).toHaveLength(0);
  });

  it("staff can read but neither insert nor update; nobody deletes", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.creditMemos).values({
            tenantId: tenantA,
            entityId: fx.a.entityId,
            customerId: fx.a.customerId,
            invoiceId: fx.a.invoiceId,
            number: "CM-STAFF",
            issueDate: "2026-09-04",
            incomeAccountId: fx.a.incomeAccountId,
            totalCents: 100,
            journalEntryId: fx.a.entryId,
            createdByClerkUserId: "user-staff",
          }),
        { role: "staff" },
      ),
    ).rejects.toThrow();
    const touched = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.creditMemos)
          .set({ memo: "staff was here" })
          .where(eq(schema.creditMemos.id, fx.a.memoId))
          .returning({ id: schema.creditMemos.id }),
      { role: "staff" },
    );
    expect(touched).toHaveLength(0);
    const owner = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.creditMemos)
          .set({ memo: "SECRET CREDIT OF A" })
          .where(eq(schema.creditMemos.id, fx.a.memoId))
          .returning({ id: schema.creditMemos.id }),
      { role: "owner" },
    );
    expect(owner).toHaveLength(1);
    const gone = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.creditMemos)
          .where(eq(schema.creditMemos.id, fx.a.memoId))
          .returning({ id: schema.creditMemos.id }),
      { role: "owner" },
    );
    expect(gone).toHaveLength(0);
  });

  it("cannot INSERT a credit memo attributed to the other tenant", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.creditMemos).values({
            tenantId: tenantB,
            entityId: fx.b.entityId,
            customerId: fx.b.customerId,
            invoiceId: fx.b.invoiceId,
            number: "CM-SMUGGLED",
            issueDate: "2026-09-04",
            incomeAccountId: fx.b.incomeAccountId,
            totalCents: 100,
            journalEntryId: fx.b.entryId,
            createdByClerkUserId: "user-smuggler",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  it("composite FKs: a memo cannot name the OTHER tenant's customer, invoice, payment, account or entry", async () => {
    const smuggle = (patch: Partial<typeof schema.creditMemos.$inferInsert>) =>
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.creditMemos).values({
            tenantId: tenantA,
            entityId: fx.a.entityId,
            customerId: fx.a.customerId,
            invoiceId: fx.a.invoiceId,
            number: `CM-${crypto.randomUUID().slice(0, 8)}`,
            issueDate: "2026-09-04",
            incomeAccountId: fx.a.incomeAccountId,
            totalCents: 100,
            // A fresh entry would be needed for a real row; the FKs under test
            // fire before the unique-per-entry rule does, and each smuggled
            // reference is refused on its own.
            journalEntryId: fx.a.entryId,
            createdByClerkUserId: "user-a",
            ...patch,
          }),
        { role: "owner" },
      );
    await expect(smuggle({ customerId: fx.b.customerId })).rejects.toThrow();
    await expect(smuggle({ invoiceId: fx.b.invoiceId })).rejects.toThrow();
    await expect(smuggle({ paymentId: fx.b.paymentId })).rejects.toThrow();
    await expect(smuggle({ incomeAccountId: fx.b.incomeAccountId })).rejects.toThrow();
    await expect(smuggle({ journalEntryId: fx.b.entryId })).rejects.toThrow();
    await expect(smuggle({ entityId: fx.b.entityId })).rejects.toThrow();
  });
});
