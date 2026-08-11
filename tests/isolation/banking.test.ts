import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * Banking tables: RLS isolation plus the composite-tenant-FK guarantees.
 *
 * These five tables had NO isolation file of their own until bank rules were
 * built — `bank_accounts` and `bank_transactions` were certified only
 * incidentally by documents.test.ts, and `reconciliations`,
 * `reconciliation_lines` and `plaid_items` were not certified at all. That last
 * one stores the AES-256-GCM encrypted Plaid access token, which makes it the
 * row in this module you would least like to leak across a tenant boundary.
 */
const STAMP_BANK = `iso-bank-${process.pid}`;

interface BankFixture {
  cashAccountId: string;
  expenseAccountId: string;
  bankAccountId: string;
  txnId: string;
  ruleId: string;
  vendorId: string;
  reconciliationId: string;
  reconciliationLineId: string;
  plaidItemId: string;
}

d("banking isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, BankFixture> = {};

  async function seedBanking(tenantId: string, tag: string): Promise<BankFixture> {
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
          code: "6100",
          name: `Insurance ${tag}`,
          accountType: "expense",
          subtype: "operating_expense",
        })
        .returning();
      const [bank] = await tx
        .insert(schema.bankAccounts)
        .values({
          tenantId,
          accountId: cash.id,
          name: `Register ${tag}`,
          kind: "checking",
          institution: `Bank of ${tag}`,
          last4: "4321",
        })
        .returning();
      const [txn] = await tx
        .insert(schema.bankTransactions)
        .values({
          tenantId,
          bankAccountId: bank.id,
          txnDate: "2026-07-06",
          description: `SECRET PAYEE OF ${tag}`,
          amountCents: -64067,
          externalHash: `${STAMP_BANK}-${tag}-1`,
        })
        .returning();
      const [party] = await tx
        .insert(schema.parties)
        .values({ tenantId, kind: "organization", displayName: `Payee ${tag}` })
        .returning();
      const [vendor] = await tx
        .insert(schema.vendors)
        .values({ tenantId, partyId: party.id, name: `Payee ${tag}` })
        .returning();
      const [rule] = await tx
        .insert(schema.bankRules)
        .values({
          tenantId,
          name: `Secret rule of ${tag}`,
          bankAccountId: bank.id,
          setAccountId: expense.id,
          conditions: [
            { field: "description", op: "contains", value: `payee of ${tag}` },
          ],
        })
        .returning();

      // A posted entry, so there is a real journal line to clear.
      const [entry] = await tx
        .insert(schema.journalEntries)
        .values({
          tenantId,
          entryDate: "2026-07-06",
          memo: `bank entry of ${tag}`,
          status: "posted",
          postedAt: new Date(),
          createdByClerkUserId: `user-${tag}`,
        })
        .returning();
      const lines = await tx
        .insert(schema.journalLines)
        .values([
          { tenantId, entryId: entry.id, accountId: expense.id, amountCents: 64067, lineNo: 1 },
          { tenantId, entryId: entry.id, accountId: cash.id, amountCents: -64067, lineNo: 2 },
        ])
        .returning();
      const [recon] = await tx
        .insert(schema.reconciliations)
        .values({
          tenantId,
          bankAccountId: bank.id,
          statementEndDate: "2026-07-31",
          statementEndBalanceCents: -64067,
          createdByClerkUserId: `user-${tag}`,
        })
        .returning();
      const [reconLine] = await tx
        .insert(schema.reconciliationLines)
        .values({
          tenantId,
          reconciliationId: recon.id,
          journalLineId: lines[1].id,
        })
        .returning();
      const [item] = await tx
        .insert(schema.plaidItems)
        .values({
          tenantId,
          plaidItemId: `${STAMP_BANK}-${tag}-item`,
          accessTokenEnc: `encrypted-secret-of-${tag}`,
          institutionName: `Bank of ${tag}`,
        })
        .returning();

      return {
        cashAccountId: cash.id,
        expenseAccountId: expense.id,
        bankAccountId: bank.id,
        txnId: txn.id,
        ruleId: rule.id,
        vendorId: vendor.id,
        reconciliationId: recon.id,
        reconciliationLineId: reconLine.id,
        plaidItemId: item.id,
      };
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_BANK}-a`, name: "Bank Iso A", slug: `${STAMP_BANK}-a` },
          { clerkOrgId: `${STAMP_BANK}-b`, name: "Bank Iso B", slug: `${STAMP_BANK}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedBanking(tenantA, "A");
    fx.b = await seedBanking(tenantB, "B");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on every banking table return only the tenant's rows", async () => {
    await withTenant(tenantA, async (tx) => {
      const accounts = await tx.select().from(schema.bankAccounts);
      expect(accounts.length).toBeGreaterThan(0);
      expect(accounts.every((r) => r.tenantId === tenantA)).toBe(true);

      const txns = await tx.select().from(schema.bankTransactions);
      expect(txns.length).toBeGreaterThan(0);
      expect(txns.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(txns.some((r) => r.description.includes("OF B"))).toBe(false);

      const rules = await tx.select().from(schema.bankRules);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(rules.some((r) => r.name.includes("of B"))).toBe(false);

      const recons = await tx.select().from(schema.reconciliations);
      expect(recons.length).toBeGreaterThan(0);
      expect(recons.every((r) => r.tenantId === tenantA)).toBe(true);

      const reconLines = await tx.select().from(schema.reconciliationLines);
      expect(reconLines.length).toBeGreaterThan(0);
      expect(reconLines.every((r) => r.tenantId === tenantA)).toBe(true);

      const items = await tx.select().from(schema.plaidItems);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((r) => r.tenantId === tenantA)).toBe(true);
      // The whole point of encrypting it is undone if the row is readable.
      expect(items.some((r) => r.accessTokenEnc.includes("of-B"))).toBe(false);
    });
  });

  it("cross-tenant filters read zero rows", async () => {
    const rules = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.bankRules).where(eq(schema.bankRules.tenantId, tenantB)),
    );
    expect(rules).toHaveLength(0);
    const items = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.plaidItems).where(eq(schema.plaidItems.tenantId, tenantB)),
    );
    expect(items).toHaveLength(0);
  });

  it("no context → default deny on all banking tables", async () => {
    const counts = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return Promise.all([
        tx.select().from(schema.bankAccounts),
        tx.select().from(schema.bankTransactions),
        tx.select().from(schema.bankRules),
        tx.select().from(schema.reconciliations),
        tx.select().from(schema.reconciliationLines),
        tx.select().from(schema.plaidItems),
      ]);
    });
    for (const rows of counts) expect(rows).toHaveLength(0);
  });

  it("cannot INSERT banking rows attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bankRules).values({
          tenantId: tenantB,
          name: "smuggled rule",
          bankAccountId: fx.b.bankAccountId,
          setAccountId: fx.b.expenseAccountId,
          conditions: [{ field: "description", op: "contains", value: "x" }],
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.plaidItems).values({
          tenantId: tenantB,
          plaidItemId: `${STAMP_BANK}-smuggled`,
          accessTokenEnc: "smuggled",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a rule cannot point at the OTHER tenant's register or category", async () => {
    // Tenant A's own tenant_id passes RLS; the composite FK is what refuses the
    // cross-tenant reference. This is the guarantee app code is not trusted for.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bankRules).values({
          tenantId: tenantA,
          name: "rule onto B's register",
          bankAccountId: fx.b.bankAccountId,
          setAccountId: fx.a.expenseAccountId,
          conditions: [{ field: "description", op: "contains", value: "x" }],
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bankRules).values({
          tenantId: tenantA,
          name: "rule onto B's category",
          bankAccountId: fx.a.bankAccountId,
          setAccountId: fx.b.expenseAccountId,
          conditions: [{ field: "description", op: "contains", value: "x" }],
        }),
      ),
    ).rejects.toThrow();
  });

  it("a rule and a feed row cannot name the OTHER tenant's payee", async () => {
    // Own tenant_id, so RLS passes; the composite FK is what refuses it. Added
    // when rules learned to set a payee — a new cross-tenant reference is a new
    // thing for the database to be asked to enforce.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.bankRules).values({
          tenantId: tenantA,
          name: "rule onto B's payee",
          bankAccountId: fx.a.bankAccountId,
          setAccountId: fx.a.expenseAccountId,
          setVendorId: fx.b.vendorId,
          conditions: [{ field: "description", op: "contains", value: "x" }],
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx
          .update(schema.bankTransactions)
          .set({ vendorId: fx.b.vendorId })
          .where(eq(schema.bankTransactions.id, fx.a.txnId)),
      ),
    ).rejects.toThrow();
  });

  it("cannot UPDATE or DELETE the other tenant's rules and feeds", async () => {
    await withTenant(tenantA, async (tx) => {
      const updated = await tx
        .update(schema.bankRules)
        .set({ name: "hijacked" })
        .where(eq(schema.bankRules.id, fx.b.ruleId))
        .returning({ id: schema.bankRules.id });
      expect(updated).toHaveLength(0);

      const deleted = await tx
        .delete(schema.bankTransactions)
        .where(eq(schema.bankTransactions.id, fx.b.txnId))
        .returning({ id: schema.bankTransactions.id });
      expect(deleted).toHaveLength(0);
    });

    // B's rows are untouched.
    await withTenant(tenantB, async (tx) => {
      const rule = await tx.query.bankRules.findFirst({
        where: eq(schema.bankRules.id, fx.b.ruleId),
      });
      expect(rule?.name).toBe("Secret rule of B");
    });
  });
});
