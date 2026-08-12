import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d, seedParty } from "./_shared";
import { remindersDueForTenant } from "../../src/modules/accounting/invoicing/reminder-run";
import { reminderIdempotencyKey } from "../../src/modules/accounting/invoicing/reminder-email";

/**
 * Accounting tables: RLS isolation PLUS the composite-tenant-FK guarantees
 * — the database itself must refuse a row that stitches together entities
 * from two tenants, even when the row's own tenant_id passes RLS.
 */
const STAMP_ACC = `iso-acc-${process.pid}`;

interface AccFixture {
  accountId: string;
  entryId: string;
  lineId: string;
  memberId: string;
  customerId: string;
  invoiceId: string;
  termId: string;
  productId: string;
}

d("accounting isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, AccFixture> = {};

  async function seedAccounting(tenantId: string, tag: string): Promise<AccFixture> {
    return withTenant(tenantId, async (tx) => {
      await tx.insert(schema.accountingSettings).values({ tenantId });
      const [cash] = await tx
        .insert(schema.accounts)
        .values({
          tenantId,
          code: "1000",
          name: `Checking ${tag}`,
          accountType: "asset",
          subtype: "bank",
        })
        .returning();
      const [expense] = await tx
        .insert(schema.accounts)
        .values({
          tenantId,
          code: "6000",
          name: `Expense ${tag}`,
          accountType: "expense",
          subtype: "operating_expense",
        })
        .returning();
      const [entry] = await tx
        .insert(schema.journalEntries)
        .values({
          tenantId,
          entryDate: "2026-07-01",
          memo: `secret entry of ${tag}`,
          status: "posted",
          postedAt: new Date(),
          createdByClerkUserId: `user-${tag}`,
        })
        .returning();
      const lines = await tx
        .insert(schema.journalLines)
        .values([
          { tenantId, entryId: entry.id, accountId: expense.id, amountCents: 5000, lineNo: 1 },
          { tenantId, entryId: entry.id, accountId: cash.id, amountCents: -5000, lineNo: 2 },
        ])
        .returning();
      const [member] = await tx
        .insert(schema.dimensionMembers)
        .values({
          tenantId,
          dimensionType: "property",
          packEntityId: crypto.randomUUID(),
          displayName: `Property ${tag}`,
        })
        .returning();
      await tx.insert(schema.lineDimensions).values({
        tenantId,
        journalLineId: lines[0].id,
        dimensionType: "property",
        memberId: member.id,
      });
      // The catalogue: three reference lists, one of each per tenant.
      const [term] = await tx
        .insert(schema.paymentTerms)
        .values({ tenantId, name: `Net 30 ${tag}`, dueInDays: 30, isDefault: true })
        .returning();
      await tx.insert(schema.paymentMethods).values({
        tenantId,
        code: `wire_${tag.toLowerCase()}`,
        name: `Wire ${tag}`,
      });
      const [product] = await tx
        .insert(schema.products)
        .values({
          tenantId,
          name: `Callout fee ${tag}`,
          unitPriceCents: 9_900,
          incomeAccountId: null,
        })
        .returning();

      // An overdue, chaseable invoice — the input the reminder sweep selects
      // over. Raw inserts, per the note on seedParty: this suite certifies what
      // the DATABASE enforces.
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
          customerId: customer.id,
          invoiceNumber: `INV-${tag}`,
          status: "issued",
          issueDate: "2026-07-01",
          dueDate: "2026-07-15",
          totalCents: 50_000,
          createdByClerkUserId: `user-${tag}`,
        })
        .returning();
      return {
        accountId: cash.id,
        entryId: entry.id,
        lineId: lines[0].id,
        memberId: member.id,
        customerId: customer.id,
        invoiceId: invoice.id,
        termId: term.id,
        productId: product.id,
      };
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_ACC}-a`, name: "Acc Iso A", slug: `${STAMP_ACC}-a` },
          { clerkOrgId: `${STAMP_ACC}-b`, name: "Acc Iso B", slug: `${STAMP_ACC}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedAccounting(tenantA, "A");
    fx.b = await seedAccounting(tenantB, "B");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on every accounting table return only the tenant's rows", async () => {
    await withTenant(tenantA, async (tx) => {
      const accounts = await tx.select().from(schema.accounts);
      expect(accounts.length).toBeGreaterThan(0);
      expect(accounts.every((r) => r.tenantId === tenantA)).toBe(true);
      const entries = await tx.select().from(schema.journalEntries);
      expect(entries.every((r) => r.tenantId === tenantA)).toBe(true);
      const lines = await tx.select().from(schema.journalLines);
      expect(lines.every((r) => r.tenantId === tenantA)).toBe(true);
      const settings = await tx.select().from(schema.accountingSettings);
      expect(settings.every((r) => r.tenantId === tenantA)).toBe(true);
      const members = await tx.select().from(schema.dimensionMembers);
      expect(members.every((r) => r.tenantId === tenantA)).toBe(true);
      const dims = await tx.select().from(schema.lineDimensions);
      expect(dims.every((r) => r.tenantId === tenantA)).toBe(true);
      const products = await tx.select().from(schema.products);
      expect(products.length).toBeGreaterThan(0);
      expect(products.every((r) => r.tenantId === tenantA)).toBe(true);
      const terms = await tx.select().from(schema.paymentTerms);
      expect(terms.every((r) => r.tenantId === tenantA)).toBe(true);
      const methods = await tx.select().from(schema.paymentMethods);
      expect(methods.every((r) => r.tenantId === tenantA)).toBe(true);
    });
  });

  it("cross-tenant filters read zero rows", async () => {
    const entries = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.tenantId, tenantB)),
    );
    expect(entries).toHaveLength(0);
  });

  it("cannot INSERT accounting rows attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.accounts).values({
          tenantId: tenantB,
          code: "9999",
          name: "smuggled account",
          accountType: "expense",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.journalEntries).values({
          tenantId: tenantB,
          entryDate: "2026-07-01",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: cannot attach a line to the OTHER tenant's entry", async () => {
    // tenant_id passes RLS (it's A's own), but (tenant_id, entry_id)
    // doesn't exist as a pair — the FK itself must reject it.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.journalLines).values({
          tenantId: tenantA,
          entryId: fx.b.entryId,
          accountId: fx.a.accountId,
          amountCents: 100,
          lineNo: 99,
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: cannot post a line against the OTHER tenant's account", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.journalLines).values({
          tenantId: tenantA,
          entryId: fx.a.entryId,
          accountId: fx.b.accountId,
          amountCents: 100,
          lineNo: 99,
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: cannot tag a line with the OTHER tenant's dimension member", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.lineDimensions).values({
          tenantId: tenantA,
          journalLineId: fx.a.lineId,
          dimensionType: "property",
          memberId: fx.b.memberId,
        }),
      ),
    ).rejects.toThrow();
  });

  it("typed FK: member must be of the stated dimension type", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.lineDimensions).values({
          tenantId: tenantA,
          journalLineId: fx.a.lineId,
          dimensionType: "job", // fx.a.memberId is a "property" member
          memberId: fx.a.memberId,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant UPDATE and DELETE affect zero accounting rows", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.accounts)
        .set({ name: "defaced" })
        .where(eq(schema.accounts.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.journalEntries)
        .where(eq(schema.journalEntries.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  /**
   * The reminder sweep is the one piece of accounting that EMAILS somebody
   * without a human clicking send, so a tenant boundary it fails to hold is
   * not a leaked read — it is one business's customer receiving another
   * business's demand for money. Certified here rather than only in the
   * feature's own suite.
   */
  it("the reminder sweep only ever selects the calling tenant's invoices", async () => {
    const offsets = [0, 7, 14, 30];
    const forA = await withTenant(tenantA, (tx) =>
      remindersDueForTenant(tx, tenantA, "2026-08-15", offsets),
    );
    expect(forA.length).toBeGreaterThan(0);
    expect(forA.every((r) => r.invoiceId !== fx.b.invoiceId)).toBe(true);
    expect(forA.some((r) => r.invoiceId === fx.a.invoiceId)).toBe(true);

    // And asking for B's rows while in A's context returns nothing at all,
    // rather than quietly answering with A's.
    const bFromA = await withTenant(tenantA, (tx) =>
      remindersDueForTenant(tx, tenantB, "2026-08-15", offsets),
    );
    expect(bFromA).toHaveLength(0);
  });

  it("one tenant's send log cannot suppress another tenant's reminder", async () => {
    // The sweep derives "already sent" from outbound_emails by key prefix. If
    // that read were not tenant-scoped, a busy tenant could silence a quiet
    // one — a failure that looks like nothing happening, which is the hardest
    // kind to notice.
    // withSystem, because `outbound_emails` refuses a member INSERT outright —
    // the send log is written only by `sendEmail`, never by tenant code. That
    // is a stronger guarantee than this test needs, and worth stating: the row
    // below cannot be forged from inside a tenant at all.
    await withSystem((tx) =>
      tx.insert(schema.outboundEmails).values({
        tenantId: tenantB,
        kind: "invoice_reminder",
        toAddress: "someone@example.com",
        toDomain: "example.com",
        subject: "reminder",
        status: "sent",
        // Deliberately keyed to tenant A's invoice — the row a boundary
        // failure would let A's sweep read.
        idempotencyKey: reminderIdempotencyKey(fx.a.invoiceId, 30, "someone@example.com"),
      }),
    );

    const forA = await withTenant(tenantA, (tx) =>
      remindersDueForTenant(tx, tenantA, "2026-08-15", [0, 7, 14, 30]),
    );
    // A still gets its reminder: B's row is invisible to A.
    expect(forA.some((r) => r.invoiceId === fx.a.invoiceId)).toBe(true);
  });

  it("composite FK: a customer cannot take the OTHER tenant's payment terms", async () => {
    // tenant_id passes RLS (it is A's own), but (tenant_id, payment_terms_id)
    // does not exist as a pair — the FK itself must reject it.
    await expect(
      withTenant(tenantA, (tx) =>
        tx
          .update(schema.customers)
          .set({ paymentTermsId: fx.b.termId })
          .where(eq(schema.customers.id, fx.a.customerId)),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: a product cannot point at the OTHER tenant's account", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.products).values({
          tenantId: tenantA,
          name: "smuggled product",
          incomeAccountId: fx.b.accountId,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot INSERT catalogue rows attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx
          .insert(schema.paymentMethods)
          .values({ tenantId: tenantB, code: "smuggled", name: "Smuggled" }),
      ),
    ).rejects.toThrow();
  });

  it("no context → default deny on all accounting tables", async () => {
    const counts = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return Promise.all([
        tx.select().from(schema.accounts),
        tx.select().from(schema.journalEntries),
        tx.select().from(schema.journalLines),
        tx.select().from(schema.dimensionMembers),
        tx.select().from(schema.lineDimensions),
        tx.select().from(schema.accountingSettings),
        tx.select().from(schema.products),
        tx.select().from(schema.paymentTerms),
        tx.select().from(schema.paymentMethods),
      ]);
    });
    for (const rows of counts) expect(rows).toHaveLength(0);
  });
});
