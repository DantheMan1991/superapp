import "server-only";
import { eq, and } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import { slugify } from "@/lib/slug";
import type { Membership, Tenant } from "@/db/schema";

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

/**
 * Outcome of a membership sync. `deferred` means the row could not be written
 * yet because something it references has not arrived — NOT that there was
 * nothing to do. Callers must react to it: the Clerk webhook answers 5xx so
 * svix retries, because a membership silently missing is a person a background
 * job will never act for.
 */
export type MembershipSyncResult =
  | {
      status: "synced";
      membership: Membership;
      previousRole: Membership["role"] | null;
    }
  | { status: "deferred"; missing: "tenant" | "profile" };

export async function upsertMembership(params: {
  clerkOrgId: string;
  clerkUserId: string;
  clerkRole: string; // "org:admin" | "org:member"
}): Promise<MembershipSyncResult> {
  return withSystem(async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.clerkOrgId, params.clerkOrgId),
    });
    if (!tenant) return { status: "deferred", missing: "tenant" } as const;
    const profile = await tx.query.profiles.findFirst({
      where: eq(schema.profiles.clerkUserId, params.clerkUserId),
    });
    // Clerk does not order webhook deliveries, so organizationMembership.created
    // can land before user.created. Deferring (and retrying) is the whole point:
    // returning "nothing happened" here used to drop the membership for good.
    if (!profile) return { status: "deferred", missing: "profile" } as const;

    const clerkDerived = params.clerkRole === "org:admin" ? "owner" : "staff";
    const existing = await tx.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.tenantId, tenant.id),
        eq(schema.memberships.profileId, profile.id),
      ),
    });
    if (existing) {
      // Clerk owns owner-vs-member; the local "expert" flag (set by the
      // tenant owner on the Team page) owns expert-vs-staff within members
      // and must survive membership webhooks re-syncing the Clerk role.
      const role =
        clerkDerived === "owner"
          ? "owner"
          : existing.role === "expert"
            ? "expert"
            : "staff";
      const [updated] = await tx
        .update(schema.memberships)
        .set({ role, clerkRoleSyncedAt: new Date() })
        .where(eq(schema.memberships.id, existing.id))
        .returning();
      return {
        status: "synced",
        membership: updated,
        previousRole: existing.role,
      } as const;
    }
    const [created] = await tx
      .insert(schema.memberships)
      .values({
        tenantId: tenant.id,
        profileId: profile.id,
        role: clerkDerived,
        clerkRoleSyncedAt: new Date(),
      })
      .returning();
    return { status: "synced", membership: created, previousRole: null } as const;
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
