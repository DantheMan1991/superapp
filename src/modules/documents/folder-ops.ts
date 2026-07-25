import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DocumentFolder, DocumentVisibility } from "@/db/schema";
import { DocsError } from "./core/errors";
import {
  buildFolderPath,
  computeEffectiveVisibility,
  folderNameKey,
  normalizeFolderName,
  rewritePath,
  wouldCreateCycle,
  FOLDER_MAX_DEPTH,
} from "./core/tree";

/**
 * Folder mutations. Every function here runs inside a withTenant transaction.
 *
 * A rule that shapes the whole file: STRUCTURAL operations — move, delete,
 * change visibility — are owner-only, and not merely as a permission taste.
 * They rewrite a subtree, and a staff member cannot see owners-only folders,
 * so a staff-run rewrite would silently skip the rows RLS hid from it and
 * leave their paths pointing at a parent that moved. Owner-only means the
 * recompute always sees the whole tree it is responsible for. Creating and
 * renaming touch one visible row and stay open to staff.
 */

export interface DocsCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

async function loadFolder(
  tx: Tx,
  tenantId: string,
  folderId: string,
): Promise<DocumentFolder> {
  const folder = await tx.query.documentFolders.findFirst({
    where: and(
      eq(schema.documentFolders.tenantId, tenantId),
      eq(schema.documentFolders.id, folderId),
    ),
  });
  // RLS may have hidden it (owners-only, staff caller). "Restricted" and
  // "gone" are indistinguishable here by design — and NOT_FOUND is the only
  // non-leaking answer.
  if (!folder) throw new DocsError("FOLDER_NOT_FOUND", "folder not visible");
  return folder;
}

/** Coarse lock over the tenant's folders, in a deterministic order. */
async function lockTree(tx: Tx, tenantId: string): Promise<void> {
  // Two concurrent moves can weave a cycle past any per-move check. Trees are
  // tiny and moves are rare, so serializing them is cheap insurance; ordering
  // by id makes deadlock impossible.
  await tx.execute(
    sql`select id from document_folders where tenant_id = ${tenantId} order by id for update`,
  );
}

/**
 * Recompute effective visibility for the whole tenant and push it down onto
 * documents. Cheap (one read, two writes) and always correct, which beats
 * trying to work out the minimal delta for a subtree.
 */
