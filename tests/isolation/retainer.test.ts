import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

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
