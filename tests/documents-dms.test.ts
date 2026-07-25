import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { and } from "drizzle-orm";
import {
  dispositionFor,
  isAllowedUpload,
  sanitizeFileName,
  MAX_FILE_BYTES,
} from "@/modules/documents/allowlist";
import {
  dmsPathPrefix,
  isTenantBlobPath,
  receiptPathPrefix,
} from "@/lib/blob";
import { listDocuments } from "@/modules/accounting/documents/documents";
import { getCloseChecklist } from "@/modules/accounting/core/close";
import {
  maxSearchPage,
  normalizeSearchQuery,
  searchDocuments,
  SEARCH_QUERY_MAX,
} from "@/modules/documents/search";
import {
  buildFolderPath,
  computeEffectiveVisibility,
  depthFromPath,
  folderNameKey,
  folderSegment,
  isDescendantPath,
  normalizeFolderName,
  rewritePath,
  wouldCreateCycle,
  FOLDER_NAME_MAX,
  type FolderNode,
} from "@/modules/documents/core/tree";
import {
  diffTags,
  isValidTagSlug,
  normalizeTags,
  slugifyTag,
  TAGS_PER_DOCUMENT_MAX,
} from "@/modules/documents/core/tags";
import {
  clampPageSize,
  encodeCursor,
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  parseCursor,
  takePage,
} from "@/modules/documents/core/paging";
import { DEFAULT_FOLDERS } from "@/modules/documents/templates/defaults";
import { friendlyMessage, DocsError } from "@/modules/documents/core/errors";

/**
 * Pure tests for the Documents module — no database, so these run everywhere.
 * The visibility cases below are the highest-stakes logic in the module: they
 * decide who can read a file. The DB-backed proof lives in
 * tests/tenant-isolation.test.ts.
 */

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describe("folder paths", () => {
  it("strips dashes into a 32-char segment", () => {
    expect(folderSegment(uuid(1))).toHaveLength(32);
    expect(folderSegment(uuid(1))).not.toContain("-");
  });

  it("builds root and child paths that match the CHECK constraint", () => {
    const pattern = /^(\/[0-9a-f]{32})+\/$/;
    const root = buildFolderPath(null, uuid(1));
    const child = buildFolderPath(root, uuid(2));
    const grandchild = buildFolderPath(child, uuid(3));
    expect(root).toMatch(pattern);
    expect(child).toMatch(pattern);
    expect(grandchild).toMatch(pattern);
    expect(child.startsWith(root)).toBe(true);
  });

  it("derives depth from the path", () => {
    const root = buildFolderPath(null, uuid(1));
    const child = buildFolderPath(root, uuid(2));
    expect(depthFromPath(root)).toBe(1);
    expect(depthFromPath(child)).toBe(2);
    expect(depthFromPath(buildFolderPath(child, uuid(3)))).toBe(3);
  });

  it("treats a folder as not its own descendant", () => {
    const root = buildFolderPath(null, uuid(1));
    const child = buildFolderPath(root, uuid(2));
    expect(isDescendantPath(child, root)).toBe(true);
    expect(isDescendantPath(root, root)).toBe(false);
    expect(isDescendantPath(root, child)).toBe(false);
  });

  it("re-roots a descendant path when its ancestor moves", () => {
    const oldRoot = buildFolderPath(null, uuid(1));
    const newRoot = buildFolderPath(null, uuid(9));
    const child = buildFolderPath(oldRoot, uuid(2));
    const moved = rewritePath(child, oldRoot, newRoot);
    expect(moved).toBe(`${newRoot}${folderSegment(uuid(2))}/`);
    expect(depthFromPath(moved)).toBe(depthFromPath(child));
  });
});

describe("wouldCreateCycle", () => {
  const root = buildFolderPath(null, uuid(1));
  const child = buildFolderPath(root, uuid(2));
  const grandchild = buildFolderPath(child, uuid(3));
  const unrelated = buildFolderPath(null, uuid(7));

  it("rejects moving a folder into itself", () => {
    expect(wouldCreateCycle(root, root)).toBe(true);
  });

  it("rejects moving a folder into its own child or grandchild", () => {
    expect(wouldCreateCycle(root, child)).toBe(true);
    expect(wouldCreateCycle(root, grandchild)).toBe(true);
  });

  it("allows a move to an unrelated folder or to the root", () => {
    expect(wouldCreateCycle(child, unrelated)).toBe(false);
    expect(wouldCreateCycle(child, null)).toBe(false);
  });
});

