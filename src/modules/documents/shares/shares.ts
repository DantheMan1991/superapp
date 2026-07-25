import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DocumentShare, DocumentVisibility } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { hashPasscode, hashToken, mintToken } from "@/lib/public-token";
import { DocsError } from "../core/errors";
import type { DocsCtx } from "../folder-ops";
import { ACTIVE_SHARES_PER_TENANT } from "./limits";

/**
 * Tenant-side share management. Public-side resolution lives in resolve.ts.
 */

export interface CreateShareInput {
  scope: "document" | "folder";
  targetId: string;
  label: string;
  canDownload: boolean;
  expiresInDays: number;
  passcode?: string;
  maxUses?: number;
}

export interface CreatedShare {
  share: DocumentShare;
  /** The only moment the raw token exists in memory. Returned once. */
  token: string;
}

/**
 * Create a link.
 *
 * The v1 restriction that shapes everything: a share root must be visible to
 * ALL members. Sharing a folder someone deliberately hid from their own staff
 * with an anonymous stranger is a contradiction, and refusing it lets the
 * public route run at the least privileged role, so RLS prunes restricted
 * content instead of app code being the only thing that does.
 */
export async function createShare(
  tx: Tx,
  ctx: DocsCtx,
  input: CreateShareInput,
): Promise<CreatedShare> {
  // Sharing is data egress — unambiguously a write, so the read-only
  // accountant role can never do it.
  if (ctx.role === "expert") {
    throw new DocsError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }

  const settings = await tx.query.documentSettings.findFirst({
    where: eq(schema.documentSettings.tenantId, ctx.tenantId),
  });
  if (!settings) throw new DocsError("SETTINGS_MISSING", "not provisioned");
  if (!settings.sharingEnabled) {
    throw new DocsError("SHARING_DISABLED", "sharing is off for this tenant");
  }
  if (input.expiresInDays > settings.shareMaxTtlDays) {
    throw new DocsError("SHARE_TTL_TOO_LONG", "beyond the tenant's ceiling");
  }

  const [{ n: activeCount }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.documentShares)
    .where(
      and(
        eq(schema.documentShares.tenantId, ctx.tenantId),
        isNull(schema.documentShares.revokedAt),
      ),
    );
  if (activeCount >= ACTIVE_SHARES_PER_TENANT) {
    throw new DocsError("SHARE_LIMIT", "too many active links");
  }

  const rootVisibility = await loadRootVisibility(
    tx,
    ctx.tenantId,
    input.scope,
    input.targetId,
  );
  if (rootVisibility === "owners") {
    throw new DocsError(
      "SHARE_ROOT_RESTRICTED",
      "owners-only content cannot be shared externally",
    );
  }

  const token = mintToken();
  const expiresAt = new Date(
    Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
  );

  const [share] = await tx
    .insert(schema.documentShares)
    .values({
      tenantId: ctx.tenantId,
      documentId: input.scope === "document" ? input.targetId : null,
      folderId: input.scope === "folder" ? input.targetId : null,
      tokenHash: hashToken(token),
      tokenCiphertext: encryptSecret(token),
      label: input.label,
      canDownload: input.canDownload,
      passcodeHash: input.passcode ? hashPasscode(input.passcode) : null,
      expiresAt,
      maxUses: input.maxUses ?? null,
      createdRootVisibility: rootVisibility,
      createdByClerkUserId: ctx.userId,
    })
    .returning();

  return { share, token };
}

/** Throws NOT_FOUND when RLS hid the target — the non-leaking answer. */
async function loadRootVisibility(
  tx: Tx,
  tenantId: string,
  scope: "document" | "folder",
  targetId: string,
): Promise<DocumentVisibility> {
  if (scope === "document") {
    const doc = await tx.query.documents.findFirst({
      where: and(
        eq(schema.documents.tenantId, tenantId),
        eq(schema.documents.id, targetId),
      ),
    });
    if (!doc) throw new DocsError("DOCUMENT_NOT_FOUND", "not visible");
    if (doc.status === "trashed") {
      throw new DocsError("DOCUMENT_TRASHED", "cannot share a trashed file");
    }
    return doc.effectiveVisibility as DocumentVisibility;
  }
  const folder = await tx.query.documentFolders.findFirst({
    where: and(
      eq(schema.documentFolders.tenantId, tenantId),
      eq(schema.documentFolders.id, targetId),
    ),
  });
  if (!folder) throw new DocsError("FOLDER_NOT_FOUND", "not visible");
  return folder.effectiveVisibility as DocumentVisibility;
}

export async function revokeShare(
  tx: Tx,
  ctx: DocsCtx,
  input: { shareId: string; expectedVersion: number },
): Promise<void> {
  const share = await loadShare(tx, ctx.tenantId, input.shareId);
  // A link belongs to the tenant, not to its author, but letting any staff
  // member revoke anyone's link is fine — revocation only ever removes access.
  if (share.version !== input.expectedVersion) {
    throw new DocsError("STALE_VERSION", "share changed");
  }
  await tx
    .update(schema.documentShares)
    .set({
      revokedAt: new Date(),
      revokedByClerkUserId: ctx.userId,
      version: share.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documentShares.tenantId, ctx.tenantId),
        eq(schema.documentShares.id, input.shareId),
      ),
    );
}

/** Clears a lock after too many wrong passcodes. Owner-only. */
export async function resetShareLock(
  tx: Tx,
  ctx: DocsCtx,
  input: { shareId: string },
): Promise<void> {
  if (ctx.role !== "owner") throw new DocsError("FORBIDDEN", "owner required");
  await tx
    .update(schema.documentShares)
    .set({ failedUnlockCount: 0, updatedAt: new Date() })
    .where(
      and(
        eq(schema.documentShares.tenantId, ctx.tenantId),
        eq(schema.documentShares.id, input.shareId),
      ),
    );
}

export async function loadShare(
  tx: Tx,
  tenantId: string,
  shareId: string,
): Promise<DocumentShare> {
  const share = await tx.query.documentShares.findFirst({
    where: and(
      eq(schema.documentShares.tenantId, tenantId),
      eq(schema.documentShares.id, shareId),
    ),
  });
  if (!share) throw new DocsError("SHARE_NOT_FOUND", "share not visible");
  return share;
}

export async function listShares(tx: Tx, tenantId: string, limit = 200) {
  return tx
    .select()
    .from(schema.documentShares)
    .where(eq(schema.documentShares.tenantId, tenantId))
    .orderBy(desc(schema.documentShares.createdAt))
    .limit(limit);
}

export async function listShareEvents(
  tx: Tx,
  tenantId: string,
  shareId: string,
  limit = 100,
) {
  return tx
    .select()
    .from(schema.documentShareEvents)
    .where(
      and(
        eq(schema.documentShareEvents.tenantId, tenantId),
        eq(schema.documentShareEvents.shareId, shareId),
      ),
    )
    .orderBy(desc(schema.documentShareEvents.createdAt))
    .limit(limit);
}