export async function recomputeVisibility(
  tx: Tx,
  tenantId: string,
): Promise<{ foldersUpdated: number; documentsUpdated: number }> {
  const folders = await tx
    .select({
      id: schema.documentFolders.id,
      parentId: schema.documentFolders.parentId,
      visibility: schema.documentFolders.visibility,
      effectiveVisibility: schema.documentFolders.effectiveVisibility,
    })
    .from(schema.documentFolders)
    .where(eq(schema.documentFolders.tenantId, tenantId));

  const computed = computeEffectiveVisibility(
    folders.map((f) => ({
      id: f.id,
      parentId: f.parentId,
      visibility: f.visibility as DocumentVisibility,
    })),
  );

  let foldersUpdated = 0;
  for (const folder of folders) {
    const next = computed.get(folder.id) ?? "members";
    if (next === folder.effectiveVisibility) continue;
    await tx
      .update(schema.documentFolders)
      .set({
        effectiveVisibility: next,
        version: sql`${schema.documentFolders.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.documentFolders.tenantId, tenantId),
          eq(schema.documentFolders.id, folder.id),
        ),
      );
    foldersUpdated += 1;
  }

  // Documents follow their folder; unfiled documents (the Inbox) are always
  // visible to members, since no folder has claimed them.
  const filed = await tx.execute(sql`
    update documents d
       set effective_visibility = f.effective_visibility,
           updated_at = now()
      from document_folders f
     where d.tenant_id = ${tenantId}
       and f.tenant_id = ${tenantId}
       and d.folder_id = f.id
       and d.effective_visibility <> f.effective_visibility
  `);
  const unfiled = await tx.execute(sql`
    update documents
       set effective_visibility = 'members',
           updated_at = now()
     where tenant_id = ${tenantId}
       and folder_id is null
       and effective_visibility <> 'members'
  `);

  return {
    foldersUpdated,
    documentsUpdated: (filed.rowCount ?? 0) + (unfiled.rowCount ?? 0),
  };
}

export async function createFolder(
  tx: Tx,
  ctx: DocsCtx,
  input: {
    parentId: string | null;
    name: string;
    visibility: DocumentVisibility;
  },
): Promise<DocumentFolder> {
  const name = normalizeFolderName(input.name);
  if (name === null) throw new DocsError("FOLDER_NAME_INVALID", "bad name");
  if (input.visibility === "owners" && ctx.role !== "owner") {
    throw new DocsError("FORBIDDEN", "owner role required");
  }

  const parent =
    input.parentId === null
      ? null
      : await loadFolder(tx, ctx.tenantId, input.parentId);

  const depth = (parent?.depth ?? 0) + 1;
  if (depth > FOLDER_MAX_DEPTH) throw new DocsError("FOLDER_DEPTH", "too deep");

  const effectiveVisibility: DocumentVisibility =
    input.visibility === "owners" || parent?.effectiveVisibility === "owners"
      ? "owners"
      : "members";

  const id = randomUUID();
  const rows = await tx
    .insert(schema.documentFolders)
    .values({
      id,
      tenantId: ctx.tenantId,
      parentId: parent?.id ?? null,
      name,
      nameKey: folderNameKey(name),
      path: buildFolderPath(parent?.path ?? null, id),
      depth,
      visibility: input.visibility,
      effectiveVisibility,
      createdByClerkUserId: ctx.userId,
    })
    // The id is freshly random, so the only reachable conflict is the
    // sibling-name unique — which is exactly the error we want to report.
    .onConflictDoNothing()
    .returning();

  if (rows.length === 0) {
    throw new DocsError("FOLDER_NAME_TAKEN", "duplicate name in parent");
  }
  return rows[0];
}

export async function renameFolder(
  tx: Tx,
  ctx: DocsCtx,
  input: { folderId: string; name: string; expectedVersion: number },
): Promise<DocumentFolder> {
  const name = normalizeFolderName(input.name);
  if (name === null) throw new DocsError("FOLDER_NAME_INVALID", "bad name");

  const folder = await loadFolder(tx, ctx.tenantId, input.folderId);
  if (folder.version !== input.expectedVersion) {
    throw new DocsError("STALE_VERSION", "folder changed");
  }

  const nameKey = folderNameKey(name);
  if (nameKey !== folder.nameKey) {
    await assertNameFree(tx, ctx.tenantId, folder.parentId, nameKey, folder.id);
  }

  const rows = await tx
    .update(schema.documentFolders)
    .set({ name, nameKey, version: folder.version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        eq(schema.documentFolders.id, folder.id),
        eq(schema.documentFolders.version, input.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) throw new DocsError("STALE_VERSION", "folder changed");
  return rows[0];
}

async function assertNameFree(
  tx: Tx,
  tenantId: string,
  parentId: string | null,
  nameKey: string,
  exceptFolderId: string,
): Promise<void> {
  const clash = await tx
    .select({ id: schema.documentFolders.id })
    .from(schema.documentFolders)
    .where(
      and(
        eq(schema.documentFolders.tenantId, tenantId),
        parentId === null
          ? isNull(schema.documentFolders.parentId)
          : eq(schema.documentFolders.parentId, parentId),
        eq(schema.documentFolders.nameKey, nameKey),
        ne(schema.documentFolders.id, exceptFolderId),
      ),
    )
    .limit(1);
  if (clash.length > 0) {
    throw new DocsError("FOLDER_NAME_TAKEN", "duplicate name in parent");
  }
}

/** Owner-only — see the file header for why this cannot be a staff action. */
export async function moveFolder(
  tx: Tx,
  ctx: DocsCtx,
  input: {
    folderId: string;
    newParentId: string | null;
    expectedVersion: number;
  },
): Promise<{ foldersMoved: number }> {
  if (ctx.role !== "owner") throw new DocsError("FORBIDDEN", "owner required");
  await lockTree(tx, ctx.tenantId);

  const folder = await loadFolder(tx, ctx.tenantId, input.folderId);
  if (folder.version !== input.expectedVersion) {
    throw new DocsError("STALE_VERSION", "folder changed");
  }
  const newParent =
    input.newParentId === null
      ? null
      : await loadFolder(tx, ctx.tenantId, input.newParentId);

  if (wouldCreateCycle(folder.path, newParent?.path ?? null)) {
    throw new DocsError("FOLDER_CYCLE", "target is inside the moving subtree");
  }
  if ((newParent?.id ?? null) === folder.parentId) {
    return { foldersMoved: 0 };
  }

  await assertNameFree(
    tx,
    ctx.tenantId,
    newParent?.id ?? null,
    folder.nameKey,
    folder.id,
  );

  // The subtree keeps its shape, so the deepest descendant sets the ceiling.
  const subtree = await tx
    .select({
      id: schema.documentFolders.id,
      path: schema.documentFolders.path,
      depth: schema.documentFolders.depth,
    })
    .from(schema.documentFolders)
    .where(
      and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        sql`${schema.documentFolders.path} like ${`${folder.path}%`}`,
      ),
    );
  const deepest = subtree.reduce((max, f) => Math.max(max, f.depth), 0);
  const newDepth = (newParent?.depth ?? 0) + 1;
  const shift = newDepth - folder.depth;
  if (deepest + shift > FOLDER_MAX_DEPTH) {
    throw new DocsError("FOLDER_DEPTH", "subtree would be too deep");
  }

  const newPath = buildFolderPath(newParent?.path ?? null, folder.id);
  for (const node of subtree) {
    await tx
      .update(schema.documentFolders)
      .set({
        path: rewritePath(node.path, folder.path, newPath),
        depth: node.depth + shift,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.documentFolders.tenantId, ctx.tenantId),
          eq(schema.documentFolders.id, node.id),
        ),
      );
  }

  await tx
    .update(schema.documentFolders)
    .set({
      parentId: newParent?.id ?? null,
      version: folder.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        eq(schema.documentFolders.id, folder.id),
      ),
    );

  await recomputeVisibility(tx, ctx.tenantId);
  return { foldersMoved: subtree.length };
}

/** Owner-only: this is the control that hides payroll from the crew. */
export async function setFolderVisibility(
  tx: Tx,
  ctx: DocsCtx,
  input: {
    folderId: string;
    visibility: DocumentVisibility;
    expectedVersion: number;
  },
): Promise<{ foldersUpdated: number; documentsUpdated: number }> {
  if (ctx.role !== "owner") throw new DocsError("FORBIDDEN", "owner required");

  const folder = await loadFolder(tx, ctx.tenantId, input.folderId);
  if (folder.version !== input.expectedVersion) {
    throw new DocsError("STALE_VERSION", "folder changed");
  }

  // Set the DECLARED value; effective values (this folder's included) are
  // derived by the recompute, which is the only writer of that column.
  await tx
    .update(schema.documentFolders)
    .set({
      visibility: input.visibility,
      // Keep the eff_implies CHECK satisfied at every instant: declaring
      // 'owners' must not leave effective_visibility momentarily 'members'.
      ...(input.visibility === "owners"
        ? { effectiveVisibility: "owners" as const }
        : {}),
      version: folder.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        eq(schema.documentFolders.id, folder.id),
      ),
    );

  return recomputeVisibility(tx, ctx.tenantId);
}

/** Owner-only. Refuses by default; relocating is an explicit choice. */
export async function deleteFolder(
  tx: Tx,
  ctx: DocsCtx,
  input: {
    folderId: string;
    expectedVersion: number;
    strategy: "refuse" | "move_to_parent";
  },
): Promise<{ movedFolders: number; movedDocuments: number }> {
  if (ctx.role !== "owner") throw new DocsError("FORBIDDEN", "owner required");
  await lockTree(tx, ctx.tenantId);

  const folder = await loadFolder(tx, ctx.tenantId, input.folderId);
  if (folder.version !== input.expectedVersion) {
    throw new DocsError("STALE_VERSION", "folder changed");
  }

  const children = await tx
    .select({ id: schema.documentFolders.id })
    .from(schema.documentFolders)
    .where(
      and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        eq(schema.documentFolders.parentId, folder.id),
      ),
    );
  const documents = await tx
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        eq(schema.documents.folderId, folder.id),
      ),
    );

  if (
    input.strategy === "refuse" &&
    (children.length > 0 || documents.length > 0)
  ) {
    throw new DocsError("FOLDER_NOT_EMPTY", "folder still has contents");
  }

  // The composite FKs are NO ACTION on purpose: a forgotten relocation must
  // fail loudly rather than orphan rows. So relocate explicitly, in this same
  // transaction, before the delete.
  for (const child of children) {
    await moveFolderInternal(tx, ctx, child.id, folder.parentId);
  }
  if (documents.length > 0) {
    await tx
      .update(schema.documents)
      .set({
        folderId: folder.parentId,
        filedAt: folder.parentId === null ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.documents.tenantId, ctx.tenantId),
          inArray(
            schema.documents.id,
            documents.map((d) => d.id),
          ),
        ),
      );
  }

  await tx
    .delete(schema.documentFolders)
    .where(
      and(
        eq(schema.documentFolders.tenantId, ctx.tenantId),
        eq(schema.documentFolders.id, folder.id),
      ),
    );

  await recomputeVisibility(tx, ctx.tenantId);
  return { movedFolders: children.length, movedDocuments: documents.length };
}

/** Move without the version check — used when relocating a folder's children. */
async function moveFolderInternal(
  tx: Tx,
  ctx: DocsCtx,
  folderId: string,
  newParentId: string | null,
): Promise<void> {
  const folder = await loadFolder(tx, ctx.tenantId, folderId);
  await moveFolder(tx, ctx, {
    folderId,
    newParentId,
    expectedVersion: folder.version,
  });
}