describe("computeEffectiveVisibility", () => {
  const nodes = (...rows: FolderNode[]) => rows;

  it("inherits owners-only down the whole chain", () => {
    const map = computeEffectiveVisibility(
      nodes(
        { id: "a", parentId: null, visibility: "owners" },
        { id: "b", parentId: "a", visibility: "members" },
        { id: "c", parentId: "b", visibility: "members" },
        { id: "d", parentId: "c", visibility: "members" },
      ),
    );
    expect(map.get("a")).toBe("owners");
    expect(map.get("b")).toBe("owners");
    expect(map.get("c")).toBe("owners");
    expect(map.get("d")).toBe("owners");
  });

  it("leaves siblings alone", () => {
    const map = computeEffectiveVisibility(
      nodes(
        { id: "root", parentId: null, visibility: "members" },
        { id: "hr", parentId: "root", visibility: "owners" },
        { id: "jobs", parentId: "root", visibility: "members" },
      ),
    );
    expect(map.get("hr")).toBe("owners");
    expect(map.get("jobs")).toBe("members");
  });

  // The case a naive `UPDATE ... WHERE path LIKE prefix || '%'` gets wrong.
  it("re-opening a mid-node does NOT re-open a descendant that declares itself owners", () => {
    const map = computeEffectiveVisibility(
      nodes(
        { id: "root", parentId: null, visibility: "members" },
        { id: "mid", parentId: "root", visibility: "members" },
        { id: "payroll", parentId: "mid", visibility: "owners" },
        { id: "under", parentId: "payroll", visibility: "members" },
      ),
    );
    expect(map.get("mid")).toBe("members");
    expect(map.get("payroll")).toBe("owners");
    expect(map.get("under")).toBe("owners");
  });

  it("a child cannot widen a restricted parent", () => {
    const map = computeEffectiveVisibility(
      nodes(
        { id: "a", parentId: null, visibility: "owners" },
        { id: "b", parentId: "a", visibility: "members" },
      ),
    );
    expect(map.get("b")).toBe("owners");
  });

  it("treats a missing parent as a root rather than widening", () => {
    const map = computeEffectiveVisibility(
      nodes({ id: "orphan", parentId: "gone", visibility: "members" }),
    );
    expect(map.get("orphan")).toBe("members");
  });

  it("terminates on a corrupt cycle instead of hanging", () => {
    const map = computeEffectiveVisibility(
      nodes(
        { id: "x", parentId: "y", visibility: "owners" },
        { id: "y", parentId: "x", visibility: "members" },
      ),
    );
    expect(map.get("x")).toBe("owners");
    expect(map.size).toBe(2);
  });
});

describe("normalizeFolderName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeFolderName("  Job   Photos  ")).toBe("Job Photos");
  });

  it("keeps ordinary punctuation, spaces and hyphens", () => {
    expect(normalizeFolderName("Insurance & Bonds")).toBe("Insurance & Bonds");
    expect(normalizeFolderName("2026-Q1 Permits")).toBe("2026-Q1 Permits");
    expect(normalizeFolderName("Núñez Residence")).toBe("Núñez Residence");
  });

  it("rejects blank, dot and over-long names", () => {
    expect(normalizeFolderName("")).toBeNull();
    expect(normalizeFolderName("   ")).toBeNull();
    expect(normalizeFolderName(".")).toBeNull();
    expect(normalizeFolderName("..")).toBeNull();
    expect(normalizeFolderName("x".repeat(FOLDER_NAME_MAX + 1))).toBeNull();
  });

  it("rejects path separators", () => {
    expect(normalizeFolderName("Jobs/2026")).toBeNull();
    expect(normalizeFolderName("Jobs\\2026")).toBeNull();
  });

  // CR/LF are the header-injection risk (Content-Disposition on export). They
  // are whitespace, so the collapse neutralizes them into a space instead of
  // failing a paste from a spreadsheet — safe either way, but assert which.
  it("neutralizes whitespace control characters rather than rejecting them", () => {
    expect(normalizeFolderName(`Jobs${String.fromCharCode(13)}X`)).toBe("Jobs X");
    expect(normalizeFolderName(`Jobs${String.fromCharCode(10)}X`)).toBe("Jobs X");
    expect(normalizeFolderName(`Jobs${String.fromCharCode(9)}X`)).toBe("Jobs X");
  });

  it("rejects every other control character", () => {
    for (const code of [0, 1, 8, 14, 27, 31, 127]) {
      expect(normalizeFolderName(`Jobs${String.fromCharCode(code)}`)).toBeNull();
    }
  });

  it("folds case for the uniqueness key", () => {
    expect(folderNameKey("Contracts")).toBe(folderNameKey("CONTRACTS"));
  });
});

