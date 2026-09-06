import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, schema } from "../src/db";
import { removeProfile } from "../src/lib/tenant-sync";

/**
 * Clerk's `user.deleted` → the mirror follows. The person's profile goes,
 * their memberships cascade with it, and the business they belonged to is
 * untouched — deleting yourself must never delete a tenant, however small.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const tag = `acct-del-${process.pid}-${Date.now()}`;

d("removeProfile (account deletion)", () => {
  const clerkUserId = `user_${tag}`;
  let tenantId: string | null = null;

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.profiles).where(eq(schema.profiles.clerkUserId, clerkUserId));
      if (tenantId) await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("removes the profile, cascades the membership, and keeps the tenant", async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `org_${tag}`, name: `Tenant ${tag}`, slug: tag })
        .returning();
      tenantId = tenant.id;
      const [profile] = await tx
        .insert(schema.profiles)
        .values({ clerkUserId, email: `${tag}@example.com` })
        .returning();
      await tx
        .insert(schema.memberships)
        .values({ tenantId: tenant.id, profileId: profile.id, role: "staff" });
    });

    expect(await removeProfile(clerkUserId)).toBe(true);

    const after = await withSystem(async (tx) => ({
      profiles: await tx
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, clerkUserId)),
      memberships: await tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(eq(schema.memberships.tenantId, tenantId!)),
      tenants: await tx
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId!)),
    }));
    expect(after.profiles).toHaveLength(0);
    expect(after.memberships).toHaveLength(0);
    expect(after.tenants).toHaveLength(1);
  });

  it("says so when there was nobody to remove", async () => {
    expect(await removeProfile(`user_${tag}-nobody`)).toBe(false);
  });
});
