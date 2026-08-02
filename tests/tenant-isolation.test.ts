import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { recentCorrespondents } from "../src/modules/email/contacts/recent";
import { accountingMailExtension } from "../src/modules/accounting/mail/extension";
import { documentsMailExtension } from "../src/modules/documents/mail/extension";

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
        .values({ tenantId, origin: "accounting", blobPathname: `acct/${tenantId}/receipts/${tag}.pdf`, fileName: `${tag}.pdf`, mimeType: "application/pdf", sizeBytes: 100, sha256: `sha-${tag}` })
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
          origin: "accounting",
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
        .values({ tenantId, origin: "accounting", blobPathname: `acct/${tenantId}/receipts/pay-${tag}.pdf`, fileName: `${tag}.pdf`, mimeType: "application/pdf", sizeBytes: 10, sha256: `pay-${tag}` })
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

/* --------------------------------------------------------------------------
 * Health-check interview sessions (public feature): platform-owner-only —
 * no member policies at all. A tenant must never see or touch prospect
 * conversations. Also proves the audits.source default backfill.
 * ------------------------------------------------------------------------ */

const STAMP_IV = `iso-interview-${process.pid}`;

d("interview-session isolation (RLS, superadmin only)", () => {
  let tenantId: string;
  let sessionId: string;

  beforeAll(async () => {
    [tenantId, sessionId] = await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP_IV, name: "Iv Iso", slug: STAMP_IV }])
        .returning();
      const [s] = await tx
        .insert(schema.interviewSessions)
        .values({
          ipHash: `hash-${STAMP_IV}`,
          messages: [{ role: "assistant", content: "secret prospect opener" }],
        })
        .returning();
      return [t.id, s.id];
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx
        .delete(schema.interviewSessions)
        .where(eq(schema.interviewSessions.id, sessionId));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("tenant members see zero interview sessions", async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.interviewSessions),
    );
    expect(rows).toHaveLength(0);
  });

  it("tenant members cannot insert or update interview sessions", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.interviewSessions).values({ ipHash: "forged" }),
      ),
    ).rejects.toThrow();
    const updated = await withTenant(tenantId, (tx) =>
      tx
        .update(schema.interviewSessions)
        .set({ state: "expired" })
        .where(eq(schema.interviewSessions.id, sessionId))
        .returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("default-deny: no context sees no sessions; audits.source backfilled", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.interviewSessions);
    });
    expect(rows).toHaveLength(0);

    // Pre-existing audits read back the 'founder' default.
    const audit = await withSystem((tx) =>
      tx.query.audits.findFirst(),
    );
    if (audit) expect(["founder", "self_serve"]).toContain(audit.source);
  });
});

/* ------------------------------------------------------------------------
 * Documents module (DMS): the folder tree, versions, tags and saved views.
 *
 * This block certifies something the others do not — a SECOND dimension of
 * isolation. Everywhere else "who are you" means "which tenant". Here it also
 * means "which role", because owners-only folders are enforced by the RLS
 * policy comparing effective_visibility against app.tenant_role, not by app
 * code. The decisive tests are the ones where tenant A's own staff sees nothing.
 * ---------------------------------------------------------------------- */

const STAMP_DMS = `iso-dms-${process.pid}`;

interface DmsFixture {
  openFolderId: string;
  lockedFolderId: string;
  openDocId: string;
  lockedDocId: string;
  versionId: string;
  tagId: string;
  viewId: string;
  templateId: string;
  templateVersionId: string;
}

