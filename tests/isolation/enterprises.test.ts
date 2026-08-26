import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `enterprises` RLS — the Layer 0 table four packs will name.
 *
 * **WHAT LEAKAGE WOULD COST HERE IS LARGER THAN THE TABLE LOOKS.** An
 * enterprise is about to become a reporting dimension on journal lines, so
 * another tenant's row appearing in a picker is a neighbour's line of business
 * showing up in this farm's profit and loss — and, worse, a journal line tagged
 * with it. This suite certifies that the row cannot be seen, written, moved or
 * enumerated across the boundary.
 *
 * Fixtures are built under `withSystem` on purpose, as in every file here: this
 * certifies what the DATABASE enforces, and routing setup through
 * `src/lib/enterprises/` would let a bug in that file make these tests agree
 * with it. The dimension-sync guarantee is NOT covered here — it lives in
 * `tests/enterprises-ops.test.ts`, and this table needs both files.
 */
d("enterprises (RLS)", () => {
  const STAMP = `iso-ent-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`; // staff in tenant A
  const OTHER = `${STAMP}-other`; // owner of tenant B

  let tenantA: string;
  let tenantB: string;
  let broilersA: string;
  let beefB: string;

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
          { clerkOrgId: `${STAMP}-a`, name: "Ent A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Ent B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const mine = await tx
        .insert(schema.enterprises)
        .values({
          tenantId: tenantA,
          name: "Broilers",
          slug: "broilers",
          kind: "livestock",
        })
        .returning();
      broilersA = mine[0].id;

      const theirs = await tx
        .insert(schema.enterprises)
        .values({
          tenantId: tenantB,
          name: "Beef",
          slug: "beef",
          kind: "livestock",
        })
        .returning();
      beefB = theirs[0].id;
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

  it("a tenant sees only its own enterprises", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.enterprises));
    expect(mine.map((e) => e.name)).toEqual(["Broilers"]);
    expect(mine.map((e) => e.id)).not.toContain(beefB);

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.enterprises),
    );
    expect(theirs.map((e) => e.name)).toEqual(["Beef"]);
  });

  it("STAFF CAN READ THEM, which is the point of the member-wide policy", async () => {
    // The enterprise is what the inventory filter bar is built on: "just the
    // broiler things" is a question whoever is sent to the freezer asks, and a
    // list only the owner could see is a filter nobody can use. WHO MAY WRITE
    // is the action layer's job — see drizzle/0215_enterprises_rls.sql.
    const seen = await asStaff((tx) => tx.select().from(schema.enterprises));
    expect(seen.map((e) => e.name)).toEqual(["Broilers"]);
  });

  it("cannot read another tenant's enterprise even by id", async () => {
    const found = await asOwner((tx) =>
      tx
        .select()
        .from(schema.enterprises)
        .where(eq(schema.enterprises.id, beefB)),
    );
    expect(found).toHaveLength(0);
  });

  it("cannot update another tenant's enterprise", async () => {
    const updated = await asOwner((tx) =>
      tx
        .update(schema.enterprises)
        .set({ name: "Stolen" })
        .where(eq(schema.enterprises.id, beefB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const actual = await withSystem((tx) =>
      tx
        .select()
        .from(schema.enterprises)
        .where(eq(schema.enterprises.id, beefB)),
    );
    expect(actual[0].name).toBe("Beef");
  });

  it("cannot delete another tenant's enterprise", async () => {
    const deleted = await asOwner((tx) =>
      tx
        .delete(schema.enterprises)
        .where(eq(schema.enterprises.id, beefB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("cannot insert an enterprise stamped with another tenant", async () => {
    // WITH CHECK, not USING: the row would be invisible afterwards, but the
    // policy has to refuse it outright or a tenant could write into another's
    // data and simply not be able to read it back.
    await expect(
      asOwner((tx) =>
        tx.insert(schema.enterprises).values({
          tenantId: tenantB,
          name: "Smuggled",
          slug: "smuggled",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move an enterprise into another tenant", async () => {
    // THROWS rather than returning zero rows: the row IS visible, and it is the
    // new values that leave the tenant, so WITH CHECK refuses with 42501.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.enterprises)
          .set({ tenantId: tenantB })
          .where(eq(schema.enterprises.id, broilersA)),
      ),
    ).rejects.toThrow();

    const stillMine = await withSystem((tx) =>
      tx
        .select()
        .from(schema.enterprises)
        .where(eq(schema.enterprises.id, broilersA)),
    );
    expect(stillMine[0].tenantId).toBe(tenantA);
  });

  it("is default-deny with no tenant context at all", async () => {
    // FORCE ROW LEVEL SECURITY: not even the connection's own role escapes. A
    // context pointing at a tenant that does not exist sees nothing rather than
    // everything, which is the backstop the whole arrangement rests on.
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.enterprises)),
    ).toHaveLength(0);
  });

  it("REUSES A SLUG ACROSS TENANTS, because the unique is per tenant", async () => {
    // Two farms both running broilers is the ordinary case, and a global unique
    // would make the second one's insert fail for a reason nobody could act on.
    const also = await withSystem((tx) =>
      tx
        .insert(schema.enterprises)
        .values({ tenantId: tenantB, name: "Broilers", slug: "broilers" })
        .returning(),
    );
    expect(also[0].slug).toBe("broilers");
  });

  it("refuses a second enterprise with the same slug in ONE tenant", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.enterprises)
          .values({ tenantId: tenantA, name: "Broilers again", slug: "broilers" }),
      ),
    ).rejects.toThrow();
  });
});
