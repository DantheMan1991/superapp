import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";

// Blob storage is mocked for the whole file: DB tests must never touch
// the network. Extraction tests wire `get` to return a tiny real PNG.
vi.mock("@vercel/blob", () => ({
  get: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
}));
import { get } from "@vercel/blob";

import { withTenant, withSystem, schema } from "../src/db";
import {
  LedgerError,
  postEntry,
  deleteDraft,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  isAllowedUpload,
} from "../src/modules/accounting/documents/allowlist";
import {
  MIN_INLINE_IMAGE_BYTES,
  inboundEmailSchema,
  inboundRecipients,
  parseInboundToken,
  selectEmailAttachments,
} from "../src/modules/accounting/documents/email";
import {
  createDocumentRecord,
  sha256Hex,
} from "../src/modules/accounting/documents/ingest";
import {
  listDocuments,
  loadDocument,
  restoreDocument,
  trashDocument,
} from "../src/modules/accounting/documents/documents";
import {
  attachDocument,
  detachAllForTargets,
  detachDocument,
  listDocumentsForTarget,
  listLinksForDocument,
} from "../src/modules/accounting/documents/links";
import {
  findBankTxnCandidatesForDocument,
  isCandidateMatch,
  matchAmounts,
  matchWindow,
} from "../src/modules/accounting/documents/match";
import { recordExpenseFromReceipt } from "../src/modules/accounting/documents/expense";
import {
  validateExtraction,
  emptyExtraction,
} from "../src/modules/accounting/ai/extract-validate";
import { extractDocument } from "../src/modules/accounting/ai/extract";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createInvoiceDraft,
  deleteInvoiceDraft,
} from "../src/modules/accounting/invoicing/invoices";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

// The blob SDK is mocked above; the lazy env guard still runs, so give it
// a dummy token (nothing in this file ever reaches the network).
process.env.BLOB_READ_WRITE_TOKEN ??= "vercel_blob_rw_TEST_test";

// ---------------------------------------------------------------- pure

describe("upload allowlist (pure)", () => {
  it("accepts every allowlisted type at a sane size", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(isAllowedUpload(mime, 1024)).toBe(true);
    }
  });
  it("rejects HEIC with the rest of the unknown types", () => {
    expect(isAllowedUpload("image/heic", 1024)).toBe(false);
    expect(isAllowedUpload("image/heif", 1024)).toBe(false);
    expect(isAllowedUpload("application/zip", 1024)).toBe(false);
    expect(isAllowedUpload("text/html", 1024)).toBe(false);
    expect(isAllowedUpload("", 1024)).toBe(false);
  });
  it("rejects oversize and empty files", () => {
    expect(isAllowedUpload("image/jpeg", MAX_FILE_BYTES + 1)).toBe(false);
    expect(isAllowedUpload("image/jpeg", MAX_FILE_BYTES)).toBe(true);
    expect(isAllowedUpload("image/jpeg", 0)).toBe(false);
  });
});

