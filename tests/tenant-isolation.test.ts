import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";

/**
 * THE test that certifies the shell: two tenants, and neither can read,
 * write, or enumerate the other's rows — enforced by Postgres RLS, not app
 * code. Runs against the real database (DATABASE_URL required) and must pass
 * on every deploy.
 *
 * It also proves default-deny: with no tenant context at all, nothing is
 * visible even to the connection's own role (FORCE ROW LEVEL SECURITY).
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "⚠ tenant-isolation: DATABASE_URL not set — SKIPPING the most important test in the repo. " +
      "Set it (test/staging DB, never prod) and re-run.",
  );
}

const STAMP = `iso-test-${process.pid}`;
let tenantA: string;
let tenantB: string;

d("tenant isolation (RLS)", () => {
  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Isolation Test A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Isolation Test B", slug: `${STAMP}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    await withTenant(tenantA, (tx) =>
      tx.insert(schema.helloItems).values({
        tenantId: tenantA,
        title: "secret of tenant A",
        createdByClerkUserId: "user-a",
      }),
    );
    await withTenant(tenantB, (tx) =>
      tx.insert(schema.helloItems).values({
        tenantId: tenantB,
        title: "secret of tenant B",
        createdByClerkUserId: "user-b",
      }),
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("tenant A sees only its own rows even with an unscoped query", async () => {
    // Deliberately NO where clause — the forgotten-where-clause scenario.
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.helloItems),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("tenant A cannot enumerate tenant B's rows by direct filter", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.helloItems)
        .where(eq(schema.helloItems.tenantId, tenantB)),
    );
    expect(rows).toHaveLength(0);
  });

  it("tenant A cannot see tenant B in the tenants table", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.tenants),
    );
    expect(rows.map((r) => r.id)).toEqual([tenantA]);
  });

  it("tenant A cannot INSERT rows attributed to tenant B", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.helloItems).values({
          tenantId: tenantB,
          title: "smuggled row",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("tenant A cannot UPDATE or DELETE tenant B's rows (0 rows affected)", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.helloItems)
        .set({ title: "defaced" })
        .where(eq(schema.helloItems.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.helloItems)
        .where(eq(schema.helloItems.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);

    const stillThere = await withTenant(tenantB, (tx) =>
      tx.select().from(schema.helloItems),
    );
    expect(stillThere.some((r) => r.title === "secret of tenant B")).toBe(true);
  });

  it("tenant A cannot read tenant B's subscription or modules", async () => {
    const subs = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.subscriptions),
    );
    expect(subs.every((s) => s.tenantId === tenantA)).toBe(true);

    const mods = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.tenantModules),
    );
    expect(mods.every((m) => m.tenantId === tenantA)).toBe(true);
  });

  it("tenants can never see admin CRM notes", async () => {
    await withSystem((tx) =>
      tx.insert(schema.tenantNotes).values({
        tenantId: tenantA,
        authorClerkUserId: "admin",
        body: "private admin note",
      }),
    );
    // Even about *their own tenant*, notes are invisible to members.
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.tenantNotes),
    );
    expect(rows).toHaveLength(0);
  });

  it("no context at all → default deny (FORCE RLS catches raw access)", async () => {
    const db = await import("../src/db");
    // A transaction that never sets app.role/app.tenant_id.
    const rows = await (
      db as unknown as {
        withSystem: typeof withSystem;
      }
    ).withSystem(async (tx) => {
      // Reset context inside this tx to simulate a forgotten wrapper.
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.helloItems);
    });
    expect(rows).toHaveLength(0);
  });
});

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
      return {
        accountId: cash.id,
        entryId: entry.id,
        lineId: lines[0].id,
        memberId: member.id,
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
      ]);
    });
    for (const rows of counts) expect(rows).toHaveLength(0);
  });
});

/**
 * Documents (session 5): RLS isolation for documents/document_links plus
 * the composite-FK smuggle matrix — a link row whose own tenant_id passes
 * RLS must still be rejected when it points at ANY other-tenant target.
 */
const STAMP_DOC = `iso-doc-${process.pid}`;

interface DocFixture {
  documentId: string;
  entryId: string;
  bankTxnId: string;
  invoiceId: string;
}

