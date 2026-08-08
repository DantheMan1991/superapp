import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "@/db";
import { createFolder } from "@/modules/documents/folder-ops";
import { verifyDocumentInvariants } from "@/modules/documents/core/integrity";
import {
  addDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
} from "@/modules/documents/versions";
import { d } from "./_shared";

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
      // The action reads these off the real bytes before opening the
      // transaction; these tests hand `addDocumentVersion` a row directly, so
      // they stand in for that. Distinct per revision, which is what lets the
      // promote/restore tests below assert the index follows the bytes.
      extractedText: `contents of ${tag} v${no}`,
      textExtraction: "done" as const,
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

  /**
   * The search index must describe the bytes actually being served, exactly as
   * `file_name` does. Without this, searching finds a document by the contents
   * of a revision it no longer serves — v1's text answering for v3's file —
   * which is worse than not finding it, because the hit looks right.
   *
   * Both directions are asserted here because both paths end in promoteVersion,
   * and that being the single choke point is the entire design.
   */
  it("moves extracted text with the current bytes, in both directions", async () => {
    const doc = await mkDoc("index", {
      extractedText: "original scope of work",
      textExtraction: "done",
    });

    await asOwner((tx) => addDocumentVersion(tx, ctx, doc.id, bytes("index", 2)));
    const afterV2 = await asOwner((tx) =>
      tx.query.documents.findFirst({ where: eq(schema.documents.id, doc.id) }),
    );
    expect(afterV2!.extractedText).toBe("contents of index v2");
    expect(afterV2!.textExtraction).toBe("done");

    // v1's text was carried onto the materialized v1 row rather than lost, so
    // restoring it needs no blob read and no re-parse.
    const history = await asOwner((tx) =>
      listDocumentVersions(tx, tenantId, doc.id),
    );
    const v1 = history.find((v) => v.versionNo === 1)!;
    await asOwner((tx) => restoreDocumentVersion(tx, ctx, doc.id, v1.id!));

    const afterRestore = await asOwner((tx) =>
      tx.query.documents.findFirst({ where: eq(schema.documents.id, doc.id) }),
    );
    expect(afterRestore!.extractedText).toBe("original scope of work");
    expect(afterRestore!.textExtraction).toBe("done");
  });

  /**
   * A document uploaded before the producer existed has no text and gets none
   * invented for it: v1 materializes as 'pending', which is precisely what the
   * backfill looks for. The failure this prevents is quieter — carrying v2's
   * text onto a restored v1 would leave the index confidently wrong.
   */
  it("materializes an un-read v1 as pending rather than borrowing v2's text", async () => {
    const doc = await mkDoc("legacy");
    await asOwner((tx) => addDocumentVersion(tx, ctx, doc.id, bytes("legacy", 2)));

    const history = await asOwner((tx) =>
      listDocumentVersions(tx, tenantId, doc.id),
    );
    const v1 = history.find((v) => v.versionNo === 1)!;
    await asOwner((tx) => restoreDocumentVersion(tx, ctx, doc.id, v1.id!));

    const after = await asOwner((tx) =>
      tx.query.documents.findFirst({ where: eq(schema.documents.id, doc.id) }),
    );
    expect(after!.extractedText).toBe("");
    expect(after!.textExtraction).toBe("pending");
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
