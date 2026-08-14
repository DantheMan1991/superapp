import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { listContactPoints } from "@/lib/parties/contacts";
import { preferredContactValue } from "@/lib/parties/contact-values";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { DocumentAttachments } from "@/modules/accounting/components/document-attachments";
import { EntityThreads } from "@/modules/email/components/entity-threads";
import { loadInvoiceLines } from "@/modules/accounting/invoicing/invoices";
import { paidCentsFor } from "@/modules/accounting/invoicing/payments";
import {
  formatCentsSigned,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import { SalesNav } from "../../sales-nav";
import { InvoiceBuilder } from "../invoice-builder";
import { listInvoiceSends } from "@/modules/accounting/invoicing/send-invoice";
import {
  getReminderSettings,
  listInvoiceReminders,
} from "@/modules/accounting/invoicing/reminders";
import { listRecordHistory } from "@/modules/accounting/history/list";
import { RecordHistory } from "@/modules/accounting/components/record-history";
import {
  listPaymentMethods,
  listPaymentTerms,
  listProducts,
  listSalesTaxRates,
} from "@/modules/accounting/invoicing/catalogue";
import { describeTaxRate } from "@/modules/accounting/invoicing/tax";
import { nextReminder } from "@/modules/accounting/invoicing/reminder-schedule";
import { InvoiceRemindersPanel } from "@/modules/accounting/components/invoice-reminders-panel";
import { InvoiceActions, SendInvoiceButton } from "./invoice-detail-controls";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  issued: "default",
  partial: "default",
  paid: "outline",
  void: "outline",
};

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
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
    const lines = await loadInvoiceLines(tx, ctx.tenant.id, invoice.id);
    const accounts = await tx.query.accounts.findMany({
      where: eq(schema.accounts.tenantId, ctx.tenant.id),
      orderBy: asc(schema.accounts.code),
    });
    const payments = await tx.query.invoicePayments.findMany({
      where: and(
        eq(schema.invoicePayments.tenantId, ctx.tenant.id),
        eq(schema.invoicePayments.invoiceId, invoice.id),
      ),
      orderBy: asc(schema.invoicePayments.paymentDate),
    });
    const paid = await paidCentsFor(tx, ctx.tenant.id, invoice.id);
    const bankAccounts = await tx.query.bankAccounts.findMany({
      where: and(
        eq(schema.bankAccounts.tenantId, ctx.tenant.id),
        eq(schema.bankAccounts.isActive, true),
      ),
    });
    const undeposited = accounts.find(
      (a) => a.subtype === "undeposited_funds" && a.isSystem,
    );
    const customersActive = await tx.query.customers.findMany({
      where: and(
        eq(schema.customers.tenantId, ctx.tenant.id),
        eq(schema.customers.isActive, true),
      ),
      orderBy: asc(schema.customers.name),
    });
    // "Has this been sent?" is DERIVED from the outbound-email log rather than
    // stored on the invoice — one fact, one home, like status and closedThrough.
    const sends = await listInvoiceSends(tx, ctx.tenant.id, invoice.id);
    // Same derivation, same reason: what chasing has happened is read from the
    // send log, so the panel shows delivery status rather than a stored tick.
    const reminders = await listInvoiceReminders(tx, ctx.tenant.id, invoice.id);
    const reminderSettings = await getReminderSettings(tx, ctx.tenant.id);
    /**
     * The invoice, its payments and its posting entry. A payment is audited
     * against the PAYMENT and the posting against the ENTRY, so filtering on
     * the invoice alone would show "created, issued" and silently omit the
     * money — see history/list.ts.
     */
    const history = await listRecordHistory(tx, ctx.tenant.id, [
      { type: "invoice", id: invoice.id },
      ...payments.map((p) => ({ type: "invoice_payment", id: p.id })),
      ...(invoice.journalEntryId
        ? [{ type: "journal_entry", id: invoice.journalEntryId }]
        : []),
    ]);
    const [productRows, termRows] = await Promise.all([
      listProducts(tx, ctx.tenant.id, { activeOnly: true }),
      listPaymentTerms(tx, ctx.tenant.id, { activeOnly: true }),
    ]);
    // ALL rates, not just active: the editor must be able to show a draft the
    // rate of which was retired since, and the display below names the rate an
    // issued invoice charged whatever its state now is.
    const taxRateRows = await listSalesTaxRates(tx, ctx.tenant.id);
    const methodRows = await listPaymentMethods(tx, ctx.tenant.id, {
      activeOnly: true,
    });
    const contacts = customer
      ? await listContactPoints(tx, ctx.tenant.id, customer.partyId)
      : [];
    return {
      invoice,
      customer,
      lines,
      accounts,
      payments,
      paid,
      sends,
      reminders,
      reminderSettings,
      history,
      products: productRows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        unitPriceCents: p.unitPriceCents,
        incomeAccountId: p.incomeAccountId,
      })),
      terms: termRows.map((t) => ({
        id: t.id,
        name: t.name,
        dueInDays: t.dueInDays,
      })),
      // The editor offers active rates, plus whichever this draft already
      // holds — otherwise opening a draft would silently drop its rate.
      taxRates: taxRateRows
        .filter((r) => r.isActive || r.id === invoice.taxRateId)
        .map((r) => ({ id: r.id, name: r.name, ratePpm: r.ratePpm })),
      defaultTaxRateId: taxRateRows.find((r) => r.isDefault)?.id ?? null,
      taxRateName:
        taxRateRows.find((r) => r.id === invoice.taxRateId)?.name ?? "Sales tax",
      paymentMethods: methodRows.map((m) => ({ code: m.code, name: m.name })),
      customerEmail: preferredContactValue(contacts, "email") ?? "",
      bankAccounts,
      undeposited,
      customersActive,
      today: todayInTimezone(ctx.tenant.timezone),
    };
  });
  if (!data) notFound();
  const { invoice, customer, lines, payments } = data;
  const isOwner = ctx.role === "owner";
  const balance = invoice.status === "void" ? 0 : invoice.totalCents - data.paid;
  const accountName = new Map(data.accounts.map((a) => [a.id, `${a.code} · ${a.name}`]));
  const editing = sp.edit === "1" && invoice.status === "draft";

  const depositOptions = [
    ...data.bankAccounts.map((b) => ({ id: b.accountId, label: b.name })),
    ...(data.undeposited
      ? [{ id: data.undeposited.id, label: "Undeposited Funds" }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Print-only business header */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">{ctx.tenant.name}</h1>
        <p className="mt-2 text-lg font-semibold">Invoice {invoice.invoiceNumber}</p>
        <p className="text-sm">
          Issued {invoice.issueDate}
          {invoice.dueDate ? ` · Due ${invoice.dueDate}` : ""}
        </p>
        <p className="mt-1 text-sm">
          Bill to: {customer?.name}
          {customer?.address ? ` — ${customer.address}` : ""}
        </p>
      </div>

      {/* `print:hidden` stays exactly where it was — the printed invoice uses
          the print-only header above, and none of the print rules on this page
          are touched by the UI migration. */}
      <PageHeader
        className="print:hidden"
        title={invoice.invoiceNumber}
        description={
          <>
            {customer?.name} · issued {invoice.issueDate}
            {invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}
            {invoice.memo ? ` · ${invoice.memo}` : ""}
          </>
        }
        actions={
          <>
            <Badge variant={STATUS_BADGE[invoice.status] ?? "outline"}>
              {invoice.status}
            </Badge>
            {!editing && (
          <>
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/accounting/invoices/${invoice.id}/pdf`}
                target="_blank"
                rel="noopener"
              >
                <FileText className="size-4" />
                PDF
              </a>
            </Button>
            <SendInvoiceButton
              invoiceId={invoice.id}
              status={invoice.status}
              defaultTo={data.customerEmail}
              lastSentAt={
                data.sends.find((s) => s.status === "sent")?.createdAt.toISOString().slice(0, 10) ??
                null
              }
              canAct={isOwner}
            />
            <InvoiceActions
              invoice={{
                id: invoice.id,
                version: invoice.version,
                status: invoice.status,
                number: invoice.invoiceNumber,
                balanceCents: balance,
              }}
              depositOptions={depositOptions}
              today={data.today}
              canAct={isOwner}
              paymentMethods={data.paymentMethods}
            />
          </>
            )}
          </>
        }
      />

      <div className="print:hidden">
        <AccountingNav />
        <div className="mt-4">
          <SalesNav />
        </div>
      </div>

      {editing ? (
        <InvoiceBuilder
          customers={data.customersActive.map((c) => ({ id: c.id, name: c.name }))}
          incomeAccounts={data.accounts
            .filter((a) => a.accountType === "income" && a.isActive)
            .map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          suggestedNumber={invoice.invoiceNumber}
          today={data.today}
          products={data.products}
          terms={data.terms}
          taxRates={data.taxRates}
          defaultTaxRateId={data.defaultTaxRateId}
          invoice={{
            id: invoice.id,
            version: invoice.version,
            customerId: invoice.customerId,
            invoiceNumber: invoice.invoiceNumber,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            memo: invoice.memo,
            taxRateId: invoice.taxRateId,
            lines: lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              isTaxable: l.isTaxable,
              incomeAccountId: l.incomeAccountId,
            })),
          }}
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="hidden sm:table-cell print:table-cell">
                      Account
                    </TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm">
                        {l.description || "—"}
                        {/* Only when the invoice charges tax — a "T" on every
                            line of an untaxed invoice is noise. */}
                        {invoice.taxRateId && l.isTaxable && (
                          <span
                            className="ml-1.5 text-xs text-muted-foreground"
                            title="Sales tax charged on this line"
                          >
                            T
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {l.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCentsSigned(l.unitPriceCents)}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell print:table-cell">
                        {accountName.get(l.incomeAccountId) ?? ""}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCentsSigned(l.amountCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Subtotal and tax appear only when there IS tax — on an
                      untaxed invoice they would be two rows saying nothing,
                      and the same rule the PDF follows. */}
                  {invoice.taxCents !== 0 && (
                    <>
                      <TableRow className="border-t">
                        <TableCell className="text-sm text-muted-foreground">
                          Subtotal
                        </TableCell>
                        <TableCell colSpan={3} />
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {formatCentsSigned(invoice.subtotalCents)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-sm text-muted-foreground">
                          {describeTaxRate(data.taxRateName, invoice.taxRatePpm)}
                        </TableCell>
                        <TableCell colSpan={3} />
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {formatCentsSigned(invoice.taxCents)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell className="text-sm">Total</TableCell>
                    <TableCell colSpan={3} />
                    <TableCell className="text-right font-mono text-sm">
                      {formatCentsSigned(invoice.totalCents)}
                    </TableCell>
                  </TableRow>
                  {data.paid > 0 && (
                    <>
                      <TableRow>
                        <TableCell className="text-sm">Paid</TableCell>
                        <TableCell colSpan={3} />
                        <TableCell className="text-right font-mono text-sm">
                          {formatCentsSigned(-data.paid)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="font-semibold">
                        <TableCell className="text-sm">Balance due</TableCell>
                        <TableCell colSpan={3} />
                        <TableCell className="text-right font-mono text-sm">
                          {formatCentsSigned(balance)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {payments.length > 0 && (
            <Card className="print:hidden">
              <CardContent className="p-0">
                <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
                  Payments
                </div>
                <ul className="divide-y">
                  {payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <span>
                        <span className="font-mono text-xs">{p.paymentDate}</span> ·{" "}
                        {p.method.replaceAll("_", " ")} →{" "}
                        {accountName.get(p.depositAccountId) ?? "account"}
                        {p.memo ? ` · ${p.memo}` : ""}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono">
                          {formatCentsSigned(p.amountCents)}
                        </span>
                        {isOwner && (
                          <InvoiceActions.Unapply
                            paymentId={p.id}
                            version={p.version}
                          />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="print:hidden">
        <InvoiceRemindersPanel
          invoiceId={invoice.id}
          version={invoice.version}
          muted={invoice.remindersMuted}
          customerMuted={customer?.remindersMuted ?? false}
          enabled={data.reminderSettings.enabled}
          nextLabel={
            // Only meaningful while the invoice is actually chaseable; a paid
            // or void one has no next reminder to describe.
            balance > 0 && !invoice.remindersMuted && !customer?.remindersMuted
              ? (() => {
                  const next = nextReminder({
                    dueDate: invoice.dueDate,
                    today: data.today,
                    offsets: data.reminderSettings.offsets,
                    sentOffsets: data.reminders.map((r) => r.offset),
                  });
                  return next ? `on ${next.date}` : null;
                })()
              : null
          }
          history={data.reminders.map((r) => ({
            offset: r.offset,
            toAddress: r.toAddress,
            status: r.status,
            sentOn: r.createdAt.toISOString().slice(0, 10),
          }))}
          canAct={isOwner}
        />
      </div>

      <RecordHistory events={data.history} />

      <div className="print:hidden">
        <DocumentAttachments
          tenantId={ctx.tenant.id}
          target={{ type: "invoice", id: data.invoice.id }}
        />
      </div>

      {/* Renders nothing at all until a conversation is attached. */}
      <div className="print:hidden">
        <EntityThreads
          ctx={ctx}
          target={{ entityType: "invoice", entityId: data.invoice.id }}
        />
      </div>
    </div>
  );
}
