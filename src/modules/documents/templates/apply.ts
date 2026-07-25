import "server-only";
import { randomUUID } from "node:crypto";
import { schema, type Tx } from "@/db";
import { buildFolderPath, folderNameKey } from "../core/tree";
import { DEFAULT_FOLDERS } from "./defaults";

/**
 * Provision Documents for a tenant: a settings row plus the default folders.
 * Fully idempotent — re-running creates nothing and never renames or reopens a
 * folder the tenant has since changed.
 *
 * Runs inside a withSystem transaction, which diverges from provisionAccounting
 * on purpose: `document_settings` carries a member_read-only policy (the share
 * TTL ceiling and AI budget are platform-governed knobs, not tenant data), so a
 * tenant-context insert would be denied by design. Folders are member-writable
 * and simply ride along in the same transaction, which is what makes
 * "enabled but unprovisioned" unrepresentable.
 *
 * Ids are generated here rather than by the database because a folder's `path`
 * contains its own id — knowing it up front turns provisioning into one insert
 * per folder instead of an insert followed by an update.
 */
export async function provisionDocuments(
  tx: Tx,
  tenantId: string,
): Promise<{ foldersCreated: number }> {
  await tx
    .insert(schema.documentSettings)
    .values({ tenantId })
    .onConflictDoNothing();

  let created = 0;
  for (const folder of DEFAULT_FOLDERS) {
    const id = randomUUID();
    const rows = await tx
      .insert(schema.documentFolders)
      .values({
        id,
        tenantId,
        parentId: null,
        name: folder.name,
        nameKey: folderNameKey(folder.name),
        path: buildFolderPath(null, id),
        depth: 1,
        visibility: "members",
        effectiveVisibility: "members",
        sortOrder: folder.sortOrder,
        // Null = provisioned by the platform, not by a person. Same honesty as
        // documents.uploaded_by_clerk_user_id for email-ingested files.
        createdByClerkUserId: null,
      })
      // Bare form is safe here: a fresh uuid cannot collide on (tenant_id, id),
      // so the only reachable conflict is the root-name unique — exactly the
      // re-run case we want to skip.
      .onConflictDoNothing()
      .returning({ id: schema.documentFolders.id });
    if (rows.length > 0) created += 1;
  }

  return { foldersCreated: created };
}