d("documents DMS isolation (RLS + role dimension + composite FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, DmsFixture> = {};

  const seg = (id: string) => id.replace(/-/g, "").toLowerCase();

  async function seedDms(tenantId: string, tag: string): Promise<DmsFixture> {
    // Seeded as owner: the fixture deliberately creates owners-only rows, and
    // the member policy's WITH CHECK would (correctly) refuse them as staff.
    return withTenant(
      tenantId,
      async (tx) => {
        const [open] = await tx
          .insert(schema.documentFolders)
          .values({
            tenantId,
            name: `Jobs ${tag}`,
            nameKey: `jobs ${tag}`.toLowerCase(),
            path: "/00000000000000000000000000000000/",
            visibility: "members",
            effectiveVisibility: "members",
          })
          .returning();
        await tx
          .update(schema.documentFolders)
          .set({ path: `/${seg(open.id)}/` })
          .where(eq(schema.documentFolders.id, open.id));

        const [locked] = await tx
          .insert(schema.documentFolders)
          .values({
            tenantId,
            parentId: open.id,
            name: `Payroll ${tag}`,
            nameKey: `payroll ${tag}`.toLowerCase(),
            path: "/00000000000000000000000000000001/",
            depth: 2,
            visibility: "owners",
            effectiveVisibility: "owners",
          })
          .returning();
        await tx
          .update(schema.documentFolders)
          .set({ path: `/${seg(open.id)}/${seg(locked.id)}/` })
          .where(eq(schema.documentFolders.id, locked.id));

        const [openDoc] = await tx
          .insert(schema.documents)
          .values({
            tenantId,
            origin: "dms",
            folderId: open.id,
            filedAt: new Date(),
            blobPathname: `docs/${tenantId}/files/open-${tag}.pdf`,
            fileName: `open-${tag}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: `dms-open-${tag}`,
            effectiveVisibility: "members",
          })
          .returning();

        const [lockedDoc] = await tx
          .insert(schema.documents)
          .values({
            tenantId,
            origin: "dms",
            folderId: locked.id,
            filedAt: new Date(),
            blobPathname: `docs/${tenantId}/files/locked-${tag}.pdf`,
            fileName: `locked-${tag}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: `dms-locked-${tag}`,
            effectiveVisibility: "owners",
          })
          .returning();

        const [version] = await tx
          .insert(schema.documentVersions)
          .values({
            tenantId,
            documentId: lockedDoc.id,
            versionNo: 1,
            blobPathname: `docs/${tenantId}/files/locked-${tag}.pdf`,
            fileName: `locked-${tag}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: `dms-locked-${tag}`,
            isCurrent: true,
          })
          .returning();

        const [dmsTag] = await tx
          .insert(schema.documentTags)
          .values({ tenantId, slug: `tag-${tag.toLowerCase()}`, name: `Tag ${tag}` })
          .returning();

        const [view] = await tx
          .insert(schema.documentSavedViews)
          .values({
            tenantId,
            name: `View ${tag}`,
            nameKey: `view ${tag}`.toLowerCase(),
            createdByClerkUserId: `user-${tag}`,
            query: { folderId: open.id },
          })
          .returning();

        const [template] = await tx
          .insert(schema.documentTemplates)
          .values({
            tenantId,
            name: `Waiver ${tag}`,
            nameKey: `waiver ${tag}`.toLowerCase(),
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();

        const [templateVersion] = await tx
          .insert(schema.documentTemplateVersions)
          .values({
            tenantId,
            templateId: template.id,
            versionNo: 1,
            body: `Received from {{payer}} — ${tag}`,
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();

        return {
          openFolderId: open.id,
          lockedFolderId: locked.id,
          openDocId: openDoc.id,
          lockedDocId: lockedDoc.id,
          versionId: version.id,
          tagId: dmsTag.id,
          viewId: view.id,
          templateId: template.id,
          templateVersionId: templateVersion.id,
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
          { clerkOrgId: `${STAMP_DMS}-a`, name: "DMS Iso A", slug: `${STAMP_DMS}-a` },
          { clerkOrgId: `${STAMP_DMS}-b`, name: "DMS Iso B", slug: `${STAMP_DMS}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedDms(tenantA, "A");
    fx.b = await seedDms(tenantB, "B");
    // Settings are member_read-only, so provisioning writes them as the system.
    await withSystem(async (tx) => {
      await tx.insert(schema.documentSettings).values({ tenantId: tenantA });
      await tx.insert(schema.documentSettings).values({ tenantId: tenantB });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  /* ---- tenant dimension ---- */

  it("unscoped selects return only this tenant's DMS rows", async () => {
    const [folders, versions, tags, views, templates, templateVersions] =
      await withTenant(
        tenantA,
        async (tx) =>
          Promise.all([
            tx.select().from(schema.documentFolders),
            tx.select().from(schema.documentVersions),
            tx.select().from(schema.documentTags),
            tx.select().from(schema.documentSavedViews),
            tx.select().from(schema.documentTemplates),
            tx.select().from(schema.documentTemplateVersions),
          ]),
        { role: "owner" },
      );
    for (const rows of [
      folders,
      versions,
      tags,
      views,
      templates,
      templateVersions,
    ]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
    }
  });

  it("cannot INSERT a template or template version for the other tenant", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.documentTemplates).values({
            tenantId: tenantB,
            name: "smuggled",
            nameKey: "smuggled",
            createdByClerkUserId: "user-a",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.documentTemplateVersions).values({
            tenantId: tenantB,
            templateId: fx.b.templateId,
            versionNo: 2,
            body: "smuggled",
            createdByClerkUserId: "user-a",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  // The composite FK is what stops A's version from being attached to B's
  // template even when the tenant_id column itself is honest.
  it("composite FK: A's template version cannot point at B's template", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.documentTemplateVersions).values({
            tenantId: tenantA,
            templateId: fx.b.templateId,
            versionNo: 2,
            body: "cross-tenant",
            createdByClerkUserId: "user-a",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  /**
   * document_generations is member_READ-only, like document_share_events: it
   * records what the business produced and sent, so a member who could write it
   * could fabricate or erase a document's provenance.
   */
  it("generations are readable but not writable by a member", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.documentGenerations).values({
            tenantId: tenantA,
            templateId: fx.a.templateId,
            templateVersionNo: 1,
            number: 9999,
            generatedByClerkUserId: "user-a",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();

    // Reading is allowed and stays tenant-scoped.
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.documentGenerations),
      { role: "owner" },
    );
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("cross-tenant UPDATE and DELETE affect zero template rows", async () => {
    const changed = await withTenant(
      tenantA,
      async (tx) => {
        const updated = await tx
          .update(schema.documentTemplates)
          .set({ name: "hijacked" })
          .where(eq(schema.documentTemplates.tenantId, tenantB))
          .returning({ id: schema.documentTemplates.id });
        const deleted = await tx
          .delete(schema.documentTemplateVersions)
          .where(eq(schema.documentTemplateVersions.tenantId, tenantB))
          .returning({ id: schema.documentTemplateVersions.id });
        return { updated, deleted };
      },
      { role: "owner" },
    );
    expect(changed.updated).toHaveLength(0);
    expect(changed.deleted).toHaveLength(0);
  });

  it("cannot INSERT a folder attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentFolders).values({
          tenantId: tenantB,
          name: "smuggled",
          nameKey: "smuggled",
          path: "/00000000000000000000000000000002/",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK blocks parenting a folder to the other tenant's folder", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentFolders).values({
          tenantId: tenantA,
          parentId: fx.b.openFolderId,
          name: "smuggled-child",
          nameKey: "smuggled-child",
          path: "/00000000000000000000000000000003/",
          depth: 2,
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK blocks filing a document into the other tenant's folder", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documents).values({
          tenantId: tenantA,
          origin: "dms",
          folderId: fx.b.openFolderId,
          fileName: "smuggled.pdf",
          mimeType: "application/pdf",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK blocks versioning the other tenant's document", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentVersions).values({
          tenantId: tenantA,
          documentId: fx.b.openDocId,
          versionNo: 2,
          blobPathname: `docs/${tenantA}/files/smuggled.pdf`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant UPDATE and DELETE affect zero rows", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.documentFolders)
          .set({ name: "hijacked" })
          .where(eq(schema.documentFolders.id, fx.b.openFolderId))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.documentTags)
          .where(eq(schema.documentTags.id, fx.b.tagId))
          .returning(),
      { role: "owner" },
    );
    expect(deleted).toHaveLength(0);
  });

  /* ---- role dimension: the reason app.tenant_role exists ---- */

  it("staff cannot see their OWN tenant's owners-only folder or document", async () => {
    const result = await withTenant(tenantA, async (tx) => ({
      folders: await tx.select().from(schema.documentFolders),
      docs: await tx.select().from(schema.documents),
    }));
    expect(result.folders.map((f) => f.id)).toContain(fx.a.openFolderId);
    expect(result.folders.map((f) => f.id)).not.toContain(fx.a.lockedFolderId);
    expect(result.docs.map((r) => r.id)).toContain(fx.a.openDocId);
    expect(result.docs.map((r) => r.id)).not.toContain(fx.a.lockedDocId);
  });

  it("the default role is staff — a two-argument withTenant is fail-closed", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, fx.a.lockedDocId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("owner sees both, and still only within their own tenant", async () => {
    const result = await withTenant(
      tenantA,
      async (tx) => ({
        own: await tx.select().from(schema.documents),
        other: await tx
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, fx.b.lockedDocId)),
      }),
      { role: "owner" },
    );
    expect(result.own.map((r) => r.id)).toContain(fx.a.lockedDocId);
    expect(result.own.map((r) => r.id)).toContain(fx.a.openDocId);
    expect(result.other).toHaveLength(0);
  });

  /**
   * The composer's image picker, through the extension seam.
   *
   * THE POINT OF THIS TEST is that `src/modules/documents/mail/extension.ts` has
   * no visibility predicate in it at all — `searchImages` filters on tenant,
   * status, type and size, and nothing else. What keeps an owners-only folder's
   * photograph out of a staff user's picker is RLS, reached through the CALLER'S
   * transaction, exactly as the `MailImageSource` contract requires.
   *
   * That is the property the seam exists for, and it is worth asserting rather
   * than believing: a future refactor that opened its own `withTenant`, or
   * reached for `withSystem`, would still pass every unit test in the module.
   */
  it("the mail image source inherits Documents' visibility, with no predicate of its own", async () => {
    const ctxFor = (role: "owner" | "staff") => ({
      tenantId: tenantA,
      userId: "user_iso_images",
      role,
    });

    // A picture inside the owners-only folder. Created as owner, because the
    // member policy's WITH CHECK would correctly refuse it as staff.
    const hiddenImageId = await withTenant(
      tenantA,
      async (tx) => {
        const [row] = await tx
          .insert(schema.documents)
          .values({
            tenantId: tenantA,
            origin: "dms",
            folderId: fx.a.lockedFolderId,
            title: "Confidential site photo",
            fileName: "confidential.png",
            mimeType: "image/png",
            sizeBytes: 2048,
            blobPathname: `tenants/${tenantA}/files/confidential.png`,
            effectiveVisibility: "owners",
          })
          .returning({ id: schema.documents.id });
        return row.id;
      },
      { role: "owner" },
    );

    const images = documentsMailExtension.images!;

    // STAFF: the picker cannot offer it, and cannot open it by id either —
    // knowing the id is not permission, and `open` returns the same null for
    // "not yours" as for "not there" so it cannot be used to probe.
    const asStaff = await withTenant(
      tenantA,
      async (tx) => ({
        found: await images.search(tx, ctxFor("staff"), "", 50),
        opened: await images.open(tx, ctxFor("staff"), hiddenImageId),
      }),
      { role: "staff" },
    );
    expect(asStaff.found.map((i) => i.id)).not.toContain(hiddenImageId);
    expect(asStaff.opened).toBeNull();

    // OWNER: the same call, the same code, a different row set.
    const asOwner = await withTenant(
      tenantA,
      async (tx) => ({
        found: await images.search(tx, ctxFor("owner"), "", 50),
        opened: await images.open(tx, ctxFor("owner"), hiddenImageId),
      }),
      { role: "owner" },
    );
    expect(asOwner.found.map((i) => i.id)).toContain(hiddenImageId);
    expect(asOwner.opened?.type).toBe("image/png");

    // And never across tenants, whatever the role.
    const asOtherTenantOwner = await withTenant(
      tenantB,
      (tx) =>
        images.open(
          tx,
          { tenantId: tenantB, userId: "user_iso_images", role: "owner" },
          hiddenImageId,
        ),
      { role: "owner" },
    );
    expect(asOtherTenantOwner).toBeNull();
  });

  it("versions inherit visibility with no flag of their own", async () => {
    const asStaff = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.documentVersions),
    );
    expect(asStaff).toHaveLength(0);

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.documentVersions),
      { role: "owner" },
    );
    expect(asOwner.map((v) => v.id)).toContain(fx.a.versionId);
  });

  it("staff cannot CREATE a restricted document (WITH CHECK)", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documents).values({
          tenantId: tenantA,
          origin: "dms",
          fileName: "self-hidden.pdf",
          mimeType: "application/pdf",
          effectiveVisibility: "owners",
        }),
      ),
    ).rejects.toThrow();
  });

  // Note the asymmetry with the cross-tenant cases above, which return 0 rows:
  // here USING passes (staff CAN see this open document) and it is WITH CHECK
  // that refuses the RESULT, so Postgres raises instead of filtering. Loud
  // failure is the better outcome — a silent no-op would look like success.
  it("staff cannot MOVE a document into a restricted folder (WITH CHECK)", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx
          .update(schema.documents)
          .set({ effectiveVisibility: "owners", folderId: fx.a.lockedFolderId })
          .where(eq(schema.documents.id, fx.a.openDocId))
          .returning(),
      ),
    ).rejects.toThrow();

    // And the document is untouched.
    const [after] = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, fx.a.openDocId)),
    );
    expect(after.effectiveVisibility).toBe("members");
    expect(after.folderId).toBe(fx.a.openFolderId);
  });

  /* ---- settings are read-only to members ---- */

  it("members read settings but can never write them", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.documentSettings),
    );
    expect(rows).toHaveLength(1);

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentSettings).values({ tenantId: tenantA }),
      ),
    ).rejects.toThrow();

    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.documentSettings)
          .set({ shareMaxTtlDays: 365 })
          .where(eq(schema.documentSettings.tenantId, tenantA))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);
  });

  /* ---- constraints and default-deny ---- */

  it("a folder cannot be its own parent", async () => {
    await expect(
      withSystem((tx) =>
        tx.execute(
          sql`update document_folders set parent_id = id where id = ${fx.a.openFolderId}`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("default-deny: no context sees no DMS rows at all", async () => {
    const results = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_role', '', true)`);
      return Promise.all([
        tx.select().from(schema.documentFolders),
        tx.select().from(schema.documentVersions),
        tx.select().from(schema.documentTags),
        tx.select().from(schema.documentSavedViews),
        tx.select().from(schema.documentSettings),
      ]);
    });
    for (const rows of results) expect(rows).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------
 * Share links. Three tables, three deliberately different policy shapes:
 * shares are ordinary tenant data, the event log is member-READ-only evidence,
 * and the anonymous probe counter belongs to no tenant at all.
 * ---------------------------------------------------------------------- */

const STAMP_SHR = `iso-shr-${process.pid}`;

interface ShareFixture {
  folderId: string;
  documentId: string;
  shareId: string;
}

d("share-link isolation (RLS + composite FKs + write-only-by-system log)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, ShareFixture> = {};

  async function seedShares(tenantId: string, tag: string): Promise<ShareFixture> {
    return withTenant(
      tenantId,
      async (tx) => {
        const [folder] = await tx
          .insert(schema.documentFolders)
          .values({
            tenantId,
            name: `Shared ${tag}`,
            nameKey: `shared ${tag}`.toLowerCase(),
            path: `/${"0".repeat(31)}${tag === "A" ? "1" : "2"}/`,
          })
          .returning();
        await tx
          .update(schema.documentFolders)
          .set({ path: `/${folder.id.replace(/-/g, "")}/` })
          .where(eq(schema.documentFolders.id, folder.id));

        const [doc] = await tx
          .insert(schema.documents)
          .values({
            tenantId,
            origin: "dms",
            folderId: folder.id,
            filedAt: new Date(),
            fileName: `${tag}.pdf`,
            mimeType: "application/pdf",
            blobPathname: `docs/${tenantId}/files/${tag}-share.pdf`,
          })
          .returning();

        const [share] = await tx
          .insert(schema.documentShares)
          .values({
            tenantId,
            documentId: doc.id,
            tokenHash: `hash-${tag}-${STAMP_SHR}`,
            tokenCiphertext: "ciphertext",
            label: `Link ${tag}`,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdRootVisibility: "members",
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();

        return { folderId: folder.id, documentId: doc.id, shareId: share.id };
      },
      { role: "owner" },
    );
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_SHR}-a`, name: "Share Iso A", slug: `${STAMP_SHR}-a` },
          { clerkOrgId: `${STAMP_SHR}-b`, name: "Share Iso B", slug: `${STAMP_SHR}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedShares(tenantA, "A");
    fx.b = await seedShares(tenantB, "B");

    // Events are written by trusted server code only, never by a member.
    await withSystem(async (tx) => {
      await tx.insert(schema.documentShareEvents).values({
        tenantId: tenantA,
        shareId: fx.a.shareId,
        kind: "viewed",
        ipHash: "hash-a",
      });
      await tx.insert(schema.documentShareEvents).values({
        tenantId: tenantB,
        shareId: fx.b.shareId,
        kind: "viewed",
        ipHash: "hash-b",
      });
      await tx.insert(schema.publicAccessAttempts).values({
        kind: "share_probe",
        ipHash: `probe-${STAMP_SHR}`,
      });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.publicAccessAttempts)
        .where(eq(schema.publicAccessAttempts.ipHash, `probe-${STAMP_SHR}`));
    });
  });

  it("unscoped selects return only this tenant's shares and events", async () => {
    const [shares, events] = await withTenant(
      tenantA,
      async (tx) =>
        Promise.all([
          tx.select().from(schema.documentShares),
          tx.select().from(schema.documentShareEvents),
        ]),
      { role: "owner" },
    );
    expect(shares.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(shares.every((r) => r.tenantId === tenantA)).toBe(true);
    expect(events.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("cannot INSERT a share attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentShares).values({
          tenantId: tenantB,
          documentId: fx.b.documentId,
          tokenHash: `smuggled-${STAMP_SHR}`,
          tokenCiphertext: "x",
          expiresAt: new Date(Date.now() + 60_000),
          createdRootVisibility: "members",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK blocks sharing the other tenant's document or folder", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentShares).values({
          tenantId: tenantA,
          documentId: fx.b.documentId,
          tokenHash: `smuggled-doc-${STAMP_SHR}`,
          tokenCiphertext: "x",
          expiresAt: new Date(Date.now() + 60_000),
          createdRootVisibility: "members",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentShares).values({
          tenantId: tenantA,
          folderId: fx.b.folderId,
          tokenHash: `smuggled-folder-${STAMP_SHR}`,
          tokenCiphertext: "x",
          expiresAt: new Date(Date.now() + 60_000),
          createdRootVisibility: "members",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a share points at exactly one thing", async () => {
    const bad = async (values: Record<string, unknown>) =>
      expect(
        withTenant(tenantA, (tx) =>
          tx.insert(schema.documentShares).values({
            tenantId: tenantA,
            tokenHash: `check-${Math.random()}`,
            tokenCiphertext: "x",
            expiresAt: new Date(Date.now() + 60_000),
            createdRootVisibility: "members",
            createdByClerkUserId: "u",
            ...values,
          } as typeof schema.documentShares.$inferInsert),
        ),
      ).rejects.toThrow();

    await bad({}); // neither
    await bad({ documentId: fx.a.documentId, folderId: fx.a.folderId }); // both
  });

  it("token_hash is unique across the whole table, not per tenant", async () => {
    await expect(
      withTenant(tenantB, (tx) =>
        tx.insert(schema.documentShares).values({
          tenantId: tenantB,
          documentId: fx.b.documentId,
          // Deliberately the hash tenant A already holds.
          tokenHash: `hash-A-${STAMP_SHR}`,
          tokenCiphertext: "x",
          expiresAt: new Date(Date.now() + 60_000),
          createdRootVisibility: "members",
          createdByClerkUserId: "u",
        }),
      ),
    ).rejects.toThrow();
  });

  it("the access log is evidence: members read it, never write it", async () => {
    // Even for their OWN tenant.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentShareEvents).values({
          tenantId: tenantA,
          shareId: fx.a.shareId,
          kind: "viewed",
          ipHash: "forged",
        }),
      ),
    ).rejects.toThrow();

    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.documentShareEvents)
        .set({ kind: "downloaded" })
        .where(eq(schema.documentShareEvents.tenantId, tenantA))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.documentShareEvents)
        .where(eq(schema.documentShareEvents.tenantId, tenantA))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("composite FK blocks logging against the other tenant's share", async () => {
    await expect(
      withSystem(async (tx) => {
        await tx.execute(sql`select set_config('app.role', 'member', true)`);
        await tx.execute(
          sql`select set_config('app.tenant_id', ${tenantA}, true)`,
        );
        return tx.insert(schema.documentShareEvents).values({
          tenantId: tenantA,
          shareId: fx.b.shareId,
          kind: "viewed",
        });
      }),
    ).rejects.toThrow();
  });

  it("anonymous probe counters are invisible to every tenant", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.publicAccessAttempts),
      { role: "owner" },
    );
    expect(rows).toHaveLength(0);
  });

  it("cross-tenant UPDATE and DELETE on shares affect zero rows", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.documentShares)
          .set({ label: "hijacked" })
          .where(eq(schema.documentShares.id, fx.b.shareId))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.documentShares)
          .where(eq(schema.documentShares.id, fx.b.shareId))
          .returning(),
      { role: "owner" },
    );
    expect(deleted).toHaveLength(0);
  });

  it("default-deny: no context sees no share rows at all", async () => {
    const results = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_role', '', true)`);
      return Promise.all([
        tx.select().from(schema.documentShares),
        tx.select().from(schema.documentShareEvents),
        tx.select().from(schema.publicAccessAttempts),
      ]);
    });
    for (const rows of results) expect(rows).toHaveLength(0);
  });
});

