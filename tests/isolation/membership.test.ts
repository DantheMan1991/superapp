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

  /**
   * **THE MECHANISM MOVED, THE GUARANTEE DID NOT** (ADR 0093, `drizzle/0385`).
   *
   * Under `0085` this raised: the row was visible to a STAFF context and the
   * WITH CHECK refused the value. `0385` added `app_current_tenant_role() =
   * 'owner'` to the USING clause as well, so a staff context no longer SEES the
   * row and the update matches nothing. Strictly stronger, and worth asserting
   * in both shapes rather than rewriting the old one away.
   */
  it("hides every membership row from a staff context UPDATE", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "owner" })
          .where(eq(schema.memberships.id, membershipStaffA))
          .returning(),
      { role: "staff" },
    );
    expect(updated).toHaveLength(0);

    const after = await withSystem((tx) =>
      tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(eq(schema.memberships.id, membershipStaffA)),
    );
    expect(after[0].role).toBe("staff");
  });

  it("REFUSES an owner context minting an owner - the WITH CHECK half", async () => {
    // The owner passes USING, so the row is reachable and the VALUE is what is
    // refused. This is the assertion the test above used to make.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx
            .update(schema.memberships)
            .set({ role: "owner" })
            .where(eq(schema.memberships.id, membershipStaffA))
            .returning(),
        { role: "owner" },
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
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "staff" })
          .where(eq(schema.memberships.id, membershipOwnerA))
          .returning(),
      { role: "owner" },
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
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "expert" })
          .where(eq(schema.memberships.id, membershipStaffB))
          .returning(),
      { role: "owner" },
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

  /**
   * The narrowed policy must not break the one legitimate caller,
   * `setMemberAccountantAction` - which is `requireTenantOwner()` and, since
   * `0385` made the role load-bearing, now passes `{ role: ctx.role }`.
   *
   * **THIS TEST IS WHY THAT FIX EXISTS.** It was written as a guard for exactly
   * this class of change, it fired on the full isolation run, and the call site
   * it was guarding had been relying on app-layer enforcement alone.
   */
  it("the accountant toggle still works for an OWNER: staff to expert", async () => {
    const toExpert = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "expert" })
          .where(eq(schema.memberships.id, membershipStaffA))
          .returning(),
      { role: "owner" },
    );
    expect(toExpert).toHaveLength(1);
    expect(toExpert[0].role).toBe("expert");

    const back = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "staff" })
          .where(eq(schema.memberships.id, membershipStaffA))
          .returning(),
      { role: "owner" },
    );
    expect(back).toHaveLength(1);
    expect(back[0].role).toBe("staff");
  });

  /** And the same toggle is refused to everybody else, which is the new half. */
  it("REFUSES the accountant toggle to a staff context", async () => {
    const tried = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ role: "expert" })
          .where(eq(schema.memberships.id, membershipStaffA))
          .returning(),
      { role: "staff" },
    );
    expect(tried).toHaveLength(0);
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