d("documents isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, DocFixture> = {};

  async function seedDocuments(tenantId: string, tag: string): Promise<DocFixture> {
    return withTenant(tenantId, async (tx) => {
      await tx
        .insert(schema.accountingSettings)
        .values({ tenantId, inboundEmailToken: `token-${tag}-${STAMP_DOC}` });
      const [cash] = await tx
        .insert(schema.accounts)
        .values({ tenantId, code: "1000", name: `Checking ${tag}`, accountType: "asset", subtype: "bank" })
        .returning();
      const [entry] = await tx
        .insert(schema.journalEntries)
        .values({ tenantId, entryDate: "2026-07-01", memo: `entry ${tag}`, createdByClerkUserId: `user-${tag}` })
        .returning();
      const [bank] = await tx
        .insert(schema.bankAccounts)
        .values({ tenantId, accountId: cash.id, name: `Bank ${tag}`, kind: "checking" })
        .returning();
      const [txn] = await tx
        .insert(schema.bankTransactions)
        .values({ tenantId, bankAccountId: bank.id, txnDate: "2026-07-01", description: `txn ${tag}`, amountCents: -1000, externalHash: `h-${tag}-${STAMP_DOC}`, source: "csv" })
        .returning();
      const [customer] = await tx
        .insert(schema.customers)
        .values({ tenantId, name: `Customer ${tag}` })
        .returning();
      const [invoice] = await tx
        .insert(schema.invoices)
        .values({ tenantId, customerId: customer.id, invoiceNumber: `INV-${tag}`, issueDate: "2026-07-01", createdByClerkUserId: `user-${tag}` })
        .returning();
      const [doc] = await tx
        .insert(schema.documents)
        .values({ tenantId, blobPathname: `acct/${tenantId}/receipts/${tag}.pdf`, fileName: `${tag}.pdf`, mimeType: "application/pdf", sizeBytes: 100, sha256: `sha-${tag}` })
        .returning();
      await tx.insert(schema.documentLinks).values({
        tenantId,
        documentId: doc.id,
        journalEntryId: entry.id,
        createdByClerkUserId: `user-${tag}`,
      });
      return { documentId: doc.id, entryId: entry.id, bankTxnId: txn.id, invoiceId: invoice.id };
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_DOC}-a`, name: "Doc Iso A", slug: `${STAMP_DOC}-a` },
          { clerkOrgId: `${STAMP_DOC}-b`, name: "Doc Iso B", slug: `${STAMP_DOC}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedDocuments(tenantA, "A");
    fx.b = await seedDocuments(tenantB, "B");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on documents tables return only the tenant's rows", async () => {
    await withTenant(tenantA, async (tx) => {
      const docs = await tx.select().from(schema.documents);
      expect(docs.length).toBeGreaterThan(0);
      expect(docs.every((r) => r.tenantId === tenantA)).toBe(true);
      const links = await tx.select().from(schema.documentLinks);
      expect(links.length).toBeGreaterThan(0);
      expect(links.every((r) => r.tenantId === tenantA)).toBe(true);
    });
  });

  it("cannot read the other tenant's inbound email token", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.accountingSettings)
        .where(eq(schema.accountingSettings.inboundEmailToken, `token-B-${STAMP_DOC}`)),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot INSERT documents attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documents).values({
          tenantId: tenantB,
          fileName: "smuggled.pdf",
          mimeType: "application/pdf",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: cannot link A's record to the OTHER tenant's document", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentLinks).values({
          tenantId: tenantA,
          documentId: fx.b.documentId,
          journalEntryId: fx.a.entryId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: cannot link A's document to the OTHER tenant's entry", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentLinks).values({
          tenantId: tenantA,
          documentId: fx.a.documentId,
          journalEntryId: fx.b.entryId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: cannot link A's document to the OTHER tenant's bank txn", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentLinks).values({
          tenantId: tenantA,
          documentId: fx.a.documentId,
          bankTransactionId: fx.b.bankTxnId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: cannot link A's document to the OTHER tenant's invoice", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentLinks).values({
          tenantId: tenantA,
          documentId: fx.a.documentId,
          invoiceId: fx.b.invoiceId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant UPDATE and DELETE affect zero documents rows", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.documents)
        .set({ fileName: "defaced.pdf" })
        .where(eq(schema.documents.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.documentLinks)
        .where(eq(schema.documentLinks.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("default-deny: no context sees no documents rows", async () => {
    const rows = await withSystem(async (tx) => {
      // Reset context inside this tx to simulate a forgotten wrapper.
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return Promise.all([
        tx.select().from(schema.documents),
        tx.select().from(schema.documentLinks),
      ]);
    });
    for (const r of rows) expect(r).toHaveLength(0);
  });
});

/**
 * Payables (session 6): RLS isolation for vendors/bills/bill_lines/
 * bill_payments plus the composite-FK smuggle matrix and the EXTENDED
 * exactly-one CHECKs on document_links (4 targets) and line_dimensions
 * (3 parents).
 */
const STAMP_PAY = `iso-pay-${process.pid}`;

interface PayFixture {
  vendorId: string;
  billId: string;
  billLineId: string;
  accountId: string;
  entryId: string;
  documentId: string;
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
      const [entry] = await tx
        .insert(schema.journalEntries)
        .values({ tenantId, entryDate: "2026-07-01", memo: `entry ${tag}`, createdByClerkUserId: `user-${tag}` })
        .returning();
      const [vendor] = await tx
        .insert(schema.vendors)
        .values({ tenantId, name: `Vendor ${tag}` })
        .returning();
      const [bill] = await tx
        .insert(schema.bills)
        .values({ tenantId, vendorId: vendor.id, billDate: "2026-07-01", createdByClerkUserId: `user-${tag}` })
        .returning();
      const [billLine] = await tx
        .insert(schema.billLines)
        .values({ tenantId, billId: bill.id, lineNo: 1, description: `line ${tag}`, amountCents: 1000, accountId: expense.id })
        .returning();
      const [doc] = await tx
        .insert(schema.documents)
        .values({ tenantId, blobPathname: `acct/${tenantId}/receipts/pay-${tag}.pdf`, fileName: `${tag}.pdf`, mimeType: "application/pdf", sizeBytes: 10, sha256: `pay-${tag}` })
        .returning();
      return {
        vendorId: vendor.id,
        billId: bill.id,
        billLineId: billLine.id,
        accountId: expense.id,
        entryId: entry.id,
        documentId: doc.id,
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
        tx.insert(schema.vendors).values({ tenantId: tenantB, name: "smuggled vendor" }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bills).values({
          tenantId: tenantB,
          vendorId: fx.b.vendorId,
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

  it("default-deny: no context sees no payables rows", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return Promise.all([
        tx.select().from(schema.vendors),
        tx.select().from(schema.bills),
        tx.select().from(schema.billLines),
        tx.select().from(schema.billPayments),
      ]);
    });
    for (const r of rows) expect(r).toHaveLength(0);
  });
});

/* --------------------------------------------------------------------------
 * Close & accountant tools (session 7): period_closes + close_notes, plus
 * the scoped memberships_member_update policy.
 * ------------------------------------------------------------------------ */

const STAMP_CLOSE = `iso-close-${process.pid}`;

interface CloseFixture {
  closeId: string;
  noteId: string;
  membershipId: string;
}

d("close-tools isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, CloseFixture> = {};

  async function seedClose(tenantId: string, tag: string): Promise<CloseFixture> {
    // Membership rows are created under withSystem (webhook-sync precedent).
    const membershipId = await withSystem(async (tx) => {
      const [profile] = await tx
        .insert(schema.profiles)
        .values({ clerkUserId: `${STAMP_CLOSE}-${tag}`, email: `${STAMP_CLOSE}-${tag}@x.test` })
        .returning();
      const [m] = await tx
        .insert(schema.memberships)
        .values({ tenantId, profileId: profile.id, role: "staff" })
        .returning();
      return m.id;
    });
    return withTenant(tenantId, async (tx) => {
      const [close] = await tx
        .insert(schema.periodCloses)
        .values({
          tenantId,
          periodEnd: "2026-06-30",
          checklist: { items: [], blockerCount: 0 },
          completedByClerkUserId: `user-${tag}`,
        })
        .returning();
      const [note] = await tx
        .insert(schema.closeNotes)
        .values({ tenantId, closeId: close.id, authorClerkUserId: `user-${tag}`, body: `note ${tag}` })
        .returning();
      return { closeId: close.id, noteId: note.id, membershipId };
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_CLOSE}-a`, name: "Close Iso A", slug: `${STAMP_CLOSE}-a` },
          { clerkOrgId: `${STAMP_CLOSE}-b`, name: "Close Iso B", slug: `${STAMP_CLOSE}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedClose(tenantA, "A");
    fx.b = await seedClose(tenantB, "B");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // Profiles are global rows — clean them explicitly.
      await tx.execute(
        sql`delete from profiles where clerk_user_id like ${`${STAMP_CLOSE}-%`}`,
      );
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on close tables return only the tenant's rows", async () => {
    await withTenant(tenantA, async (tx) => {
      const closes = await tx.select().from(schema.periodCloses);
      expect(closes.length).toBeGreaterThan(0);
      expect(closes.every((r) => r.tenantId === tenantA)).toBe(true);
      const notes = await tx.select().from(schema.closeNotes);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((r) => r.tenantId === tenantA)).toBe(true);
    });
  });

  it("cannot INSERT close rows attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.periodCloses).values({
          tenantId: tenantB,
          periodEnd: "2026-05-31",
          checklist: {},
          completedByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's close_note cannot point at B's close", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.closeNotes).values({
          tenantId: tenantA,
          closeId: fx.b.closeId,
          authorClerkUserId: "attacker",
          body: "smuggled note",
        }),
      ),
    ).rejects.toThrow();
  });

  it("one completed close per period end (partial unique)", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.periodCloses).values({
          tenantId: tenantA,
          periodEnd: "2026-06-30",
          checklist: {},
          completedByClerkUserId: "user-A",
        }),
      ),
    ).rejects.toThrow();
  });

  it("memberships UPDATE under tenant context is scoped to the tenant", async () => {
    // In-tenant update works (the new memberships_member_update policy)…
    const own = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "expert" })
        .where(eq(schema.memberships.id, fx.a.membershipId))
        .returning(),
    );
    expect(own).toHaveLength(1);
    expect(own[0].role).toBe("expert");
    // …but cannot touch the other tenant's rows (0 rows affected).
    const cross = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "expert" })
        .where(eq(schema.memberships.id, fx.b.membershipId))
        .returning(),
    );
    expect(cross).toHaveLength(0);
  });

  it("cross-tenant UPDATE and DELETE affect zero close rows", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.periodCloses)
        .set({ status: "reopened" })
        .where(eq(schema.periodCloses.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.closeNotes)
        .where(eq(schema.closeNotes.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("default-deny: no context sees no close rows", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return Promise.all([
        tx.select().from(schema.periodCloses),
        tx.select().from(schema.closeNotes),
      ]);
    });
    for (const r of rows) expect(r).toHaveLength(0);
  });
});

