import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

d("crm rule health (RLS)", () => {
  const STAMP4 = `iso-rh-${process.pid}`;
  let tenantA: string;
  let tenantB: string;
  let ruleA: string;
  let ruleB: string;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP4}-a`, name: "RH A", slug: `${STAMP4}-a` },
          { clerkOrgId: `${STAMP4}-b`, name: "RH B", slug: `${STAMP4}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const rules = await tx
        .insert(schema.crmAutomationRules)
        .values([
          {
            tenantId: tenantA,
            name: "A rule",
            trigger: "record_created",
            definition: {},
            createdByClerkUserId: `${STAMP4}-u`,
          },
          {
            tenantId: tenantB,
            name: "B rule",
            trigger: "record_created",
            definition: {},
            createdByClerkUserId: `${STAMP4}-u`,
          },
        ])
        .returning();
      ruleA = rules[0].id;
      ruleB = rules[1].id;

      await tx.insert(schema.crmAutomationRuleHealth).values([
        {
          tenantId: tenantA,
          ruleId: ruleA,
          consecutiveFailures: 3,
          lastError: "boom",
        },
        {
          tenantId: tenantB,
          ruleId: ruleB,
          consecutiveFailures: 1,
          lastError: "other tenant",
        },
      ]);
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("every member can READ their tenant's rule health, staff included", async () => {
    // Transparency is the point: staff are the people most likely to notice a
    // rule misbehaving and least likely to be able to ask an owner.
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmAutomationRuleHealth),
      { role: "staff", userId: `${STAMP4}-u` },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ruleId).toBe(ruleA);
    expect(rows[0].consecutiveFailures).toBe(3);
  });

  it("cannot see the other tenant's rule health", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.crmAutomationRuleHealth)
          .where(eq(schema.crmAutomationRuleHealth.tenantId, tenantB)),
      { role: "owner", userId: `${STAMP4}-u` },
    );
    expect(rows).toHaveLength(0);
  });

  it("NOBODY writes it from tenant context — not even an owner", async () => {
    // A member forging a failure would be able to discredit a rule they did not
    // like. An owner cannot either, because there is no legitimate caller: the
    // engine writes this under withSystem.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx
            .insert(schema.crmAutomationRuleHealth)
            .values({
              tenantId: tenantA,
              ruleId: ruleA,
              consecutiveFailures: 99,
              lastError: "forged",
            })
            .returning(),
        { role: "owner", userId: `${STAMP4}-u` },
      ),
    ).rejects.toThrow();

    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.crmAutomationRuleHealth)
          .set({ lastError: "tampered" })
          .where(eq(schema.crmAutomationRuleHealth.ruleId, ruleA))
          .returning(),
      { role: "owner", userId: `${STAMP4}-u` },
    );
    expect(updated).toHaveLength(0);

    // And a member cannot clear an inconvenient failure by deleting the row.
    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.crmAutomationRuleHealth)
          .where(eq(schema.crmAutomationRuleHealth.ruleId, ruleA))
          .returning(),
      { role: "owner", userId: `${STAMP4}-u` },
    );
    expect(deleted).toHaveLength(0);

    const after = await withSystem((tx) =>
      tx
        .select({ err: schema.crmAutomationRuleHealth.lastError })
        .from(schema.crmAutomationRuleHealth)
        .where(eq(schema.crmAutomationRuleHealth.ruleId, ruleA)),
    );
    expect(after[0].err).toBe("boom");
  });

  it("deleting the rule takes its health with it", async () => {
    // ON DELETE CASCADE — a health row for a rule that no longer exists would
    // render as a failing badge on nothing.
    await withSystem((tx) =>
      tx
        .delete(schema.crmAutomationRules)
        .where(eq(schema.crmAutomationRules.id, ruleB)),
    );
    const rows = await withSystem((tx) =>
      tx
        .select()
        .from(schema.crmAutomationRuleHealth)
        .where(eq(schema.crmAutomationRuleHealth.ruleId, ruleB)),
    );
    expect(rows).toHaveLength(0);
  });
});
