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
import {
  isDeniedKind,
  loadShareActivity,
  visitorLabel,
} from "@/modules/documents/shares/activity";
import {
  addDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
} from "@/modules/documents/versions";
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
import { decryptSecret } from "@/lib/crypto";
import {
  hashIp,
  hashPasscode,
  hashToken,
  looksLikeToken,
  mintToken,
  signSession,
  verifyPasscode,
  verifySession,
} from "@/lib/public-token";
import {
  MAX_FAILED_UNLOCKS,
  resolveShareStatus,
} from "@/modules/documents/shares/status";
import {
  isWithinScope,
  visibleSubfolders,
} from "@/modules/documents/shares/scope";
import {
  createShare,
  loadShare,
  revokeShare,
} from "@/modules/documents/shares/shares";
import {
  countFailedUnlock,
  countShareView,
} from "@/modules/documents/shares/resolve";
import {
  loadSharedContents,
  resolveSharedFile,
} from "@/modules/documents/shares/contents";
import {
  buildInboundAddress,
  parseTokenForPrefix,
  routeInboundEmail,
} from "@/lib/inbound-address";
import {
  acceptsInboundMail,
  createInboundDocument,
  disableFolderInbound,
  enableFolderInbound,
  folderIngestCount,
  mintFolderToken,
  resolveFolderByToken,
} from "@/modules/documents/inbound";
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

/* ------------------------------------------------------------------------
 * File revision history.
 *
 * These run against the database because every invariant worth testing here
 * is one the DATABASE enforces: exactly one current version (partial unique),
 * unique version numbers per document, and the fact that a version row keeps
 * a blob referenced. A mocked version of this would prove nothing.
 * ---------------------------------------------------------------------- */

const STAMP_VER = `dms-ver-${process.pid}`;

