import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import type { DocumentShare, DocumentVisibility } from "@/db/schema";
import { isModuleEnabled } from "@/lib/modules";
import {
  decoyPasscodeWork,
  hashToken,
  isShareSecretConfigured,
  looksLikeToken,
} from "@/lib/public-token";
import { recordAttempt } from "./limits";
import { resolveShareStatus } from "./status";

/**
 * Turning an anonymous token into a tenant-scoped read.
 *
 * The trust model is the inbound-email webhook's, verbatim: `withSystem` does
 * the token -> tenant hop and NOTHING else. It never accepts a caller-supplied
 * tenant, document or folder id, and every read after it runs under
 * `withTenant`. Widening that one lookup is the single most dangerous refactor
 * in this feature.
 *
 * The tenant context runs at role "staff", not "owner", because of a
 * deliberate v1 restriction: a share can only be rooted at something visible
 * to all members (enforced when the link is created). That means RLS itself
 * prunes owners-only content out of every share, and the pure scope function
 * is a second layer rather than the only one. The cost is that an owners-only
 * folder cannot be shared externally at all — which, for a folder someone
 * deliberately hid from their own staff, is the right default.
 */

/** Every failure answers with this. No status is ever distinguishable. */
export const GENERIC_GONE = "This link is no longer available.";

export type ShareResolution =
  | { ok: false }
  | {
      ok: true;
      share: DocumentShare;
      tenantId: string;
      tenantName: string;
      rootVisibility: DocumentVisibility;
    };

/**
 * Resolve and gate a token. Returns `{ ok: false }` for every failure —
 * unknown, revoked, expired, exhausted, locked, suspended, module switched
 * off, tenant gone. The caller cannot tell them apart, and neither can a
 * visitor.
 */
export async function resolveShare(
  rawToken: string,
  ipHash: string,
): Promise<ShareResolution> {
  // Fail closed: with no secret there is no keying, so nothing can be trusted.
  if (!isShareSecretConfigured()) {
    console.error("SHARE_SECRET is not set — share links disabled");
    return { ok: false };
  }

  if (!looksLikeToken(rawToken)) {
    // Spend the same work a real check would, so a malformed token is not
    // measurably faster than a well-formed miss.
    decoyPasscodeWork();
    await recordAttempt("share_probe", ipHash);
    return { ok: false };
  }

  const found = await withSystem(async (tx) => {
    const share = await tx.query.documentShares.findFirst({
      where: eq(schema.documentShares.tokenHash, hashToken(rawToken)),
    });
    if (!share) return null;
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, share.tenantId),
    });
    if (!tenant) return null;
    return { share, tenantName: tenant.name, tenantStatus: tenant.status };
  });

  if (!found) {
    decoyPasscodeWork();
    await recordAttempt("share_probe", ipHash);
    return { ok: false };
  }

  const { share, tenantName, tenantStatus } = found;
  if (tenantStatus === "churned") return { ok: false };
  if (!(await isModuleEnabled(share.tenantId, "documents"))) {
    return { ok: false };
  }

  // Everything from here reads as the tenant, at the least privileged role.
  const rootVisibility = await withTenant(share.tenantId, (tx) =>
    currentRootVisibility(tx, share),
  );

  const status = resolveShareStatus({
    revokedAt: share.revokedAt,
    expiresAt: share.expiresAt,
    maxUses: share.maxUses,
    useCount: share.useCount,
    failedUnlockCount: share.failedUnlockCount,
    createdRootVisibility: share.createdRootVisibility,
    currentRootVisibility: rootVisibility,
  });
  if (status !== "active") return { ok: false };

  return {
    ok: true,
    share,
    tenantId: share.tenantId,
    tenantName,
    rootVisibility: rootVisibility ?? "members",
  };
}

/**
 * The root's visibility right now, or null if it is gone. Read at role staff,
 * so a root that has since become owners-only reads as MISSING — which
 * resolveShareStatus turns into "revoked" rather than leaving the link live.
 * A trashed shared document counts as gone for the same reason.
 */
async function currentRootVisibility(
  tx: Tx,
  share: DocumentShare,
): Promise<DocumentVisibility | null> {
  if (share.documentId) {
    const doc = await tx.query.documents.findFirst({
      where: and(
        eq(schema.documents.tenantId, share.tenantId),
        eq(schema.documents.id, share.documentId),
      ),
    });
    if (!doc || doc.status === "trashed") return null;
    return doc.effectiveVisibility as DocumentVisibility;
  }
  const folder = await tx.query.documentFolders.findFirst({
    where: and(
      eq(schema.documentFolders.tenantId, share.tenantId),
      eq(schema.documentFolders.id, share.folderId ?? ""),
    ),
  });
  if (!folder) return null;
  return folder.effectiveVisibility as DocumentVisibility;
}

/**
 * Count a view and stamp last-accessed, in one statement so concurrent opens
 * serialize on the row rather than over-granting.
 *
 * `max_uses` therefore counts VIEWS, not devices — a reload is a view. That is
 * a deliberate simplification: the alternative needs a cookie minted during
 * render, which React Server Components cannot do, and "limit to N views" is
 * an honest thing to put on a label.
 */
export async function countShareView(
  tenantId: string,
  shareId: string,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(schema.documentShares)
      .set({
        useCount: sql`${schema.documentShares.useCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(
        and(
          eq(schema.documentShares.tenantId, tenantId),
          eq(schema.documentShares.id, shareId),
        ),
      ),
  );
}

/** Bump the failed-passcode counter; ten of them lock the link. */
export async function countFailedUnlock(
  tenantId: string,
  shareId: string,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(schema.documentShares)
      .set({
        failedUnlockCount: sql`${schema.documentShares.failedUnlockCount} + 1`,
      })
      .where(
        and(
          eq(schema.documentShares.tenantId, tenantId),
          eq(schema.documentShares.id, shareId),
        ),
      ),
  );
}
