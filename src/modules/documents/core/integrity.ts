import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DocumentVisibility } from "@/db/schema";
import {
  buildFolderPath,
  computeEffectiveVisibility,
  depthFromPath,
} from "./tree";

/**
 * Drift detector for the two denormalized columns the module depends on:
 * `path`/`depth` (derived from the parent chain) and `effective_visibility`
 * (derived from declared visibility rolled downward).
 *
 * Denormalization is what makes visibility enforceable inside an RLS policy
 * and subtree queries cheap. The cost is that a bug could leave a stale value,
 * and a stale effective_visibility is not a cosmetic bug — it is a file
 * visible to someone who should not see it. So the invariant gets an explicit
 * checker, asserted after every mutation in the tests, rather than being
 * assumed. Mirrors accounting/core/integrity.ts.
 *
 * Must run with owner visibility, or RLS hides exactly the rows most worth
 * checking.
 */
export async function verifyDocumentInvariants(
  tx: Tx,
  tenantId: string,
): Promise<string[]> {
  const problems: string[] = [];

  const folders = await tx
    .select()
    .from(schema.documentFolders)
    .where(eq(schema.documentFolders.tenantId, tenantId));
  const byId = new Map(folders.map((f) => [f.id, f]));

  for (const folder of folders) {
    const parent = folder.parentId ? byId.get(folder.parentId) : null;
    if (folder.parentId && !parent) {
      problems.push(`folder ${folder.id}: parent ${folder.parentId} missing`);
      continue;
    }
    const expectedPath = buildFolderPath(parent?.path ?? null, folder.id);
    if (folder.path !== expectedPath) {
      problems.push(
        `folder ${folder.id}: path ${folder.path} should be ${expectedPath}`,
      );
    }
    if (folder.depth !== depthFromPath(folder.path)) {
      problems.push(
        `folder ${folder.id}: depth ${folder.depth} disagrees with path`,
      );
    }
  }

  const computed = computeEffectiveVisibility(
    folders.map((f) => ({
      id: f.id,
      parentId: f.parentId,
      visibility: f.visibility as DocumentVisibility,
    })),
  );
  for (const folder of folders) {
    const expected = computed.get(folder.id) ?? "members";
    if (folder.effectiveVisibility !== expected) {
      problems.push(
        `folder ${folder.id}: effective_visibility ${folder.effectiveVisibility} should be ${expected}`,
      );
    }
  }

  const documents = await tx
    .select({
      id: schema.documents.id,
      folderId: schema.documents.folderId,
      effectiveVisibility: schema.documents.effectiveVisibility,
      filedAt: schema.documents.filedAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.tenantId, tenantId));

  for (const doc of documents) {
    const expected = doc.folderId
      ? (byId.get(doc.folderId)?.effectiveVisibility ?? "members")
      : "members";
    if (doc.effectiveVisibility !== expected) {
      problems.push(
        `document ${doc.id}: effective_visibility ${doc.effectiveVisibility} should be ${expected}`,
      );
    }
    if (doc.folderId === null && doc.filedAt !== null) {
      problems.push(`document ${doc.id}: filed_at set without a folder`);
    }
  }

  return problems;
}