d("document versions", () => {
  let tenantId: string;
  const ctx = { tenantId: "", userId: "user-ver", role: "owner" as const };

  async function asOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(tenantId, fn, { role: "owner" });
  }

  /** A DMS document with real-looking file columns and NO history rows. */
  async function mkDoc(
    tag: string,
    over: Partial<typeof schema.documents.$inferInsert> = {},
  ) {
    return asOwner(async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          fileName: `${tag}-v1.pdf`,
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/${tag}-v1.pdf`,
          sizeBytes: 100,
          sha256: `sha-${tag}-v1`,
          title: `Drawing ${tag}`,
          uploadedByClerkUserId: "user-original",
          status: "inbox",
          ...over,
        })
        .returning();
      return doc;
    });
  }

  function bytes(tag: string, no: number) {
    return {
      blobPathname: `docs/${tenantId}/files/${tag}-v${no}.pdf`,
      fileName: `${tag}-v${no}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 100 * no,
      sha256: `sha-${tag}-v${no}`,
      note: "",
    };
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP_VER, name: "DMS Ver", slug: STAMP_VER })
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

  /**
   * The whole reason materializeCurrentVersion exists. Every document created
   * before this feature — and every one created since, because a file with no
   * history gets no history row — has zero version rows. Appending v2
   * overwrites documents.blob_pathname, so if v1 were not written first the
   * ORIGINAL blob would stop being referenced by anything: still stored, still
   * billed, unreachable, and missing from a history claiming to be complete.
   */
  it("materializes v1 from the document's own columns before appending v2", async () => {
    const doc = await mkDoc("mat");
    const originalBlob = doc.blobPathname;

    await asOwner((tx) => addDocumentVersion(tx, ctx, doc.id, bytes("mat", 2)));

    const history = await asOwner((tx) =>
      listDocumentVersions(tx, tenantId, doc.id),
    );
    expect(history.map((v) => v.versionNo)).toEqual([2, 1]);

    const v1 = history.find((v) => v.versionNo === 1)!;
    const rows = await asOwner((tx) =>
      tx
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, doc.id)),
    );
    const v1Row = rows.find((r) => r.versionNo === 1)!;
    // The original bytes are still addressable, and attributed to whoever
    // uploaded them rather than to whoever added v2.
    expect(v1Row.blobPathname).toBe(originalBlob);
    expect(v1Row.uploadedByClerkUserId).toBe("user-original");
    expect(v1Row.isCurrent).toBe(false);
    expect(v1.id).not.toBeNull();
  });

  it("points the document at the new bytes but keeps the human's title", async () => {
    const doc = await mkDoc("promote");
    await asOwner((tx) =>
      addDocumentVersion(tx, ctx, doc.id, bytes("promote", 2)),
    );

    const after = await asOwner((tx) =>
      tx.query.documents.findFirst({
        where: eq(schema.documents.id, doc.id),
      }),
    );
    expect(after!.blobPathname).toBe(`docs/${tenantId}/files/promote-v2.pdf`);
    expect(after!.fileName).toBe("promote-v2.pdf");
    expect(after!.sizeBytes).toBe(200);
    expect(after!.sha256).toBe("sha-promote-v2");
    expect(after!.fileVersionNo).toBe(2);
    expect(after!.fileVersionCount).toBe(2);
    // The label the user gave the thing survives a new set of bytes.
    expect(after!.title).toBe("Drawing promote");
    // The optimistic-concurrency counter moved, so a rename dialog opened
    // before the replacement is now stale.
    expect(after!.version).toBe(doc.version + 1);
  });

  it("keeps exactly one current version across repeated replacements", async () => {
    const doc = await mkDoc("single");
    for (const no of [2, 3, 4]) {
      await asOwner((tx) =>
        addDocumentVersion(tx, ctx, doc.id, bytes("single", no)),
      );
    }
    const rows = await asOwner((tx) =>
      tx
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, doc.id)),
    );
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    expect(rows.find((r) => r.isCurrent)!.versionNo).toBe(4);
  });

  it("synthesizes a single entry for a document that has never been revised", async () => {
    const doc = await mkDoc("virgin");
    const history = await asOwner((tx) =>
      listDocumentVersions(tx, tenantId, doc.id),
    );
    expect(history).toHaveLength(1);
    // A null id tells the UI there is no history row, so the document's own
    // URL already serves these bytes — no ?v= needed.
    expect(history[0].id).toBeNull();
    expect(history[0].versionNo).toBe(1);
    expect(history[0].isCurrent).toBe(true);
    expect(history[0].fileName).toBe("virgin-v1.pdf");
  });

  /**
   * Restore is an append, not a rewind: rolling back is itself an event worth
   * seeing in the history, and the old row keeps its number.
   */
  it("restores by appending the old bytes again, reusing the same blob", async () => {
    const doc = await mkDoc("undo");
    await asOwner((tx) => addDocumentVersion(tx, ctx, doc.id, bytes("undo", 2)));

    const history = await asOwner((tx) =>
      listDocumentVersions(tx, tenantId, doc.id),
    );
    const v1 = history.find((v) => v.versionNo === 1)!;

    const result = await asOwner((tx) =>
      restoreDocumentVersion(tx, ctx, doc.id, v1.id!),
    );
    expect(result.version.versionNo).toBe(3);
    expect(result.sourceNo).toBe(1);
    // No byte copy: v3 and v1 name the SAME blob, which is why
    // document_versions_blob_idx is deliberately not unique.
    expect(result.version.blobPathname).toBe(
      `docs/${tenantId}/files/undo-v1.pdf`,
    );
    expect(result.document.blobPathname).toBe(
      `docs/${tenantId}/files/undo-v1.pdf`,
    );
    expect(result.document.fileVersionNo).toBe(3);

    const after = await asOwner((tx) =>
      listDocumentVersions(tx, tenantId, doc.id),
    );
    expect(after.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    // Resolved to a number so the panel can say "restored from v1".
    expect(after[0].restoredFromVersionNo).toBe(1);
    expect(after.filter((v) => v.isCurrent)).toHaveLength(1);
  });

  it("refuses to restore the version that is already current", async () => {
    const doc = await mkDoc("noop");
    await asOwner((tx) => addDocumentVersion(tx, ctx, doc.id, bytes("noop", 2)));
    const history = await asOwner((tx) =>
      listDocumentVersions(tx, tenantId, doc.id),
    );
    const current = history.find((v) => v.isCurrent)!;

    await expect(
      asOwner((tx) => restoreDocumentVersion(tx, ctx, doc.id, current.id!)),
    ).rejects.toMatchObject({ code: "VERSION_ALREADY_CURRENT" });
  });

  it("warns, but does not block, when the new bytes are identical", async () => {
    const doc = await mkDoc("same");
    const result = await asOwner((tx) =>
      addDocumentVersion(tx, ctx, doc.id, {
        ...bytes("same", 2),
        sha256: "sha-same-v1",
      }),
    );
    expect(result.sameAsCurrent).toBe(true);
    expect(result.version.versionNo).toBe(2);
  });

  /**
   * A receipt's bytes are evidence a journal entry or bill points at. Swapping
   * them from the filing cabinet would rewrite that transaction's support
   * without the accounting module ever hearing about it.
   */
  it("refuses to version an accounting-origin document", async () => {
    const receipt = await mkDoc("receipt", {
      origin: "accounting",
      blobPathname: `acct/${tenantId}/receipts/receipt.pdf`,
    });
    await expect(
      asOwner((tx) =>
        addDocumentVersion(tx, ctx, receipt.id, bytes("receipt", 2)),
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_VERSIONABLE" });
  });

  it("refuses to version a trashed document", async () => {
    const doc = await mkDoc("gone", { status: "trashed", trashedAt: new Date() });
    await expect(
      asOwner((tx) => addDocumentVersion(tx, ctx, doc.id, bytes("gone", 2))),
    ).rejects.toMatchObject({ code: "DOCUMENT_TRASHED" });
  });

  /**
   * The role dimension, at the operations layer. RLS hides the document from
   * staff, so the lock finds nothing — and "restricted" is indistinguishable
   * from "gone", which is the only non-leaking answer.
   */
  it("staff cannot add a version to an owners-only document", async () => {
    // Restricted-ness comes from the FOLDER, never set directly on a document:
    // an unfiled document lives in the Inbox and is visible to members, and
    // verifyDocumentInvariants treats any other combination as drift.
    const folder = await asOwner((tx) =>
      createFolder(tx, ctx, {
        parentId: null,
        name: "Locked Versions",
        visibility: "owners",
      }),
    );
    const doc = await mkDoc("locked", {
      folderId: folder.id,
      filedAt: new Date(),
      effectiveVisibility: "owners",
    });
    const staffCtx = { tenantId, userId: "user-staff", role: "staff" as const };

    await expect(
      withTenant(
        tenantId,
        (tx) => addDocumentVersion(tx, staffCtx, doc.id, bytes("locked", 2)),
        { role: "staff" },
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    // And no partial write happened: the document still has no history.
    const rows = await asOwner((tx) =>
      tx
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, doc.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("leaves the module's denormalized invariants clean", async () => {
    const problems = await asOwner((tx) =>
      verifyDocumentInvariants(tx, tenantId),
    );
    expect(problems).toEqual([]);
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

/* ------------------------------------------------------------------------
 * Share links. The pure blocks below are the security core: a token that is
 * guessable, a status that says "active" when it shouldn't, or a scope that
 * leaks one folder into another are all silent failures in production.
 * ---------------------------------------------------------------------- */

describe("share tokens", () => {
  it("mints 256 bits of base64url and accepts its own shape", () => {
    const token = mintToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(looksLikeToken(token)).toBe(true);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintToken()));
    expect(seen.size).toBe(200);
  });

  it("rejects shapes that cannot be tokens before hitting the database", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("short")).toBe(false);
    expect(looksLikeToken("a".repeat(200))).toBe(false);
    expect(looksLikeToken("has spaces in it aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(looksLikeToken("../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });

  it("hashes deterministically and does not store the token", () => {
    const token = mintToken();
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(hashToken(mintToken())).not.toBe(hash);
  });

  it("hashes IPs rather than storing them", () => {
    const hashed = hashIp("203.0.113.7");
    expect(hashed).toHaveLength(64);
    expect(hashed).not.toContain("203.0.113");
    expect(hashed).toBe(hashIp("203.0.113.7"));
    expect(hashed).not.toBe(hashIp("203.0.113.8"));
  });
});

describe("share passcodes", () => {
  it("round-trips and rejects the wrong passcode", () => {
    const stored = hashPasscode("open-sesame");
    expect(verifyPasscode("open-sesame", stored)).toBe(true);
    expect(verifyPasscode("Open-Sesame", stored)).toBe(false);
    expect(verifyPasscode("", stored)).toBe(false);
  });

  it("salts, so the same passcode stores differently every time", () => {
    expect(hashPasscode("same")).not.toBe(hashPasscode("same"));
  });

  it("never throws on a malformed stored value", () => {
    expect(verifyPasscode("x", "")).toBe(false);
    expect(verifyPasscode("x", "garbage")).toBe(false);
    expect(verifyPasscode("x", "not.base64.at.all")).toBe(false);
  });
});

describe("unlock sessions", () => {
  it("accepts only its own signature, share and lifetime", () => {
    const value = signSession({ shareId: "share-1", exp: Date.now() + 60_000 });
    expect(verifySession(value, "share-1")).toBe(true);
    // Bound to one share, so a cookie cannot be replayed onto another link.
    expect(verifySession(value, "share-2")).toBe(false);
    expect(verifySession(value, "share-1", Date.now() + 120_000)).toBe(false);
    expect(verifySession(undefined, "share-1")).toBe(false);
    expect(verifySession("garbage", "share-1")).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const value = signSession({ shareId: "share-1", exp: Date.now() + 60_000 });
    const [payload, mac] = value.split(".");
    const forged = Buffer.from(
      JSON.stringify({ shareId: "share-9", exp: Date.now() + 60_000 }),
      "utf8",
    ).toString("base64url");
    expect(verifySession(`${forged}.${mac}`, "share-9")).toBe(false);
    expect(verifySession(`${payload}.deadbeef`, "share-1")).toBe(false);
  });
});

describe("resolveShareStatus", () => {
  const base = {
    revokedAt: null,
    expiresAt: new Date("2026-08-01T00:00:00Z"),
    maxUses: null,
    useCount: 0,
    failedUnlockCount: 0,
    createdRootVisibility: "members",
    currentRootVisibility: "members" as const,
  };
  const now = new Date("2026-07-25T00:00:00Z");

  it("is active in the ordinary case", () => {
    expect(resolveShareStatus(base, now)).toBe("active");
  });

  it("reports revoked ahead of everything else", () => {
    expect(
      resolveShareStatus(
        { ...base, revokedAt: new Date("2026-07-20T00:00:00Z"), expiresAt: new Date("2026-07-01T00:00:00Z") },
        now,
      ),
    ).toBe("revoked");
  });

  it("expires on the boundary, not after it", () => {
    expect(resolveShareStatus({ ...base, expiresAt: now }, now)).toBe("expired");
    expect(
      resolveShareStatus(
        { ...base, expiresAt: new Date(now.getTime() + 1) },
        now,
      ),
    ).toBe("active");
  });

  it("exhausts at the limit", () => {
    expect(resolveShareStatus({ ...base, maxUses: 3, useCount: 2 }, now)).toBe("active");
    expect(resolveShareStatus({ ...base, maxUses: 3, useCount: 3 }, now)).toBe("exhausted");
  });

  it("locks after too many wrong passcodes", () => {
    expect(
      resolveShareStatus({ ...base, failedUnlockCount: MAX_FAILED_UNLOCKS - 1 }, now),
    ).toBe("active");
    expect(
      resolveShareStatus({ ...base, failedUnlockCount: MAX_FAILED_UNLOCKS }, now),
    ).toBe("locked");
  });

  // The reason created_root_visibility is stored at all.
  it("suspends when the root became owners-only after the link went out", () => {
    expect(
      resolveShareStatus({ ...base, currentRootVisibility: "owners" }, now),
    ).toBe("suspended");
  });

  it("treats a deleted or hidden root as revoked", () => {
    expect(
      resolveShareStatus({ ...base, currentRootVisibility: null }, now),
    ).toBe("revoked");
  });
});

describe("share scope", () => {
  const rootPath = "/aaaa/";
  const membersRoot = {
    kind: "folder" as const,
    path: rootPath,
    visibility: "members" as const,
  };

  const doc = (folderPath: string | null, visibility: "members" | "owners") => ({
    documentId: "d1",
    folderId: "f1",
    visibility,
    folderPath,
  });

  it("includes documents beneath the root", () => {
    expect(isWithinScope(membersRoot, null, doc("/aaaa/", "members"))).toBe(true);
    expect(isWithinScope(membersRoot, null, doc("/aaaa/bbbb/", "members"))).toBe(true);
  });

  it("excludes documents outside it", () => {
    expect(isWithinScope(membersRoot, null, doc("/zzzz/", "members"))).toBe(false);
    expect(isWithinScope(membersRoot, null, doc(null, "members"))).toBe(false);
  });

  // The reason paths always end in a separator.
  it("does not confuse a sibling whose path is a string prefix", () => {
    const jobs12 = { kind: "folder" as const, path: "/jobs/12/", visibility: "members" as const };
    expect(isWithinScope(jobs12, null, doc("/jobs/123/", "members"))).toBe(false);
    expect(isWithinScope(jobs12, null, doc("/jobs/12/x/", "members"))).toBe(true);
  });

  it("prunes an owners-only subtree from an ordinary share", () => {
    expect(isWithinScope(membersRoot, null, doc("/aaaa/bbbb/", "owners"))).toBe(false);
  });

  it("matches a file share by id only", () => {
    const fileRoot = { kind: "document" as const, path: null, visibility: "members" as const };
    expect(isWithinScope(fileRoot, "d1", doc(null, "members"))).toBe(true);
    expect(isWithinScope(fileRoot, "other", doc(null, "members"))).toBe(false);
  });

  it("hides pruned subfolder NAMES, not just their files", () => {
    const folders = [
      { id: "root", path: "/aaaa/", name: "Root", visibility: "members" as const },
      { id: "open", path: "/aaaa/bbbb/", name: "Open", visibility: "members" as const },
      { id: "secret", path: "/aaaa/cccc/", name: "Payroll", visibility: "owners" as const },
      { id: "outside", path: "/zzzz/", name: "Elsewhere", visibility: "members" as const },
    ];
    const visible = visibleSubfolders(membersRoot, folders).map((f) => f.name);
    expect(visible).toEqual(["Open"]);
  });
});

d("share links (database)", () => {
  let tenantId: string;
  let folderId: string;
  let lockedFolderId: string;
  let docId: string;
  let lockedDocId: string;
  const ctx = { tenantId: "", userId: "user-share", role: "owner" as const };

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP_OPS}-share-links`,
          name: "DMS Shares",
          slug: `${STAMP_OPS}-share-links`,
        })
        .returning();
      return row.id;
    });
    ctx.tenantId = tenantId;
    await withSystem((tx) =>
      tx.insert(schema.documentSettings).values({ tenantId }),
    );

    await asOwner(async (tx) => {
      const [open] = await tx
        .insert(schema.documentFolders)
        .values({
          tenantId,
          name: "Shared Jobs",
          nameKey: "shared jobs",
          path: "/00000000000000000000000000000000/",
        })
        .returning();
      await tx
        .update(schema.documentFolders)
        .set({ path: `/${open.id.replace(/-/g, "")}/` })
        .where(eq(schema.documentFolders.id, open.id));
      folderId = open.id;

      const [locked] = await tx
        .insert(schema.documentFolders)
        .values({
          tenantId,
          name: "Shared Payroll",
          nameKey: "shared payroll",
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

      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          folderId: open.id,
          filedAt: new Date(),
          fileName: "plans.pdf",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/plans.pdf`,
        })
        .returning();
      docId = doc.id;

      const [secret] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          folderId: locked.id,
          filedAt: new Date(),
          effectiveVisibility: "owners",
          fileName: "wages.pdf",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/wages.pdf`,
        })
        .returning();
      lockedDocId = secret.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("creates a link whose token is never stored in the clear", async () => {
    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "document",
        targetId: docId,
        label: "Plans for the sub",
        canDownload: true,
        expiresInDays: 7,
      }),
    );
    expect(created.token.length).toBeGreaterThanOrEqual(40);
    expect(created.share.tokenHash).toBe(hashToken(created.token));
    // The row holds a hash and a ciphertext — never the token itself.
    const row = JSON.stringify(created.share);
    expect(row).not.toContain(created.token);
    // But an owner can still get it back, which is what the ciphertext is for.
    expect(decryptSecret(created.share.tokenCiphertext)).toBe(created.token);
  });

  // The v1 restriction that lets the public route run at the least privileged
  // role: you cannot externally share something hidden from your own staff.
  it("refuses to share owners-only content", async () => {
    await expect(
      asOwner((tx) =>
        createShare(tx, ctx, {
          scope: "folder",
          targetId: lockedFolderId,
          label: "nope",
          canDownload: false,
          expiresInDays: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHARE_ROOT_RESTRICTED" });

    await expect(
      asOwner((tx) =>
        createShare(tx, ctx, {
          scope: "document",
          targetId: lockedDocId,
          label: "nope",
          canDownload: false,
          expiresInDays: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHARE_ROOT_RESTRICTED" });
  });

  it("refuses an expiry beyond the tenant's ceiling", async () => {
    await expect(
      asOwner((tx) =>
        createShare(tx, ctx, {
          scope: "document",
          targetId: docId,
          label: "too long",
          canDownload: false,
          expiresInDays: 365,
        }),
      ),
    ).rejects.toMatchObject({ code: "SHARE_TTL_TOO_LONG" });
  });

  it("refuses to share a trashed file", async () => {
    const trashedId = await asOwner(async (tx) => {
      const [row] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          folderId,
          filedAt: new Date(),
          status: "trashed",
          trashedAt: new Date(),
          fileName: "old.pdf",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/old.pdf`,
        })
        .returning();
      return row.id;
    });
    await expect(
      asOwner((tx) =>
        createShare(tx, ctx, {
          scope: "document",
          targetId: trashedId,
          label: "gone",
          canDownload: false,
          expiresInDays: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_TRASHED" });
  });

  it("revokes immediately, and revocation is idempotent under a stale version", async () => {
    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "folder",
        targetId: folderId,
        label: "Job folder",
        canDownload: false,
        expiresInDays: 7,
      }),
    );
    await asOwner((tx) =>
      revokeShare(tx, ctx, {
        shareId: created.share.id,
        expectedVersion: created.share.version,
      }),
    );
    const after = await asOwner((tx) =>
      loadShare(tx, tenantId, created.share.id),
    );
    expect(after.revokedAt).not.toBeNull();
    expect(
      resolveShareStatus({
        revokedAt: after.revokedAt,
        expiresAt: after.expiresAt,
        maxUses: after.maxUses,
        useCount: after.useCount,
        failedUnlockCount: after.failedUnlockCount,
        createdRootVisibility: after.createdRootVisibility,
        currentRootVisibility: "members",
      }),
    ).toBe("revoked");

    await expect(
      asOwner((tx) =>
        revokeShare(tx, ctx, {
          shareId: created.share.id,
          expectedVersion: created.share.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("counts views and stamps last access", async () => {
    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "document",
        targetId: docId,
        label: "counted",
        canDownload: false,
        expiresInDays: 7,
        maxUses: 2,
      }),
    );
    await countShareView(tenantId, created.share.id);
    await countShareView(tenantId, created.share.id);
    const after = await asOwner((tx) =>
      loadShare(tx, tenantId, created.share.id),
    );
    expect(after.useCount).toBe(2);
    expect(after.lastAccessedAt).not.toBeNull();
    expect(
      resolveShareStatus({
        revokedAt: after.revokedAt,
        expiresAt: after.expiresAt,
        maxUses: after.maxUses,
        useCount: after.useCount,
        failedUnlockCount: after.failedUnlockCount,
        createdRootVisibility: after.createdRootVisibility,
        currentRootVisibility: "members",
      }),
    ).toBe("exhausted");
  });

  it("locks after ten failed unlocks", async () => {
    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "document",
        targetId: docId,
        label: "locked",
        canDownload: false,
        expiresInDays: 7,
        passcode: "hunter2",
      }),
    );
    for (let i = 0; i < MAX_FAILED_UNLOCKS; i += 1) {
      await countFailedUnlock(tenantId, created.share.id);
    }
    const after = await asOwner((tx) =>
      loadShare(tx, tenantId, created.share.id),
    );
    expect(after.failedUnlockCount).toBe(MAX_FAILED_UNLOCKS);
    expect(verifyPasscode("hunter2", after.passcodeHash ?? "")).toBe(true);
  });

  it("only lists a folder share's non-restricted contents", async () => {
    // Nest the restricted folder under the shared one, then share the parent.
    await asOwner(async (tx) => {
      const parent = await tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, folderId),
      });
      await tx
        .update(schema.documentFolders)
        .set({
          parentId: folderId,
          depth: 2,
          path: `${parent!.path}${lockedFolderId.replace(/-/g, "")}/`,
        })
        .where(eq(schema.documentFolders.id, lockedFolderId));
    });

    const created = await asOwner((tx) =>
      createShare(tx, ctx, {
        scope: "folder",
        targetId: folderId,
        label: "Whole job",
        canDownload: true,
        expiresInDays: 7,
      }),
    );

    const contents = await loadSharedContents(created.share);
    expect(contents).not.toBeNull();
    const names = contents!.files.map((f) => f.name);
    expect(names).toContain("plans.pdf");
    // The restricted subfolder's file and its NAME are both absent.
    expect(names).not.toContain("wages.pdf");
    expect(contents!.folders.map((f) => f.name)).not.toContain("Shared Payroll");

    // And the gate agrees with the listing, per request.
    expect(await resolveSharedFile(created.share, docId)).not.toBeNull();
    expect(await resolveSharedFile(created.share, lockedDocId)).toBeNull();
  });
});