describe("tag slugs", () => {
  it("slugifies display names", () => {
    expect(slugifyTag("Change Order")).toBe("change-order");
    expect(slugifyTag("  Safety!!  ")).toBe("safety");
    expect(slugifyTag("2026 Permits")).toBe("2026-permits");
  });

  it("returns null when nothing usable survives", () => {
    expect(slugifyTag("")).toBeNull();
    expect(slugifyTag("!!!")).toBeNull();
    expect(slugifyTag("---")).toBeNull();
  });

  it("never emits a slug the CHECK constraint would reject", () => {
    for (const raw of ["A".repeat(120), "-lead", "trail-", "a b c", "Ünïcode"]) {
      const slug = slugifyTag(raw);
      if (slug !== null) expect(isValidTagSlug(slug)).toBe(true);
    }
  });

  it("dedupes, sorts and caps a tag list", () => {
    const tags = normalizeTags(["safety", "SAFETY", "jobs", "bad slug!", ""]);
    expect(tags).toEqual(["jobs", "safety"]);
    const many = normalizeTags(
      Array.from({ length: 60 }, (_, i) => `tag-${i.toString().padStart(2, "0")}`),
    );
    expect(many).toHaveLength(TAGS_PER_DOCUMENT_MAX);
  });

  it("reports added and removed slugs for the audit meta", () => {
    expect(diffTags(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });
});

describe("cursor paging", () => {
  const row = { createdAt: new Date("2026-07-24T12:00:00.000Z"), id: uuid(4) };

  it("round-trips", () => {
    const parsed = parseCursor(encodeCursor(row));
    expect(parsed?.id).toBe(row.id);
    expect(parsed?.createdAt.toISOString()).toBe(row.createdAt.toISOString());
  });

  it("returns null on junk instead of throwing", () => {
    expect(parseCursor(undefined)).toBeNull();
    expect(parseCursor("")).toBeNull();
    expect(parseCursor("garbage")).toBeNull();
    expect(parseCursor(Buffer.from("{}", "utf8").toString("base64url"))).toBeNull();
    expect(
      parseCursor(
        Buffer.from(JSON.stringify({ t: "nonsense", i: "x" }), "utf8").toString(
          "base64url",
        ),
      ),
    ).toBeNull();
  });

  it("clamps the page size", () => {
    expect(clampPageSize(undefined)).toBe(PAGE_SIZE);
    expect(clampPageSize(0)).toBe(PAGE_SIZE);
    expect(clampPageSize(10)).toBe(10);
    expect(clampPageSize(9999)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(Number.NaN)).toBe(PAGE_SIZE);
  });

  it("splits a limit+1 fetch into a page and a next cursor", () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      createdAt: new Date(2026, 0, i + 1),
      id: uuid(i),
    }));
    const full = takePage(rows, 3);
    expect(full.items).toHaveLength(3);
    expect(parseCursor(full.nextCursor)?.id).toBe(rows[2].id);

    const partial = takePage(rows.slice(0, 2), 3);
    expect(partial.items).toHaveLength(2);
    expect(partial.nextCursor).toBeNull();
  });
});