describe("inbound token parsing (pure)", () => {
  const domain = "in.example.com";
  it("finds the token in a plain address", () => {
    expect(parseInboundToken(["receipts-abc123def456@in.example.com"], domain)).toBe(
      "abc123def456",
    );
  });
  it("tolerates display-name form and case", () => {
    expect(
      parseInboundToken(
        ['"Yosher Receipts" <RECEIPTS-ABC123DEF456@IN.EXAMPLE.COM>'],
        domain,
      ),
    ).toBe("ABC123DEF456");
  });
  it("scans past unrelated recipients", () => {
    expect(
      parseInboundToken(
        ["bob@corp.com", "receipts-tok1234567890@in.example.com"],
        domain,
      ),
    ).toBe("tok1234567890");
  });
  it("rejects the wrong domain and junk local parts", () => {
    expect(parseInboundToken(["receipts-abc123def456@evil.com"], domain)).toBeNull();
    expect(parseInboundToken(["invoices-abc123def456@in.example.com"], domain)).toBeNull();
    expect(parseInboundToken(["receipts-short@in.example.com"], domain)).toBeNull();
    expect(parseInboundToken(["not-an-email"], domain)).toBeNull();
    expect(parseInboundToken([], domain)).toBeNull();
    expect(parseInboundToken(["receipts-abc123def456@in.example.com"], "")).toBeNull();
  });
  it("zod schema accepts a minimal payload and rejects wrong types", () => {
    const ok = inboundEmailSchema.safeParse({
      type: "email.received",
      data: { email_id: "em_1" },
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(inboundRecipients(ok.data)).toEqual([]);
    }
    expect(
      inboundEmailSchema.safeParse({ type: "email.sent", data: { email_id: "x" } })
        .success,
    ).toBe(false);
    expect(
      inboundEmailSchema.safeParse({ type: "email.received", data: {} }).success,
    ).toBe(false);
  });
  it("collects to + cc + received_for", () => {
    const parsed = inboundEmailSchema.parse({
      type: "email.received",
      data: {
        email_id: "em_1",
        to: ["a@x.com"],
        cc: ["b@x.com"],
        received_for: ["receipts-tok1234567890@in.example.com"],
      },
    });
    expect(parseInboundToken(inboundRecipients(parsed), domain)).toBe(
      "tok1234567890",
    );
  });
});

describe("email attachment selection (pure)", () => {
  const pdf = (over: object = {}) => ({
    content_type: "application/pdf",
    size: 200_000,
    content_disposition: "attachment",
    ...over,
  });
  const logo = (over: object = {}) => ({
    content_type: "image/png",
    size: 40_000,
    content_disposition: "inline",
    ...over,
  });

  it("keeps the bill PDF and drops the signature logo", () => {
    const kept = selectEmailAttachments([pdf(), logo()], isAllowedUpload);
    expect(kept).toHaveLength(1);
    expect(kept[0].content_type).toBe("application/pdf");
  });

  it("drops ALL inline images when any regular attachment exists", () => {
    const bigInlinePhoto = logo({ size: 2_000_000 });
    const kept = selectEmailAttachments([pdf(), bigInlinePhoto], isAllowedUpload);
    expect(kept).toHaveLength(1);
    expect(kept[0].content_type).toBe("application/pdf");
  });

  it("keeps a pasted receipt photo when the email has no real attachment", () => {
    const pastedPhoto = logo({ size: MIN_INLINE_IMAGE_BYTES });
    expect(selectEmailAttachments([pastedPhoto], isAllowedUpload)).toHaveLength(1);
    const smallLogo = logo({ size: MIN_INLINE_IMAGE_BYTES - 1 });
    expect(selectEmailAttachments([smallLogo], isAllowedUpload)).toHaveLength(0);
  });

  it("inline PDFs count as documents regardless of size heuristics", () => {
    const inlinePdf = pdf({ content_disposition: "inline", size: 50_000 });
    const kept = selectEmailAttachments([inlinePdf, logo()], isAllowedUpload);
    expect(kept).toHaveLength(1);
    expect(kept[0].content_type).toBe("application/pdf");
  });

  it("still applies the allowlist and drops tracking pixels", () => {
    const zip = { content_type: "application/zip", size: 500_000, content_disposition: "attachment" };
    const pixel = { content_type: "image/png", size: 120, content_disposition: "attachment" };
    expect(selectEmailAttachments([zip, pixel], isAllowedUpload)).toHaveLength(0);
  });

  it("caps the number of kept attachments", () => {
    const many = Array.from({ length: 15 }, () => pdf());
    expect(selectEmailAttachments(many, isAllowedUpload)).toHaveLength(10);
  });
});

describe("sha256Hex (pure)", () => {
  it("is stable and content-sensitive", () => {
    const a = new TextEncoder().encode("receipt bytes");
    expect(sha256Hex(a)).toBe(sha256Hex(new TextEncoder().encode("receipt bytes")));
    expect(sha256Hex(a)).not.toBe(sha256Hex(new TextEncoder().encode("other")));
    expect(sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("extraction validation (pure)", () => {
  const MODEL = "claude-opus-4-8";
  const NOW = "2026-07-22T00:00:00.000Z";

  it("passes a fully valid payload through", () => {
    const out = validateExtraction(
      {
        docType: "receipt",
        docTypeConfidence: 0.95,
        vendorName: "Starbucks",
        vendorNameConfidence: 0.9,
        documentDate: "2026-07-14",
        documentDateConfidence: 0.85,
        totalCents: 4218,
        totalCentsConfidence: 0.99,
        taxCents: 350,
        taxCentsConfidence: 0.8,
        currency: "usd",
        currencyConfidence: 0.7,
        documentNumber: "R-1001",
        documentNumberConfidence: 0.6,
        lineItems: [{ description: "Latte", quantity: 2, amountCents: 1050 }],
      },
      MODEL,
      NOW,
    );
    expect(out.docType).toBe("receipt");
    expect(out.fields.vendorName.value).toBe("Starbucks");
    expect(out.fields.totalCents.value).toBe(4218);
    expect(out.fields.currency.value).toBe("USD");
    expect(out.lineItems).toHaveLength(1);
    expect(out.model).toBe(MODEL);
    expect(out.extractedAt).toBe(NOW);
  });

  it("clamps confidence and zeroes it for null values", () => {
    const out = validateExtraction(
      {
        docType: "receipt",
        docTypeConfidence: 7,
        vendorName: null,
        vendorNameConfidence: 0.9,
        totalCents: 100,
        totalCentsConfidence: -3,
      },
      MODEL,
      NOW,
    );
    expect(out.docTypeConfidence).toBe(1);
    expect(out.fields.vendorName.value).toBeNull();
    expect(out.fields.vendorName.confidence).toBe(0);
    expect(out.fields.totalCents.confidence).toBe(0);
  });

  it("nulls float cents, string cents, and impossible dates", () => {
    const out = validateExtraction(
      {
        docType: "receipt",
        docTypeConfidence: 1,
        totalCents: 42.18,
        totalCentsConfidence: 0.9,
        taxCents: "350",
        taxCentsConfidence: 0.9,
        documentDate: "2026-02-31",
        documentDateConfidence: 0.9,
      },
      MODEL,
      NOW,
    );
    expect(out.fields.totalCents.value).toBeNull();
    expect(out.fields.taxCents.value).toBeNull();
    expect(out.fields.documentDate.value).toBeNull();
  });

  it("caps line items, drops empty descriptions, degrades unknown docType", () => {
    const out = validateExtraction(
      {
        docType: "napkin",
        docTypeConfidence: 0.5,
        lineItems: [
          ...Array.from({ length: 30 }, (_, i) => ({
            description: `Item ${i}`,
            amountCents: 100,
          })),
          { description: "", amountCents: 100 },
        ],
      },
      MODEL,
      NOW,
    );
    expect(out.docType).toBe("other");
    expect(out.lineItems).toHaveLength(25);
  });

  it("degrades non-object payloads to the empty extraction", () => {
    expect(validateExtraction("garbage", MODEL, NOW)).toEqual(
      emptyExtraction(MODEL, NOW),
    );
    expect(validateExtraction(null, MODEL, NOW)).toEqual(
      emptyExtraction(MODEL, NOW),
    );
  });
});

describe("bank txn matching (pure)", () => {
  it("matchAmounts covers both signs and rejects zero", () => {
    expect(matchAmounts(4218)).toEqual([4218, -4218]);
    expect(matchAmounts(0)).toEqual([]);
  });
  it("window is ±7 days inclusive", () => {
    expect(matchWindow("2026-07-14")).toEqual({ from: "2026-07-07", to: "2026-07-21" });
    const doc = { totalCents: 4218, documentDate: "2026-07-14" };
    expect(isCandidateMatch({ amountCents: -4218, txnDate: "2026-07-07" }, doc)).toBe(true);
    expect(isCandidateMatch({ amountCents: -4218, txnDate: "2026-07-21" }, doc)).toBe(true);
    expect(isCandidateMatch({ amountCents: -4218, txnDate: "2026-07-06" }, doc)).toBe(false);
    expect(isCandidateMatch({ amountCents: -4218, txnDate: "2026-07-22" }, doc)).toBe(false);
    expect(isCandidateMatch({ amountCents: -4217, txnDate: "2026-07-14" }, doc)).toBe(false);
  });
});

// ------------------------------------------------------------------- DB

const STAMP = `doc-test-${process.pid}`;
let tenantId: string;
let owner: LedgerCtx;
let staff: LedgerCtx;
const acct: Record<string, string> = {};

async function accountId(code: string): Promise<string> {
  if (acct[code]) return acct[code];
  const row = await withTenant(tenantId, (tx) =>
    tx.query.accounts.findFirst({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.code, code),
      ),
    }),
  );
  if (!row) throw new Error(`fixture account ${code} missing`);
  acct[code] = row.id;
  return row.id;
}

let docSeq = 0;
async function makeDocument(
  overrides: Partial<Parameters<typeof createDocumentRecord>[2]> = {},
) {
  docSeq += 1;
  return withTenant(tenantId, (tx) =>
    createDocumentRecord(tx, tenantId, {
      blobPathname: `acct/${tenantId}/receipts/fixture-${docSeq}.png`,
      fileName: `fixture-${docSeq}.png`,
      mimeType: "image/png",
      sizeBytes: 1234,
      sha256: `sha-${STAMP}-${docSeq}`,
      source: "upload",
      uploadedByClerkUserId: "owner-user",
      ...overrides,
    }),
  );
}

async function makeDraftEntry(): Promise<string> {
  const cash = await accountId("1000");
  const expense = await accountId("6000");
  const { entry } = await withTenant(tenantId, (tx) =>
    postEntry(tx, owner, {
      status: "draft",
      entryDate: "2026-07-10",
      memo: "doc test draft",
      source: "manual",
      lines: [
        { accountId: expense, amountCents: 5000 },
        { accountId: cash, amountCents: -5000 },
      ],
    }),
  );
  return entry.id;
}

d("documents (DB)", () => {
  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Doc Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner-user", role: "owner" };
    staff = { tenantId, userId: "staff-user", role: "staff" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  describe("ingestion", () => {
    it("inserts and warns on content-hash duplicates without blocking", async () => {
      const first = await makeDocument({ sha256: `dup-${STAMP}` });
      expect(first.duplicateOfId).toBeNull();
      const second = await makeDocument({ sha256: `dup-${STAMP}` });
      expect(second.duplicateOfId).toBe(first.document.id);
      expect(second.document.id).not.toBe(first.document.id);
    });

    it("double-registration of the same pathname returns the same row", async () => {
      const pathname = `acct/${tenantId}/receipts/same-path.png`;
      const a = await makeDocument({ blobPathname: pathname });
      const b = await makeDocument({ blobPathname: pathname });
      expect(b.document.id).toBe(a.document.id);
    });

    it("stores email provenance and no-attachment rows", async () => {
      const withAttachment = await makeDocument({
        source: "email",
        emailFrom: "vendor@corp.com",
        emailSubject: "Your bill",
        emailMessageId: `<msg-${STAMP}@corp.com>`,
        emailReceivedAt: new Date(),
      });
      expect(withAttachment.document.source).toBe("email");
      const none = await makeDocument({
        blobPathname: null,
        fileName: "(no attachment)",
        mimeType: "",
        sizeBytes: 0,
        sha256: "",
        source: "email",
        extractionStatus: "skipped",
      });
      expect(none.document.blobPathname).toBeNull();
      expect(none.document.extractionStatus).toBe("skipped");
    });
  });

  describe("links", () => {
    it("DB CHECK rejects links with zero or two targets", async () => {
      const doc = await makeDocument();
      const entryId = await makeDraftEntry();
      await expect(
        withTenant(tenantId, (tx) =>
          tx.insert(schema.documentLinks).values({
            tenantId,
            documentId: doc.document.id,
            createdByClerkUserId: "owner-user",
          }),
        ),
      ).rejects.toThrow();
      const bankTxnId = await seedBankTxn("-check2", -111, "2026-07-10");
      await expect(
        withTenant(tenantId, (tx) =>
          tx.insert(schema.documentLinks).values({
            tenantId,
            documentId: doc.document.id,
            journalEntryId: entryId,
            bankTransactionId: bankTxnId,
            createdByClerkUserId: "owner-user",
          }),
        ),
      ).rejects.toThrow();
    });

    it("attach files the document; duplicate attach rejects; detach-last re-inboxes", async () => {
      const doc = await makeDocument();
      const entryId = await makeDraftEntry();
      const link = await withTenant(tenantId, (tx) =>
        attachDocument(tx, owner, {
          documentId: doc.document.id,
          target: { type: "entry", id: entryId },
        }),
      );
      let reloaded = await withTenant(tenantId, (tx) =>
        loadDocument(tx, tenantId, doc.document.id),
      );
      expect(reloaded.status).toBe("filed");

      await expect(
        withTenant(tenantId, (tx) =>
          attachDocument(tx, owner, {
            documentId: doc.document.id,
            target: { type: "entry", id: entryId },
          }),
        ),
      ).rejects.toMatchObject({ code: "DOCUMENT_LINK_EXISTS" });

      const views = await withTenant(tenantId, (tx) =>
        listLinksForDocument(tx, tenantId, doc.document.id),
      );
      expect(views).toHaveLength(1);
      expect(views[0].targetType).toBe("entry");

      const forTarget = await withTenant(tenantId, (tx) =>
        listDocumentsForTarget(tx, tenantId, { type: "entry", id: entryId }),
      );
      expect(forTarget.map((r) => r.document.id)).toContain(doc.document.id);

      await withTenant(tenantId, (tx) =>
        detachDocument(tx, owner, { linkId: link.id }),
      );
      reloaded = await withTenant(tenantId, (tx) =>
        loadDocument(tx, tenantId, doc.document.id),
      );
      expect(reloaded.status).toBe("inbox");
    });

    it("attach validates the target and the document state", async () => {
      const doc = await makeDocument();
      await expect(
        withTenant(tenantId, (tx) =>
          attachDocument(tx, owner, {
            documentId: doc.document.id,
            target: { type: "entry", id: crypto.randomUUID() },
          }),
        ),
      ).rejects.toMatchObject({ code: "DOCUMENT_TARGET_INVALID" });

      await withTenant(tenantId, (tx) =>
        trashDocument(tx, owner, {
          documentId: doc.document.id,
          expectedVersion: doc.document.version,
        }),
      );
      const entryId = await makeDraftEntry();
      await expect(
        withTenant(tenantId, (tx) =>
          attachDocument(tx, owner, {
            documentId: doc.document.id,
            target: { type: "entry", id: entryId },
          }),
        ),
      ).rejects.toMatchObject({ code: "DOCUMENT_TRASHED" });
    });
  });

  describe("trash / restore", () => {
    it("blocks trashing a linked document", async () => {
      const doc = await makeDocument();
      const entryId = await makeDraftEntry();
      await withTenant(tenantId, (tx) =>
        attachDocument(tx, owner, {
          documentId: doc.document.id,
          target: { type: "entry", id: entryId },
        }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          trashDocument(tx, owner, {
            documentId: doc.document.id,
            expectedVersion: doc.document.version,
          }),
        ),
      ).rejects.toMatchObject({ code: "DOCUMENT_HAS_LINKS" });
    });

    it("CAS: stale version rejected; trash + restore round-trips", async () => {
      const doc = await makeDocument();
      await expect(
        withTenant(tenantId, (tx) =>
          trashDocument(tx, owner, {
            documentId: doc.document.id,
            expectedVersion: 99,
          }),
        ),
      ).rejects.toMatchObject({ code: "STALE_VERSION" });

      const trashed = await withTenant(tenantId, (tx) =>
        trashDocument(tx, owner, {
          documentId: doc.document.id,
          expectedVersion: doc.document.version,
        }),
      );
      expect(trashed.status).toBe("trashed");
      const trashList = await withTenant(tenantId, (tx) =>
        listDocuments(tx, tenantId, "trash"),
      );
      expect(trashList.map((r) => r.id)).toContain(doc.document.id);

      const restored = await withTenant(tenantId, (tx) =>
        restoreDocument(tx, owner, {
          documentId: doc.document.id,
          expectedVersion: trashed.version,
        }),
      );
      expect(restored.status).toBe("inbox");
    });
  });

  describe("P21 deletion coordination (FK backstop)", () => {
    it("raw draft delete with an attached doc fails at the FK; unlink-first works", async () => {
      const doc = await makeDocument();
      const entryId = await makeDraftEntry();
      await withTenant(tenantId, (tx) =>
        attachDocument(tx, owner, {
          documentId: doc.document.id,
          target: { type: "entry", id: entryId },
        }),
      );
      // The backstop: deleting the entry without detaching must fail.
      await expect(
        withTenant(tenantId, (tx) =>
          tx
            .delete(schema.journalEntries)
            .where(
              and(
                eq(schema.journalEntries.tenantId, tenantId),
                eq(schema.journalEntries.id, entryId),
              ),
            ),
        ),
      ).rejects.toThrow();
      // The coordinated path: detach + delete in one tx.
      await withTenant(tenantId, async (tx) => {
        await detachAllForTargets(tx, tenantId, "entry", [entryId]);
        await deleteDraft(tx, owner, { entryId, expectedVersion: 1 });
      });
      const reloaded = await withTenant(tenantId, (tx) =>
        loadDocument(tx, tenantId, doc.document.id),
      );
      expect(reloaded.status).toBe("inbox");
    });

    it("same for invoice drafts", async () => {
      const doc = await makeDocument();
      const incomeId = await accountId("4010");
      const { invoice } = await withTenant(tenantId, async (tx) => {
        const customer = await createCustomer(tx, owner, { name: "Doc Test Co" });
        const inv = await createInvoiceDraft(tx, owner, {
          customerId: customer.id,
          issueDate: "2026-07-10",
          lines: [
            {
              description: "Service",
              quantity: "1",
              unitPriceCents: 10000,
              incomeAccountId: incomeId,
            },
          ],
        });
        return { invoice: inv };
      });
      await withTenant(tenantId, (tx) =>
        attachDocument(tx, owner, {
          documentId: doc.document.id,
          target: { type: "invoice", id: invoice.id },
        }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          tx
            .delete(schema.invoices)
            .where(
              and(
                eq(schema.invoices.tenantId, tenantId),
                eq(schema.invoices.id, invoice.id),
              ),
            ),
        ),
      ).rejects.toThrow();
      await withTenant(tenantId, async (tx) => {
        await detachAllForTargets(tx, tenantId, "invoice", [invoice.id]);
        await deleteInvoiceDraft(tx, owner, {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
        });
      });
      const reloaded = await withTenant(tenantId, (tx) =>
        loadDocument(tx, tenantId, doc.document.id),
      );
      expect(reloaded.status).toBe("inbox");
    });
  });

  describe("extraction pipeline (injected model, mocked blob)", () => {
    async function resetCooldown(): Promise<void> {
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.accountingSettings)
          .set({ aiLastExtractedAt: null })
          .where(eq(schema.accountingSettings.tenantId, tenantId)),
      );
    }

    async function mockBlobPng(): Promise<void> {
      const png = await sharp({
        create: { width: 4, height: 4, channels: 3, background: "#fff" },
      })
        .png()
        .toBuffer();
      vi.mocked(get).mockResolvedValue({
        statusCode: 200,
        stream: new Blob([new Uint8Array(png)]).stream(),
        headers: new Headers(),
        blob: {
          url: "u",
          downloadUrl: "d",
          pathname: "p",
          contentDisposition: "inline",
          cacheControl: "private",
          uploadedAt: new Date(),
          etag: "e",
          contentType: "image/png",
          size: png.byteLength,
        },
      } as never);
    }

    it("persists a validated extraction, claims the cooldown, audits by id only", async () => {
      await resetCooldown();
      await mockBlobPng();
      const doc = await makeDocument();
      const extraction = await extractDocument(
        owner,
        doc.document.id,
        async () => ({
          docType: "receipt",
          docTypeConfidence: 0.9,
          vendorName: "Test Vendor",
          vendorNameConfidence: 0.9,
          totalCents: 4218,
          totalCentsConfidence: 0.95,
          documentDate: "2026-07-14",
          documentDateConfidence: 0.9,
        }),
      );
      expect(extraction.fields.totalCents.value).toBe(4218);

      const reloaded = await withTenant(tenantId, (tx) =>
        loadDocument(tx, tenantId, doc.document.id),
      );
      expect(reloaded.extractionStatus).toBe("done");
      expect(
        (reloaded.extraction as { fields: { vendorName: { value: string } } })
          .fields.vendorName.value,
      ).toBe("Test Vendor");

      const settings = await withTenant(tenantId, (tx) =>
        tx.query.accountingSettings.findFirst({
          where: eq(schema.accountingSettings.tenantId, tenantId),
        }),
      );
      expect(settings?.aiLastExtractedAt).not.toBeNull();

      const audits = await withSystem((tx) =>
        tx
          .select()
          .from(schema.auditLog)
          .where(eq(schema.auditLog.action, "documents.extracted")),
      );
      const row = audits.find((a) => a.targetId === doc.document.id);
      expect(row).toBeTruthy();
      expect(JSON.stringify(row?.meta)).not.toContain("Test Vendor");
    });

    it("enforces the per-tenant cooldown on immediate re-runs", async () => {
      const doc = await makeDocument();
      await expect(
        extractDocument(owner, doc.document.id, async () => ({})),
      ).rejects.toMatchObject({ code: "AI_COOLDOWN" });
    });

    it("model failure persists status failed and rethrows", async () => {
      await resetCooldown();
      await mockBlobPng();
      const doc = await makeDocument();
      await expect(
        extractDocument(owner, doc.document.id, async () => {
          throw new LedgerError("AI_UNAVAILABLE", "no tool block");
        }),
      ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
      const reloaded = await withTenant(tenantId, (tx) =>
        loadDocument(tx, tenantId, doc.document.id),
      );
      expect(reloaded.extractionStatus).toBe("failed");
    });

    it("malformed model output degrades to an all-null extraction (status done)", async () => {
      await resetCooldown();
      await mockBlobPng();
      const doc = await makeDocument();
      const extraction = await extractDocument(
        owner,
        doc.document.id,
        async () => "garbage",
      );
      expect(extraction.fields.totalCents.value).toBeNull();
      const reloaded = await withTenant(tenantId, (tx) =>
        loadDocument(tx, tenantId, doc.document.id),
      );
      expect(reloaded.extractionStatus).toBe("done");
    });

    it("rejects extraction for no-blob and non-extractable documents", async () => {
      await resetCooldown();
      const none = await makeDocument({
        blobPathname: null,
        fileName: "(no attachment)",
        mimeType: "",
        sizeBytes: 0,
        sha256: "",
        source: "email",
        extractionStatus: "skipped",
      });
      await expect(
        extractDocument(owner, none.document.id, async () => ({})),
      ).rejects.toMatchObject({ code: "DOCUMENT_NOT_EXTRACTABLE" });
    });
  });

  describe("record expense from receipt", () => {
    it("posts a balanced entry, links the doc, and dedups double-clicks", async () => {
      const doc = await makeDocument();
      const input = {
        documentId: doc.document.id,
        entryDate: "2026-07-15",
        amountCents: 4218,
        memo: "Coffee run",
        paidFromAccountId: await accountId("1000"),
        categoryAccountId: await accountId("6000"),
      };
      const first = await withTenant(tenantId, (tx) =>
        recordExpenseFromReceipt(tx, owner, input),
      );
      expect(first.status).toBe("posted");
      // Double-click: same prior link count → same idempotency key → dedup.
      const second = await withTenant(tenantId, (tx) =>
        recordExpenseFromReceipt(tx, owner, input),
      );
      expect(second.entryId).toBe(first.entryId);

      const lines = await withTenant(tenantId, (tx) =>
        tx
          .select()
          .from(schema.journalLines)
          .where(
            and(
              eq(schema.journalLines.tenantId, tenantId),
              eq(schema.journalLines.entryId, first.entryId),
            ),
          ),
      );
      expect(lines).toHaveLength(2);
      expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);

      const links = await withTenant(tenantId, (tx) =>
        listLinksForDocument(tx, tenantId, doc.document.id),
      );
      expect(links).toHaveLength(1);
    });

    it("staff records a draft, not a posting", async () => {
      const doc = await makeDocument();
      const result = await withTenant(tenantId, (tx) =>
        recordExpenseFromReceipt(tx, staff, {
          documentId: doc.document.id,
          entryDate: "2026-07-15",
          amountCents: 999,
          paidFromAccountId: acct["1000"],
          categoryAccountId: acct["6000"],
        }),
      );
      expect(result.status).toBe("draft");
      const entry = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findFirst({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.id, result.entryId),
          ),
        }),
      );
      expect(entry?.status).toBe("draft");
    });
  });

  describe("bank txn match candidates", () => {
    let bankAccountId: string;

    it("suggests exact-amount txns inside the window, ordered by date distance", async () => {
      const created = await withTenant(tenantId, (tx) =>
        createBankAccount(tx, owner, { name: "Match Checking", kind: "checking" }),
      );
      bankAccountId = created.bankAccount.id;
      await seedBankTxn("-m1", -4218, "2026-07-15", bankAccountId);
      await seedBankTxn("-m2", -4218, "2026-07-10", bankAccountId);
      await seedBankTxn("-m3", -4218, "2026-06-01", bankAccountId); // outside window
      await seedBankTxn("-m4", -9999, "2026-07-14", bankAccountId); // wrong amount
      const posted = await seedBankTxn("-m5", -4218, "2026-07-14", bankAccountId);
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.bankTransactions)
          .set({ status: "excluded" })
          .where(
            and(
              eq(schema.bankTransactions.tenantId, tenantId),
              eq(schema.bankTransactions.id, posted),
            ),
          ),
      );

      const candidates = await withTenant(tenantId, (tx) =>
        findBankTxnCandidatesForDocument(tx, tenantId, {
          totalCents: 4218,
          documentDate: "2026-07-14",
        }),
      );
      const dates = candidates.map((c) => c.txnDate);
      expect(dates).toEqual(["2026-07-15", "2026-07-10"]);
      expect(candidates[0].bankAccountName).toBe("Match Checking");
    });

    it("zero-total documents produce no candidates", async () => {
      const candidates = await withTenant(tenantId, (tx) =>
        findBankTxnCandidatesForDocument(tx, tenantId, {
          totalCents: 0,
          documentDate: "2026-07-14",
        }),
      );
      expect(candidates).toEqual([]);
    });
  });
});

let bankSeq = 0;
let fallbackBankAccountId: string | undefined;
async function seedBankTxn(
  tag: string,
  amountCents: number,
  txnDate: string,
  bankAccountId?: string,
): Promise<string> {
  bankSeq += 1;
  const accountIdToUse =
    bankAccountId ??
    fallbackBankAccountId ??
    (fallbackBankAccountId = (
      await withTenant(tenantId, (tx) =>
        createBankAccount(tx, { tenantId, userId: "owner-user", role: "owner" }, {
          name: "Seed Checking",
          kind: "checking",
        }),
      )
    ).bankAccount.id);
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .insert(schema.bankTransactions)
      .values({
        tenantId,
        bankAccountId: accountIdToUse,
        txnDate,
        description: `seed txn ${tag}`,
        amountCents,
        externalHash: `seed-${STAMP}-${tag}-${bankSeq}`,
        source: "csv",
      })
      .returning(),
  );
  return row.id;
}
