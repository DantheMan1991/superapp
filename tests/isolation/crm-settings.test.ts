import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

d("crm settings (RLS)", () => {
  const STAMP5 = `iso-crmset-${process.pid}`;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP5}-a`, name: "CS A", slug: `${STAMP5}-a` },
          { clerkOrgId: `${STAMP5}-b`, name: "CS B", slug: `${STAMP5}-b` },
        ])
        .returning();
      tenantA = rows[0].id;
      tenantB = rows[1].id;
      await tx.insert(schema.crmSettings).values([
        { tenantId: tenantA, aiLastExtractedAt: new Date("2026-08-07T10:00:00Z") },
        { tenantId: tenantB, aiLastExtractedAt: new Date("2026-08-07T10:00:00Z") },
      ]);
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("a member can claim their OWN tenant's cooldown", async () => {
    // The grant exists for exactly this write. If it failed, two people pasting
    // notes at once would each spend a model call.
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.crmSettings)
          .set({ aiLastExtractedAt: new Date() })
          .where(eq(schema.crmSettings.tenantId, tenantA))
          .returning(),
      { role: "staff", userId: `${STAMP5}-u` },
    );
    expect(updated).toHaveLength(1);
  });

  it("sees only its own row on an unscoped select", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmSettings),
      { role: "staff", userId: `${STAMP5}-u` },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(tenantA);
  });

  it("cannot touch the other tenant's cooldown", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.crmSettings)
          .set({ aiLastExtractedAt: new Date("2000-01-01T00:00:00Z") })
          .where(eq(schema.crmSettings.tenantId, tenantB))
          .returning(),
      { role: "owner", userId: `${STAMP5}-u` },
    );
    expect(updated).toHaveLength(0);

    const after = await withSystem((tx) =>
      tx
        .select({ at: schema.crmSettings.aiLastExtractedAt })
        .from(schema.crmSettings)
        .where(eq(schema.crmSettings.tenantId, tenantB)),
    );
    expect(after[0].at?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
  });

  it("cannot INSERT a row attributed to the other tenant", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx
            .insert(schema.crmSettings)
            .values({ tenantId: tenantB })
            .returning(),
        { role: "owner", userId: `${STAMP5}-u` },
      ),
    ).rejects.toThrow();
  });
});