describe("module surface", () => {
  it("ships default folders with unique case-insensitive names", () => {
    const keys = DEFAULT_FOLDERS.map((f) => folderNameKey(f.name));
    expect(new Set(keys).size).toBe(keys.length);
    for (const folder of DEFAULT_FOLDERS) {
      expect(normalizeFolderName(folder.name)).toBe(folder.name);
    }
  });

  it("maps typed errors to copy and anything else to a generic message", () => {
    expect(friendlyMessage(new DocsError("FOLDER_CYCLE", "x"))).toContain(
      "inside itself",
    );
    expect(friendlyMessage(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

/* ------------------------------------------------------------------------
 * DB-backed folder operations. Gated on DATABASE_URL like the rest of the
 * suite; the pure tests above stay runnable everywhere.
 * ---------------------------------------------------------------------- */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const STAMP_OPS = `dms-ops-${process.pid}`;

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

describe("upload allowlist", () => {
  it("accepts the file types a filing cabinet actually holds", () => {
    expect(isAllowedUpload("application/pdf", 1024)).toBe(true);
    expect(isAllowedUpload("image/jpeg", 1024)).toBe(true);
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        1024,
      ),
    ).toBe(true);
    expect(isAllowedUpload("application/zip", 1024)).toBe(true);
  });

  // The stored-XSS types. Refused at upload, not merely served as attachments,
  // so they can never sit in the store waiting to be mis-served later.
  it("refuses types that can execute in our origin", () => {
    expect(isAllowedUpload("text/html", 1024)).toBe(false);
    expect(isAllowedUpload("image/svg+xml", 1024)).toBe(false);
    expect(isAllowedUpload("application/xhtml+xml", 1024)).toBe(false);
    expect(isAllowedUpload("application/x-msdownload", 1024)).toBe(false);
  });

  it("refuses empty and oversized files", () => {
    expect(isAllowedUpload("application/pdf", 0)).toBe(false);
    expect(isAllowedUpload("application/pdf", -1)).toBe(false);
    expect(isAllowedUpload("application/pdf", MAX_FILE_BYTES + 1)).toBe(false);
    expect(isAllowedUpload("application/pdf", Number.NaN)).toBe(false);
  });

  it("only renders inline what cannot execute", () => {
    expect(dispositionFor("application/pdf")).toBe("inline");
    expect(dispositionFor("image/png")).toBe("inline");
    expect(dispositionFor("text/plain")).toBe("inline");
    expect(dispositionFor("application/zip")).toBe("attachment");
    expect(dispositionFor("image/tiff")).toBe("attachment");
    expect(
      dispositionFor(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("attachment");
    // Never uploadable, but the header rule must hold regardless.
    expect(dispositionFor("image/svg+xml")).toBe("attachment");
    expect(dispositionFor("text/html")).toBe("attachment");
  });

  it("strips what must never reach a Content-Disposition header", () => {
    const cr = String.fromCharCode(13);
    const lf = String.fromCharCode(10);
    expect(sanitizeFileName(`plan${cr}${lf}X-Evil: 1.pdf`)).toBe(
      "planX-Evil: 1.pdf",
    );
    expect(sanitizeFileName('say"hello".pdf')).toBe("sayhello.pdf");
    expect(sanitizeFileName("a/b\\c.pdf")).toBe("abc.pdf");
    expect(sanitizeFileName("   ")).toBe("download");
    expect(sanitizeFileName("x".repeat(300)).length).toBeLessThanOrEqual(120);
    // Non-ASCII survives; the route emits an RFC 5987 filename* alongside.
    expect(sanitizeFileName("Núñez.pdf")).toBe("Núñez.pdf");
  });
});

describe("tenant blob namespaces", () => {
  const t = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";

  it("accepts this tenant's own prefixes, across modules", () => {
    expect(isTenantBlobPath(t, `${dmsPathPrefix(t, "files")}a.pdf`)).toBe(true);
    expect(isTenantBlobPath(t, `${dmsPathPrefix(t, "generated")}a.pdf`)).toBe(
      true,
    );
    expect(isTenantBlobPath(t, `${receiptPathPrefix(t)}a.pdf`)).toBe(true);
  });

  it("refuses another tenant's namespace and traversal", () => {
    expect(isTenantBlobPath(t, `${dmsPathPrefix(other, "files")}a.pdf`)).toBe(
      false,
    );
    expect(isTenantBlobPath(t, `docs/${t}/files/../../${other}/files/a.pdf`)).toBe(
      false,
    );
    expect(isTenantBlobPath(t, `/docs/${t}/files/a.pdf`)).toBe(false);
    expect(isTenantBlobPath(t, `docs\\${t}\\files\\a.pdf`)).toBe(false);
    expect(isTenantBlobPath(t, "")).toBe(false);
  });
});

/* ------------------------------------------------------------------------
 * The regression this whole `origin` column exists to prevent.
 * ---------------------------------------------------------------------- */

d("shared documents table: accounting is unaffected by DMS rows", () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP_OPS}-share`,
          name: "DMS Share",
          slug: `${STAMP_OPS}-share`,
        })
        .returning();
      return row.id;
    });
    await withTenant(
      tenantId,
      async (tx) => {
        await tx.insert(schema.accountingSettings).values({ tenantId });
        // One unfiled DMS file, and one real receipt for contrast.
        await tx.insert(schema.documents).values({
          tenantId,
          origin: "dms",
          fileName: "site-photo.jpg",
          mimeType: "image/jpeg",
          blobPathname: `docs/${tenantId}/files/site-photo.jpg`,
          status: "inbox",
        });
        await tx.insert(schema.documents).values({
          tenantId,
          origin: "accounting",
          fileName: "receipt.pdf",
          mimeType: "application/pdf",
          blobPathname: `acct/${tenantId}/receipts/receipt.pdf`,
          status: "inbox",
        });
      },
      { role: "owner" },
    );
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("the Receipts inbox lists only accounting-origin documents", async () => {
    const rows = await withTenant(
      tenantId,
      (tx) => listDocuments(tx, tenantId, "inbox"),
      { role: "owner" },
    );
    expect(rows.map((r) => r.fileName)).toEqual(["receipt.pdf"]);
  });

  // Without the origin filter every unfiled DMS file would be a permanent
  // month-end close blocker — the most severe consequence of sharing the table.
  it("an unfiled DMS file is not a month-end close blocker", async () => {
    const checklist = await withTenant(
      tenantId,
      (tx) => getCloseChecklist(tx, tenantId, "2026-07-31"),
      { role: "owner" },
    );
    const item = checklist.items.find((i) => i.key === "inbox_documents");
    expect(item?.count).toBe(1);

    // Trash the receipt: the DMS file must not keep the item red.
    await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(schema.documents)
          .set({ status: "trashed" })
          .where(
            and(
              eq(schema.documents.tenantId, tenantId),
              eq(schema.documents.origin, "accounting"),
            ),
          ),
      { role: "owner" },
    );
    const after = await withTenant(
      tenantId,
      (tx) => getCloseChecklist(tx, tenantId, "2026-07-31"),
      { role: "owner" },
    );
    const afterItem = after.items.find((i) => i.key === "inbox_documents");
    expect(afterItem?.count).toBe(0);
    expect(afterItem?.ok).toBe(true);
  });
});

describe("search query normalization", () => {
  it("trims, bounds and rejects empty input", () => {
    expect(normalizeSearchQuery("  invoice  ")).toBe("invoice");
    expect(normalizeSearchQuery("")).toBeNull();
    expect(normalizeSearchQuery("   ")).toBeNull();
    expect(normalizeSearchQuery(undefined)).toBeNull();
    expect(normalizeSearchQuery(null)).toBeNull();
    expect(normalizeSearchQuery("x".repeat(500))).toHaveLength(SEARCH_QUERY_MAX);
  });

  it("caps how deep ranked paging can go", () => {
    expect(maxSearchPage(50)).toBe(20);
    expect(maxSearchPage(100)).toBe(10);
  });
});

d("search (full text)", () => {
  let tenantId: string;
  let openFolderId: string;
  let lockedFolderId: string;
  let openFolderPath: string;

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  const run = (q: string, opts: { folderPath?: string | null; page?: number } = {}) =>
    asOwner((tx) => searchDocuments(tx, tenantId, { q, ...opts }));

  const names = (r: { hits: Array<{ fileName: string }> }) =>
    r.hits.map((h) => h.fileName);

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP_OPS}-search`,
          name: "DMS Search",
          slug: `${STAMP_OPS}-search`,
        })
        .returning();
      return row.id;
    });

    await asOwner(async (tx) => {
      const [open] = await tx
        .insert(schema.documentFolders)
        .values({
          tenantId,
          name: "Open",
          nameKey: "open",
          path: "/00000000000000000000000000000000/",
        })
        .returning();
      openFolderPath = `/${open.id.replace(/-/g, "")}/`;
      await tx
        .update(schema.documentFolders)
        .set({ path: openFolderPath })
        .where(eq(schema.documentFolders.id, open.id));
      openFolderId = open.id;

      const [locked] = await tx
        .insert(schema.documentFolders)
        .values({
          tenantId,
          name: "Locked",
          nameKey: "locked",
          path: "/00000000000000000000000000000001/",
          visibility: "owners",
          effectiveVisibility: "owners",
        })
        .returning();
      await tx
        .update(schema.documentFolders)
        .set({ path: `/${locked.id.replace(/-/g, "")}/` })
        .where(eq(schema.documentFolders.id, locked.id));
      lockedFolderId = locked.id;

      const base = {
        tenantId,
        origin: "dms" as const,
        mimeType: "application/pdf",
      };
      await tx.insert(schema.documents).values([
        {
          ...base,
          folderId: openFolderId,
          filedAt: new Date(),
          fileName: "titled.pdf",
          title: "Zephyrqx roofing scope",
          blobPathname: `docs/${tenantId}/files/titled.pdf`,
        },
        {
          ...base,
          folderId: openFolderId,
          filedAt: new Date(),
          fileName: "mentioned.pdf",
          emailFrom: "zephyrqx@example.com",
          blobPathname: `docs/${tenantId}/files/mentioned.pdf`,
        },
        {
          ...base,
          folderId: openFolderId,
          filedAt: new Date(),
          fileName: "2026-invoice_acmewidgets.pdf",
          blobPathname: `docs/${tenantId}/files/2026-invoice_acmewidgets.pdf`,
        },
        {
          ...base,
          folderId: openFolderId,
          filedAt: new Date(),
          fileName: "gonequx.pdf",
          status: "trashed",
          trashedAt: new Date(),
          blobPathname: `docs/${tenantId}/files/gonequx.pdf`,
        },
        {
          ...base,
          folderId: lockedFolderId,
          filedAt: new Date(),
          effectiveVisibility: "owners",
          fileName: "secretqx.pdf",
          title: "Zephyrqx payroll",
          blobPathname: `docs/${tenantId}/files/secretqx.pdf`,
        },
        {
          ...base,
          fileName: "unfiledqx.pdf",
          title: "Zephyrqx unfiled",
          blobPathname: `docs/${tenantId}/files/unfiledqx.pdf`,
        },
      ]);
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("finds documents and ranks a title above an email address", async () => {
    const result = await run("zephyrqx");
    expect(names(result)).toContain("titled.pdf");
    expect(names(result)).toContain("mentioned.pdf");
    // setweight 'A' (title) must beat 'D' (email_from).
    expect(names(result).indexOf("titled.pdf")).toBeLessThan(
      names(result).indexOf("mentioned.pdf"),
    );
  });

  // Trap 3 in drizzle/0026: without replacing - and _ the whole filename is a
  // single useless lexeme and filename search silently never works.
  it("tokenizes hyphens and underscores in file names", async () => {
    expect(names(await run("acmewidgets"))).toContain(
      "2026-invoice_acmewidgets.pdf",
    );
  });

  it("excludes trashed documents", async () => {
    expect(names(await run("gonequx"))).toEqual([]);
  });

  it("hides owners-only matches from staff and shows them to owners", async () => {
    const asStaff = await withTenant(tenantId, (tx) =>
      searchDocuments(tx, tenantId, { q: "zephyrqx" }),
    );
    expect(asStaff.hits.map((h) => h.fileName)).not.toContain("secretqx.pdf");
    expect(asStaff.hits.map((h) => h.fileName)).toContain("titled.pdf");

    expect(names(await run("zephyrqx"))).toContain("secretqx.pdf");
  });

  it("scopes to a folder subtree when asked", async () => {
    const scoped = await run("zephyrqx", { folderPath: openFolderPath });
    expect(names(scoped)).toContain("titled.pdf");
    // Unfiled and other-folder matches drop out.
    expect(names(scoped)).not.toContain("unfiledqx.pdf");
    expect(names(scoped)).not.toContain("secretqx.pdf");
  });

  // websearch_to_tsquery is total — it must never raise on anything a user can
  // type, which is exactly why it is used instead of to_tsquery.
  it("survives quotes, operators and outright garbage", async () => {
    await expect(run('"roofing scope"')).resolves.toBeTruthy();
    await expect(run("zephyrqx or acmewidgets")).resolves.toBeTruthy();
    await expect(run("zephyrqx -payroll")).resolves.toBeTruthy();
    await expect(run("((( & | ! :* <-> \\")).resolves.toBeTruthy();
    await expect(run("'; drop table documents; --")).resolves.toBeTruthy();

    const phrase = await run('"roofing scope"');
    expect(names(phrase)).toContain("titled.pdf");
    const excluded = await run("zephyrqx -payroll");
    expect(names(excluded)).not.toContain("secretqx.pdf");
  });

  it("reports another page only when there is one", async () => {
    const wide = await run("zephyrqx", { page: 0 });
    expect(wide.hasMore).toBe(false);
    const oneAtATime = await asOwner((tx) =>
      searchDocuments(tx, tenantId, { q: "zephyrqx", pageSize: 1, page: 0 }),
    );
    expect(oneAtATime.hits).toHaveLength(1);
    expect(oneAtATime.hasMore).toBe(true);
  });

  it("clamps a page number past the offset cap", async () => {
    const far = await run("zephyrqx", { page: 9999 });
    expect(far.page).toBe(maxSearchPage());
  });
});