/* ------------------------------------------------------------------------
 * Emailing files straight into a folder. The routing block below is the
 * important one: getting a prefix or a case rule wrong delivers a
 * subcontractor's drawings into the wrong feature — or the wrong business.
 * ---------------------------------------------------------------------- */

describe("share activity labels", () => {
  it("derives a short, stable pseudonym from the IP hash", () => {
    const hash = "3f9a2c1b8e7d65a4";
    expect(visitorLabel(hash)).toBe("3f9a2c");
    // Same address, same code — that is the only claim the UI makes.
    expect(visitorLabel(hash)).toBe(visitorLabel(hash));
    expect(visitorLabel("aaaaaa111")).not.toBe(visitorLabel(hash));
  });

  it("returns null rather than a constant that would merge visitors", () => {
    // An event recorded without a hash must not be grouped with other such
    // events under one pseudonym — that would invent a visitor.
    expect(visitorLabel("")).toBeNull();
    expect(visitorLabel("   ")).toBeNull();
    expect(visitorLabel("abc")).toBeNull();
  });

  it("separates refusals from ordinary access", () => {
    expect(isDeniedKind("denied_passcode")).toBe(true);
    expect(isDeniedKind("denied_scope")).toBe(true);
    expect(isDeniedKind("budget_hit")).toBe(true);
    expect(isDeniedKind("viewed")).toBe(false);
    expect(isDeniedKind("downloaded")).toBe(false);
    expect(isDeniedKind("unlocked")).toBe(false);
  });
});

