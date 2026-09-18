import "server-only";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import type { JobEstimateShare } from "@/db/schema";
import { isModuleEnabled } from "@/lib/modules";
import { recordAttempt } from "@/lib/public-limits";
import { hashToken, isShareSecretConfigured, looksLikeToken } from "@/lib/public-token";
import { todayInTimezone } from "@/lib/timezone";
import { shareOpens, shareStanding, type ShareStanding } from "./estimate-share-status";
import { loadProposalDocument, type LoadedProposal } from "./proposal";
import { PACK } from "./vocabulary";

/**
 * TURNING AN ANONYMOUS TOKEN INTO A TENANT-SCOPED READ (E5c, ADR 0085).
 *
 * The most dangerous function in the pack, in its own file so it can be read
 * in one sitting. The trust model is the inbound-email webhook's and the
 * document share's, verbatim:
 *
 *   **`withSystem` does the token -> tenant hop and NOTHING else.**
 *
 * It never accepts a caller-supplied tenant id, estimate id or project id —
 * the only input is 43 characters of base64url — and every read after it runs
 * under `withTenant`, where the pack's own RLS policy governs it. Widening
 * that one lookup is the single most dangerous refactor in this feature.
 *
 * The tenant context runs at role **staff**, the least privileged value, for
 * the same reason the document share does: a visitor is not an owner, and
 * nothing a proposal shows needs to be.
 *
 * **EVERY FAILURE LOOKS THE SAME.** Unknown, revoked, expired, already
 * accepted, estimate revised since signing, jobs switched off, tenant gone —
 * one answer, so a visitor cannot use the page to learn that a token was
 * nearly right, or that a business exists, or that a proposal was withdrawn.
 * The BUILDER is told which it is, on their own screen, where they are
 * authenticated.
 */

/** Every failure answers with this. No status is ever distinguishable. */
export const GENERIC_GONE = "This proposal is no longer available.";

export type ShareResolution =
  | { ok: false }
  | {
      ok: true;
      share: JobEstimateShare;
      standing: ShareStanding;
      tenantId: string;
      tenantName: string;
      loaded: LoadedProposal;
    };

export async function resolveProposalShare(
  rawToken: string,
  ipHash: string,
): Promise<ShareResolution> {
  // Fail closed: with no secret there is no keying, so nothing can be trusted.
  if (!isShareSecretConfigured()) {
    console.error("SHARE_SECRET is not set — proposal links disabled");
    return { ok: false };
  }

  /**
   * A miss is recorded on BOTH paths, malformed and well-formed, so the
   * dominant cost of the two is the same write and neither is measurably
   * faster. There is no passcode here, so no scrypt decoy is needed — the
   * document share's `decoyPasscodeWork` exists to hide a KDF this has not
   * got.
   */
  if (!looksLikeToken(rawToken)) {
    await recordAttempt("proposal_probe", ipHash);
    return { ok: false };
  }

  const found = await withSystem(async (tx) => {
    const share = await tx.query.jobEstimateShares.findFirst({
      where: eq(schema.jobEstimateShares.tokenHash, hashToken(rawToken)),
    });
    if (!share) return null;
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, share.tenantId),
    });
    if (!tenant) return null;
    return {
      share,
      tenantName: tenant.name,
      tenantStatus: tenant.status,
      timeZone: tenant.timezone,
    };
  });

  if (!found) {
    await recordAttempt("proposal_probe", ipHash);
    return { ok: false };
  }

  const { share, tenantName, tenantStatus, timeZone } = found;
  if (tenantStatus === "churned") return { ok: false };
  // A business that switched the pack off is not serving its proposals.
  if (!(await isModuleEnabled(share.tenantId, PACK))) return { ok: false };

  // Everything from here reads as the tenant, at the least privileged role.
  const loaded = await withTenant(
    share.tenantId,
    (tx) =>
      loadProposalDocument(
        tx,
        share.tenantId,
        share.estimateId,
        timeZone,
        todayInTimezone(timeZone),
      ),
    { role: "staff" },
  );
  // The estimate was deleted under the link, or RLS pruned it. Gone.
  if (!loaded) return { ok: false };

  const standing = shareStanding(
    {
      revokedAt: share.revokedAt,
      expiresAt: share.expiresAt,
      signedAt: share.signedAt,
      signedEstimateVersion: share.signedEstimateVersion,
      estimateVersion: loaded.data.row.estimate.version,
    },
    new Date(),
  );
  if (!shareOpens(standing)) return { ok: false };

  return { ok: true, share, standing, tenantId: share.tenantId, tenantName, loaded };
}
