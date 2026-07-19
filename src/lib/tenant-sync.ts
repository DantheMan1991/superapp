import "server-only";
import { eq, and } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import { slugify } from "@/lib/slug";
import type { Tenant } from "@/db/schema";

/**
 * Idempotent sync of Clerk objects → local rows. Called from the Clerk
 * webhook and from onboarding (so the app works even before the webhook
 * endpoint is configured, and webhook retries are harmless).
 */

export async function upsertTenantFromOrg(org: {
  id: string;
  name: string;
  slug?: string | null;
}): Promise<Tenant> {
  return withSystem(async (tx) => {
    const existing = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.clerkOrgId, org.id),
    });
    if (existing) {
      const [updated] = await tx
        .update(schema.tenants)
        .set({ name: org.name, updatedAt: new Date() })
        .where(eq(schema.tenants.id, existing.id))
        .returning();
      return updated;
    }

    // Ensure slug uniqueness with a numeric suffix if needed.
    const base = slugify(org.slug || org.name);
    let slug = base;
    for (let i = 2; ; i++) {
      const clash = await tx.query.tenants.findFirst({
        where: eq(schema.tenants.slug, slug),
      });
      if (!clash) break;
      slug = `${base}-${i}`;
    }

    const [created] = await tx
      .insert(schema.tenants)
      .values({ clerkOrgId: org.id, name: org.name, slug })
      .returning();

    // A subscription row exists for every tenant from day one (status "none").
    await tx
      .insert(schema.subscriptions)
      .values({ tenantId: created.id })
      .onConflictDoNothing();

    return created;
  });
}

export async function upsertProfileFromUser(user: {
  id: string;
  email: string;
  name?: string | null;
  imageUrl?: string | null;
}) {
  return withSystem(async (tx) => {
    const [row] = await tx
      .insert(schema.profiles)
      .values({
        clerkUserId: user.id,
        email: user.email,
        name: user.name ?? null,
        imageUrl: user.imageUrl ?? null,
      })
      .onConflictDoUpdate({
        target: schema.profiles.clerkUserId,
        set: {
          email: user.email,
          name: user.name ?? null,
          imageUrl: user.imageUrl ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  });
}

export async function upsertMembership(params: {
  clerkOrgId: string;
  clerkUserId: string;
  clerkRole: string; // "org:admin" | "org:member"
}) {
  return withSystem(async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.clerkOrgId, params.clerkOrgId),
    });
    const profile = await tx.query.profiles.findFirst({
      where: eq(schema.profiles.clerkUserId, params.clerkUserId),
    });
    if (!tenant || !profile) return null;

    const role = params.clerkRole === "org:admin" ? "owner" : "staff";
    const existing = await tx.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.tenantId, tenant.id),
        eq(schema.memberships.profileId, profile.id),
      ),
    });
    if (existing) {
      const [updated] = await tx
        .update(schema.memberships)
        .set({ role })
        .where(eq(schema.memberships.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await tx
      .insert(schema.memberships)
      .values({ tenantId: tenant.id, profileId: profile.id, role })
      .returning();
    return created;
  });
}

export async function removeMembership(params: {
  clerkOrgId: string;
  clerkUserId: string;
}) {
  return withSystem(async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.clerkOrgId, params.clerkOrgId),
    });
    const profile = await tx.query.profiles.findFirst({
      where: eq(schema.profiles.clerkUserId, params.clerkUserId),
    });
    if (!tenant || !profile) return;
    await tx
      .delete(schema.memberships)
      .where(
        and(
          eq(schema.memberships.tenantId, tenant.id),
          eq(schema.memberships.profileId, profile.id),
        ),
      );
  });
}

/** Org deleted in Clerk → mark churned. Data is retained, not dropped. */
export async function markTenantChurned(clerkOrgId: string) {
  return withSystem((tx) =>
    tx
      .update(schema.tenants)
      .set({ status: "churned", updatedAt: new Date() })
      .where(eq(schema.tenants.clerkOrgId, clerkOrgId)),
  );
}
