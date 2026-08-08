import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "@/db";
import {
  countDocumentsByTag,
  createTag,
  deleteTag,
  listTags,
  setDocumentTags,
  updateTag,
} from "@/modules/documents/tag-ops";
import {
  createSavedView,
  deleteSavedView,
  isEmptyQuery,
  listSavedViews,
  parseSavedViewQuery,
  savedViewHref,
} from "@/modules/documents/saved-views";
import { searchDocuments } from "@/modules/documents/search";
import { d } from "./_shared";

const STAMP_TAG = `dms-tag-${process.pid}`;

describe("saved view queries", () => {
  it("keeps the four fields it knows and drops everything else", () => {
    const parsed = parseSavedViewQuery({
      q: "invoice",
      folderId: "00000000-0000-4000-8000-000000000001",
      tags: ["as-built"],
      origin: "dms",
      // A key nothing in the schema mentions — a hand-edited row, or a field
      // from a future version. Stripped rather than carried.
      sortBy: "size",
      limit: 100000,
    });
    expect(parsed).toEqual({
      q: "invoice",
      folderId: "00000000-0000-4000-8000-000000000001",
      tags: ["as-built"],
      origin: "dms",
    });
  });

  it("survives garbage instead of throwing on a page render", () => {
    expect(parseSavedViewQuery(null)).toEqual({});
    expect(parseSavedViewQuery("not an object")).toEqual({});
    expect(parseSavedViewQuery([1, 2, 3])).toEqual({});
    // Individually invalid fields degrade to absent, so one bad value does not
    // cost the user the rest of their view.
    expect(parseSavedViewQuery({ folderId: "not-a-uuid", q: "keep me" })).toEqual({
      q: "keep me",
    });
    expect(parseSavedViewQuery({ origin: "sql; drop table" })).toEqual({});
  });

  it("runs stored tags through the same normalizer as every other path", () => {
    // Upper case, duplicates and a slug that could never match are all
    // impossible to store through the UI — and all survivable here.
    const parsed = parseSavedViewQuery({
      tags: ["As-Built", "as-built", "../../etc/passwd", ""],
    });
    expect(parsed.tags).toEqual(["as-built"]);
  });

  it("builds an href the search page can read back", () => {
    expect(savedViewHref({ q: "roof plan", tags: ["as-built", "signed"] })).toBe(
      "/dashboard/m/documents/search?q=roof+plan&tag=as-built&tag=signed",
    );
    expect(savedViewHref({})).toBe("/dashboard/m/documents/search");
  });

  it("recognizes a view that would select everything", () => {
    expect(isEmptyQuery({})).toBe(true);
    expect(isEmptyQuery({ tags: [] })).toBe(true);
    expect(isEmptyQuery({ tags: ["as-built"] })).toBe(false);
    expect(isEmptyQuery({ q: "x" })).toBe(false);
  });
});

