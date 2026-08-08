import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "@/db";
import {
  createFolder,
  deleteFolder,
  moveFolder,
  renameFolder,
  setFolderVisibility,
} from "@/modules/documents/folder-ops";
import { verifyDocumentInvariants } from "@/modules/documents/core/integrity";
import { STAMP_OPS, d } from "./_shared";

d("folder operations", () => {
  let tenantId: string;
  const ctx = { tenantId: "", userId: "user-ops", role: "owner" as const };

  async function asOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(tenantId, fn, { role: "owner" });
  }

  async function mkFolder(
    parentId: string | null,
    name: string,
    visibility: "members" | "owners" = "members",
  ) {
    return asOwner((tx) => createFolder(tx, ctx, { parentId, name, visibility }));
  }

  async function expectClean() {
    const problems = await asOwner((tx) =>
      verifyDocumentInvariants(tx, tenantId),
    );
    expect(problems).toEqual([]);
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: STAMP_OPS,
          name: "DMS Ops",
          slug: STAMP_OPS,
        })
        .returning();
      return row.id;
    });
    ctx.tenantId = tenantId;
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("creates roots and children, and rejects duplicate names case-insensitively", async () => {
    const jobs = await mkFolder(null, "Jobs");
    expect(jobs.depth).toBe(1);
    expect(jobs.path).toMatch(/^\/[0-9a-f]{32}\/$/);

    const child = await mkFolder(jobs.id, "2026");
    expect(child.depth).toBe(2);
    expect(child.path.startsWith(jobs.path)).toBe(true);

    await expect(mkFolder(null, "  jobs  ")).rejects.toMatchObject({
      code: "FOLDER_NAME_TAKEN",
    });
    // The same name under a DIFFERENT parent is fine.
    const other = await mkFolder(null, "Archive");
    await expect(mkFolder(other.id, "2026")).resolves.toBeTruthy();
    await expectClean();
  });

  it("refuses an eleventh level", async () => {
    let parentId: string | null = null;
    for (let i = 1; i <= 10; i += 1) {
      const folder: { id: string } = await mkFolder(parentId, `Deep ${i}`);
      parentId = folder.id;
    }
    await expect(mkFolder(parentId, "Deep 11")).rejects.toMatchObject({
      code: "FOLDER_DEPTH",
    });
  });

  it("refuses a move into the folder's own subtree", async () => {
    const root = await mkFolder(null, "Move Root");
    const mid = await mkFolder(root.id, "Move Mid");
    const leaf = await mkFolder(mid.id, "Move Leaf");

    for (const target of [root.id, mid.id, leaf.id]) {
      await expect(
        asOwner((tx) =>
          moveFolder(tx, ctx, {
            folderId: root.id,
            newParentId: target,
            expectedVersion: root.version,
          }),
        ),
      ).rejects.toMatchObject({ code: "FOLDER_CYCLE" });
    }
  });

  it("rewrites path AND depth across a moved subtree", async () => {
    const from = await mkFolder(null, "From");
    const to = await mkFolder(null, "To");
    const mid = await mkFolder(from.id, "Mid");
    const leaf = await mkFolder(mid.id, "Leaf");

    await asOwner((tx) =>
      moveFolder(tx, ctx, {
        folderId: mid.id,
        newParentId: to.id,
        expectedVersion: mid.version,
      }),
    );

    const rows = await asOwner((tx) =>
      tx
        .select()
        .from(schema.documentFolders)
        .where(eq(schema.documentFolders.tenantId, tenantId)),
    );
    const movedMid = rows.find((r) => r.id === mid.id)!;
    const movedLeaf = rows.find((r) => r.id === leaf.id)!;
    expect(movedMid.parentId).toBe(to.id);
    expect(movedMid.path.startsWith(to.path)).toBe(true);
    expect(movedLeaf.path.startsWith(movedMid.path)).toBe(true);
    expect(movedMid.depth).toBe(2);
    expect(movedLeaf.depth).toBe(3);
    await expectClean();
  });

  it("cascades owners-only down to descendants and their documents", async () => {
    const root = await mkFolder(null, "Vis Root");
    const mid = await mkFolder(root.id, "Vis Mid");
    const docId = await asOwner(async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          folderId: mid.id,
          filedAt: new Date(),
          fileName: "plan.pdf",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/vis-plan.pdf`,
        })
        .returning();
      return doc.id;
    });

    await asOwner((tx) =>
      setFolderVisibility(tx, ctx, {
        folderId: root.id,
        visibility: "owners",
        expectedVersion: root.version,
      }),
    );

    const afterLock = await asOwner(async (tx) => ({
      mid: await tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, mid.id),
      }),
      doc: await tx.query.documents.findFirst({
        where: eq(schema.documents.id, docId),
      }),
    }));
    expect(afterLock.mid?.effectiveVisibility).toBe("owners");
    expect(afterLock.doc?.effectiveVisibility).toBe("owners");
    await expectClean();

    // And the document really is gone for staff.
    const asStaff = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, docId)),
    );
    expect(asStaff).toHaveLength(0);
  });

  // The case a subtree UPDATE gets wrong in one direction.
  it("re-opening a parent leaves a self-declared owners descendant closed", async () => {
    const root = await mkFolder(null, "Reopen Root", "owners");
    const mid = await mkFolder(root.id, "Reopen Mid");
    const payroll = await mkFolder(mid.id, "Reopen Payroll", "owners");

    const fresh = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, root.id),
      }),
    );
    await asOwner((tx) =>
      setFolderVisibility(tx, ctx, {
        folderId: root.id,
        visibility: "members",
        expectedVersion: fresh!.version,
      }),
    );

    const rows = await asOwner((tx) =>
      tx
        .select()
        .from(schema.documentFolders)
        .where(eq(schema.documentFolders.tenantId, tenantId)),
    );
    expect(rows.find((r) => r.id === root.id)!.effectiveVisibility).toBe("members");
    expect(rows.find((r) => r.id === mid.id)!.effectiveVisibility).toBe("members");
    expect(rows.find((r) => r.id === payroll.id)!.effectiveVisibility).toBe("owners");
    await expectClean();
  });

  it("refuses to delete a non-empty folder, and relocates on request", async () => {
    const parent = await mkFolder(null, "Del Parent");
    const target = await mkFolder(parent.id, "Del Target");
    const child = await mkFolder(target.id, "Del Child");
    const docId = await asOwner(async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          folderId: target.id,
          filedAt: new Date(),
          fileName: "spec.pdf",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/del-spec.pdf`,
        })
        .returning();
      return doc.id;
    });

    await expect(
      asOwner((tx) =>
        deleteFolder(tx, ctx, {
          folderId: target.id,
          expectedVersion: target.version,
          strategy: "refuse",
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLDER_NOT_EMPTY" });

    const fresh = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, target.id),
      }),
    );
    const result = await asOwner((tx) =>
      deleteFolder(tx, ctx, {
        folderId: target.id,
        expectedVersion: fresh!.version,
        strategy: "move_to_parent",
      }),
    );
    expect(result.movedFolders).toBe(1);
    expect(result.movedDocuments).toBe(1);

    const after = await asOwner(async (tx) => ({
      gone: await tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, target.id),
      }),
      child: await tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, child.id),
      }),
      doc: await tx.query.documents.findFirst({
        where: eq(schema.documents.id, docId),
      }),
    }));
    expect(after.gone).toBeUndefined();
    expect(after.child?.parentId).toBe(parent.id);
    expect(after.doc?.folderId).toBe(parent.id);
    await expectClean();
  });

  it("refuses a stale version", async () => {
    const folder = await mkFolder(null, "Stale");
    await expect(
      asOwner((tx) =>
        renameFolder(tx, ctx, {
          folderId: folder.id,
          name: "Stale Renamed",
          expectedVersion: folder.version + 5,
        }),
      ),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("staff may create a folder but never a restricted one, and never move", async () => {
    const staffCtx = { tenantId, userId: "user-staff", role: "staff" as const };
    const created = await withTenant(
      tenantId,
      (tx) =>
        createFolder(tx, staffCtx, {
          parentId: null,
          name: "Staff Made",
          visibility: "members",
        }),
      { role: "staff" },
    );
    expect(created.effectiveVisibility).toBe("members");

    await expect(
      withTenant(
        tenantId,
        (tx) =>
          createFolder(tx, staffCtx, {
            parentId: null,
            name: "Staff Secret",
            visibility: "owners",
          }),
        { role: "staff" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      withTenant(
        tenantId,
        (tx) =>
          moveFolder(tx, staffCtx, {
            folderId: created.id,
            newParentId: null,
            expectedVersion: created.version,
          }),
        { role: "staff" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
