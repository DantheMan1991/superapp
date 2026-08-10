import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { preferredContactValue } from "@/lib/parties/contact-values";
import { listContactPoints } from "@/lib/parties/contacts";
import { renderInvoicePdf } from "@/modules/accounting/invoicing/invoice-pdf";

export const runtime = "nodejs";

/**
 * The invoice as a PDF.
 *
 * A GET route rather than a server action: actions are capped at 4MB and
 * return through the RSC channel, and this is a file somebody saves, prints, or
 * forwards to their accountant. Same shape as the books export.
 *
 * Auth is re-checked on every fetch — tenant + module gate, then RLS proves the
 * invoice belongs to the caller's tenant. The expert (accountant) role may read
 * it: this is a report of the books, not a mutation.
 *
 * NOTE: nothing here is public. Sending the invoice to the customer is a
 * separate slice with its own token model; until then a PDF only ever reaches
 * somebody who is already signed in to the tenant.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params;
  const ctx = await resolveTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled(ctx.tenant.id, "accounting"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const invoice = await tx.query.invoices.findFirst({
        where: and(
          eq(schema.invoices.tenantId, ctx.tenant.id),
          eq(schema.invoices.id, id),
        ),
      });
      if (!invoice) return null;

      const customer = await tx.query.customers.findFirst({
        where: and(
          eq(schema.customers.tenantId, ctx.tenant.id),
          eq(schema.customers.id, invoice.customerId),
        ),
      });
      const lines = await tx.query.invoiceLines.findMany({
        where: and(
          eq(schema.invoiceLines.tenantId, ctx.tenant.id),
          eq(schema.invoiceLines.invoiceId, invoice.id),
        ),
        orderBy: (l, { asc }) => [asc(l.lineNo)],
      });
      const payments = await tx.query.invoicePayments.findMany({
        where: and(
          eq(schema.invoicePayments.tenantId, ctx.tenant.id),
          eq(schema.invoicePayments.invoiceId, invoice.id),
        ),
        columns: { amountCents: true },
      });
      // The address lives on the party since 0075, not on the customer row.
      const contacts = customer
        ? await listContactPoints(tx, ctx.tenant.id, customer.partyId)
        : [];
      return { invoice, customer, lines, payments, contacts };
    },
    { role: ctx.role },
  );

  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const bytes = await renderInvoicePdf({
    businessName: ctx.tenant.name,
    invoiceNumber: data.invoice.invoiceNumber,
    status: data.invoice.status,
    issueDate: data.invoice.issueDate,
    dueDate: data.invoice.dueDate,
    memo: data.invoice.memo,
    totalCents: data.invoice.totalCents,
    paidCents: data.payments.reduce((s, p) => s + p.amountCents, 0),
    customerName: data.customer?.name ?? "",
    customerAddress: data.customer?.address ?? "",
    customerEmail: preferredContactValue(data.contacts, "email") ?? "",
    lines: data.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      amountCents: l.amountCents,
    })),
  });

  const safeNumber = data.invoice.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // inline: the browser previews it, and Save is one more click away.
      "Content-Disposition": `inline; filename="invoice-${safeNumber}.pdf"`,
      // A draft's PDF changes whenever the draft does.
      "Cache-Control": "private, no-store",
    },
  });
}
