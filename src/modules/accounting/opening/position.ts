import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Bill, Invoice } from "@/db/schema";
import {
  findOpeningBalanceAccountId,
  getBooksStartOn,
  getTrialBalance,
  requireOwnerRole,
  type LedgerCtx,
  type TrialBalance,
} from "../core";
import { listCustomers } from "../invoicing/customers";
import { createInvoiceDraft, issueInvoice } from "../invoicing/invoices";
import { approveBill, createBillDraft } from "../payables/bills";
import { listVendors } from "../payables/vendors";

/**
 * The opening position (ADR 0037): what was open on the day the books began,
 * and where the books stand on that day.
 *
 * TWO VERBS AND ONE READ. `recordOpeningInvoice` and `recordOpeningBill` make
 * a real document — a draft with one line, flagged `isOpening`, then issued
 * or approved through the ordinary verb, which is where the posting rule
 * lives (`core/opening.ts`). Nothing here posts; the module's own verbs do,
 * so an opening invoice ages, gets paid, appears on statements and reminders
 * exactly like one written on the Sales page. `getOpeningPosition` is what
 * the page shows: the documents, and the trial balance as of the start day
 * with Opening Balance Equity named as the plug.
 *
 * ONE LINE, NO TAX, NO DIMENSIONS, on purpose. An opening document records
 * what is OWED, and the account on its line exists for one reason: the cash
 * basis recognises it there when the money moves. Tax collected before the
 * books began is the old books' liability, and a dimension on prior-year
 * income is a report nobody files.
 */

export interface OpeningDocumentInput {
  entityId: string;
  /** The customer for an invoice, the vendor for a bill. */
  partyId: string;
  /** The number as printed. Absent means the next invoice number, or none for a bill. */
  number?: string;
  /** The document's own date. Must be before the company's start day. */
  documentDate: string;
  dueDate?: string | null;
  /** What was still owed on the start day, in cents. Positive. */
  amountCents: number;
  /** The income account (invoice) or expense account (bill) the cash basis recognises. */
  accountId: string;
  memo?: string;
}

export async function recordOpeningInvoice(
  tx: Tx,
  ctx: LedgerCtx,
  input: OpeningDocumentInput,
): Promise<Invoice> {
  requireOwnerRole(ctx);
  const draft = await createInvoiceDraft(tx, ctx, {
    entityId: input.entityId,
    customerId: input.partyId,
    invoiceNumber: input.number?.trim() || undefined,
    issueDate: input.documentDate,
    dueDate: input.dueDate ?? null,
    memo: input.memo?.trim() ?? "",
    taxRateId: null,
    isOpening: true,
    lines: [
      {
        description: "Open when the books began",
        quantity: "1",
        unitPriceCents: input.amountCents,
        incomeAccountId: input.accountId,
      },
    ],
  });
  // The rule — dated on the start day, credited to Opening Balance Equity —
  // is the issue verb's, so a document made here and one made anywhere else
  // cannot post differently.
  return issueInvoice(tx, ctx, { invoiceId: draft.id, expectedVersion: draft.version });
}

export async function recordOpeningBill(
  tx: Tx,
  ctx: LedgerCtx,
  input: OpeningDocumentInput,
): Promise<Bill> {
  requireOwnerRole(ctx);
  const draft = await createBillDraft(tx, ctx, {
    entityId: input.entityId,
    vendorId: input.partyId,
    billNumber: input.number?.trim() ?? "",
    billDate: input.documentDate,
    dueDate: input.dueDate ?? null,
    memo: input.memo?.trim() ?? "",
    isOpening: true,
    lines: [
      {
        description: "Open when the books began",
        amountCents: input.amountCents,
        accountId: input.accountId,
      },
    ],
  });
  return approveBill(tx, ctx, { billId: draft.id, expectedVersion: draft.version });
}

export interface OpeningInvoiceRow {
  id: string;
  number: string;
  customerName: string;
  issueDate: string;
  dueDate: string | null;
  totalCents: number;
  status: Invoice["status"];
}

export interface OpeningBillRow {
  id: string;
  number: string;
  vendorName: string;
  billDate: string;
  dueDate: string | null;
  totalCents: number;
  status: Bill["status"];
}

export interface OpeningPosition {
  booksStartOn: string | null;
  invoices: OpeningInvoiceRow[];
  bills: OpeningBillRow[];
  /** The accrual trial balance as of the start day, or null until there is one. */
  standing: TrialBalance | null;
  /** Opening Balance Equity, so the page can name the plug. Null if the chart lacks it. */
  obeAccountId: string | null;
}

export async function getOpeningPosition(
  tx: Tx,
  tenantId: string,
  entityId: string,
): Promise<OpeningPosition> {
  const booksStartOn = await getBooksStartOn(tx, tenantId, entityId);

  const [invoices, bills, customers, vendors] = await Promise.all([
    tx.query.invoices.findMany({
      where: and(
        eq(schema.invoices.tenantId, tenantId),
        eq(schema.invoices.entityId, entityId),
        eq(schema.invoices.isOpening, true),
      ),
      orderBy: [asc(schema.invoices.issueDate), asc(schema.invoices.invoiceNumber)],
    }),
    tx.query.bills.findMany({
      where: and(
        eq(schema.bills.tenantId, tenantId),
        eq(schema.bills.entityId, entityId),
        eq(schema.bills.isOpening, true),
      ),
      orderBy: [asc(schema.bills.billDate), asc(schema.bills.billNumber)],
    }),
    listCustomers(tx, tenantId),
    listVendors(tx, tenantId, { includeInactive: true }),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

  let obeAccountId: string | null = null;
  try {
    obeAccountId = await findOpeningBalanceAccountId(tx, tenantId);
  } catch {
    obeAccountId = null;
  }

  return {
    booksStartOn,
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.invoiceNumber,
      customerName: customerName.get(i.customerId) ?? "—",
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      totalCents: i.totalCents,
      status: i.status,
    })),
    bills: bills.map((b) => ({
      id: b.id,
      number: b.billNumber,
      vendorName: vendorName.get(b.vendorId) ?? "—",
      billDate: b.billDate,
      dueDate: b.dueDate,
      totalCents: b.totalCents,
      status: b.status,
    })),
    // Accrual, always: the opening position is a balance sheet, and the plug
    // only exists on that basis. The cash view of the same day is empty by
    // construction (issuance is excluded there).
    standing: booksStartOn
      ? await getTrialBalance(tx, tenantId, booksStartOn, { kind: "one", entityId }, "accrual")
      : null,
    obeAccountId,
  };
}
