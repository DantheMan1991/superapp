import { formatCents } from "@/lib/money";

/**
 * What the customer receives. Pure — no database, no sending.
 *
 * Split from `send-invoice.ts` so the wording, the subject line and above all
 * the idempotency key are table-testable: the key is the only thing standing
 * between a double-clicked Send button and a customer getting two copies of
 * the same invoice.
 */

export interface InvoiceEmailInput {
  businessName: string;
  invoiceNumber: string;
  customerName: string;
  totalCents: number;
  balanceCents: number;
  dueDate: string | null;
  /** The owner's own note from the invoice, if any. */
  memo: string;
}

export interface InvoiceEmail {
  subject: string;
  text: string;
  html: string;
  attachmentFilename: string;
}

/**
 * Stable per (invoice, recipient) and NOTHING else.
 *
 * Deriving it from a timestamp or a random value would make every retry a
 * second email. Deriving it from the invoice alone would silently swallow a
 * genuine re-send to a corrected address. Uuids cannot contain a colon, so the
 * prefix `invoice:<id>:` is an exact match for "this invoice, any recipient" —
 * which is how the UI derives whether it has been sent at all.
 */
export function invoiceSendIdempotencyKey(invoiceId: string, recipient: string): string {
  return `invoice:${invoiceId}:${recipient.trim().toLowerCase()}`;
}

/** The prefix that matches every send of one invoice, to any recipient. */
export function invoiceSendKeyPrefix(invoiceId: string): string {
  return `invoice:${invoiceId}:`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildInvoiceEmail(input: InvoiceEmailInput): InvoiceEmail {
  const amount = formatCents(input.balanceCents);
  const greetingName = input.customerName.trim();
  const due = input.dueDate ? `Due ${input.dueDate}.` : "";
  const memo = input.memo.trim();

  // The number goes in the subject because that is what somebody searches
  // their inbox for when an invoice goes missing.
  const subject = `Invoice ${input.invoiceNumber} from ${input.businessName}`;

  const lines = [
    greetingName ? `Hi ${greetingName},` : "Hi,",
    "",
    `Please find invoice ${input.invoiceNumber} attached, for ${amount}.`,
    ...(due ? [due] : []),
    ...(memo ? ["", memo] : []),
    "",
    `Thanks,`,
    input.businessName,
  ];

  const html = [
    `<p>${greetingName ? `Hi ${escapeHtml(greetingName)},` : "Hi,"}</p>`,
    `<p>Please find invoice <strong>${escapeHtml(input.invoiceNumber)}</strong> attached, for <strong>${amount}</strong>.` +
      (due ? ` ${escapeHtml(due)}` : "") +
      `</p>`,
    ...(memo ? [`<p>${escapeHtml(memo)}</p>`] : []),
    `<p>Thanks,<br>${escapeHtml(input.businessName)}</p>`,
  ].join("\n");

  return {
    subject,
    text: lines.join("\n"),
    html,
    attachmentFilename: `invoice-${input.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`,
  };
}
