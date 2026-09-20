import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import type { JobBidInvitation, JobBidPackage } from "@/db/schema";
import { isModuleEnabled } from "@/lib/modules";
import { recordAttempt } from "@/lib/public-limits";
import { hashToken, isShareSecretConfigured, looksLikeToken } from "@/lib/public-token";
import { invitationAcceptsReply, invitationOpens } from "./bid-math";
import { PACK } from "./vocabulary";

/**
 * TURNING A SUBCONTRACTOR'S TOKEN INTO A TENANT-SCOPED READ (X3, ADR 0098).
 *
 * The second most dangerous function in the pack, in its own file so it can
 * be read in one sitting, and a deliberate copy of `proposal-share.ts` — the
 * trust model is the inbound-email webhook's and the document share's:
 *
 *   **`withSystem` does the token -> tenant hop and NOTHING else.**
 *
 * It never accepts a caller-supplied tenant id, package id or party id — the
 * only input is 43 characters of base64url — and every read after it runs
 * under `withTenant` at role **staff**, the least privileged value, where the
 * pack's own RLS governs it. Widening that one lookup is the most dangerous
 * refactor in this feature.
 *
 * **EVERY FAILURE LOOKS THE SAME.** Unknown, revoked, expired, already
 * answered, jobs switched off, tenant gone — one answer, so a visitor cannot
 * use the page to learn that a token was nearly right, that a business
 * exists, or that a job was cancelled. The BUILDER is told which it is, on
 * their own screen, where they are authenticated.
 *
 * **AND A SUBCONTRACTOR IS SHOWN THE SCOPE, NOT THE JOB.** The package's
 * title, its scope and its due date, plus the job's number and address so
 * they know where it is. Never the estimate, never the other bidders, never
 * what anybody else said. A bid request that leaked the competition would be
 * worse than no bid request.
 */

export const GENERIC_GONE = "This bid request is no longer available.";

export interface BidResolution {
  ok: boolean;
  invitation?: JobBidInvitation;
  pkg?: JobBidPackage;
  tenantId?: string;
  tenantName?: string;
  /** What the subcontractor is told about where the work is. */
  jobLabel?: string;
  /** Whether they may still answer, as against merely look. */
  acceptsReply?: boolean;
}

export async function resolveBidInvitation(
  rawToken: string,
  ipHash: string,
): Promise<BidResolution> {
  // Fail closed: with no secret there is no keying, so nothing can be trusted.
  if (!isShareSecretConfigured()) {
    console.error("SHARE_SECRET is not set — bid links disabled");
    return { ok: false };
  }

  /** A miss is recorded on both paths, so neither is measurably faster. */
  if (!looksLikeToken(rawToken)) {
    await recordAttempt("bid_probe", ipHash);
    return { ok: false };
  }

  const found = await withSystem(async (tx) => {
    const invitation = await tx.query.jobBidInvitations.findFirst({
      where: eq(schema.jobBidInvitations.tokenHash, hashToken(rawToken)),
    });
    if (!invitation) return null;
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, invitation.tenantId),
    });
    if (!tenant) return null;
    return { invitation, tenantName: tenant.name, tenantStatus: tenant.status };
  });

  if (!found) {
    await recordAttempt("bid_probe", ipHash);
    return { ok: false };
  }

  const { invitation, tenantName, tenantStatus } = found;
  if (tenantStatus === "churned") return { ok: false };
  // A business that switched the pack off is not collecting bids.
  if (!(await isModuleEnabled(invitation.tenantId, PACK))) return { ok: false };

  const now = new Date();
  const facts = {
    amountCents: invitation.amountCents,
    declined: invitation.declined,
    revokedAt: invitation.revokedAt,
    expiresAt: invitation.expiresAt,
    viewCount: invitation.viewCount,
  };
  /**
   * A REPLY ALREADY GIVEN STILL OPENS THE DOOR. A subcontractor who sent a
   * number and comes back to check what they sent should see it, not a wall
   * — and `invitationAcceptsReply` is what stops them sending a second.
   */
  if (!invitationOpens(facts, now)) return { ok: false };

  // Everything from here reads as the tenant, at the least privileged role.
  const loaded = await withTenant(
    invitation.tenantId,
    async (tx) => {
      const pkg = await tx.query.jobBidPackages.findFirst({
        where: and(
          eq(schema.jobBidPackages.tenantId, invitation.tenantId),
          eq(schema.jobBidPackages.id, invitation.packageId),
        ),
      });
      if (!pkg) return null;
      const project = await tx.query.jobProjects.findFirst({
        where: and(
          eq(schema.jobProjects.tenantId, invitation.tenantId),
          eq(schema.jobProjects.id, pkg.projectId),
        ),
        columns: { number: true, name: true, address: true },
      });
      return { pkg, project };
    },
    { role: "staff" },
  );
  // The package was deleted under the link, or RLS pruned it. Gone.
  if (!loaded) return { ok: false };
  // A closed request is not collecting numbers.
  if (loaded.pkg.status !== "open") return { ok: false };

  const jobLabel = loaded.project
    ? [loaded.project.number, loaded.project.address || loaded.project.name]
        .filter(Boolean)
        .join(" · ")
    : "";

  return {
    ok: true,
    invitation,
    pkg: loaded.pkg,
    tenantId: invitation.tenantId,
    tenantName,
    jobLabel,
    acceptsReply: invitationAcceptsReply(facts, now),
  };
}
