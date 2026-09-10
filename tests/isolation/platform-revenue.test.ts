import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * `operator_postings` (back-office slice 5) is platform-level and
 * superadmin-only: what a client paid the platform is the platform's record,
 * not a row the client's members can read or forge.
 */
const STAMP = `iso-postings-${process.pid}`;

d("operator-postings isolation (RLS, superadmin only)", () => {
  let tenantId: string;
  let postingId: string;

  beforeAll(async () => {
    [tenantId, postingId] = await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Postings Iso", slug: STAMP })
        .returning();
      const [p] = await tx
        .insert(schema.operatorPostings)
        .values({
          kind: "subscription_invoice",
          stripeObjectId: `in_${STAMP}`,
          clientTenantId: t.id,
          amountCents: 100000,
          currency: "usd",
          paidAt: new Date(),
          description: "isolation",
          status: "skipped",
          reason: "pending",
        })
        .returning();
      return [t.id, p.id];
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.operatorPostings).where(eq(schema.operatorPostings.id, postingId));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("the client's own members see no posting about them", async () => {
    const rows = await withTenant(
      tenantId,
      (tx) => tx.select().from(schema.operatorPostings),
      { role: "owner" },
    );
    expect(rows).toHaveLength(0);
  });

  it("members cannot write or change one", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.operatorPostings).values({
          kind: "hour_block",
          stripeObjectId: `cs_${STAMP}`,
          clientTenantId: tenantId,
          amountCents: 1,
          currency: "usd",
          paidAt: new Date(),
          description: "forged",
          status: "posted",
        }),
      ),
    ).rejects.toThrow();
    const changed = await withTenant(tenantId, (tx) =>
      tx
        .update(schema.operatorPostings)
        .set({ status: "posted" })
        .where(eq(schema.operatorPostings.id, postingId))
        .returning(),
    );
    expect(changed).toHaveLength(0);
  });

  it("no context at all sees nothing; the superadmin sees it", async () => {
    const none = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.operatorPostings).where(eq(schema.operatorPostings.id, postingId));
    });
    expect(none).toHaveLength(0);
    const mine = await withSystem((tx) =>
      tx.select().from(schema.operatorPostings).where(eq(schema.operatorPostings.id, postingId)),
    );
    expect(mine).toHaveLength(1);
  });
});
