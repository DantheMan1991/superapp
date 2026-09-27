import "server-only";
import { eq, and } from "drizzle-orm";
import { withSystem, schema, type Tx } from "@/db";
import { slugify } from "@/lib/slug";
import { ensurePrimaryCalendar } from "@/lib/schedule/provision";
import { ensureDefaultWorkList } from "@/lib/work/provision";
import { kindFromOrgMetadata, personalSlug } from "@/lib/personal-space-core";
import type { Membership, Tenant } from "@/db/schema";

/**
 * Idempotent sync of Clerk objects → local rows. Called from the Clerk
 * webhook and from onboarding (so the app works even before the webhook
 * endpoint is configured, and webhook retries are harmless).
 */

/** What this file needs to know about a Clerk organization. */
export interface ClerkOrgFacts {
  id: string;
  name: string;
  slug?: string | null;
  /**
   * The organization's PUBLIC metadata, which is where a personal space's mark
   * lives (`personalOrgMetadata`, ADR 0111). Only our backend can write it, so
   * it can be trusted to say what kind of workspace this is. Absent on every
   * organization made before personal spaces existed, which reads as business.
   */
  publicMetadata?: unknown;
}

/**
 * A second personal organization for somebody who already has one — two tabs,
 * or a double click that beat the lock. The row is refused by
 * `tenants_personal_owner_idx` either way; this names the case so a caller can
 * answer it rather than retry it forever.
 */
export class DuplicatePersonalSpaceError extends Error {
  constructor(
    readonly clerkOrgId: string,
    readonly ownerClerkUserId: string,
  ) {
    super(
      `${ownerClerkUserId} already has a personal space; organization ${clerkOrgId} would be a second one`,
    );
    this.name = "DuplicatePersonalSpaceError";
  }
}

/** Whether an error names a constraint, wherever the driver put the name. */
function violates(err: unknown, constraint: string): boolean {
  const e = err as {
    message?: string;
    constraint?: string;
    cause?: { message?: string; constraint?: string };
  };
  return [e?.message, e?.constraint, e?.cause?.message, e?.cause?.constraint].some(
    (text) => typeof text === "string" && text.includes(constraint),
  );
}

export async function upsertTenantFromOrg(org: ClerkOrgFacts): Promise<Tenant> {
  return withSystem(async (tx) => {
    const existing = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.clerkOrgId, org.id),
    });
    if (existing) {
      // The NAME follows Clerk. The kind and the owner never do: they were
      // settled when the row was made, whatever the metadata says now, and a
      // trigger refuses to change them (`tenants_kind_immutable`).
      const [updated] = await tx
        .update(schema.tenants)
        .set({ name: org.name, updatedAt: new Date() })
        .where(eq(schema.tenants.id, existing.id))
        .returning();
      return updated;
    }
    return insertTenantFromOrgInTx(tx, org);
  });
}

/**
 * THE ONE PLACE A TENANT ROW IS MADE FROM A CLERK ORGANIZATION — the webhook,
 * onboarding and personal-space provisioning all come through here, so all
 * three agree on the kind, the owner, the slug and the subscription row.
 *
 * **Race-safe, because two of those callers race by design.** Provisioning a
 * personal space creates the organization and then inserts the row; Clerk
 * fires `organization.created` the moment the organization exists, and the
 * webhook can land first. Both come here, the insert skips on the
 * organization's unique id, and the loser reads the winner's row — which has
 * the right kind either way, because both read it off the same metadata.
 */
