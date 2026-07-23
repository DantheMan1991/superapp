import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Bill, Vendor } from "@/db/schema";
import { LedgerError, type LedgerCtx } from "../core";
import {
  readExtraction,
  type DocumentExtraction,
} from "../ai/extract-validate";
import { loadDocument } from "../documents/documents";
import { attachDocument } from "../documents/links";
import { createBillDraft, findPossibleDuplicates, type DuplicateSignal } from "./bills";
import { createVendor, loadVendor } from "./vendors";
import { billTotalCents, type BillLineInput } from "./lines";

/**
 * The flagship entry point: a document in Bills & Receipts (already
 * extracted) becomes a prefilled bill draft with the document attached —
 * one transaction, idempotent by link presence (P12).
 */

export interface BillPrefill {
  billNumber: string;
  billDate: string | null;
  lines: BillLineInput[];
  /** True when extraction lineItems were trusted (Σ matched the total). */
  usedLineItems: boolean;
}

/**
 * P13: use extraction lineItems only when EVERY item has a non-null
 * amount AND they sum exactly to totalCents — a mismatched extraction
 * must never fabricate a different total. Otherwise one line, the total.
 */
export function prefillFromExtraction(
  extraction: DocumentExtraction | null,
  defaultAccountId: string | null,
): BillPrefill {
  const total = extraction?.fields.totalCents.value ?? null;
  const billNumber = extraction?.fields.documentNumber.value ?? "";
  const billDate = extraction?.fields.documentDate.value ?? null;
  const vendorName = extraction?.fields.vendorName.value ?? "";

  const items = extraction?.lineItems ?? [];
  const allAmountsKnown =
    items.length > 0 && items.every((i) => i.amountCents !== null);
  const itemsSum = allAmountsKnown
    ? items.reduce((s, i) => s + (i.amountCents ?? 0), 0)
    : null;
  const useLineItems =
    total !== null && allAmountsKnown && itemsSum === total;

  const lines: BillLineInput[] = useLineItems
    ? items.map((i) => ({
        description: [
          i.quantity !== undefined && i.quantity !== 1 ? `${i.quantity}x ` : "",
          i.description,
        ].join(""),
        amountCents: i.amountCents!,
        accountId: defaultAccountId,
      }))
    : [
        {
          description: vendorName || "Bill total",
          amountCents: total ?? 0,
          accountId: defaultAccountId,
        },
      ];

  return { billNumber, billDate, lines, usedLineItems: useLineItems };
}

/** Case-insensitive candidate list for the vendor-resolve dialog. */
export async function findVendorCandidatesByName(
  tx: Tx,
  tenantId: string,
  name: string,
): Promise<Vendor[]> {
  const wanted = name.trim();
  if (wanted === "") return [];
  return tx.query.vendors.findMany({
    where: and(
      eq(schema.vendors.tenantId, tenantId),
      eq(schema.vendors.isActive, true),
      sql`lower(${schema.vendors.name}) like ${"%" + wanted.toLowerCase() + "%"}`,
    ),
    limit: 5,
  });
}

export interface CreateBillFromDocumentInput {
  documentId: string;
  /** Exactly one of the two: an existing vendor, or a new one by name. */
  vendorId?: string;
  createVendorName?: string;
  billDateFallback: string;
}

export async function createBillFromDocument(
  tx: Tx,
  ctx: LedgerCtx,
  input: CreateBillFromDocumentInput,
): Promise<{ bill: Bill; duplicates: DuplicateSignal[]; existing: boolean }> {
  const doc = await loadDocument(tx, ctx.tenantId, input.documentId);
  if (doc.status === "trashed") {
    throw new LedgerError("DOCUMENT_TRASHED", doc.id);
  }

  // Idempotency = link presence (P12): already billed → return that bill.
  const existingLink = await tx.query.documentLinks.findFirst({
    where: and(
      eq(schema.documentLinks.tenantId, ctx.tenantId),
      eq(schema.documentLinks.documentId, doc.id),
      isNotNull(schema.documentLinks.billId),
    ),
  });
  if (existingLink?.billId) {
    const bill = await tx.query.bills.findFirst({
      where: and(
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.id, existingLink.billId),
      ),
    });
    if (bill) return { bill, duplicates: [], existing: true };
  }

  let vendor: Vendor;
  if (input.vendorId) {
    vendor = await loadVendor(tx, ctx.tenantId, input.vendorId);
    if (!vendor.isActive) {
      throw new LedgerError("VENDOR_INACTIVE", `vendor ${vendor.id} inactive`);
    }
  } else if (input.createVendorName?.trim()) {
    vendor = await createVendor(tx, ctx, { name: input.createVendorName.trim() });
  } else {
    throw new LedgerError("VENDOR_NOT_FOUND", "no vendor specified");
  }

  const extraction = readExtraction(doc.extraction);
  const prefill = prefillFromExtraction(
    extraction,
    vendor.defaultExpenseAccountId,
  );

  const bill = await createBillDraft(tx, ctx, {
    vendorId: vendor.id,
    billNumber: prefill.billNumber,
    billDate: prefill.billDate ?? input.billDateFallback,
    memo: doc.emailSubject || "",
    lines: prefill.lines,
  });
  await attachDocument(tx, ctx, {
    documentId: doc.id,
    target: { type: "bill", id: bill.id },
  });

  const duplicates = await findPossibleDuplicates(tx, ctx.tenantId, {
    vendorId: vendor.id,
    billNumber: bill.billNumber,
    totalCents: billTotalCents(prefill.lines),
    billDate: bill.billDate,
    excludeBillId: bill.id,
  });
  return { bill, duplicates, existing: false };
}
