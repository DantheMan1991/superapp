import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { eq, inArray } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import { logAudit } from "@/lib/audit";
import { upsertMembership, upsertProfileFromUser } from "@/lib/tenant-sync";

/**
 * Server→Clerk reconcile of a tenant's roster.
 *
 * Same shape and the same justification as billing-sync.ts: the webhook is the
 * live path, and this is the authoritative read that heals whatever the webhook
 * missed. Membership needs it more than billing does, for two reasons.
 *
 * First, the webhook only reports CHANGES. A delivery dropped while nobody was
 * looking leaves a row that is wrong indefinitely, and the demotion case is the
 * dangerous one: a stale row saying "owner" for somebody Clerk has since
 * demoted would let a background job read owners-only data on their behalf and
 * mail it to them. Nothing in the product notices, because requireTenant asks
 * Clerk directly and never consults this table for owner-ness.
 *
 * Second, the repair paths that existed before this file only ran for people
 * who were signing in. A digest has to be right about the people who are NOT
 * visiting — that is the entire point of sending it.
 *
 * So: a job that intends to act as somebody reconciles first, and then trusts
 * `clerkRoleSyncedAt`. That is what turns "we stored a role once" into "we
 * confirmed this role against Clerk seconds ago".
 */

export interface ReconcileResult {
  /** Memberships confirmed against Clerk (created or updated). */
  synced: number;
  /** Rows that did not exist locally before this run. */
  created: number;
  /** Profiles created because user.created never arrived. */
  profilesCreated: number;
  /** Local rows deleted because the person is no longer in the Clerk org. */
  removed: number;
  /** Rows whose stored role disagreed with Clerk — the drift signal. */
  corrected: number;
  /** Members that could not be synced this run. */
  failed: number;
  /** True when the roster was fully listed and is safe to treat as complete. */
  complete: boolean;
}

const EMPTY: ReconcileResult = {
  synced: 0,
  created: 0,
  profilesCreated: 0,
  removed: 0,
  corrected: 0,
  failed: 0,
  complete: false,
};

/** Clerk caps this at 500; 100 keeps each round trip small. */
const PAGE = 100;

interface ClerkMember {
  clerkUserId: string;
  clerkRole: string;
}

/**
 * Page through the org's memberships. Returns null if ANY page fails — a
 * partial roster must never be mistaken for a complete one, because the caller
 * deletes local rows that the roster does not mention.
 */
async function listClerkMembers(
  clerkOrgId: string,
): Promise<ClerkMember[] | null> {
  try {
    const client = await clerkClient();
    const members: ClerkMember[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await client.organizations.getOrganizationMembershipList({
        organizationId: clerkOrgId,
        limit: PAGE,
        offset,
      });
      for (const m of page.data) {
        const clerkUserId = m.publicUserData?.userId;
        if (!clerkUserId) continue;
        members.push({ clerkUserId, clerkRole: m.role });
      }
      if (page.data.length < PAGE) break;
    }
    return members;
  } catch (err) {
    console.error("clerk membership list failed", err);
    return null;
  }
}

/**
 * Create the profile rows a membership needs when `user.created` never
 * arrived. Reads the user from Clerk rather than trusting the membership
 * payload's `identifier`: that field is whatever the instance uses to identify
 * a person, and writing it into profiles.email would put a guess where the
 * digest later reads an address. Only called for people we have no profile for,
 * so the extra round trips are rare.
 */
async function backfillProfiles(
  clerkUserIds: string[],
): Promise<{ created: number; failed: number }> {
  if (clerkUserIds.length === 0) return { created: 0, failed: 0 };

  const known = await withSystem((tx) =>
    tx
      .select({ clerkUserId: schema.profiles.clerkUserId })
      .from(schema.profiles)
      .where(inArray(schema.profiles.clerkUserId, clerkUserIds)),
  );
  const missing = clerkUserIds.filter(
    (id) => !known.some((k) => k.clerkUserId === id),
  );
  if (missing.length === 0) return { created: 0, failed: 0 };

  const client = await clerkClient();
  let created = 0;
  let failed = 0;
  for (const clerkUserId of missing) {
    try {
      const user = await client.users.getUser(clerkUserId);
      const email =
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
          ?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
      // No address means nowhere to send anything and no way to name them.
      // Counting it as failed is honest; inventing a placeholder is not.
      if (!email) {
        failed += 1;
        continue;
      }
      await upsertProfileFromUser({
        id: user.id,
        email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
        imageUrl: user.imageUrl ?? null,
      });
      created += 1;
    } catch (err) {
      console.error("clerk user backfill failed", err);
      failed += 1;
    }
  }
  return { created, failed };
}