export async function insertTenantFromOrgInTx(
  tx: Tx,
  org: ClerkOrgFacts,
): Promise<Tenant> {
  const existing = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.clerkOrgId, org.id),
  });
  if (existing) return existing;

  const mark = kindFromOrgMetadata(org.publicMetadata);
  if (mark.kind === "personal") {
    const other = await tx.query.tenants.findFirst({
      where: and(
        eq(schema.tenants.kind, "personal"),
        eq(schema.tenants.personalOwnerClerkUserId, mark.owner),
      ),
      columns: { id: true },
    });
    if (other) throw new DuplicatePersonalSpaceError(org.id, mark.owner);
  }

  // Ensure slug uniqueness with a numeric suffix if needed. A personal space
  // with no slug from Clerk — which is every one: this instance has slugs off —
  // takes one derived from its organization id, never from the name
  // ("Personal"), which every personal space shares.
  const base = slugify(
    org.slug || (mark.kind === "personal" ? personalSlug(org.id) : org.name),
  );
  let slug = base;
  for (let i = 2; ; i++) {
    const clash = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.slug, slug),
    });
    if (!clash) break;
    slug = `${base}-${i}`;
  }

  let created: Tenant | undefined;
  try {
    [created] = await tx
      .insert(schema.tenants)
      .values({
        clerkOrgId: org.id,
        name: org.name,
        slug,
        kind: mark.kind,
        personalOwnerClerkUserId: mark.owner,
        // `onboarding` is the first step of a BUSINESS's life with us: a fee,
        // a setup, a first month. A personal space has none of that.
        ...(mark.kind === "personal" ? { status: "active" as const } : {}),
      })
      .onConflictDoNothing({ target: schema.tenants.clerkOrgId })
      .returning();
  } catch (err) {
    if (mark.kind === "personal" && violates(err, "tenants_personal_owner_idx")) {
      throw new DuplicatePersonalSpaceError(org.id, mark.owner);
    }
    throw err;
  }

  if (!created) {
    // The other writer committed this organization between our read and our
    // insert. Its row is the row.
    const winner = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.clerkOrgId, org.id),
    });
    if (!winner) {
      throw new Error(`tenant for ${org.id} conflicted on insert and then could not be read`);
    }
    return winner;
  }

  // A subscription row exists for every tenant from day one (status "none").
  await tx
    .insert(schema.subscriptions)
    .values({ tenantId: created.id })
    .onConflictDoNothing();

  return created;
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
  | { status: "deferred"; missing: "tenant" | "profile" }
  /**
   * Somebody other than its owner, in a personal space (ADR 0111). Never
   * mirrored: Clerk caps the organization at one member, and this is the lock
   * behind that one. Final, not deferred — retrying cannot make them the owner.
   */
  | { status: "refused"; reason: "not-the-owner" };

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
    if (
      tenant.kind === "personal" &&
      params.clerkUserId !== tenant.personalOwnerClerkUserId
    ) {
      return { status: "refused", reason: "not-the-owner" } as const;
    }
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
      // Also on the EXISTING branch, not just on create: everybody who joined
      // before scheduling existed has a membership and no calendar, and this is
      // the path their next role sync comes through. Idempotent, so the common
      // case costs one no-op insert.
      //
      // The work list is per TENANT, so this is one no-op insert per membership
      // sync rather than per person. It rides along here for the same reason the
      // calendar does — it is the path every pre-existing tenant comes back
      // through — and not because provisioning a workspace-level row belongs to
      // a membership event.
      await provisionBusinessRows(tx, tenant, params.clerkUserId);
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
    await provisionBusinessRows(tx, tenant, params.clerkUserId);
    return { status: "synced", membership: created, previousRole: null } as const;
  });
}

/**
 * The rows a membership brings with it in a BUSINESS: the person's calendar
 * and the workspace's default work list, both idempotent. Not in a personal
 * space, which runs neither Scheduling nor Work — its tools are its own, and
 * a calendar row there would be a business tool's leftovers in somebody's
 * private space.
 */
async function provisionBusinessRows(
  tx: Tx,
  tenant: Tenant,
  clerkUserId: string,
): Promise<void> {
  if (tenant.kind !== "business") return;
  await ensurePrimaryCalendar(tx, tenant.id, clerkUserId);
  await ensureDefaultWorkList(tx, tenant.id);
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

/**
 * Clerk user deleted (they used "Delete account", or we did) → the profile
 * row goes, and memberships cascade with it (FK). Rows elsewhere that name
 * the person by id keep the id, as a record of who acted — the same rule the
 * instance migration follows. Returns whether a row existed.
 */
export async function removeProfile(clerkUserId: string): Promise<boolean> {
  return withSystem(async (tx) => {
    const deleted = await tx
      .delete(schema.profiles)
      .where(eq(schema.profiles.clerkUserId, clerkUserId))
      .returning({ id: schema.profiles.id });
    return deleted.length > 0;
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
