import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d, seedEntity, seedParty } from "./_shared";

/**
 * Documents (session 5): RLS isolation for documents/document_links plus
 * the composite-FK smuggle matrix — a link row whose own tenant_id passes
 * RLS must still be rejected when it points at ANY other-tenant target.
 */
const STAMP_DOC = `iso-doc-${process.pid}`;

/**
 * THE PARTY SPINE (CRM slice 0).
 *
 * `parties` is the first table in this schema written by TWO modules —
 * Accounting today, CRM next — which makes it worth more than the standard
 * two-tenant pass. The specific risk a shared identity table introduces is a
 * role row in one tenant pointing at an identity in another, so the composite
 * FK gets its own case here rather than being assumed from the column list.
 */

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
      const entityId = await seedEntity(tx, tenantId, tag);
      const [entry] = await tx
        .insert(schema.journalEntries)
        .values({ tenantId, entityId, entryDate: "2026-07-01", memo: `entry ${tag}`, createdByClerkUserId: `user-${tag}` })
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
        .values({
          tenantId,
          partyId: await seedParty(tx, tenantId, `Customer ${tag}`),
          name: `Customer ${tag}`,
        })
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
