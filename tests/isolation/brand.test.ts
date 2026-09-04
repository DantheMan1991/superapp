import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `brand_kits` RLS — the business's look, per company.
 *
 * Members read; owners write; nobody sees another tenant's kit. The role
 * split is enforced by the POLICY (`app_current_tenant_role() = 'owner'`),
 * not only by the action layer, so this file exercises it with a staff and an
 * owner transaction on the same tenant.
 *
 * **TENANT A DELIBERATELY HOLDS TWO COMPANIES**, for the reason ADR 0015
 * recorded and `payments.test.ts` repeats: a one-company fixture cannot tell
 * a row hung off the tenant from one hung off the company, which is precisely
 * the blind spot the per-company kit exists in. The composite FK is the other
 * half — a kit naming another tenant's company must be unrepresentable even
 * under `withSystem`, where RLS is not watching.
 */
d("brand_kits (RLS)", () => {
  const STAMP = `iso-brand-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let entityA1: string;
  let entityA2: string;
  let entityB: string;
  let businessKitA: string;
  let companyKitA2: string;
  let kitB: string;

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Brand A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Brand B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;
      const entities = await tx
        .insert(schema.entities)
        .values([
          { tenantId: tenantA, name: "Oak Row LLC", isDefault: true },
          { tenantId: tenantA, name: "Maple Street LLC" },
          { tenantId: tenantB, name: "B Farm LLC", isDefault: true },
        ])
        .returning();
      entityA1 = entities[0].id;
      entityA2 = entities[1].id;
      entityB = entities[2].id;
      const kits = await tx
        .insert(schema.brandKits)
        .values([
          {
            tenantId: tenantA,
            entityId: null,
            displayName: "Hilltop Farm",
            primaryColor: "#1f6f5f",
            logoPathname: `brand/${tenantA}/logos/hilltop.png`,
            logoMimeType: "image/png",
            logoWidth: 400,
            logoHeight: 120,
            logoBytes: 12_345,
          },
          { tenantId: tenantA, entityId: entityA2, displayName: "Maple Meats" },
          { tenantId: tenantB, entityId: null, displayName: "B Farm" },
        ])
        .returning();
      businessKitA = kits[0].id;
      companyKitA2 = kits[1].id;
      kitB = kits[2].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // Kits and entities cascade from the tenant.
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("staff read their own tenant's kits and nothing of the other's", async () => {
    const seen = await asStaff((tx) => tx.select().from(schema.brandKits));
    expect(seen.map((k) => k.id).sort()).toEqual([businessKitA, companyKitA2].sort());
    expect(seen.some((k) => k.id === kitB)).toBe(false);
    expect(seen.some((k) => k.tenantId !== tenantA)).toBe(false);
  });

  it("staff cannot insert, update or delete a kit — the policy is owner-only", async () => {
    await expect(
      asStaff((tx) =>
        tx.insert(schema.brandKits).values({ tenantId: tenantA, entityId: entityA1 }),
      ),
    ).rejects.toThrow();
    const updated = await asStaff((tx) =>
      tx
        .update(schema.brandKits)
        .set({ displayName: "Forged" })
        .where(eq(schema.brandKits.id, businessKitA))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asStaff((tx) =>
      tx.delete(schema.brandKits).where(eq(schema.brandKits.id, companyKitA2)).returning(),
    );
    expect(deleted).toHaveLength(0);
    const still = await withSystem((tx) =>
      tx.query.brandKits.findFirst({ where: eq(schema.brandKits.id, businessKitA) }),
    );
    expect(still?.displayName).toBe("Hilltop Farm");
  });

  it("an owner writes their own tenant's kits, including a new company's", async () => {
    const updated = await asOwner((tx) =>
      tx
        .update(schema.brandKits)
        .set({ tagline: "Grass-fed since 1998" })
        .where(eq(schema.brandKits.id, businessKitA))
        .returning(),
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].tagline).toBe("Grass-fed since 1998");
    const [created] = await asOwner((tx) =>
      tx
        .insert(schema.brandKits)
        .values({ tenantId: tenantA, entityId: entityA1, displayName: "Oak Row" })
        .returning(),
    );
    expect(created.entityId).toBe(entityA1);
    await asOwner((tx) =>
      tx.delete(schema.brandKits).where(eq(schema.brandKits.id, created.id)),
    );
  });

  it("another tenant's owner cannot read, update or delete tenant A's kits", async () => {
    const seen = await asOtherTenant((tx) => tx.select().from(schema.brandKits));
    expect(seen.map((k) => k.id)).toEqual([kitB]);
    const updated = await asOtherTenant((tx) =>
      tx
        .update(schema.brandKits)
        .set({ displayName: "Taken over" })
        .where(eq(schema.brandKits.id, businessKitA))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asOtherTenant((tx) =>
      tx.delete(schema.brandKits).where(eq(schema.brandKits.id, businessKitA)).returning(),
    );
    expect(deleted).toHaveLength(0);
    // And cannot insert into A's namespace under their own context either.
    await expect(
      asOtherTenant((tx) =>
        tx.insert(schema.brandKits).values({ tenantId: tenantA, entityId: null }),
      ),
    ).rejects.toThrow();
  });

  it("one business-wide kit and one per company: the partial uniques hold", async () => {
    await expect(
      asOwner((tx) =>
        tx.insert(schema.brandKits).values({ tenantId: tenantA, entityId: null }),
      ),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) =>
        tx.insert(schema.brandKits).values({ tenantId: tenantA, entityId: entityA2 }),
      ),
    ).rejects.toThrow();
  });

  it("a kit naming another tenant's company is unrepresentable, even under withSystem", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.brandKits).values({ tenantId: tenantB, entityId: entityA2 }),
      ),
    ).rejects.toThrow();
    // And in the other direction: tenant A cannot dress up B's company either.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.brandKits).values({ tenantId: tenantA, entityId: entityB }),
      ),
    ).rejects.toThrow();
  });

  it("the CHECKs refuse a malformed colour and a half-described logo", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.brandKits)
          .set({ primaryColor: "red" })
          .where(eq(schema.brandKits.id, businessKitA)),
      ),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.brandKits)
          .set({ logoPathname: `brand/${tenantA}/logos/x.png`, logoWidth: 0 })
          .where(eq(schema.brandKits.id, companyKitA2)),
      ),
    ).rejects.toThrow();
  });

  it("a company's own kit goes with the company; the business kit stays", async () => {
    const [extra] = await withSystem((tx) =>
      tx
        .insert(schema.entities)
        .values({ tenantId: tenantA, name: "Short-lived LLC" })
        .returning(),
    );
    const [kit] = await asOwner((tx) =>
      tx
        .insert(schema.brandKits)
        .values({ tenantId: tenantA, entityId: extra.id })
        .returning(),
    );
    await withSystem((tx) =>
      tx.delete(schema.entities).where(eq(schema.entities.id, extra.id)),
    );
    const gone = await withSystem((tx) =>
      tx.query.brandKits.findFirst({ where: eq(schema.brandKits.id, kit.id) }),
    );
    expect(gone).toBeUndefined();
    const business = await withSystem((tx) =>
      tx.query.brandKits.findFirst({
        where: and(eq(schema.brandKits.tenantId, tenantA), isNull(schema.brandKits.entityId)),
      }),
    );
    expect(business?.id).toBe(businessKitA);
  });

  it("default-deny: no context sees no kits", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.brandKits);
    });
    expect(rows).toHaveLength(0);
  });
});
