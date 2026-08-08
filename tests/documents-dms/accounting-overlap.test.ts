import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import { listDocuments } from "@/modules/accounting/documents/documents";
import { getCloseChecklist } from "@/modules/accounting/core/close";
import { STAMP_OPS, d } from "./_shared";

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