/**
 * Mail (the inbox): RLS for the seven tables the email module owns.
 *
 * Three different shapes get certified here, because 0042 gives them three
 * different policies for three different reasons:
 *
 *   - member_read tables (mailbox_domains, mailboxes, mail_directory_accounts,
 *     mail_accounts, mail_thread_index) — readable within the tenant, writable
 *     only by trusted server code. A member who could write any of them could
 *     assert something untrue about the outside world: a cutover that never
 *     happened, a password hash on a colleague's address, a token they control.
 *   - member-writable tables (mail_links, mail_annotations) — the deliberate
 *     exception, because attaching a thread to an invoice is daily work.
 *   - composite tenant FKs, which must refuse a cross-tenant target even when
 *     the row's own tenant_id passes RLS.
 *
 * The single most valuable assertion in this block is that tenant A cannot read
 * tenant B's stored OAuth token. That row is a live credential to somebody's
 * mail.
 */
const STAMP_MAIL = `iso-mail-${process.pid}`;

interface MailFixture {
  domainId: string;
  mailboxId: string;
  directoryId: string;
  accountId: string;
  threadRowId: string;
}

/** A second person inside tenant A — the colleague who must see nothing. */
const COLLEAGUE = "user-a-colleague";

d("mail isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  let colleagueAccountId: string;
  const fx: Record<string, MailFixture> = {};

  /** Seeded under withSystem: members cannot write most of these by design. */
  async function seedMail(tenantId: string, tag: string): Promise<MailFixture> {
    return withSystem(async (tx) => {
      const [domain] = await tx
        .insert(schema.mailboxDomains)
        .values({
          tenantId,
          domain: `${tag}-${STAMP_MAIL}.example`,
          provider: "stalwart",
          status: "pending",
        })
        .returning();
      const [mailbox] = await tx
        .insert(schema.mailboxes)
        .values({
          tenantId,
          mailboxDomainId: domain.id,
          localPart: tag,
          address: `${tag}@${tag}-${STAMP_MAIL}.example`,
          displayName: `Owner ${tag}`,
          status: "active",
        })
        .returning();
      const [directory] = await tx
        .insert(schema.mailDirectoryAccounts)
        .values({
          tenantId,
          mailboxId: mailbox.id,
          login: `${tag}@${tag}-${STAMP_MAIL}.example`,
          passwordHash: `$argon2id$secret-of-${tag}`,
        })
        .returning();
      const [account] = await tx
        .insert(schema.mailAccounts)
        .values({
          tenantId,
          mailboxId: mailbox.id,
          clerkUserId: `user-${tag}`,
          jmapSessionUrl: "https://mail.example/.well-known/jmap",
          jmapAccountId: `acct-${tag}`,
          accessTokenEnc: `ciphertext-token-of-${tag}`,
          refreshTokenEnc: `ciphertext-refresh-of-${tag}`,
        })
        .returning();
      const [threadRow] = await tx
        .insert(schema.mailThreadIndex)
        .values({
          tenantId,
          mailAccountId: account.id,
          threadId: `thread-${tag}`,
          subject: `secret subject of ${tag}`,
        })
        .returning();
      await tx.insert(schema.mailLinks).values({
        tenantId,
        // 0045: a thread id is only unique inside one mail account, so the
        // account is part of the link's identity.
        mailAccountId: account.id,
        threadId: `thread-${tag}`,
        extensionSlug: "documents",
        entityType: "document",
        // Any uuid: the table carries no FK on entity_id on purpose, so a
        // future layer can contribute a type without a migration.
        entityId: domain.id,
        createdByClerkUserId: `user-${tag}`,
      });
      await tx.insert(schema.mailAnnotations).values({
        tenantId,
        threadId: `thread-${tag}`,
        extensionSlug: "documents",
        data: { note: `annotation of ${tag}` },
      });
      return {
        domainId: domain.id,
        mailboxId: mailbox.id,
        directoryId: directory.id,
        accountId: account.id,
        threadRowId: threadRow.id,
      };
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_MAIL}-a`, name: "Mail Iso A", slug: `${STAMP_MAIL}-a` },
          { clerkOrgId: `${STAMP_MAIL}-b`, name: "Mail Iso B", slug: `${STAMP_MAIL}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedMail(tenantA, "a");
    fx.b = await seedMail(tenantB, "b");

    // A second person in tenant A, for the per-user tests below. Created here
    // rather than inside a test so the block does not depend on `it` order.
    const [colleague] = await withSystem((tx) =>
      tx
        .insert(schema.mailAccounts)
        .values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          clerkUserId: COLLEAGUE,
          jmapSessionUrl: "https://mail.example/.well-known/jmap",
          jmapAccountId: "acct-colleague",
          accessTokenEnc: "ciphertext-token-of-colleague",
        })
        .returning(),
    );
    colleagueAccountId = colleague.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on every mail table return only the tenant's rows", async () => {
    // The user id is required for the two per-user tables (0043); the other
    // five are tenant-scoped and ignore it.
    await withTenant(
      tenantA,
      async (tx) => {
        const tables = [
          await tx.select().from(schema.mailboxDomains),
          await tx.select().from(schema.mailboxes),
          await tx.select().from(schema.mailDirectoryAccounts),
          await tx.select().from(schema.mailAccounts),
          await tx.select().from(schema.mailThreadIndex),
          await tx.select().from(schema.mailLinks),
          await tx.select().from(schema.mailAnnotations),
        ];
        for (const rows of tables) {
          expect(rows.length).toBeGreaterThan(0);
          expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
        }
      },
      { userId: "user-a" },
    );
  });

  it("cannot read the other tenant's stored OAuth token", async () => {
    // That row is a live credential to somebody's mail. Encryption is what
    // makes the residual exposure uninteresting; this proves it never arrives.
    const rows = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.mailAccounts)
          .where(eq(schema.mailAccounts.id, fx.b.accountId)),
      { userId: "user-a" },
    );
    expect(rows).toHaveLength(0);
  });

  // ── Per-user isolation INSIDE one tenant (drizzle/0043) ──────────────────
  //
  // The rest of this file asks "can tenant A read tenant B?". These four ask
  // the question the inbox actually turns on: can one employee read a
  // COLLEAGUE'S mail? Same tenant, same RLS context, different person. Before
  // 0043 the answer was "only because the application remembered to filter".

  it("a colleague in the SAME tenant cannot read another user's connection", async () => {
    // Deliberately NO where clause on clerk_user_id — the forgotten-predicate
    // scenario this policy exists for.
    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailAccounts),
      { userId: "user-a" },
    );
    expect(asOwner.every((r) => r.clerkUserId === "user-a")).toBe(true);
    expect(asOwner.some((r) => r.id === colleagueAccountId)).toBe(false);

    // And the colleague sees theirs, so this is scoping rather than breakage.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailAccounts),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(1);
    expect(asColleague[0].id).toBe(colleagueAccountId);
  });

  it("omitting the user id reads NOTHING, not everything", async () => {
    // The direction that matters: a caller who forgets `{ userId }` must be
    // denied, never granted. Same property app.tenant_role was built with.
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailAccounts),
    );
    expect(rows).toHaveLength(0);
  });

  it("a colleague cannot read another user's thread subjects", async () => {
    // mail_thread_index has no clerk_user_id of its own — it inherits scope
    // through mail_accounts. This proves the EXISTS in 0043 actually composes.
    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailThreadIndex),
      { userId: "user-a" },
    );
    expect(asOwner.length).toBeGreaterThan(0);
    expect(asOwner.every((r) => r.threadId === "thread-a")).toBe(true);

    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailThreadIndex),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailThreadIndex),
    );
    expect(asNobody).toHaveLength(0);
  });

  /**
   * Recipient autocomplete, over the same per-user scope.
   *
   * THE PRIVACY FAILURE THIS RULES OUT is specific and easy to ship by accident:
   * an autocomplete that offered a colleague's correspondents would leak WHO
   * SOMEBODY ELSE WRITES TO, from a feature nobody thinks of as sensitive. It is
   * the same class of leak `mail_thread_index`'s policy exists for — a subject
   * line in a colleague's thread list is already too much — and it is reached
   * here through a different door, so it deserves its own assertion.
   *
   * `recentCorrespondents` has no user predicate of its own. What scopes it is
   * the `withTenant(..., { userId })` the action passes, and RLS.
   */
  it("recipient suggestions never offer a colleague's correspondents", async () => {
    // Seeded under withSystem, and that is itself worth noticing:
    // `mail_thread_index` is member-READ only, so a member update is silently
    // refused. Sync writes it as trusted code, which is exactly why a member
    // cannot forge a correspondent into somebody's suggestions.
    await withSystem((tx) =>
      tx
        .update(schema.mailThreadIndex)
        .set({
          participants: [{ name: "A Supplier", email: "supplier-iso@example.com" }],
        })
        .where(eq(schema.mailThreadIndex.id, fx.a.threadRowId)),
    );

    const mine = await withTenant(
      tenantA,
      (tx) => recentCorrespondents(tx, tenantA, "supplier-iso", 10),
      { userId: "user-a" },
    );
    expect(mine.map((c) => c.email)).toContain("supplier-iso@example.com");

    const theirs = await withTenant(
      tenantA,
      (tx) => recentCorrespondents(tx, tenantA, "supplier-iso", 10),
      { userId: COLLEAGUE },
    );
    expect(theirs).toEqual([]);

    // The fail-closed direction: a caller that forgets `userId` gets NOTHING
    // rather than everything, which is what `app_current_user()` returning NULL
    // is for.
    const anonymous = await withTenant(tenantA, (tx) =>
      recentCorrespondents(tx, tenantA, "supplier-iso", 10),
    );
    expect(anonymous).toEqual([]);
  });

  /**
   * The contact SEAM, over Accounting's customers.
   *
   * `extension.ts` filters on tenant and a non-empty address and nothing else,
   * so this asserts that the CALLER'S transaction is what keeps one tenant's
   * customers out of another's recipient field — the same property the image
   * source is tested for, reached through the other capability.
   */
  it("the contact source cannot reach another tenant's customers", async () => {
    for (const [tenant, tag] of [
      [tenantA, "a"],
      [tenantB, "b"],
    ] as const) {
      await withTenant(
        tenant,
        (tx) =>
          tx.insert(schema.customers).values({
            tenantId: tenant,
            name: `Isolation Contact ${tag}`,
            email: `isolation-contact@${tag}.example`,
          }),
        { role: "owner", userId: `user-${tag}` },
      );
    }

    const fromA = await withTenant(
      tenantA,
      (tx) =>
        accountingMailExtension.contacts!.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          "isolation-contact",
          10,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(fromA.map((c) => c.email)).toEqual(["isolation-contact@a.example"]);

    const fromB = await withTenant(
      tenantB,
      (tx) =>
        accountingMailExtension.contacts!.search(
          tx,
          { tenantId: tenantB, userId: "user-b", role: "owner" },
          "isolation-contact",
          10,
        ),
      { role: "owner", userId: "user-b" },
    );
    expect(fromB.map((c) => c.email)).toEqual(["isolation-contact@b.example"]);
  });

  it("a colleague cannot delete another user's connection, but you can delete your own", async () => {
    const deletedTheirs = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailAccounts)
          .where(eq(schema.mailAccounts.clerkUserId, "user-a"))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deletedTheirs).toHaveLength(0);

    const deletedOwn = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailAccounts)
          .where(eq(schema.mailAccounts.clerkUserId, COLLEAGUE))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deletedOwn).toHaveLength(1);
  });

  it("a colleague cannot see, or delete, another user's saved searches", async () => {
    // mail_saved_searches (0048) is the SECOND per-user table. The name of a
    // saved search is correspondence — "unread from the solicitor" tells a
    // colleague what somebody is dealing with — so it gets the same scoping
    // mail_accounts and mail_thread_index got in 0043.
    const [mine] = await withTenant(
      tenantA,
      (tx) =>
        tx
          .insert(schema.mailSavedSearches)
          .values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            name: "Unread from the solicitor",
            nameKey: "unread from the solicitor",
            query: { unread: true },
          })
          .returning(),
      { userId: "user-a" },
    );
    expect(mine.id).toBeTruthy();

    // Member-writable, unlike the other per-user mail tables: the worst a
    // member can do to their own saved searches is save a bad one.
    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailSavedSearches),
      { userId: "user-a" },
    );
    expect(asOwner.some((r) => r.id === mine.id)).toBe(true);

    // Deliberately no where clause — the forgotten-predicate scenario.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailSavedSearches),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailSavedSearches),
    );
    expect(asNobody).toHaveLength(0);

    const deletedByColleague = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailSavedSearches)
          .where(eq(schema.mailSavedSearches.id, mine.id))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deletedByColleague).toHaveLength(0);
  });

  it("cannot create a saved search attributed to a colleague", async () => {
    // The WITH CHECK pins clerk_user_id as well as tenant_id, so a member
    // cannot plant a view in somebody else's rail any more than they can read
    // one out of it.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailSavedSearches).values({
            tenantId: tenantA,
            clerkUserId: COLLEAGUE,
            mailAccountId: fx.a.accountId,
            name: "planted",
            nameKey: "planted",
            query: {},
          }),
        { userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("composite FK: a saved search cannot point at the OTHER tenant's connection", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailSavedSearches).values({
          tenantId: tenantA,
          clerkUserId: "user-a",
          mailAccountId: fx.b.accountId,
          name: "smuggled",
          nameKey: "smuggled",
          query: {},
        }),
      ),
    ).rejects.toThrow();
  });

  it("a colleague cannot see, or delete, another user's snoozes", async () => {
    // mail_snoozes (0050) is the THIRD per-user table. A row here is a diary
    // entry: it says what somebody is putting off and until when, message by
    // message. Same scoping as 0043 and 0048, for the same two reasons — the
    // mailbox ids are not shareable, and the list is nobody else's business.
    const [mine] = await withTenant(
      tenantA,
      (tx) =>
        tx
          .insert(schema.mailSnoozes)
          .values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            emailId: "M-snooze-1",
            returnToMailboxId: "mbx-inbox",
            snoozeMailboxId: "mbx-snoozed",
            dueAt: new Date(Date.now() + 3_600_000),
          })
          .returning(),
      { userId: "user-a" },
    );
    expect(mine.id).toBeTruthy();

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailSnoozes),
      { userId: "user-a" },
    );
    expect(asOwner.some((r) => r.id === mine.id)).toBe(true);

    // Deliberately no where clause — the forgotten-predicate scenario.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailSnoozes),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailSnoozes),
    );
    expect(asNobody).toHaveLength(0);

    const deletedByColleague = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailSnoozes)
          .where(eq(schema.mailSnoozes.id, mine.id))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deletedByColleague).toHaveLength(0);
  });

  it("cannot snooze on a colleague's behalf", async () => {
    // The WITH CHECK pins clerk_user_id as well as tenant_id. Planting a snooze
    // in somebody else's account would move THEIR mail out of THEIR inbox,
    // which is a good deal worse than planting a saved search.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailSnoozes).values({
            tenantId: tenantA,
            clerkUserId: COLLEAGUE,
            mailAccountId: fx.a.accountId,
            emailId: "M-planted",
            returnToMailboxId: "mbx-inbox",
            snoozeMailboxId: "mbx-snoozed",
            dueAt: new Date(Date.now() + 3_600_000),
          }),
        { userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("a colleague cannot see, or write, another user's rules", async () => {
    // mail_rules (0051/0052) is the FOURTH per-user table. Reading somebody
    // else's rules is a privacy problem; WRITING one is worse than anything
    // the other three allow — a planted rule files a colleague's mail
    // somewhere they never look, server-side and invisible from the inbox.
    const [mine] = await withTenant(
      tenantA,
      (tx) =>
        tx
          .insert(schema.mailRules)
          .values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            name: "Anything from the solicitor",
            matchMode: "all",
            tests: [{ field: "from", contains: "solicitor.example" }],
            action: { fileIntoMailboxId: "mbx1", fileIntoName: "Legal", markRead: false, flag: true },
          })
          .returning(),
      { userId: "user-a" },
    );
    expect(mine.id).toBeTruthy();

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailRules),
      { userId: "user-a" },
    );
    expect(asOwner.some((r) => r.id === mine.id)).toBe(true);

    // Deliberately no where clause — the forgotten-predicate scenario.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailRules),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailRules),
    );
    expect(asNobody).toHaveLength(0);

    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailRules)
          .where(eq(schema.mailRules.id, mine.id))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deleted).toHaveLength(0);
  });

  it("cannot plant a rule in a colleague's script", async () => {
    // The one that matters most on this table: a rule attributed to somebody
    // else would be compiled into THEIR Sieve script and run on THEIR mail.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailRules).values({
            tenantId: tenantA,
            clerkUserId: COLLEAGUE,
            mailAccountId: fx.a.accountId,
            name: "planted",
            matchMode: "all",
            tests: [{ field: "from", contains: "x" }],
            action: { fileIntoMailboxId: "mbx1", fileIntoName: "X", markRead: false, flag: false },
          }),
        { userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("composite FK: a snooze cannot point at the OTHER tenant's connection", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailSnoozes).values({
          tenantId: tenantA,
          clerkUserId: "user-a",
          mailAccountId: fx.b.accountId,
          emailId: "M-smuggled",
          returnToMailboxId: "mbx-inbox",
          snoozeMailboxId: "mbx-snoozed",
          dueAt: new Date(Date.now() + 3_600_000),
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot read the other tenant's mail password hashes", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.mailDirectoryAccounts)
        .where(eq(schema.mailDirectoryAccounts.id, fx.b.directoryId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot read the other tenant's thread subjects", async () => {
    // Passes a valid user id on purpose, so this proves CROSS-TENANT denial
    // rather than passing trivially because no user was set.
    const rows = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.mailThreadIndex)
          .where(eq(schema.mailThreadIndex.threadId, "thread-b")),
      { userId: "user-a" },
    );
    expect(rows).toHaveLength(0);
  });

  it("members cannot write the trusted-code-only mail tables, even for their own tenant", async () => {
    // No member INSERT policy exists on any of these. A member who could write
    // mail_accounts could point an account at a token they control; one who
    // could write mail_directory_accounts could set a hash on a colleague's
    // address. Both are authentication bypasses, not data errors.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          clerkUserId: "attacker",
          accessTokenEnc: "attacker-controlled",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailDirectoryAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          login: `attacker-${STAMP_MAIL}@example.test`,
          passwordHash: "$argon2id$chosen-by-attacker",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailboxes).values({
          tenantId: tenantA,
          mailboxDomainId: fx.a.domainId,
          localPart: "attacker",
          address: `attacker@a-${STAMP_MAIL}.example`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("members CAN write links and annotations for their own tenant", async () => {
    // The deliberate exception: attaching a thread to an invoice is ordinary
    // daily work, not an administrative act.
    const inserted = await withTenant(tenantA, (tx) =>
      tx
        .insert(schema.mailLinks)
        .values({
          tenantId: tenantA,
          mailAccountId: fx.a.accountId,
          threadId: "thread-a",
          extensionSlug: "accounting",
          entityType: "invoice",
          entityId: fx.a.mailboxId,
          createdByClerkUserId: "user-a",
        })
        .returning(),
    );
    expect(inserted).toHaveLength(1);

    // The annotation counter (0045). Member-writable for the same reason the
    // row is: a layer reprocessing a thread is ordinary work.
    const bumped = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.mailAnnotations)
        .set({ data: { note: "reprocessed" }, version: 2 })
        .where(eq(schema.mailAnnotations.tenantId, tenantA))
        .returning(),
    );
    expect(bumped.length).toBeGreaterThan(0);
    expect(bumped[0].version).toBe(2);
  });

  it("cannot INSERT links or annotations attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailLinks).values({
          tenantId: tenantB,
          mailAccountId: fx.b.accountId,
          threadId: "thread-b",
          extensionSlug: "accounting",
          entityType: "invoice",
          entityId: fx.b.mailboxId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailAnnotations).values({
          tenantId: tenantB,
          threadId: "thread-b",
          extensionSlug: "accounting",
          data: { planted: true },
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's mailbox cannot hang off the OTHER tenant's domain", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailboxes).values({
          tenantId: tenantA,
          mailboxDomainId: fx.b.domainId,
          localPart: "smuggled",
          address: `smuggled@b-${STAMP_MAIL}.example`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's connection cannot point at the OTHER tenant's mailbox", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.b.mailboxId,
          clerkUserId: "user-a",
          accessTokenEnc: "x",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's thread index cannot point at the OTHER tenant's connection", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailThreadIndex).values({
          tenantId: tenantA,
          mailAccountId: fx.b.accountId,
          threadId: "smuggled",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's link cannot point at the OTHER tenant's connection", async () => {
    // `mail_links` is MEMBER-writable, which makes this the one composite FK in
    // the module that an ordinary user could try to bend. RLS pins tenant_id, so
    // the smuggled account id is the only field left to aim — and 0046's
    // composite FK is what refuses it. Attempted as a member, not under
    // withSystem, because that is who would actually be doing it.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailLinks).values({
            tenantId: tenantA,
            mailAccountId: fx.b.accountId,
            threadId: "smuggled",
            extensionSlug: "accounting",
            entityType: "invoice",
            entityId: fx.a.mailboxId,
            createdByClerkUserId: "attacker",
          }),
        { role: "owner", userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("disconnecting a mailbox KEEPS its links and nulls only the account id", async () => {
    // The single most important behaviour 0046 buys, and the reason the FK is
    // ON DELETE SET NULL (mail_account_id) rather than CASCADE.
    //
    // Linking copies the message into Documents precisely so the link survives
    // the person who made it — their token expiring, their disconnecting the
    // mailbox, their leaving the business — which is exactly when the
    // correspondence behind an invoice is most wanted. CASCADE would delete it
    // at that moment and quietly undo the whole design.
    //
    // The column list is load-bearing too: a plain SET NULL on a composite FK
    // nulls EVERY key column, including tenant_id, which is NOT NULL — so the
    // disconnect would fail outright. This asserts tenant_id survives.
    const doomed = await withSystem(async (tx) => {
      const [account] = await tx
        .insert(schema.mailAccounts)
        .values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          clerkUserId: "user-a-leaver",
          accessTokenEnc: "ciphertext-token-of-leaver",
        })
        .returning();
      const [link] = await tx
        .insert(schema.mailLinks)
        .values({
          tenantId: tenantA,
          mailAccountId: account.id,
          threadId: "thread-of-the-leaver",
          extensionSlug: "accounting",
          entityType: "invoice",
          entityId: fx.a.mailboxId,
          createdByClerkUserId: "user-a-leaver",
        })
        .returning();
      return { accountId: account.id, linkId: link.id };
    });

    // Deleted the way the app does it: by the person themselves, under the
    // member DELETE policy from 0043.
    const removed = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailAccounts)
          .where(eq(schema.mailAccounts.id, doomed.accountId))
          .returning(),
      { userId: "user-a-leaver" },
    );
    expect(removed).toHaveLength(1);

    const survivors = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.mailLinks)
        .where(eq(schema.mailLinks.id, doomed.linkId)),
    );
    expect(survivors).toHaveLength(1);
    expect(survivors[0].mailAccountId).toBeNull();
    expect(survivors[0].tenantId).toBe(tenantA);
    // The route back to the live thread is what was genuinely lost; the thread
    // id itself is kept, so the row still records which conversation it was.
    expect(survivors[0].threadId).toBe("thread-of-the-leaver");
  });

  it("composite FK: A's directory row cannot point at the OTHER tenant's mailbox", async () => {
    // This one is the authentication boundary: a directory row is what the mail
    // server authenticates against, so a cross-tenant one is a working login
    // for an address that belongs to somebody else.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailDirectoryAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.b.mailboxId,
          login: `smuggled-${STAMP_MAIL}@example.test`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant UPDATE and DELETE affect zero mail rows", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.mailAnnotations)
        .set({ data: { defaced: true } })
        .where(eq(schema.mailAnnotations.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.mailLinks)
        .where(eq(schema.mailLinks.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("default-deny: no context sees no mail rows at all", async () => {
    const results = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_role', '', true)`);
      return Promise.all([
        tx.select().from(schema.mailboxDomains),
        tx.select().from(schema.mailboxes),
        tx.select().from(schema.mailDirectoryAccounts),
        tx.select().from(schema.mailAccounts),
        tx.select().from(schema.mailThreadIndex),
        tx.select().from(schema.mailLinks),
        tx.select().from(schema.mailAnnotations),
        tx.select().from(schema.mailSavedSearches),
      ]);
    });
    for (const rows of results) expect(rows).toHaveLength(0);
  });
});
