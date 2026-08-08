import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { documentsMailExtension } from "../../src/modules/documents/mail/extension";
import { d } from "./_shared";

const STAMP_DMS = `iso-dms-${process.pid}`;

interface DmsFixture {
  openFolderId: string;
  lockedFolderId: string;
  openDocId: string;
  lockedDocId: string;
  versionId: string;
  tagId: string;
  viewId: string;
  templateId: string;
  templateVersionId: string;
}

d("documents DMS isolation (RLS + role dimension + composite FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, DmsFixture> = {};

  const seg = (id: string) => id.replace(/-/g, "").toLowerCase();

  async function seedDms(tenantId: string, tag: string): Promise<DmsFixture> {
    // Seeded as owner: the fixture deliberately creates owners-only rows, and
    // the member policy's WITH CHECK would (correctly) refuse them as staff.
    return withTenant(
      tenantId,
      async (tx) => {
        const [open] = await tx
          .insert(schema.documentFolders)
          .values({
            tenantId,
            name: `Jobs ${tag}`,
            nameKey: `jobs ${tag}`.toLowerCase(),
            path: "/00000000000000000000000000000000/",
            visibility: "members",
            effectiveVisibility: "members",
          })
          .returning();
        await tx
          .update(schema.documentFolders)
          .set({ path: `/${seg(open.id)}/` })
          .where(eq(schema.documentFolders.id, open.id));

        const [locked] = await tx
          .insert(schema.documentFolders)
          .values({
            tenantId,
            parentId: open.id,
            name: `Payroll ${tag}`,
            nameKey: `payroll ${tag}`.toLowerCase(),
            path: "/00000000000000000000000000000001/",
            depth: 2,
            visibility: "owners",
            effectiveVisibility: "owners",
          })
          .returning();
        await tx
          .update(schema.documentFolders)
          .set({ path: `/${seg(open.id)}/${seg(locked.id)}/` })
          .where(eq(schema.documentFolders.id, locked.id));

        const [openDoc] = await tx
          .insert(schema.documents)
          .values({
            tenantId,
            origin: "dms",
            folderId: open.id,
            filedAt: new Date(),
            blobPathname: `docs/${tenantId}/files/open-${tag}.pdf`,
            fileName: `open-${tag}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: `dms-open-${tag}`,
            effectiveVisibility: "members",
          })
          .returning();

        const [lockedDoc] = await tx
          .insert(schema.documents)
          .values({
            tenantId,
            origin: "dms",
            folderId: locked.id,
            filedAt: new Date(),
            blobPathname: `docs/${tenantId}/files/locked-${tag}.pdf`,
            fileName: `locked-${tag}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: `dms-locked-${tag}`,
            effectiveVisibility: "owners",
            // The CONTENTS of an owners-only file, not just its name. Since the
            // text producer shipped, `search_tsv` indexes this at weight D —
            // which raised the stakes of a leak from "a filename" to "the
            // wording of the document". The tests below read it back.
            extractedText: `severance terms for locked-${tag} zephyrqx`,
            textExtraction: "done",
          })
          .returning();

        const [version] = await tx
          .insert(schema.documentVersions)
          .values({
            tenantId,
            documentId: lockedDoc.id,
            versionNo: 1,
            blobPathname: `docs/${tenantId}/files/locked-${tag}.pdf`,
            fileName: `locked-${tag}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: `dms-locked-${tag}`,
            extractedText: `severance terms for locked-${tag} zephyrqx`,
            textExtraction: "done",
            isCurrent: true,
          })
          .returning();

        const [dmsTag] = await tx
          .insert(schema.documentTags)
          .values({ tenantId, slug: `tag-${tag.toLowerCase()}`, name: `Tag ${tag}` })
          .returning();

        const [view] = await tx
          .insert(schema.documentSavedViews)
          .values({
            tenantId,
            name: `View ${tag}`,
            nameKey: `view ${tag}`.toLowerCase(),
            createdByClerkUserId: `user-${tag}`,
            query: { folderId: open.id },
          })
          .returning();

        const [template] = await tx
          .insert(schema.documentTemplates)
          .values({
            tenantId,
            name: `Waiver ${tag}`,
            nameKey: `waiver ${tag}`.toLowerCase(),
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();

        const [templateVersion] = await tx
          .insert(schema.documentTemplateVersions)
          .values({
            tenantId,
            templateId: template.id,
            versionNo: 1,
            body: `Received from {{payer}} — ${tag}`,
            createdByClerkUserId: `user-${tag}`,
          })
          .returning();

        return {
          openFolderId: open.id,
          lockedFolderId: locked.id,
          openDocId: openDoc.id,
          lockedDocId: lockedDoc.id,
          versionId: version.id,
          tagId: dmsTag.id,
          viewId: view.id,
          templateId: template.id,
          templateVersionId: templateVersion.id,
        };
      },
      { role: "owner" },
    );
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_DMS}-a`, name: "DMS Iso A", slug: `${STAMP_DMS}-a` },
          { clerkOrgId: `${STAMP_DMS}-b`, name: "DMS Iso B", slug: `${STAMP_DMS}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedDms(tenantA, "A");
    fx.b = await seedDms(tenantB, "B");
    // Settings are member_read-only, so provisioning writes them as the system.
    await withSystem(async (tx) => {
      await tx.insert(schema.documentSettings).values({ tenantId: tenantA });
      await tx.insert(schema.documentSettings).values({ tenantId: tenantB });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  /* ---- tenant dimension ---- */

  it("unscoped selects return only this tenant's DMS rows", async () => {
    const [folders, versions, tags, views, templates, templateVersions] =
      await withTenant(
        tenantA,
        async (tx) =>
          Promise.all([
            tx.select().from(schema.documentFolders),
            tx.select().from(schema.documentVersions),
            tx.select().from(schema.documentTags),
            tx.select().from(schema.documentSavedViews),
            tx.select().from(schema.documentTemplates),
            tx.select().from(schema.documentTemplateVersions),
          ]),
        { role: "owner" },
      );
    for (const rows of [
      folders,
      versions,
      tags,
      views,
      templates,
      templateVersions,
    ]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
    }
  });

  it("cannot INSERT a template or template version for the other tenant", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.documentTemplates).values({
            tenantId: tenantB,
            name: "smuggled",
            nameKey: "smuggled",
            createdByClerkUserId: "user-a",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.documentTemplateVersions).values({
            tenantId: tenantB,
            templateId: fx.b.templateId,
            versionNo: 2,
            body: "smuggled",
            createdByClerkUserId: "user-a",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  // The composite FK is what stops A's version from being attached to B's
  // template even when the tenant_id column itself is honest.
  it("composite FK: A's template version cannot point at B's template", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.documentTemplateVersions).values({
            tenantId: tenantA,
            templateId: fx.b.templateId,
            versionNo: 2,
            body: "cross-tenant",
            createdByClerkUserId: "user-a",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  /**
   * document_generations is member_READ-only, like document_share_events: it
   * records what the business produced and sent, so a member who could write it
   * could fabricate or erase a document's provenance.
   */
  it("generations are readable but not writable by a member", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.documentGenerations).values({
            tenantId: tenantA,
            templateId: fx.a.templateId,
            templateVersionNo: 1,
            number: 9999,
            generatedByClerkUserId: "user-a",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();

    // Reading is allowed and stays tenant-scoped.
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.documentGenerations),
      { role: "owner" },
    );
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("cross-tenant UPDATE and DELETE affect zero template rows", async () => {
    const changed = await withTenant(
      tenantA,
      async (tx) => {
        const updated = await tx
          .update(schema.documentTemplates)
          .set({ name: "hijacked" })
          .where(eq(schema.documentTemplates.tenantId, tenantB))
          .returning({ id: schema.documentTemplates.id });
        const deleted = await tx
          .delete(schema.documentTemplateVersions)
          .where(eq(schema.documentTemplateVersions.tenantId, tenantB))
          .returning({ id: schema.documentTemplateVersions.id });
        return { updated, deleted };
      },
      { role: "owner" },
    );
    expect(changed.updated).toHaveLength(0);
    expect(changed.deleted).toHaveLength(0);
  });

  it("cannot INSERT a folder attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentFolders).values({
          tenantId: tenantB,
          name: "smuggled",
          nameKey: "smuggled",
          path: "/00000000000000000000000000000002/",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK blocks parenting a folder to the other tenant's folder", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentFolders).values({
          tenantId: tenantA,
          parentId: fx.b.openFolderId,
          name: "smuggled-child",
          nameKey: "smuggled-child",
          path: "/00000000000000000000000000000003/",
          depth: 2,
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK blocks filing a document into the other tenant's folder", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documents).values({
          tenantId: tenantA,
          origin: "dms",
          folderId: fx.b.openFolderId,
          fileName: "smuggled.pdf",
          mimeType: "application/pdf",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK blocks versioning the other tenant's document", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentVersions).values({
          tenantId: tenantA,
          documentId: fx.b.openDocId,
          versionNo: 2,
          blobPathname: `docs/${tenantA}/files/smuggled.pdf`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant UPDATE and DELETE affect zero rows", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.documentFolders)
          .set({ name: "hijacked" })
          .where(eq(schema.documentFolders.id, fx.b.openFolderId))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.documentTags)
          .where(eq(schema.documentTags.id, fx.b.tagId))
          .returning(),
      { role: "owner" },
    );
    expect(deleted).toHaveLength(0);
  });

  /* ---- role dimension: the reason app.tenant_role exists ---- */

  it("staff cannot see their OWN tenant's owners-only folder or document", async () => {
    const result = await withTenant(tenantA, async (tx) => ({
      folders: await tx.select().from(schema.documentFolders),
      docs: await tx.select().from(schema.documents),
    }));
    expect(result.folders.map((f) => f.id)).toContain(fx.a.openFolderId);
    expect(result.folders.map((f) => f.id)).not.toContain(fx.a.lockedFolderId);
    expect(result.docs.map((r) => r.id)).toContain(fx.a.openDocId);
    expect(result.docs.map((r) => r.id)).not.toContain(fx.a.lockedDocId);
  });

  it("the default role is staff — a two-argument withTenant is fail-closed", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, fx.a.lockedDocId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("owner sees both, and still only within their own tenant", async () => {
    const result = await withTenant(
      tenantA,
      async (tx) => ({
        own: await tx.select().from(schema.documents),
        other: await tx
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, fx.b.lockedDocId)),
      }),
      { role: "owner" },
    );
    expect(result.own.map((r) => r.id)).toContain(fx.a.lockedDocId);
    expect(result.own.map((r) => r.id)).toContain(fx.a.openDocId);
    expect(result.other).toHaveLength(0);
  });

  /**
   * The composer's image picker, through the extension seam.
   *
   * THE POINT OF THIS TEST is that `src/modules/documents/mail/extension.ts` has
   * no visibility predicate in it at all — `searchImages` filters on tenant,
   * status, type and size, and nothing else. What keeps an owners-only folder's
   * photograph out of a staff user's picker is RLS, reached through the CALLER'S
   * transaction, exactly as the `MailImageSource` contract requires.
   *
   * That is the property the seam exists for, and it is worth asserting rather
   * than believing: a future refactor that opened its own `withTenant`, or
   * reached for `withSystem`, would still pass every unit test in the module.
   */
  it("the mail image source inherits Documents' visibility, with no predicate of its own", async () => {
    const ctxFor = (role: "owner" | "staff") => ({
      tenantId: tenantA,
      userId: "user_iso_images",
      role,
    });

    // A picture inside the owners-only folder. Created as owner, because the
    // member policy's WITH CHECK would correctly refuse it as staff.
    const hiddenImageId = await withTenant(
      tenantA,
      async (tx) => {
        const [row] = await tx
          .insert(schema.documents)
          .values({
            tenantId: tenantA,
            origin: "dms",
            folderId: fx.a.lockedFolderId,
            title: "Confidential site photo",
            fileName: "confidential.png",
            mimeType: "image/png",
            sizeBytes: 2048,
            blobPathname: `tenants/${tenantA}/files/confidential.png`,
            effectiveVisibility: "owners",
          })
          .returning({ id: schema.documents.id });
        return row.id;
      },
      { role: "owner" },
    );

    const images = documentsMailExtension.images!;

    // STAFF: the picker cannot offer it, and cannot open it by id either —
    // knowing the id is not permission, and `open` returns the same null for
    // "not yours" as for "not there" so it cannot be used to probe.
    const asStaff = await withTenant(
      tenantA,
      async (tx) => ({
        found: await images.search(tx, ctxFor("staff"), "", 50),
        opened: await images.open(tx, ctxFor("staff"), hiddenImageId),
      }),
      { role: "staff" },
    );
    expect(asStaff.found.map((i) => i.id)).not.toContain(hiddenImageId);
    expect(asStaff.opened).toBeNull();

    // OWNER: the same call, the same code, a different row set.
    const asOwner = await withTenant(
      tenantA,
      async (tx) => ({
        found: await images.search(tx, ctxFor("owner"), "", 50),
        opened: await images.open(tx, ctxFor("owner"), hiddenImageId),
      }),
      { role: "owner" },
    );
    expect(asOwner.found.map((i) => i.id)).toContain(hiddenImageId);
    expect(asOwner.opened?.type).toBe("image/png");

    // And never across tenants, whatever the role.
    const asOtherTenantOwner = await withTenant(
      tenantB,
      (tx) =>
        images.open(
          tx,
          { tenantId: tenantB, userId: "user_iso_images", role: "owner" },
          hiddenImageId,
        ),
      { role: "owner" },
    );
    expect(asOtherTenantOwner).toBeNull();
  });

  it("versions inherit visibility with no flag of their own", async () => {
    const asStaff = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.documentVersions),
    );
    expect(asStaff).toHaveLength(0);

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.documentVersions),
      { role: "owner" },
    );
    expect(asOwner.map((v) => v.id)).toContain(fx.a.versionId);
  });

  /**
   * Search reaches inside files now, so the thing being protected is no longer
   * a filename — it is the WORDING of an owners-only document. Nothing about
   * the policy changed to make that true (extracted_text is a column on a row
   * RLS already governs), and that is exactly why it is worth asserting: the
   * protection is inherited rather than added, so nobody re-derived it.
   *
   * Both the tenant boundary and the role boundary, and both tables, because
   * the text is stored twice by design — authoritative on the version,
   * denormalized onto the document.
   */
  it("never leaks an owners-only document's TEXT, across tenants or roles", async () => {
    const secret = "zephyrqx";

    // The other tenant, at the highest role it has.
    const acrossTenants = await withTenant(
      tenantB,
      async (tx) => ({
        docs: await tx
          .select({ text: schema.documents.extractedText })
          .from(schema.documents)
          .where(eq(schema.documents.id, fx.a.lockedDocId)),
        versions: await tx
          .select({ text: schema.documentVersions.extractedText })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.id, fx.a.versionId)),
      }),
      { role: "owner" },
    );
    expect(acrossTenants.docs).toHaveLength(0);
    expect(acrossTenants.versions).toHaveLength(0);

    // The right tenant, at the wrong role. Staff cannot see the row at all, so
    // there is no text to read — the point being that the text needs no
    // predicate of its own to be protected.
    const asStaff = await withTenant(tenantA, async (tx) => ({
      docs: await tx
        .select({ text: schema.documents.extractedText })
        .from(schema.documents)
        .where(eq(schema.documents.id, fx.a.lockedDocId)),
      versions: await tx
        .select({ text: schema.documentVersions.extractedText })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, fx.a.versionId)),
    }));
    expect(asStaff.docs).toHaveLength(0);
    expect(asStaff.versions).toHaveLength(0);

    // And it really is there for the owner, so the assertions above are about
    // RLS rather than about an empty fixture.
    const asOwner = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select({ text: schema.documents.extractedText })
          .from(schema.documents)
          .where(eq(schema.documents.id, fx.a.lockedDocId)),
      { role: "owner" },
    );
    expect(asOwner[0]?.text).toContain(secret);
  });

  /**
   * The generated `search_tsv` column is what the search page actually queries,
   * and it is derived from `extracted_text` — so it is a second surface the
   * same words reach. RLS covers it for the same reason (it is a column on the
   * row), but a full-text hit is the path a real leak would take, so it is
   * asserted through the query shape search.ts really uses.
   */
  it("full-text search cannot match another tenant's document contents", async () => {
    // Both tenants have a locked fixture carrying the same distinctive word, so
    // "no rows" would be the wrong assertion — each tenant SHOULD find its own.
    // The claim is about whose document comes back, which is why this asserts
    // on ids rather than on a count.
    const search = (tenantId: string) =>
      withTenant(
        tenantId,
        async (tx) => {
          const res = await tx.execute(
            sql`select d.id from documents d, websearch_to_tsquery('english', 'zephyrqx') tsq
                 where d.search_tsv @@ tsq`,
          );
          return (res.rows ?? []).map((r) => String((r as { id: unknown }).id));
        },
        { role: "owner" },
      );

    const fromB = await search(tenantB);
    expect(fromB).not.toContain(fx.a.lockedDocId);
    // Its own, which is what makes the line above evidence rather than an
    // empty result set agreeing with an empty expectation.
    expect(fromB).toContain(fx.b.lockedDocId);

    const fromA = await search(tenantA);
    expect(fromA).toContain(fx.a.lockedDocId);
    expect(fromA).not.toContain(fx.b.lockedDocId);
  });

  it("staff cannot CREATE a restricted document (WITH CHECK)", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documents).values({
          tenantId: tenantA,
          origin: "dms",
          fileName: "self-hidden.pdf",
          mimeType: "application/pdf",
          effectiveVisibility: "owners",
        }),
      ),
    ).rejects.toThrow();
  });

  // Note the asymmetry with the cross-tenant cases above, which return 0 rows:
  // here USING passes (staff CAN see this open document) and it is WITH CHECK
  // that refuses the RESULT, so Postgres raises instead of filtering. Loud
  // failure is the better outcome — a silent no-op would look like success.
  it("staff cannot MOVE a document into a restricted folder (WITH CHECK)", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx
          .update(schema.documents)
          .set({ effectiveVisibility: "owners", folderId: fx.a.lockedFolderId })
          .where(eq(schema.documents.id, fx.a.openDocId))
          .returning(),
      ),
    ).rejects.toThrow();

    // And the document is untouched.
    const [after] = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, fx.a.openDocId)),
    );
    expect(after.effectiveVisibility).toBe("members");
    expect(after.folderId).toBe(fx.a.openFolderId);
  });

  /* ---- settings are read-only to members ---- */

  it("members read settings but can never write them", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.documentSettings),
    );
    expect(rows).toHaveLength(1);

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.documentSettings).values({ tenantId: tenantA }),
      ),
    ).rejects.toThrow();

    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.documentSettings)
          .set({ shareMaxTtlDays: 365 })
          .where(eq(schema.documentSettings.tenantId, tenantA))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);
  });

  /* ---- constraints and default-deny ---- */

  it("a folder cannot be its own parent", async () => {
    await expect(
      withSystem((tx) =>
        tx.execute(
          sql`update document_folders set parent_id = id where id = ${fx.a.openFolderId}`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("default-deny: no context sees no DMS rows at all", async () => {
    const results = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_role', '', true)`);
      return Promise.all([
        tx.select().from(schema.documentFolders),
        tx.select().from(schema.documentVersions),
        tx.select().from(schema.documentTags),
        tx.select().from(schema.documentSavedViews),
        tx.select().from(schema.documentSettings),
      ]);
    });
    for (const rows of results) expect(rows).toHaveLength(0);
  });
});
