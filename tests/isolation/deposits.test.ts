import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d, seedEntity } from "./_shared";

/**
 * `deposits` (0265/0266): RLS isolation, the owner-only write posture, and
 * the composite tenant FKs to the register and the entry.
 *
 * The table is the first banking table whose writes are owner-only AT THE
 * DATABASE (the 0010 tables let any member write). That is what the
 * staff-cannot-insert and staff-cannot-update cases certify; the deposit
 * actions pass `{ role }` to `withTenant` so an owner's write is seen as one.
 */
const STAMP = `iso-deposits-${process.pid}`;

interface Fixture {
  entityId: string;
  cashAccountId: string;
  bankAccountId: string;
  entryId: string;
  depositId: string;
}

d("deposits isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, Fixture> = {};

  async function seed(tenantId: string, tag: string): Promise<Fixture> {
    return withTenant(
      tenantId,
      async (tx) => {
        await tx.insert(schema.accountingSettings).values({ tenantId });
        const entityId = await seedEntity(tx, tenantId, tag);
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
        const [uf] = await tx
          .insert(schema.accounts)
          .values({
            tenantId,
            code: "1250",
            name: `Undeposited ${tag}`,
            accountType: "asset",
            subtype: "undeposited_funds",
          })
          .returning();
        const [bank] = await tx
          .insert(schema.bankAccounts)
          .values({
            tenantId,
            entityId,
            accountId: cash.id,
            name: `Register ${tag}`,
            kind: "checking",
          })
          .returning();
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({
            tenantId,
            entityId,
            entryDate: "2026-09-07",
            memo: `deposit entry of ${tag}`,
            status: "posted",
            source: "deposit",
            postedAt: new Date(),
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();
        await tx.insert(schema.journalLines).values([
          { tenantId, entryId: entry.id, accountId: cash.id, amountCents: 12345, lineNo: 1 },
          { tenantId, entryId: entry.id, accountId: uf.id, amountCents: -12345, lineNo: 2 },
        ]);
        const [deposit] = await tx
          .insert(schema.deposits)
          .values({
            tenantId,
            entityId,
            bankAccountId: bank.id,
            depositDate: "2026-09-07",
            memo: `SECRET DEPOSIT OF ${tag}`,
            totalCents: 12345,
            journalEntryId: entry.id,
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();
        return {
          entityId,
          cashAccountId: cash.id,
          bankAccountId: bank.id,
          entryId: entry.id,
          depositId: deposit.id,
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
          { clerkOrgId: `${STAMP}-a`, name: "Deposit Iso A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Deposit Iso B", slug: `${STAMP}-b` },
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

  it("unscoped selects return only the tenant's deposits, for staff as for owners", async () => {
    for (const role of ["staff", "owner"] as const) {
      const rows = await withTenant(tenantA, (tx) => tx.select().from(schema.deposits), { role });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(rows.some((r) => r.memo.includes("OF B"))).toBe(false);
    }
  });

  it("cross-tenant filters read zero rows", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.deposits).where(eq(schema.deposits.tenantId, tenantB)),
    );
    expect(rows).toHaveLength(0);
  });

  it("no context → default deny", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.deposits);
    });
    expect(rows).toHaveLength(0);
  });

  it("staff can read but neither insert nor update a deposit", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.deposits).values({
            tenantId: tenantA,
            entityId: fx.a.entityId,
            bankAccountId: fx.a.bankAccountId,
            depositDate: "2026-09-08",
            totalCents: 100,
            // A fresh entry would be needed for a real row; the policy refuses
            // before any FK is consulted.
            journalEntryId: fx.a.entryId,
            createdByClerkUserId: "user-staff",
          }),
        { role: "staff" },
      ),
    ).rejects.toThrow();

    // UPDATE under a USING clause that excludes the row is a silent no-op,
    // which is why the assertion is on the row count rather than an error.
    const touched = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.deposits)
          .set({ memo: "staff was here" })
          .where(eq(schema.deposits.id, fx.a.depositId))
          .returning({ id: schema.deposits.id }),
      { role: "staff" },
    );
    expect(touched).toHaveLength(0);

    const owner = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.deposits)
          .set({ memo: `SECRET DEPOSIT OF A` })
          .where(eq(schema.deposits.id, fx.a.depositId))
          .returning({ id: schema.deposits.id }),
      { role: "owner" },
    );
    expect(owner).toHaveLength(1);
  });

  it("nobody deletes a deposit — it is voided instead", async () => {
    const gone = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.deposits)
          .where(eq(schema.deposits.id, fx.a.depositId))
          .returning({ id: schema.deposits.id }),
      { role: "owner" },
    );
    expect(gone).toHaveLength(0);
  });

  it("cannot INSERT a deposit attributed to the other tenant", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.deposits).values({
            tenantId: tenantB,
            entityId: fx.b.entityId,
            bankAccountId: fx.b.bankAccountId,
            depositDate: "2026-09-08",
            totalCents: 100,
            journalEntryId: fx.b.entryId,
            createdByClerkUserId: "user-smuggler",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  it("composite FKs: a deposit cannot name the OTHER tenant's register, company or entry", async () => {
    // Tenant A's own tenant_id passes RLS; the composite FK is what refuses
    // the cross-tenant reference — the guarantee app code is not trusted for.
    const smuggle = (patch: Partial<typeof schema.deposits.$inferInsert>) =>
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.deposits).values({
            tenantId: tenantA,
            entityId: fx.a.entityId,
            bankAccountId: fx.a.bankAccountId,
            depositDate: "2026-09-08",
            totalCents: 100,
            journalEntryId: fx.a.entryId,
            createdByClerkUserId: "user-a",
            ...patch,
          }),
        { role: "owner" },
      );
    await expect(smuggle({ bankAccountId: fx.b.bankAccountId })).rejects.toThrow();
    await expect(smuggle({ entityId: fx.b.entityId })).rejects.toThrow();
    await expect(smuggle({ journalEntryId: fx.b.entryId })).rejects.toThrow();
  });
});