const STAMP_ACT = `dms-act-${process.pid}`;

d("share activity feed", () => {
  let tenantId: string;
  let shareId: string;
  let docId: string;

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP_ACT, name: "DMS Act", slug: STAMP_ACT })
        .returning();
      return row.id;
    });

    docId = await asOwner(async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          fileName: "elevation.pdf",
          title: "Kitchen elevation",
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/elevation.pdf`,
          status: "inbox",
        })
        .returning();
      return doc.id;
    });

    shareId = await asOwner(async (tx) => {
      const [share] = await tx
        .insert(schema.documentShares)
        .values({
          tenantId,
          documentId: docId,
          label: "For the inspector",
          tokenHash: `hash-${STAMP_ACT}`,
          tokenCiphertext: "cipher",
          createdByClerkUserId: "user-act",
          expiresAt: new Date(Date.now() + 86_400_000),
          createdRootVisibility: "members",
        })
        .returning();
      return share.id;
    });

    // The log is member_read by policy, so only trusted server code writes it.
    await withSystem(async (tx) => {
      const base = Date.now();
      const events = [
        { kind: "viewed", ipHash: "aaaaaa0000", at: base - 5000 },
        { kind: "viewed", ipHash: "aaaaaa0000", at: base - 4000 },
        { kind: "downloaded", ipHash: "bbbbbb1111", at: base - 3000, bytes: 2048 },
        { kind: "denied_passcode", ipHash: "cccccc2222", at: base - 2000 },
        { kind: "viewed", ipHash: "", at: base - 1000 },
      ];
      for (const e of events) {
        await tx.insert(schema.documentShareEvents).values({
          tenantId,
          shareId,
          documentId: e.kind === "downloaded" ? docId : null,
          kind: e.kind,
          ipHash: e.ipHash,
          bytesSent: e.bytes ?? 0,
          createdAt: new Date(e.at),
        });
      }
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("returns the feed newest first with refusals flagged", async () => {
    const activity = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId),
    );
    expect(activity.entries).toHaveLength(5);
    // Newest first.
    expect(activity.entries[0].kind).toBe("viewed");
    expect(activity.entries[1].kind).toBe("denied_passcode");
    expect(activity.entries[1].denied).toBe(true);
    expect(activity.entries[0].denied).toBe(false);
  });

  it("counts distinct places without inventing one for missing hashes", async () => {
    const activity = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId),
    );
    // Three real hashes; the two opens from aaaaaa are ONE place, and the
    // event with no hash contributes nobody.
    expect(activity.distinctVisitors).toBe(3);
    expect(activity.entries.some((e) => e.visitor === null)).toBe(true);
  });

  it("names the file a download was for, preferring its title", async () => {
    const activity = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId),
    );
    const download = activity.entries.find((e) => e.kind === "downloaded")!;
    expect(download.documentName).toBe("Kitchen elevation");
    expect(download.bytesSent).toBe(2048);
    // Events not about one file carry no name rather than a placeholder.
    expect(
      activity.entries.find((e) => e.kind === "denied_passcode")!.documentName,
    ).toBeNull();
  });

  it("flags truncation instead of implying the feed is complete", async () => {
    const activity = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId, 2),
    );
    expect(activity.entries).toHaveLength(2);
    expect(activity.truncated).toBe(true);

    const full = await asOwner((tx) =>
      loadShareActivity(tx, tenantId, shareId, 100),
    );
    expect(full.truncated).toBe(false);
  });

  /**
   * The log is evidence, so members read it and only withSystem code appends.
   * A member who could write it could also fabricate an access record.
   */
  it("is read-only to members", async () => {
    await expect(
      asOwner((tx) =>
        tx.insert(schema.documentShareEvents).values({
          tenantId,
          shareId,
          kind: "viewed",
          ipHash: "forged",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("inbound address routing", () => {
  const domain = "in.example.com";

  it("routes each prefix to its own feature", () => {
    expect(
      routeInboundEmail(["docs-abc123def4567890@in.example.com"], domain),
    ).toEqual({ kind: "docs", token: "abc123def4567890" });
    expect(
      routeInboundEmail(["receipts-abc123def456@in.example.com"], domain),
    ).toEqual({ kind: "receipts", token: "abc123def456" });
  });

  // A token is only ever a token for the prefix it was addressed with.
  it("never confuses one prefix for the other", () => {
    expect(
      parseTokenForPrefix(["docs-abc123def456@in.example.com"], domain, "receipts"),
    ).toBeNull();
    expect(
      parseTokenForPrefix(["receipts-abc123def456@in.example.com"], domain, "docs"),
    ).toBeNull();
  });

  /**
   * The production lesson this file exists to preserve: Outlook lowercases
   * forwarded addresses, so matching is case-insensitive and the token comes
   * back lowercase to match how it was stored.
   */
  it("matches case-insensitively and returns a lowercase token", () => {
    expect(
      routeInboundEmail(["DOCS-AbC123dEf4567890@IN.EXAMPLE.COM"], domain),
    ).toEqual({ kind: "docs", token: "abc123def4567890" });
  });

  it("reads the address out of a display-name form", () => {
    expect(
      routeInboundEmail(
        ['"Job 42" <docs-abc123def4567890@in.example.com>'],
        domain,
      ),
    ).toEqual({ kind: "docs", token: "abc123def4567890" });
  });

  // Envelope recipients are the only place a BCC or a forward shows up.
  it("finds the token among several recipients", () => {
    expect(
      routeInboundEmail(
        [
          "someone@elsewhere.com",
          "another@elsewhere.com",
          "docs-abc123def4567890@in.example.com",
        ],
        domain,
      ),
    ).toEqual({ kind: "docs", token: "abc123def4567890" });
  });

  it("ignores addresses on other domains", () => {
    expect(
      routeInboundEmail(["docs-abc123def4567890@evil.example.com"], domain),
    ).toBeNull();
    // A lookalike suffix must not match either.
    expect(
      routeInboundEmail(["docs-abc123def4567890@notin.example.com"], domain),
    ).toBeNull();
  });

  it("ignores malformed and too-short tokens", () => {
    expect(routeInboundEmail(["docs-short@in.example.com"], domain)).toBeNull();
    expect(routeInboundEmail(["docs-@in.example.com"], domain)).toBeNull();
    expect(routeInboundEmail(["docs@in.example.com"], domain)).toBeNull();
    expect(routeInboundEmail([], domain)).toBeNull();
    // No domain configured means nothing can ever match.
    expect(routeInboundEmail(["docs-abc123def4567890@in.example.com"], "")).toBeNull();
  });

  it("builds the address it will later parse", () => {
    const address = buildInboundAddress("docs", "ABC123DEF4567890", domain);
    expect(address).toBe("docs-abc123def4567890@in.example.com");
    expect(routeInboundEmail([address], domain)).toEqual({
      kind: "docs",
      token: "abc123def4567890",
    });
  });
});

describe("folder inbound tokens", () => {
  it("mints lowercase hex that satisfies the CHECK constraint", () => {
    for (let i = 0; i < 20; i += 1) {
      const token = mintFolderToken();
      expect(token).toMatch(/^[a-z0-9]{16,}$/);
    }
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintFolderToken()));
    expect(seen.size).toBe(200);
  });
});

d("folder inbound delivery (database)", () => {
  let tenantId: string;
  let openFolderId: string;
  let openToken: string;
  const ctx = { tenantId: "", userId: "user-inbound", role: "owner" as const };

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP_OPS}-inbound`,
          name: "Inbound Co",
          slug: `${STAMP_OPS}-inbound`,
        })
        .returning();
      return row.id;
    });
    ctx.tenantId = tenantId;

    const folder = await asOwner((tx) =>
      createFolder(tx, ctx, {
        parentId: null,
        name: "Job 42",
        visibility: "members",
      }),
    );
    openFolderId = folder.id;
    openToken = await asOwner((tx) =>
      enableFolderInbound(tx, tenantId, openFolderId),
    );
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("resolves a token back to its folder", async () => {
    const found = await withSystem((tx) => resolveFolderByToken(tx, openToken));
    expect(found?.id).toBe(openFolderId);
    // And an unknown token resolves to nothing rather than throwing.
    expect(
      await withSystem((tx) => resolveFolderByToken(tx, "deadbeefdeadbeef")),
    ).toBeNull();
  });

  it("is case-insensitive on lookup, because email addresses are", async () => {
    const found = await withSystem((tx) =>
      resolveFolderByToken(tx, openToken.toUpperCase()),
    );
    expect(found?.id).toBe(openFolderId);
  });

  it("files an emailed attachment straight into the folder", async () => {
    const folder = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, openFolderId),
      }),
    );
    const created = await asOwner((tx) =>
      createInboundDocument(tx, tenantId, folder!, {
        blobPathname: `docs/${tenantId}/files/drawing.pdf`,
        fileName: "drawing.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        sha256: "abc",
        emailFrom: "sub@example.com",
        emailSubject: "Revised drawings",
        emailMessageId: `msg-${STAMP_OPS}-1`,
        emailReceivedAt: new Date(),
      }),
    );
    expect(created).not.toBeNull();

    const doc = await asOwner((tx) =>
      tx.query.documents.findFirst({
        where: eq(schema.documents.id, created!.documentId),
      }),
    );
    // Filed on arrival — the whole point. Not sitting in an inbox.
    expect(doc?.folderId).toBe(openFolderId);
    expect(doc?.filedAt).not.toBeNull();
    expect(doc?.source).toBe("email");
    expect(doc?.origin).toBe("dms");
    expect(doc?.uploadedByClerkUserId).toBeNull();
  });

  it("refuses a file type the allowlist rejects", async () => {
    const folder = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, openFolderId),
      }),
    );
    const created = await asOwner((tx) =>
      createInboundDocument(tx, tenantId, folder!, {
        blobPathname: `docs/${tenantId}/files/evil.html`,
        fileName: "evil.html",
        mimeType: "text/html",
        sizeBytes: 100,
        sha256: "x",
        emailFrom: "attacker@example.com",
        emailSubject: "hi",
        emailMessageId: `msg-${STAMP_OPS}-evil`,
        emailReceivedAt: new Date(),
      }),
    );
    expect(created).toBeNull();
  });

  it("counts only this folder's emailed files toward its cap", async () => {
    const n = await asOwner((tx) =>
      folderIngestCount(tx, tenantId, openFolderId),
    );
    expect(n).toBeGreaterThanOrEqual(1);
  });

  /**
   * The address was handed to an outsider while the folder was open. If an
   * owner later closes it, delivery must stop — otherwise a third party keeps
   * writing into somewhere the business deliberately shut.
   */
  it("stops accepting mail once the folder becomes owners-only", async () => {
    const before = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, openFolderId),
      }),
    );
    expect(acceptsInboundMail(before!)).toBe(true);

    await asOwner((tx) =>
      setFolderVisibility(tx, ctx, {
        folderId: openFolderId,
        visibility: "owners",
        expectedVersion: before!.version,
      }),
    );

    const after = await asOwner((tx) =>
      tx.query.documentFolders.findFirst({
        where: eq(schema.documentFolders.id, openFolderId),
      }),
    );
    expect(after!.effectiveVisibility).toBe("owners");
    // Token still present, but delivery is refused.
    expect(after!.inboundToken).not.toBeNull();
    expect(acceptsInboundMail(after!)).toBe(false);
  });

  it("refuses to create an address on an owners-only folder", async () => {
    const locked = await asOwner((tx) =>
      createFolder(tx, ctx, {
        parentId: null,
        name: "Payroll Inbound",
        visibility: "owners",
      }),
    );
    await expect(
      asOwner((tx) => enableFolderInbound(tx, tenantId, locked.id)),
    ).rejects.toMatchObject({ code: "SHARE_ROOT_RESTRICTED" });
  });

  it("turning the address off frees the token and stops delivery", async () => {
    const folder = await asOwner((tx) =>
      createFolder(tx, ctx, {
        parentId: null,
        name: "Temp Inbound",
        visibility: "members",
      }),
    );
    const token = await asOwner((tx) =>
      enableFolderInbound(tx, tenantId, folder.id),
    );
    expect(await withSystem((tx) => resolveFolderByToken(tx, token))).not.toBeNull();

    await asOwner((tx) => disableFolderInbound(tx, tenantId, folder.id));
    expect(await withSystem((tx) => resolveFolderByToken(tx, token))).toBeNull();
  });

  it("two folders cannot share an address", async () => {
    const a = await asOwner((tx) =>
      createFolder(tx, ctx, { parentId: null, name: "Dup A", visibility: "members" }),
    );
    const token = await asOwner((tx) => enableFolderInbound(tx, tenantId, a.id));
    const b = await asOwner((tx) =>
      createFolder(tx, ctx, { parentId: null, name: "Dup B", visibility: "members" }),
    );
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.documentFolders)
          .set({ inboundToken: token })
          .where(eq(schema.documentFolders.id, b.id)),
      ),
    ).rejects.toThrow();
  });
});
