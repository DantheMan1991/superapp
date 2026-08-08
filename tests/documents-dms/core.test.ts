import "dotenv/config";
import { describe, expect, it } from "vitest";
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
import { uuid } from "./_shared";

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
