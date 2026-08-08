import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "@/db";
import {
  maxSearchPage,
  normalizeSearchQuery,
  searchDocuments,
  SEARCH_QUERY_MAX,
} from "@/modules/documents/search";
import { STAMP_OPS, d } from "./_shared";

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
