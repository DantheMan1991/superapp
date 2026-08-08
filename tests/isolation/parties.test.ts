import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { findPartiesByContact } from "../../src/lib/parties/contacts";
import { previewMerge } from "../../src/modules/crm/merge-ops";
import { d, seedParty } from "./_shared";

/**
 * THE PARTY SPINE (CRM slice 0).
 *
 * `parties` is the first table in this schema written by TWO modules —
 * Accounting today, CRM next — which makes it worth more than the standard
 * two-tenant pass. The specific risk a shared identity table introduces is a
 * role row in one tenant pointing at an identity in another, so the composite
 * FK gets its own case here rather than being assumed from the column list.
 */
const STAMP_PARTY = `iso-party-${process.pid}`;

d("parties isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const partyOf: Record<string, string> = {};

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_PARTY}-a`, name: "Party Iso A", slug: `${STAMP_PARTY}-a` },
          { clerkOrgId: `${STAMP_PARTY}-b`, name: "Party Iso B", slug: `${STAMP_PARTY}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    for (const [tenant, tag] of [
      [tenantA, "A"],
      [tenantB, "B"],
    ] as const) {
      partyOf[tag] = await withTenant(tenant, (tx) =>
        seedParty(tx, tenant, `Party ${tag}`),
      );
    }
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("an unscoped select on parties returns only the tenant's rows", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.parties),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("cannot INSERT a party attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.parties).values({
          tenantId: tenantB,
          kind: "organization",
          displayName: "smuggled party",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot UPDATE or DELETE the other tenant's parties (0 rows affected)", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.parties)
        .set({ displayName: "defaced" })
        .where(eq(schema.parties.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.parties)
        .where(eq(schema.parties.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("no context at all → default deny (FORCE RLS catches raw access)", async () => {
    const rows = await withSystem(async (tx) => {
      // Reset context inside this tx to simulate a forgotten wrapper.
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.parties);
    });
    expect(rows).toHaveLength(0);
  });

  /**
   * THE CASE A SHARED IDENTITY TABLE ADDS, and the reason this block exists.
   *
   * A customer row naming another tenant's party would be a cross-tenant join
   * that RLS alone cannot see — both rows are individually legitimate, and the
   * reference between them is what is wrong. `customers_party_fk` is composite
   * on (tenant_id, party_id), so the database refuses it outright rather than
   * leaving it to a predicate somebody has to remember to write.
   */
  it("a role row cannot reference another tenant's party", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.customers).values({
          tenantId: tenantA,
          partyId: partyOf.B,
          name: "cross-tenant identity",
        }),
      ),
    ).rejects.toThrow();
  });

  /**
   * The positive case, and the entire point of the spine: ONE identity holding
   * BOTH accounting roles. Before slice 0 a business that invoiced you and sold
   * to you was two unrelated rows with no way to state they were the same
   * company.
   */
  it("one party can hold both a customer and a vendor role", async () => {
    const [customer, vendor] = await withTenant(tenantA, async (tx) => {
      const partyId = await seedParty(tx, tenantA, "Both Roles Ltd");
      const [c] = await tx
        .insert(schema.customers)
        .values({ tenantId: tenantA, partyId, name: "Both Roles Ltd" })
        .returning();
      const [v] = await tx
        .insert(schema.vendors)
        .values({ tenantId: tenantA, partyId, name: "Both Roles Ltd" })
        .returning();
      return [c, v];
    });
    expect(customer.partyId).toBe(vendor.partyId);
  });

  /**
   * And the duplicate that unique index exists to refuse: the same party
   * cannot hold the SAME role twice. Two AR relationships with one identity is
   * a duplicate record, not a fact about the business.
   */
  /* -- Contact points ----------------------------------------------------- */

  /**
   * `party_contact_points` is tenant-scoped like `parties`. The case that
   * earns its keep is the DUPLICATE LOOKUP: it searches by normalized value
   * across the whole tenant, which is exactly the shape that leaks if it is
   * ever run outside a scoped transaction. Typing a competitor's email and
   * being told whether they are one of our clients is the failure to prevent.
   */
  it("contact points are scoped to their tenant", async () => {
    for (const [tenant, tag] of [
      [tenantA, "a"],
      [tenantB, "b"],
    ] as const) {
      await withTenant(tenant, (tx) =>
        tx.insert(schema.partyContactPoints).values({
          tenantId: tenant,
          partyId: partyOf[tag === "a" ? "A" : "B"],
          kind: "email",
          value: `shared@example.com`,
          // Written literally rather than through the normalizer, so this test
          // does not agree with a bug in the code it is certifying.
          normalizedValue: "shared@example.com",
          isPrimary: true,
        }),
      );
    }

    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.partyContactPoints),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenantId).toBe(tenantA);
  });

  it("THE DUPLICATE LOOKUP CANNOT SEE ANOTHER TENANT'S PARTY", async () => {
    // Both tenants have `shared@example.com` from the test above. Tenant A must
    // find its own and only its own — otherwise the warning becomes a way to
    // discover another business's client list one address at a time.
    const matches = await withTenant(tenantA, (tx) =>
      findPartiesByContact(tx, tenantA, "email", "Shared@Example.COM"),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].party.id).toBe(partyOf.A);
    expect(matches[0].party.tenantId).toBe(tenantA);
  });

  /**
   * MERGING CANNOT REACH ACROSS TENANTS, and this is the highest-consequence
   * version of that question in the codebase. A merge deletes an identity and
   * re-points posted invoices; one that accepted another tenant's party id
   * would destroy a different business's records from inside this one.
   *
   * Nothing in `merge-ops.ts` filters on tenancy beyond the explicit
   * `tenant_id` predicates — the guard is `loadParty` running inside the
   * caller's transaction, where RLS has already removed the other tenant's row,
   * so the id resolves to nothing and the merge refuses before it writes.
   */
  it("A MERGE CANNOT NAME ANOTHER TENANT'S RECORD", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) => previewMerge(tx, tenantA, partyOf.A, partyOf.B),
        { role: "owner", userId: "user-a" },
      ),
    ).rejects.toThrow();

    // And the same in the direction that would matter most: the other tenant's
    // record as the SURVIVOR, which would move our rows onto theirs.
    await expect(
      withTenant(
        tenantA,
        (tx) => previewMerge(tx, tenantA, partyOf.B, partyOf.A),
        { role: "owner", userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("cannot INSERT a contact point attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.partyContactPoints).values({
          tenantId: tenantB,
          partyId: partyOf.B,
          kind: "email",
          value: "smuggled@example.com",
          normalizedValue: "smuggled@example.com",
        }),
      ),
    ).rejects.toThrow();
  });

  it("one party cannot hold the same address twice", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.partyContactPoints).values({
          tenantId: tenantA,
          partyId: partyOf.A,
          kind: "email",
          value: "SHARED@example.com",
          // Same normalized value as the row inserted above — differing
          // capitalisation must not sneak a duplicate past the unique.
          normalizedValue: "shared@example.com",
        }),
      ),
    ).rejects.toThrow();
  });

  it("one party cannot have two primary addresses of the same kind", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.partyContactPoints).values({
          tenantId: tenantA,
          partyId: partyOf.A,
          kind: "email",
          value: "second@example.com",
          normalizedValue: "second@example.com",
          isPrimary: true,
        }),
      ),
    ).rejects.toThrow();
  });

  it("but CAN have a primary of each kind", async () => {
    // The partial unique is per (party, KIND) — a main email and a main phone
    // are different questions and both deserve an answer.
    const row = await withTenant(tenantA, (tx) =>
      tx
        .insert(schema.partyContactPoints)
        .values({
          tenantId: tenantA,
          partyId: partyOf.A,
          kind: "phone",
          value: "+1 555 123 4567",
          normalizedValue: "+15551234567",
          isPrimary: true,
        })
        .returning(),
    );
    expect(row).toHaveLength(1);
  });

  it("a party cannot hold the same role twice", async () => {
    await expect(
      withTenant(tenantA, async (tx) => {
        const partyId = await seedParty(tx, tenantA, "Twice Ltd");
        await tx
          .insert(schema.customers)
          .values({ tenantId: tenantA, partyId, name: "Twice Ltd" });
        await tx
          .insert(schema.customers)
          .values({ tenantId: tenantA, partyId, name: "Twice Ltd again" });
      }),
    ).rejects.toThrow();
  });
});
