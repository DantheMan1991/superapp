import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  attachDocumentToRecord,
  attachmentCounts,
  attachmentsForRecord,
  detachAllForEntity,
  detachDocumentFromRecord,
  primaryAttachments,
  setPrimaryAttachment,
  type AttachmentTarget,
} from "../src/modules/documents/attachments";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * Documents — attaching a file to a record that is not an accounting one.
 * Livestock slice 4b's Layer 0 half.
 *
 * The claims worth certifying are the ones a screen would get wrong quietly:
 *
 *   1. **The FIRST photo becomes the picture and a later one does not steal
 *      it.** A gallery of one with a blank thumbnail is a bug in every reader's
 *      eyes; a photo silently taking over the portrait is worse.
 *   2. **A profile picture has to be a picture**, and the refusal has to name
 *      the file rather than the rule.
 *   3. **Detaching removes the ATTACHMENT, never the file** — and takes the
 *      primary flag with it rather than promoting whatever is next.
 *   4. **A record with photos but no chosen picture is ABSENT from the
 *      thumbnail map**, so a list shows a placeholder instead of picking one.
 */
d("document attachments", () => {
  const STAMP = `attach-${process.pid}`;
  const USER = `${STAMP}-owner`;

  let tenantId: string;
  const cow = "33333333-3333-4333-8333-333333333333";
  const otherCow = "44444444-4444-4444-8444-444444444444";
  const target: AttachmentTarget = {
    extensionSlug: "livestock",
    entityType: "livestock_lot",
    entityId: cow,
  };
  const ctx = () => ({ tenantId, userId: USER });

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: USER });

  /** A document row straight in, so these tests need no blob storage. */
  async function newDoc(
    name: string,
    mimeType = "image/jpeg",
  ): Promise<string> {
    return asOwner(async (tx) => {
      const [doc] = await tx
        .insert(schema.documents)
        .values({
          tenantId,
          origin: "dms",
          blobPathname: `docs/${tenantId}/files/${name}`,
          fileName: name,
          mimeType,
          sizeBytes: 10,
          sha256: `${STAMP}-${name}`,
          effectiveVisibility: "members",
        })
        .returning();
      return doc.id;
    });
  }

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Attachments",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("the FIRST photo becomes the picture, and a later one does not take it", async () => {
    const first = await newDoc("first.jpg");
    const second = await newDoc("second.jpg");

    const a = await asOwner((tx) =>
      attachDocumentToRecord(tx, ctx(), { documentId: first, target }),
    );
    expect(a.isPrimary).toBe(true);

    const b = await asOwner((tx) =>
      attachDocumentToRecord(tx, ctx(), { documentId: second, target }),
    );
    expect(b.isPrimary).toBe(false);

    // Portrait first, then newest — the order a gallery renders in.
    const list = await asOwner((tx) =>
      attachmentsForRecord(tx, tenantId, target),
    );
    expect(list.map((row) => row.document.fileName)).toEqual([
      "first.jpg",
      "second.jpg",
    ]);
  });

  it("attaching a file marks it FILED — it has found a home", async () => {
    const doc = await newDoc("filed.jpg");
    await asOwner((tx) =>
      attachDocumentToRecord(tx, ctx(), { documentId: doc, target }),
    );
    const row = await asOwner((tx) =>
      tx.query.documents.findFirst({ where: eq(schema.documents.id, doc) }),
    );
    expect(row?.status).toBe("filed");
  });

  it("refuses the same file on the same record twice", async () => {
    const doc = await newDoc("twice.jpg");
    await asOwner((tx) =>
      attachDocumentToRecord(tx, ctx(), { documentId: doc, target }),
    );
    await expect(
      asOwner((tx) =>
        attachDocumentToRecord(tx, ctx(), { documentId: doc, target }),
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_EXISTS" });
  });

  it("A PROFILE PICTURE HAS TO BE A PICTURE", async () => {
    const manual = await newDoc("manual.pdf", "application/pdf");
    // Attaching it is fine — a tractor's manual is a legitimate attachment.
    const row = await asOwner((tx) =>
      attachDocumentToRecord(tx, ctx(), { documentId: manual, target }),
    );
    expect(row.isPrimary).toBe(false);

    await expect(
      asOwner((tx) =>
        setPrimaryAttachment(tx, ctx(), { documentId: manual, target }),
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_AN_IMAGE" });
  });

  it("refuses a TIFF as the picture, because the browser will not show one", async () => {
    // Accepted for upload — a scanner makes them — and not inline-safe, so it
    // arrives as a download prompt. A portrait nobody can see is not a portrait.
    const scan = await newDoc("scan.tiff", "image/tiff");
    await expect(
      asOwner((tx) =>
        attachDocumentToRecord(tx, ctx(), {
          documentId: scan,
          target,
          makePrimary: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_AN_IMAGE" });
  });

  it("moves the picture, and never leaves two", async () => {
    const list = await asOwner((tx) =>
      attachmentsForRecord(tx, tenantId, target),
    );
    const second = list.find((row) => row.document.fileName === "second.jpg")!;
    await asOwner((tx) =>
      setPrimaryAttachment(tx, ctx(), {
        documentId: second.document.id,
        target,
      }),
    );
    const after = await asOwner((tx) =>
      attachmentsForRecord(tx, tenantId, target),
    );
    expect(after.filter((row) => row.isPrimary)).toHaveLength(1);
    expect(after[0].document.fileName).toBe("second.jpg");
  });

  it("detaching removes the ATTACHMENT and leaves the FILE alone", async () => {
    const doc = await newDoc("detach-me.jpg");
    await asOwner((tx) =>
      attachDocumentToRecord(tx, ctx(), { documentId: doc, target }),
    );
    await asOwner((tx) =>
      detachDocumentFromRecord(tx, ctx(), { documentId: doc, target }),
    );

    const still = await asOwner((tx) =>
      tx.query.documents.findFirst({ where: eq(schema.documents.id, doc) }),
    );
    expect(still?.id).toBe(doc);
    expect(still?.status).not.toBe("trashed");

    await expect(
      asOwner((tx) =>
        detachDocumentFromRecord(tx, ctx(), { documentId: doc, target }),
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("DETACHING THE PICTURE LEAVES THE RECORD WITHOUT ONE, rather than promoting the next", async () => {
    // The app picking a portrait is the thing the flag exists to stop.
    const list = await asOwner((tx) =>
      attachmentsForRecord(tx, tenantId, target),
    );
    const primary = list.find((row) => row.isPrimary)!;
    await asOwner((tx) =>
      detachDocumentFromRecord(tx, ctx(), {
        documentId: primary.document.id,
        target,
      }),
    );
    const after = await asOwner((tx) =>
      attachmentsForRecord(tx, tenantId, target),
    );
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((row) => row.isPrimary)).toBe(false);

    // And the thumbnail map is ABSENT rather than holding a null, so a list
    // shows a placeholder instead of whichever photo happens to sort first.
    const portraits = await asOwner((tx) =>
      primaryAttachments(tx, tenantId, "livestock_lot", [cow]),
    );
    expect(portraits.has(cow)).toBe(false);

    // Which is a different question from "does it have any photos".
    const counts = await asOwner((tx) =>
      attachmentCounts(tx, tenantId, "livestock_lot", [cow]),
    );
    expect(counts.get(cow)).toBe(after.length);
  });

  it("refuses a target that is not a slug", async () => {
    const doc = await newDoc("bad-target.jpg");
    await expect(
      asOwner((tx) =>
        attachDocumentToRecord(tx, ctx(), {
          documentId: doc,
          target: { ...target, entityType: "Livestock Lot" },
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TARGET_INVALID" });
  });

  it("a trashed file cannot be attached", async () => {
    const doc = await newDoc("trashed.jpg");
    await asOwner((tx) =>
      tx
        .update(schema.documents)
        .set({ status: "trashed", trashedAt: new Date() })
        .where(eq(schema.documents.id, doc)),
    );
    await expect(
      asOwner((tx) =>
        attachDocumentToRecord(tx, ctx(), { documentId: doc, target }),
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_TRASHED" });
  });

  it("detaches everything for a record — the promise standing in for a foreign key", async () => {
    const doc = await newDoc("other-cow.jpg");
    const otherTarget = { ...target, entityId: otherCow };
    await asOwner((tx) =>
      attachDocumentToRecord(tx, ctx(), {
        documentId: doc,
        target: otherTarget,
      }),
    );

    const removed = await asOwner((tx) =>
      detachAllForEntity(tx, tenantId, otherTarget),
    );
    expect(removed).toBe(1);
    expect(
      await asOwner((tx) => attachmentsForRecord(tx, tenantId, otherTarget)),
    ).toHaveLength(0);
    // And it left the OTHER record's photos alone.
    expect(
      (await asOwner((tx) => attachmentsForRecord(tx, tenantId, target))).length,
    ).toBeGreaterThan(0);
  });
});
