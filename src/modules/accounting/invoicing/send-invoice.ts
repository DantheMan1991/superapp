import "server-only";
import { and, eq, like } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { sendEmail, type SendResult } from "@/lib/email/send";
import { preferredContactValue } from "@/lib/parties/contact-values";
import { listContactPoints } from "@/lib/parties/contacts";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import { renderInvoicePdf } from "./invoice-pdf";
import { invoiceTaxFields } from "./invoices";
import {
  buildInvoiceEmail,
  invoiceSendIdempotencyKey,
  invoiceSendKeyPrefix,
} from "./invoice-email";

/**
 * Emailing an invoice to the customer.
 *
 * Goes through `@/lib/email/send`, the platform's one outbound door: it owns
 * the rate caps, the non-production recipient redirect, the sender identity
 * (tenant's verified domain where there is one, ours otherwise) and the
 * `outbound_emails` log. `EmailKind` has had `"invoice"` in it since the seam
 * was written — this is the caller it was waiting for.
 *
 * There is no `sent_at` column. Whether an invoice has been sent is DERIVED
 * from `outbound_emails`, the same way invoice status derives from payments
 * and `closed_through` derives from period closes. One fact, one home.
 */

/** Statuses it makes sense to send. A draft prints DRAFT; a void one is void. */
const SENDABLE = new Set(["issued", "partial", "paid"]);

export interface InvoiceSendRecord {
  toAddress: string;
  status: string;
  createdAt: Date;
}

/** Every send of this invoice, newest first. Empty = never sent. */
export async function listInvoiceSends(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
): Promise<InvoiceSendRecord[]> {
  const rows = await tx
    .select({
      toAddress: schema.outboundEmails.toAddress,
      status: schema.outboundEmails.status,
      createdAt: schema.outboundEmails.createdAt,
    })
    .from(schema.outboundEmails)
    .where(
      and(
        eq(schema.outboundEmails.tenantId, tenantId),
        eq(schema.outboundEmails.kind, "invoice"),
        // Uuids cannot contain a colon, so this prefix is exact.
        like(schema.outboundEmails.idempotencyKey, `${invoiceSendKeyPrefix(invoiceId)}%`),
      ),
    )
    .orderBy(schema.outboundEmails.createdAt);
  return rows.reverse();
}

export interface SendInvoiceArgs {
  invoiceId: string;
  /** Overrides the customer's stored address; used when it is missing or wrong. */
  toOverride?: string;
}

export async function sendInvoiceEmail(
  tx: Tx,
  ctx: LedgerCtx,
  args: SendInvoiceArgs,
): Promise<{ result: SendResult; to: string }> {
  requireOwnerRole(ctx);

  const invoice = await tx.query.invoices.findFirst({
    where: and(
      eq(schema.invoices.tenantId, ctx.tenantId),
      eq(schema.invoices.id, args.invoiceId),
    ),
  });
  if (!invoice) throw new LedgerError("INVOICE_NOT_FOUND", "invoice not found");
  if (!SENDABLE.has(invoice.status)) {
    throw new LedgerError(
      "INVOICE_NOT_SENDABLE",
      `a ${invoice.status} invoice cannot be emailed`,
    );
  }

  const customer = await tx.query.customers.findFirst({
    where: and(
      eq(schema.customers.tenantId, ctx.tenantId),
      eq(schema.customers.id, invoice.customerId),
    ),
  });
  const contacts = customer
    ? await listContactPoints(tx, ctx.tenantId, customer.partyId)
    : [];
  const to =
    args.toOverride?.trim() || (preferredContactValue(contacts, "email") ?? "");
  if (to === "") {
    throw new LedgerError(
      "INVOICE_NO_RECIPIENT",
      "this customer has no email address",
    );
  }

  const lines = await tx.query.invoiceLines.findMany({
    where: and(
      eq(schema.invoiceLines.tenantId, ctx.tenantId),
      eq(schema.invoiceLines.invoiceId, invoice.id),
    ),
    orderBy: (l, { asc }) => [asc(l.lineNo)],
  });
  const payments = await tx.query.invoicePayments.findMany({
    where: and(
      eq(schema.invoicePayments.tenantId, ctx.tenantId),
      eq(schema.invoicePayments.invoiceId, invoice.id),
    ),
    columns: { amountCents: true },
  });
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);

  const tenant = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.id, ctx.tenantId),
    columns: { name: true },
  });
  const businessName = tenant?.name ?? "";

  const tax = await invoiceTaxFields(tx, ctx.tenantId, invoice);

  const pdf = await renderInvoicePdf({
    businessName,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    memo: invoice.memo,
    totalCents: invoice.totalCents,
    ...tax,
    paidCents,
    customerName: customer?.name ?? "",
    customerAddress: customer?.address ?? "",
    customerEmail: preferredContactValue(contacts, "email") ?? "",
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      amountCents: l.amountCents,
    })),
  });

  const email = buildInvoiceEmail({
    businessName,
    invoiceNumber: invoice.invoiceNumber,
    customerName: customer?.name ?? "",
    totalCents: invoice.totalCents,
    balanceCents: invoice.totalCents - paidCents,
    dueDate: invoice.dueDate,
    memo: invoice.memo,
  });

  const result = await sendEmail({
    tenantId: ctx.tenantId,
    kind: "invoice",
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: invoiceSendIdempotencyKey(invoice.id, to),
    attachments: [{ filename: email.attachmentFilename, content: pdf }],
  });

  return { result, to };
}