/**
 * Drop local memberships for people Clerk no longer lists. Only ever called
 * with a roster we know is complete — see listClerkMembers.
 */
async function removeDeparted(
  tenantId: string,
  presentClerkUserIds: string[],
): Promise<number> {
  return withSystem(async (tx) => {
    const local = await tx
      .select({
        id: schema.memberships.id,
        role: schema.memberships.role,
        clerkUserId: schema.profiles.clerkUserId,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.profiles,
        eq(schema.profiles.id, schema.memberships.profileId),
      )
      .where(eq(schema.memberships.tenantId, tenantId));

    const departed = local.filter(
      (row) => !presentClerkUserIds.includes(row.clerkUserId),
    );
    if (departed.length === 0) return 0;

    await tx.delete(schema.memberships).where(
      inArray(
        schema.memberships.id,
        departed.map((d) => d.id),
      ),
    );
    return departed.length;
  });
}

/**
 * Bring a tenant's memberships in line with Clerk. Best-effort by design: it
 * runs on page loads (onboarding, Team) where a Clerk outage must not blank the
 * page, so it reports what it managed rather than throwing.
 *
 * `complete: false` means the roster could not be established. A caller about
 * to act on somebody's behalf should treat that as "do not trust the roles",
 * not as "nothing to do".
 */
export async function reconcileTenantMemberships(tenant: {
  id: string;
  clerkOrgId: string | null;
}): Promise<ReconcileResult> {
  // Lazy, like every other provider client here: no key, no call, build stays
  // green and local dev without Clerk credentials degrades instead of crashing.
  if (!process.env.CLERK_SECRET_KEY || !tenant.clerkOrgId) return EMPTY;

  const members = await listClerkMembers(tenant.clerkOrgId);
  if (!members) return EMPTY;

  const result: ReconcileResult = { ...EMPTY, complete: true };

  const backfilled = await backfillProfiles(members.map((m) => m.clerkUserId));
  result.profilesCreated = backfilled.created;
  result.failed += backfilled.failed;

  for (const member of members) {
    const outcome = await upsertMembership({
      clerkOrgId: tenant.clerkOrgId,
      clerkUserId: member.clerkUserId,
      clerkRole: member.clerkRole,
    });
    if (outcome.status === "deferred") {
      // The profile backfill above should have prevented this. It does not make
      // the ROSTER doubtful — that came from Clerk and is still complete — only
      // this person's role, so `complete` drops but removals below stay safe.
      result.failed += 1;
      result.complete = false;
      continue;
    }
    result.synced += 1;
    if (outcome.previousRole === null) {
      result.created += 1;
    } else if (outcome.previousRole !== outcome.membership.role) {
      result.corrected += 1;
      // The drift signal. A correction here means a webhook was missed, and
      // the owner→staff direction is the one that mattered: it is the window
      // in which a background job could have acted as somebody who had
      // already been demoted.
      await logAudit({
        action: "membership.role_corrected",
        tenantId: tenant.id,
        actorLabel: "membership-reconcile",
        targetType: "membership",
        targetId: outcome.membership.id,
        meta: { from: outcome.previousRole, to: outcome.membership.role },
      });
    }
  }

  /**
   * Removals key on the ROSTER being trustworthy, not on every row having
   * synced: reaching here means listClerkMembers paged through the whole org
   * without an error, which is what makes "absent from `members`" mean "gone
   * from the org". A profile we could not write above says nothing about who
   * belongs — and letting it block removals would leave a departed member
   * receiving a digest for a tenant they have left.
   *
   * The one case still worth refusing: a Clerk org always has at least one
   * member, so an empty-but-successful listing means something is wrong
   * upstream. Deleting every local membership on the strength of it would turn
   * a provider hiccup into a tenant locked out of its own digest.
   */
  if (members.length > 0) {
    result.removed = await removeDeparted(
      tenant.id,
      members.map((m) => m.clerkUserId),
    );
    if (result.removed > 0) {
      await logAudit({
        action: "membership.removed_stale",
        tenantId: tenant.id,
        actorLabel: "membership-reconcile",
        meta: { count: result.removed },
      });
    }
  }

  return result;
}
