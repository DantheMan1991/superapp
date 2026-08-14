import { formatCents } from "@/lib/money";

/**
 * The invoice as a printable document — pure, no database, no React.
 *
 * Split from the renderer for the same reason `ai/*-validate.ts` is split from
 * `ai/*-code.ts`: every decision about what appears on the page (what the
 * balance is, whether a due date is shown, how a quantity is written) is
 * table-testable without rendering a PDF, and the renderer stays a layout file
 * with no arithmetic in it.
 *
 * All money arrives as integer cents and leaves as a formatted string. No
 * division happens here.
 */

export interface InvoicePdfInput {
  businessName: string;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  memo: string;
  /** Gross: subtotal + tax. What the customer owes. */
  totalCents: number;
  /**
   * Σ line amounts, before tax. Optional so the many fixtures and callers
   * predating sales tax still typecheck; absent means "no tax on this
   * invoice", which is what those invoices charged.
   */
  subtotalCents?: number;
  taxCents?: number;
  /** "Sales Tax (7.25%)" — built by the caller from the FROZEN rate. */
  taxLabel?: string;
  paidCents: number;
  customerName: string;
  /** Free-text postal address as captured on the customer. */
  customerAddress: string;
  customerEmail: string;
  lines: ReadonlyArray<{
    description: string;
    /** Numeric string as stored, e.g. "1.00". */
    quantity: string;
    unitPriceCents: number;
    amountCents: number;
  }>;
}

export interface InvoicePdfRow {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface InvoicePdfModel {
  businessName: string;
  title: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  billTo: string[];
  rows: InvoicePdfRow[];
  subtotal: string;
  tax: string;
  taxLabel: string;
  /**
   * Whether the subtotal/tax pair is printed at all.
   *
   * Most US states REQUIRE sales tax to be stated separately on the document,
   * so this is not decoration — an invoice that folds tax into one total is
   * the wrong document. Equally, printing "Tax 0.00" on an untaxed invoice
   * implies a taxed sale that came to nothing.
   */
  showTax: boolean;
  total: string;
  paid: string;
  balance: string;
  /** Only shown when part of the invoice has been paid. */
  showPayments: boolean;
  memo: string;
  /** Stamped across the page for a voided invoice. */
  watermark: string | null;
}

/** "1.00" reads as clutter on a one-off line; "2.50" does not. */
export function formatQuantity(quantity: string): string {
  // Number("") and Number("  ") are both 0, so an empty quantity would
  // otherwise print as "0" — a number nobody entered, on a document somebody
  // pays from. Anything unreadable passes through untouched instead.
  if (quantity.trim() === "") return quantity;
  const n = Number(quantity);
  if (!Number.isFinite(n)) return quantity;
  return Number.isInteger(n) ? String(n) : quantity.replace(/0+$/, "").replace(/\.$/, "");
}

export function buildInvoicePdfModel(input: InvoicePdfInput): InvoicePdfModel {
  const billTo = [input.customerName, input.customerAddress, input.customerEmail]
    .flatMap((part) => part.split("\n"))
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const balanceCents = input.totalCents - input.paidCents;
  const taxCents = input.taxCents ?? 0;
  // Falls back to the total rather than to zero: an invoice with no tax has a
  // subtotal, and it is its total.
  const subtotalCents = input.subtotalCents ?? input.totalCents;

  return {
    businessName: input.businessName,
    // A draft is not an invoice yet, and a document that says otherwise is the
    // kind of thing that gets paid twice.
    title: input.status === "draft" ? "DRAFT INVOICE" : "INVOICE",
    invoiceNumber: input.invoiceNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    billTo,
    rows: input.lines
      // A zero line is a note to ourselves, not something to bill for.
      .filter((l) => l.amountCents !== 0 || l.description.trim() !== "")
      .map((l) => ({
        description: l.description,
        quantity: formatQuantity(l.quantity),
        unitPrice: formatCents(l.unitPriceCents),
        amount: formatCents(l.amountCents),
      })),
    subtotal: formatCents(subtotalCents),
    tax: formatCents(taxCents),
    taxLabel: input.taxLabel ?? "Sales Tax",
    showTax: taxCents !== 0,
    total: formatCents(input.totalCents),
    paid: formatCents(input.paidCents),
    balance: formatCents(balanceCents),
    showPayments: input.paidCents !== 0,
    memo: input.memo.trim(),
    watermark: input.status === "void" ? "VOID" : null,
  };
}
