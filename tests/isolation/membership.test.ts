import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

d("membership role escalation (RLS)", () => {
  let tenantA: string;
  let tenantB: string;
  let profileStaffA: string;
  let profileOwnerA: string;
  let membershipStaffA: string;
  let membershipOwnerA: string;
  let membershipStaffB: string;

  const STAMP2 = `iso-mrole-${process.pid}`;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP2}-a`, name: "Role Test A", slug: `${STAMP2}-a` },
          { clerkOrgId: `${STAMP2}-b`, name: "Role Test B", slug: `${STAMP2}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const profiles = await tx
        .insert(schema.profiles)
        .values([
          { clerkUserId: `${STAMP2}-staff`, email: `${STAMP2}-staff@example.test` },
          { clerkUserId: `${STAMP2}-owner`, email: `${STAMP2}-owner@example.test` },
          { clerkUserId: `${STAMP2}-b`, email: `${STAMP2}-b@example.test` },
        ])
        .returning();
      profileStaffA = profiles[0].id;
      profileOwnerA = profiles[1].id;

      const memberships = await tx
        .insert(schema.memberships)
        .values([
          { tenantId: tenantA, profileId: profileStaffA, role: "staff" },
          { tenantId: tenantA, profileId: profileOwnerA, role: "owner" },
          { tenantId: tenantB, profileId: profiles[2].id, role: "staff" },
        ])
        .returning();
      membershipStaffA = memberships[0].id;
      membershipOwnerA = memberships[1].id;
      membershipStaffB = memberships[2].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.profiles)
        .where(sql`${schema.profiles.clerkUserId} like ${`${STAMP2}%`}`);
    });
  });

  it("tenant context cannot promote itself to owner", async () => {
    // The escalation this migration exists to prevent: a WITH CHECK violation
    // raises, it does not silently write.
    await expect(
      withTenant(tenantA, (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "owner" })
          .where(eq(schema.memberships.id, membershipStaffA))
          .returning(),
      ),
    ).rejects.toThrow();

    const after = await withSystem((tx) =>
      tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(eq(schema.memberships.id, membershipStaffA)),
    );
    expect(after[0].role).toBe("staff");
  });

  it("tenant context cannot modify an existing owner row", async () => {
    // Excluded by USING rather than rejected by WITH CHECK, so the row is
    // invisible to the UPDATE and zero rows change.
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "staff" })
        .where(eq(schema.memberships.id, membershipOwnerA))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const after = await withSystem((tx) =>
      tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(eq(schema.memberships.id, membershipOwnerA)),
    );
    expect(after[0].role).toBe("owner");
  });

  it("tenant context cannot demote the other tenant's member", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "expert" })
        .where(eq(schema.memberships.id, membershipStaffB))
        .returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("tenant context cannot INSERT a membership at all", async () => {
    // There is no member INSERT policy — joining an org happens in Clerk and
    // arrives here through the webhook, never from a tenant transaction.
    await expect(
      withTenant(tenantA, (tx) =>
        tx
          .insert(schema.memberships)
          .values({ tenantId: tenantA, profileId: profileStaffA, role: "owner" })
          .returning(),
      ),
    ).rejects.toThrow();
  });

  it("the accountant toggle still works: staff ↔ expert", async () => {
    // The narrowed policy must not break the one legitimate caller
    // (setMemberAccountantAction), which only ever writes these two values.
    const toExpert = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "expert" })
        .where(eq(schema.memberships.id, membershipStaffA))
        .returning(),
    );
    expect(toExpert).toHaveLength(1);
    expect(toExpert[0].role).toBe("expert");

    const back = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "staff" })
        .where(eq(schema.memberships.id, membershipStaffA))
        .returning(),
    );
    expect(back).toHaveLength(1);
    expect(back[0].role).toBe("staff");
  });

  it("only withSystem can mint an owner", async () => {
    // The positive half of the invariant: the Clerk webhook and the reconcile
    // both run under withSystem, and they must still be able to do this.
    const promoted = await withSystem((tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "owner" })
        .where(eq(schema.memberships.id, membershipStaffA))
        .returning(),
    );
    expect(promoted).toHaveLength(1);
    expect(promoted[0].role).toBe("owner");

    await withSystem((tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "staff" })
        .where(eq(schema.memberships.id, membershipStaffA)),
    );
  });
});