/* --------------------------------------------------------------------------
 * Retainer hours (platform feature): retainers, retainer_allotments,
 * retainer_time_entries, retainer_purchases. Members READ their own rows
 * only — every write path is superadmin/webhook. The write rejections here
 * are the "a tenant can't forge hours or credits" proof.
 * ------------------------------------------------------------------------ */

const STAMP_RET = `iso-retainer-${process.pid}`;

d("retainer isolation (RLS, member read-only)", () => {
  let tenantA: string;
  let tenantB: string;

  async function seedRetainer(tenantId: string, tag: string) {
    await withSystem(async (tx) => {
      await tx.insert(schema.retainers).values({
        tenantId,
        includedMinutesMonthly: 600,
      });
      await tx.insert(schema.retainerAllotments).values({
        tenantId,
        effectiveMonth: "2026-01",
        includedMinutes: 600,
      });
      await tx.insert(schema.retainerTimeEntries).values({
        tenantId,
        minutes: 90,
        workDate: "2026-07-01",
        note: `secret work note ${tag}`,
        source: "manual",
        actorClerkUserId: "founder",
      });
      await tx.insert(schema.retainerPurchases).values({
        tenantId,
        minutes: 300,
        amountCents: 50_000,
        stripeSessionId: `cs_${STAMP_RET}_${tag}`,
        blockKey: "five_hours",
      });
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_RET}-a`, name: "Ret Iso A", slug: `${STAMP_RET}-a` },
          { clerkOrgId: `${STAMP_RET}-b`, name: "Ret Iso B", slug: `${STAMP_RET}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    await seedRetainer(tenantA, "A");
    await seedRetainer(tenantB, "B");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on all four tables return only the tenant's rows", async () => {
    await withTenant(tenantA, async (tx) => {
      const [rets, allots, entries, purchases] = await Promise.all([
        tx.select().from(schema.retainers),
        tx.select().from(schema.retainerAllotments),
        tx.select().from(schema.retainerTimeEntries),
        tx.select().from(schema.retainerPurchases),
      ]);
      for (const rows of [rets, allots, entries, purchases]) {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
      }
      expect(
        entries.some((e) => e.note.includes("secret work note B")),
      ).toBe(false);
    });
  });

  it("member INSERT is rejected even for the member's OWN tenant (read-only tables)", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.retainerTimeEntries).values({
          tenantId: tenantA,
          minutes: 6000,
          workDate: "2026-07-01",
          note: "forged hours",
          source: "manual",
          actorClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.retainerPurchases).values({
          tenantId: tenantA,
          minutes: 60000,
          amountCents: 0,
          stripeSessionId: `cs_${STAMP_RET}_forged`,
          blockKey: "five_hours",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.retainerAllotments).values({
          tenantId: tenantA,
          effectiveMonth: "2026-08",
          includedMinutes: 60000,
        }),
      ),
    ).rejects.toThrow();
  });

  it("member UPDATE and DELETE affect zero rows, own tenant included", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.retainers)
        .set({ includedMinutesMonthly: 60000 })
        .where(eq(schema.retainers.tenantId, tenantA))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.retainerTimeEntries)
        .where(eq(schema.retainerTimeEntries.tenantId, tenantA))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("cross-tenant UPDATE/DELETE also affect zero rows", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.retainerPurchases)
        .set({ minutes: 1 })
        .where(eq(schema.retainerPurchases.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.retainerPurchases)
        .where(eq(schema.retainerPurchases.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("default-deny: no context sees no retainer rows", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return Promise.all([
        tx.select().from(schema.retainers),
        tx.select().from(schema.retainerAllotments),
        tx.select().from(schema.retainerTimeEntries),
        tx.select().from(schema.retainerPurchases),
      ]);
    });
    for (const r of rows) expect(r).toHaveLength(0);
  });
});