d("tags and saved views", () => {
  let tenantId: string;
  const ctx = { tenantId: "", userId: "user-tag", role: "owner" as const };

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  async function mkDoc(tag: string, tags: string[] = []) {
    return asOwner(async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          fileName: `${tag}.pdf`,
          mimeType: "application/pdf",
          blobPathname: `docs/${tenantId}/files/${tag}.pdf`,
          sha256: `sha-${tag}`,
          tags,
          status: "inbox",
        })
        .returning();
      return doc;
    });
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP_TAG, name: "DMS Tag", slug: STAMP_TAG })
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

  it("derives a slug and treats case variants as the same tag", async () => {
    const created = await asOwner((tx) =>
      createTag(tx, ctx, { name: "As Built" }),
    );
    expect(created.slug).toBe("as-built");
    expect(created.name).toBe("As Built");

    // "as-built" and "As Built" slugify identically, so they ARE the same tag.
    await expect(
      asOwner((tx) => createTag(tx, ctx, { name: "as-built" })),
    ).rejects.toMatchObject({ code: "TAG_NAME_TAKEN" });
  });

  it("refuses a name with nothing a slug can be built from", async () => {
    await expect(
      asOwner((tx) => createTag(tx, ctx, { name: "!!! ???" })),
    ).rejects.toMatchObject({ code: "TAG_NAME_INVALID" });
  });

  /**
   * The headline property of the whole design: documents store SLUGS, so a
   * rename is one row and nothing else moves.
   */
  it("renaming changes the display name and never the slug", async () => {
    const tag = await asOwner((tx) => createTag(tx, ctx, { name: "Permit" }));
    const doc = await mkDoc("permit-doc");
    await asOwner((tx) =>
      setDocumentTags(tx, ctx, { documentId: doc.id, slugs: [tag.slug] }),
    );

    const renamed = await asOwner((tx) =>
      updateTag(tx, ctx, {
        tagId: tag.id,
        expectedVersion: tag.version,
        name: "Permits & Approvals",
      }),
    );
    expect(renamed.name).toBe("Permits & Approvals");
    expect(renamed.slug).toBe("permit");

    // The document was not touched, and still resolves to the renamed tag.
    const after = await asOwner((tx) =>
      tx.query.documents.findFirst({ where: eq(schema.documents.id, doc.id) }),
    );
    expect(after!.tags).toEqual(["permit"]);
  });

  it("refuses a rename against a stale version", async () => {
    const tag = await asOwner((tx) => createTag(tx, ctx, { name: "Stale Tag" }));
    await expect(
      asOwner((tx) =>
        updateTag(tx, ctx, {
          tagId: tag.id,
          expectedVersion: tag.version + 5,
          name: "Nope",
        }),
      ),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  /**
   * Postgres cannot foreign-key an array element, so setDocumentTags resolving
   * slugs in-transaction is the ONLY thing standing between the column and a
   * value the registry has never heard of.
   */
  it("refuses a slug that is not in the registry", async () => {
    const doc = await mkDoc("unknown-tag-doc");
    await expect(
      asOwner((tx) =>
        setDocumentTags(tx, ctx, {
          documentId: doc.id,
          slugs: ["never-registered"],
        }),
      ),
    ).rejects.toMatchObject({ code: "TAG_NOT_FOUND" });

    const after = await asOwner((tx) =>
      tx.query.documents.findFirst({ where: eq(schema.documents.id, doc.id) }),
    );
    expect(after!.tags).toEqual([]);
  });

  it("dedupes, sorts and drops malformed slugs before storing", async () => {
    await asOwner((tx) => createTag(tx, ctx, { name: "Signed" }));
    await asOwner((tx) => createTag(tx, ctx, { name: "Zebra" }));
    const doc = await mkDoc("normalize-doc");

    const result = await asOwner((tx) =>
      setDocumentTags(tx, ctx, {
        documentId: doc.id,
        // Duplicate, upper case, and one that is not a valid slug at all.
        slugs: ["zebra", "signed", "SIGNED", "not a slug!"],
      }),
    );
    // Sorted, so two documents with the same tags store the same array.
    expect(result.after).toEqual(["signed", "zebra"]);
  });

  it("deleting a tag strips it from every document carrying it", async () => {
    const tag = await asOwner((tx) => createTag(tx, ctx, { name: "Temporary" }));
    const a = await mkDoc("del-a");
    const b = await mkDoc("del-b");
    for (const doc of [a, b]) {
      await asOwner((tx) =>
        setDocumentTags(tx, ctx, { documentId: doc.id, slugs: [tag.slug] }),
      );
    }

    const counts = await asOwner((tx) => countDocumentsByTag(tx, tenantId));
    expect(counts["temporary"]).toBe(2);

    const fresh = await asOwner((tx) =>
      tx.query.documentTags.findFirst({
        where: eq(schema.documentTags.id, tag.id),
      }),
    );
    const result = await asOwner((tx) =>
      deleteTag(tx, ctx, { tagId: tag.id, expectedVersion: fresh!.version }),
    );
    expect(result.documentsUpdated).toBe(2);

    const rows = await asOwner((tx) =>
      tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.tenantId, tenantId)),
    );
    // No document is left pointing at a registry entry that is gone.
    expect(rows.every((r) => !r.tags.includes("temporary"))).toBe(true);
    expect(
      await asOwner((tx) => listTags(tx, tenantId)).then((t) =>
        t.some((x) => x.slug === "temporary"),
      ),
    ).toBe(false);
  });

  /**
   * Owner-only for the same reason structural folder operations are: the sweep
   * rewrites documents across the tenant, and RLS hides owners-only ones from
   * staff. A staff-run delete would drop the registry entry while silently
   * skipping exactly the documents it could not see.
   */
  it("only an owner can delete a tag", async () => {
    const tag = await asOwner((tx) => createTag(tx, ctx, { name: "Owner Only" }));
    const staffCtx = { tenantId, userId: "user-staff", role: "staff" as const };
    await expect(
      withTenant(
        tenantId,
        (tx) => deleteTag(tx, staffCtx, { tagId: tag.id, expectedVersion: tag.version }),
        { role: "staff" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /* ---- filtering ---- */

  it("filters by tag with no search text at all", async () => {
    await asOwner((tx) => createTag(tx, ctx, { name: "Filter A" }));
    await asOwner((tx) => createTag(tx, ctx, { name: "Filter B" }));
    const both = await mkDoc("filter-both");
    const onlyA = await mkDoc("filter-a");
    await asOwner((tx) =>
      setDocumentTags(tx, ctx, {
        documentId: both.id,
        slugs: ["filter-a", "filter-b"],
      }),
    );
    await asOwner((tx) =>
      setDocumentTags(tx, ctx, { documentId: onlyA.id, slugs: ["filter-a"] }),
    );

    const byOne = await asOwner((tx) =>
      searchDocuments(tx, tenantId, { tags: ["filter-a"] }),
    );
    expect(byOne.hits.map((h) => h.fileName).sort()).toEqual([
      "filter-a.pdf",
      "filter-both.pdf",
    ]);

    // Two tags AND together — a hit must carry both.
    const byBoth = await asOwner((tx) =>
      searchDocuments(tx, tenantId, { tags: ["filter-a", "filter-b"] }),
    );
    expect(byBoth.hits.map((h) => h.fileName)).toEqual(["filter-both.pdf"]);
  });

  it("filters by origin, and combines a tag with a text term", async () => {
    const doc = await mkDoc("acme-drawing");
    await asOwner((tx) => createTag(tx, ctx, { name: "Combo" }));
    await asOwner((tx) =>
      setDocumentTags(tx, ctx, { documentId: doc.id, slugs: ["combo"] }),
    );

    const combined = await asOwner((tx) =>
      searchDocuments(tx, tenantId, { q: "acme", tags: ["combo"] }),
    );
    expect(combined.hits.map((h) => h.fileName)).toEqual(["acme-drawing.pdf"]);

    // Same tag, a term that does not match it: no hits.
    const contradictory = await asOwner((tx) =>
      searchDocuments(tx, tenantId, { q: "zzzznomatch", tags: ["combo"] }),
    );
    expect(contradictory.hits).toHaveLength(0);

    const dmsOnly = await asOwner((tx) =>
      searchDocuments(tx, tenantId, { tags: ["combo"], origin: "accounting" }),
    );
    expect(dmsOnly.hits).toHaveLength(0);
  });

  /* ---- saved views ---- */

  it("round-trips a view through storage and back into parameters", async () => {
    const view = await asOwner((tx) =>
      createSavedView(tx, ctx, {
        name: "Open Permits",
        scope: "tenant",
        query: { q: "permit", tags: ["permit"] },
      }),
    );
    expect(view.name).toBe("Open Permits");

    const views = await asOwner((tx) =>
      listSavedViews(tx, tenantId, ctx.userId),
    );
    const found = views.find((v) => v.id === view.id)!;
    expect(found.query).toEqual({ q: "permit", tags: ["permit"] });
    expect(found.href).toBe(
      "/dashboard/m/documents/search?q=permit&tag=permit",
    );
  });

  it("refuses a view with no filters at all", async () => {
    await expect(
      asOwner((tx) =>
        createSavedView(tx, ctx, { name: "Everything", scope: "tenant", query: {} }),
      ),
    ).rejects.toMatchObject({ code: "VIEW_QUERY_EMPTY" });
  });

  it("scopes name collisions to the creator, not the tenant", async () => {
    await asOwner((tx) =>
      createSavedView(tx, ctx, {
        name: "My List",
        scope: "private",
        query: { q: "alpha" },
      }),
    );
    await expect(
      asOwner((tx) =>
        createSavedView(tx, ctx, {
          name: "My List",
          scope: "private",
          query: { q: "beta" },
        }),
      ),
    ).rejects.toMatchObject({ code: "VIEW_NAME_TAKEN" });

    // A colleague may use the same name — the unique is (tenant, creator, name).
    const otherCtx = { tenantId, userId: "user-other", role: "staff" as const };
    await expect(
      asOwner((tx) =>
        createSavedView(tx, otherCtx, {
          name: "My List",
          scope: "private",
          query: { q: "gamma" },
        }),
      ),
    ).resolves.toBeTruthy();
  });

  it("shows shared views to everyone and private ones only to their creator", async () => {
    await asOwner((tx) =>
      createSavedView(tx, ctx, {
        name: "Shared Thing",
        scope: "tenant",
        query: { q: "shared" },
      }),
    );
    const otherCtx = { tenantId, userId: "user-nosy", role: "staff" as const };
    await asOwner((tx) =>
      createSavedView(tx, otherCtx, {
        name: "Nosy Private",
        scope: "private",
        query: { q: "secret" },
      }),
    );

    const mine = await asOwner((tx) => listSavedViews(tx, tenantId, ctx.userId));
    expect(mine.some((v) => v.name === "Shared Thing")).toBe(true);
    expect(mine.some((v) => v.name === "Nosy Private")).toBe(false);

    const theirs = await asOwner((tx) =>
      listSavedViews(tx, tenantId, "user-nosy"),
    );
    expect(theirs.some((v) => v.name === "Nosy Private")).toBe(true);
  });

  it("lets the creator or an owner delete, and refuses anyone else", async () => {
    const authorCtx = { tenantId, userId: "user-author", role: "staff" as const };
    const view = await asOwner((tx) =>
      createSavedView(tx, authorCtx, {
        name: "Author View",
        scope: "tenant",
        query: { q: "author" },
      }),
    );

    const strangerCtx = { tenantId, userId: "user-stranger", role: "staff" as const };
    await expect(
      withTenant(
        tenantId,
        (tx) => deleteSavedView(tx, strangerCtx, { viewId: view.id }),
        { role: "staff" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // An owner can tidy up after somebody who has left.
    await expect(
      asOwner((tx) => deleteSavedView(tx, ctx, { viewId: view.id })),
    ).resolves.toMatchObject({ name: "Author View" });
  });

  /**
   * The reason the query column is re-parsed on READ: a row that was never
   * written by this code — a hand edit, a bad migration, a future version —
   * must degrade to a usable view rather than reaching the query layer.
   */
  it("sanitizes a stored query that this code never would have written", async () => {
    const [row] = await asOwner((tx) =>
      tx
        .insert(schema.documentSavedViews)
        .values({
          tenantId,
          name: "Hand Edited",
          nameKey: "hand edited",
          scope: "tenant",
          createdByClerkUserId: ctx.userId,
          query: {
            q: "legit",
            folderId: "'; drop table documents; --",
            tags: ["as-built", "NOT A SLUG"],
            origin: "superuser",
            extraField: { nested: true },
          },
        })
        .returning(),
    );

    const views = await asOwner((tx) =>
      listSavedViews(tx, tenantId, ctx.userId),
    );
    const found = views.find((v) => v.id === row.id)!;
    // The injection string is not a uuid, the bogus origin is not in the enum,
    // the malformed slug fails the slug pattern, and the unknown key is
    // stripped. What survives is the one field that was actually valid.
    expect(found.query).toEqual({ q: "legit", tags: ["as-built"] });
    expect(found.href).toBe(
      "/dashboard/m/documents/search?q=legit&tag=as-built",
    );
  });
});
