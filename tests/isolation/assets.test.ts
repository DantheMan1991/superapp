import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `assets` RLS — THE FIRST PACK-OWNED TABLE TO BE CERTIFIED.
 *
 * The point of this file is that there is nothing special in it. A capability
 * pack's table gets exactly the treatment a core module's does: tenant_id,
 * FORCE RLS, default-deny with no context, and no cross-tenant read, write or
 * enumeration. If a pack ever needed a weaker shape than this, the boundary was
 * drawn wrong.
 *
 * It also certifies the containment FK, which is the one thing this table has
 * that a flat reference list does not: `assets_parent_fk` is COMPOSITE, so a
 * parent is always a same-tenant row and no cross-tenant nesting is
 * representable even under `withSystem`.
 *
 * Fixtures are built under `withSystem` on purpose: this suite certifies what
 * the DATABASE enforces, and routing setup through `src/packs/assets/ops.ts`
 * would let a bug in that file make these tests agree with it.
 */
d("assets table (RLS)", () => {
  const STAMP = `iso-assets-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`; // staff in tenant A
  const OTHER = `${STAMP}-other`; // owner of tenant B

  let tenantA: string;
  let tenantB: string;
  let barnA: string; // container in tenant A
  let freezerA: string; // inside barnA
  let tractorB: string; // tenant B

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
          { clerkOrgId: `${STAMP}-a`, name: "Assets A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Assets B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const barn = await tx
        .insert(schema.assets)
        .values({
          tenantId: tenantA,
          kind: "building",
          name: "Barn",
          acquisitionCostCents: 4_500_000,
        })
        .returning();
      barnA = barn[0].id;

      const freezer = await tx
        .insert(schema.assets)
        .values({
          tenantId: tenantA,
          kind: "equipment",
          name: "Chest freezer",
          parentId: barnA,
        })
        .returning();
      freezerA = freezer[0].id;

      const tractor = await tx
        .insert(schema.assets)
        .values({ tenantId: tenantB, kind: "equipment", name: "Tractor" })
        .returning();
      tractorB = tractor[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.profiles)
        .where(inArray(schema.profiles.clerkUserId, [OWNER, MATE, OTHER]));
    });
  });

  it("a tenant sees only its own assets", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.assets));
    expect(mine.map((a) => a.name).sort()).toEqual(["Barn", "Chest freezer"]);
    expect(mine.map((a) => a.id)).not.toContain(tractorB);

    const theirs = await asOtherTenant((tx) => tx.select().from(schema.assets));
    expect(theirs.map((a) => a.name)).toEqual(["Tractor"]);
  });

  it("cannot read another tenant's asset even by id", async () => {
    const found = await asOwner((tx) =>
      tx.select().from(schema.assets).where(eq(schema.assets.id, tractorB)),
    );
    expect(found).toHaveLength(0);
  });

  it("cannot update another tenant's asset", async () => {
    const updated = await asOwner((tx) =>
      tx
        .update(schema.assets)
        .set({ name: "Stolen" })
        .where(eq(schema.assets.id, tractorB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    // And it really is untouched, checked from the god view rather than from
    // the tenant that just failed to see it.
    const actual = await withSystem((tx) =>
      tx.select().from(schema.assets).where(eq(schema.assets.id, tractorB)),
    );
    expect(actual[0].name).toBe("Tractor");
  });

  it("cannot delete another tenant's asset", async () => {
    const deleted = await asOwner((tx) =>
      tx.delete(schema.assets).where(eq(schema.assets.id, tractorB)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("cannot insert a row stamped with another tenant", async () => {
    // WITH CHECK, not USING: the row would be invisible afterwards, but the
    // policy has to refuse it outright or a tenant could write into another's
    // data and simply not be able to read it back.
    await expect(
      asOwner((tx) =>
        tx
          .insert(schema.assets)
          .values({ tenantId: tenantB, kind: "vehicle", name: "Smuggled" }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a row into another tenant", async () => {
    // THROWS rather than returning zero rows, and the difference is the policy
    // being stricter than a filter. Two update shapes, two outcomes:
    //
    //   - can't SEE the row (another tenant's) → USING excludes it, 0 rows, no error
    //   - CAN see it but the new values leave the tenant → WITH CHECK refuses, 42501
    //
    // The second is the one that matters: a silent no-op would let a caller
    // believe an escape had merely failed, when what actually happened is that
    // the database refused to let the row leave at all.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.assets)
          .set({ tenantId: tenantB })
          .where(eq(schema.assets.id, barnA)),
      ),
    ).rejects.toThrow();

    const stillMine = await withSystem((tx) =>
      tx.select().from(schema.assets).where(eq(schema.assets.id, barnA)),
    );
    expect(stillMine[0].tenantId).toBe(tenantA);
  });

  it("staff see the same assets as an owner — RLS is tenancy, not role", async () => {
    // Who may WRITE is gated in the pack's action layer (owner-only). RLS
    // answers only whose rows these are, so a staff member sent to service the
    // tractor can still find it. See drizzle/0126_assets_rls.sql.
    const staffView = await asStaff((tx) => tx.select().from(schema.assets));
    expect(staffView.map((a) => a.name).sort()).toEqual([
      "Barn",
      "Chest freezer",
    ]);
  });

  it("is default-deny with no tenant context at all", async () => {
    // FORCE ROW LEVEL SECURITY: not even the connection's own role escapes.
    const rows = await withTenant(
      "00000000-0000-0000-0000-000000000000",
      (tx) => tx.select().from(schema.assets),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot nest an asset inside another tenant's asset", async () => {
    // The composite FK (tenant_id, parent_id) → (tenant_id, id) makes this
    // unrepresentable rather than merely forbidden — so it fails even here,
    // under withSystem, where RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.assets)
          .set({ parentId: tractorB })
          .where(eq(schema.assets.id, freezerA)),
      ),
    ).rejects.toThrow();
  });

  it("keeps a disposed asset's row and cost", async () => {
    // Disposal is a status, never a delete: an asset that cost money for six
    // years does not stop having done so when it is sold.
    await asOwner((tx) =>
      tx
        .update(schema.assets)
        .set({ status: "disposed", disposedOn: "2026-08-14" })
        .where(eq(schema.assets.id, freezerA)),
    );
    const row = await asOwner((tx) =>
      tx.select().from(schema.assets).where(eq(schema.assets.id, freezerA)),
    );
    expect(row).toHaveLength(1);
    expect(row[0].status).toBe("disposed");
    expect(row[0].parentId).toBe(barnA);

    await asOwner((tx) =>
      tx
        .update(schema.assets)
        .set({ status: "active", disposedOn: null })
        .where(eq(schema.assets.id, freezerA)),
    );
  });

  it("refuses a status the app does not believe in", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.assets)
          .set({ status: "sold" })
          .where(eq(schema.assets.id, barnA)),
      ),
    ).rejects.toThrow();
  });

  it("constrains the FORMAT of kind but never its values", async () => {
    // `kind` is an open taxonomy (P1). A kind nobody anticipated must work
    // without a migration; a kind that would break querying must not.
    const invented = await asOwner((tx) =>
      tx
        .insert(schema.assets)
        .values({ tenantId: tenantA, kind: "chicken_tractor", name: "Pen 3" })
        .returning(),
    );
    expect(invented[0].kind).toBe("chicken_tractor");

    await expect(
      asOwner((tx) =>
        tx
          .insert(schema.assets)
          .values({ tenantId: tenantA, kind: "Chicken Tractor", name: "Pen 4" }),
      ),
    ).rejects.toThrow();

    await asOwner((tx) =>
      tx.delete(schema.assets).where(eq(schema.assets.id, invented[0].id)),
    );
  });

  it("refuses a negative cost but allows an unknown one", async () => {
    const unknown = await asOwner((tx) =>
      tx
        .insert(schema.assets)
        .values({
          tenantId: tenantA,
          kind: "fixture",
          name: "Inherited bench",
          acquisitionCostCents: null,
        })
        .returning(),
    );
    expect(unknown[0].acquisitionCostCents).toBeNull();

    await expect(
      asOwner((tx) =>
        tx.insert(schema.assets).values({
          tenantId: tenantA,
          kind: "fixture",
          name: "Impossible",
          acquisitionCostCents: -1,
        }),
      ),
    ).rejects.toThrow();

    await asOwner((tx) =>
      tx.delete(schema.assets).where(eq(schema.assets.id, unknown[0].id)),
    );
  });

  it("cascades with its tenant", async () => {
    // The tenant FK is ON DELETE CASCADE, so removing a tenant takes its assets
    // with it. Certified here because afterAll depends on it.
    const before = await withSystem((tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.assets)
        .where(eq(schema.assets.tenantId, tenantB)),
    );
    expect(before[0].n).toBeGreaterThan(0);
  });

  it("refuses to contain itself", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.assets)
          .set({ parentId: barnA })
          .where(
            and(
              eq(schema.assets.id, barnA),
              eq(schema.assets.tenantId, tenantA),
            ),
          ),
      ),
    ).rejects.toThrow();
  });
});
