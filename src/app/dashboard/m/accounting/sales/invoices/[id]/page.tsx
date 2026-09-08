import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
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
import {
  listDimensionMembers,
  listEntities,
} from "@/modules/accounting/core";
import { dimensionTypesFrom } from "@/lib/dimension-options";
import { loadInvoiceLines } from "@/modules/accounting/invoicing/invoices";
import { paidCentsFor } from "@/modules/accounting/invoicing/payments";
import { depositOptionsFor } from "@/modules/accounting/lib/deposit-options";
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
import {
  InvoiceActions,
  SendInvoiceButton,
  UnapplyPaymentButton,
} from "./invoice-detail-controls";
import { CreditMemoButton } from "./credit-memo-dialog";

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
    // The deposits that banked any of these payments, for the row's
    // "deposited 2026-09-07" note and its link.
    const depositIds = payments
      .map((p) => p.depositId)
      .filter((v): v is string => !!v);
    const deposits =
      depositIds.length === 0
        ? []
        : await tx.query.deposits.findMany({
            where: and(
              eq(schema.deposits.tenantId, ctx.tenant.id),
              inArray(schema.deposits.id, depositIds),
            ),
            columns: { id: true, depositDate: true },
          });
    // The credit memos behind any credit rows, for the row's number and link.
    const creditMemos = await tx.query.creditMemos.findMany({
      where: and(
        eq(schema.creditMemos.tenantId, ctx.tenant.id),
        eq(schema.creditMemos.invoiceId, invoice.id),
      ),
      columns: { id: true, number: true, memo: true, paymentId: true },
    });
    const paid = await paidCentsFor(tx, ctx.tenant.id, invoice.id);
    /**
     * EVERY active register, including other companies' — and that reverses
     * what slice 1b did here, exactly as slice 2 reversed it on the bill.
     *
     * Slice 1b filtered this list because depositing one company's payment into
     * another's account was refused, so offering it was offering a choice that
     * always failed. It is recorded now, as a linked intercompany pair — the
     * mirror of the bill case — so it is a real option. The dialog labels whose
     * account each one is; `recordPayment` decides from the register which
     * shape to write.
     */
    const bankAccounts = await tx.query.bankAccounts.findMany({
      where: and(
        eq(schema.bankAccounts.tenantId, ctx.tenant.id),
        eq(schema.bankAccounts.isActive, true),
      ),
    });
    const companies = await listEntities(tx, ctx.tenant.id, {
      includeInactive: true,
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
     * The invoice, its payments, its credit memos and its posting entry. A
     * payment is audited against the PAYMENT and the posting against the
     * ENTRY, so filtering on the invoice alone would show "created, issued"
     * and silently omit the money — see history/list.ts. A credit memo is
     * audited against the MEMO, and every memo of the invoice is loaded above,
     * voided ones included, so a credit stays in the invoice's story after its
     * payment row is gone.
     */
    const history = await listRecordHistory(tx, ctx.tenant.id, [
      { type: "invoice", id: invoice.id },
      ...payments.map((p) => ({ type: "invoice_payment", id: p.id })),
      ...creditMemos.map((m) => ({ type: "credit_memo", id: m.id })),
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
      // Unfiltered: `dimensionTypesFrom` owns the active-only rule.
      dimensionMembers: await listDimensionMembers(tx, ctx.tenant.id),
      accounts,
      payments,
      deposits,
      creditMemos,
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
      // For a customer change on the draft; the saved due date is never
      // re-derived on open.
      defaultTermId: termRows.find((t) => t.isDefault)?.id ?? null,
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
      companies,
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
  const depositDate = new Map(data.deposits.map((d) => [d.id, d.depositDate]));
  const creditMemoByPayment = new Map(
    data.creditMemos.filter((m) => m.paymentId).map((m) => [m.paymentId!, m]),
  );
  const incomeAccounts = data.accounts
    .filter((a) => a.accountType === "income" && a.isActive)
    .map((a) => ({ id: a.id, code: a.code, name: a.name }));
  const editing = sp.edit === "1" && invoice.status === "draft";

  /**
   * WHOSE ACCOUNT A PAYMENT LANDED IN, when it was not this invoice's own
   * company — the mirror of the same line on the bill page. Undefined at one
   * company and for the ordinary payment.
   *
   * Found by driving the mirror case: the row read "→ 1040 · Test Operating"
   * on an Oak Row invoice and said nothing about the money having gone to an
   * affiliate. It was legible there only because that tenant named the register
   * after its company.
   */
  const recipientOf = (depositAccountId: string): string | undefined => {
    if (data.companies.length < 2) return undefined;
    const register = data.bankAccounts.find((b) => b.accountId === depositAccountId);
    if (!register || register.entityId === invoice.entityId) return undefined;
    return (
      data.companies.find((c) => c.id === register.entityId)?.name ??
      "another company"
    );
  };

  // One function with the Invoices list, which offers the same dialog on a
  // row — the intercompany labelling cannot differ between the two.
  const depositOptions = depositOptionsFor({
    registers: data.bankAccounts,
    companies: data.companies,
    undepositedAccountId: data.undeposited?.id ?? null,
    entityId: invoice.entityId,
  });

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
            {customer ? (
              // The name opens the customer's statement: what they owe across
              // every invoice, which is the question this page cannot answer.
              <Link
                href={`/dashboard/m/accounting/sales/customers/${customer.id}/statement`}
                className="hover:underline"
              >
                {customer.name}
              </Link>
            ) : null}{" "}
            · issued {invoice.issueDate}
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
            {isOwner && (invoice.status === "issued" || invoice.status === "partial") && (
              <CreditMemoButton
                invoice={{
                  id: invoice.id,
                  version: invoice.version,
                  number: invoice.invoiceNumber,
                  balanceCents: balance,
                }}
                incomeAccounts={incomeAccounts}
                defaultAccountId={lines[0]?.incomeAccountId ?? null}
                today={data.today}
              />
            )}
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
              customerEmail={data.customerEmail}
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
          customers={data.customersActive.map((c) => ({
            id: c.id,
            name: c.name,
            paymentTermsId: c.paymentTermsId,
          }))}
          incomeAccounts={data.accounts
            .filter((a) => a.accountType === "income" && a.isActive)
            .map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          suggestedNumber={invoice.invoiceNumber}
          today={data.today}
          products={data.products}
          terms={data.terms}
          defaultTermId={data.defaultTermId}
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
              // `loadInvoiceLines` returns these and this mapping used to drop
              // them. Since `updateInvoiceDraft` deletes every line and
              // re-inserts it, a tag not carried through the form is a tag
              // deleted by the next save.
              dimensionMemberIds: l.dimensionMemberIds,
            })),
          }}
          /* Plus whatever these lines already hold, retired or not — the same
             rule the tax-rate picker above follows, and for the same reason. */
          dimensionTypes={dimensionTypesFrom(data.dimensionMembers, {
            keepIds: lines.flatMap((l) => l.dimensionMemberIds),
          })}
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
                      {p.method === "credit_memo" ? (
                        // Settled by a credit, not by money: the row names the
                        // memo and opens it, and Void lives there.
                        <span>
                          <span className="font-mono text-xs">{p.paymentDate}</span> · credit
                          memo{" "}
                          <Link
                            href={`/dashboard/m/accounting/sales/credit-memos/${creditMemoByPayment.get(p.id)?.id ?? ""}`}
                            className="font-mono text-xs hover:underline"
                          >
                            {creditMemoByPayment.get(p.id)?.number ?? p.memo}
                          </Link>
                          {creditMemoByPayment.get(p.id)?.memo
                            ? ` · ${creditMemoByPayment.get(p.id)!.memo}`
                            : ""}
                        </span>
                      ) : (
                        <span>
                          <span className="font-mono text-xs">{p.paymentDate}</span> ·{" "}
                          {p.method.replaceAll("_", " ")} →{" "}
                          {accountName.get(p.depositAccountId) ?? "account"}
                          {recipientOf(p.depositAccountId) && (
                            // The same words the ledger entry carries in its
                            // memo, so the row and the journal agree.
                            <span className="text-muted-foreground">
                              {" · received by "}
                              {recipientOf(p.depositAccountId)}
                            </span>
                          )}
                          {p.memo ? ` · ${p.memo}` : ""}
                        </span>
                      )}
                      <span className="flex items-center gap-3">
                        <span className="font-mono">
                          {formatCentsSigned(p.amountCents)}
                        </span>
                        {p.depositId ? (
                          // Banked by a deposit: Unapply would be refused, so
                          // the row says where the money went instead, and
                          // that is where Void lives.
                          <Link
                            href={`/dashboard/m/accounting/banking/deposits/${p.depositId}`}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            deposited{" "}
                            <span className="font-mono">
                              {depositDate.get(p.depositId) ?? ""}
                            </span>
                          </Link>
                        ) : p.method === "credit_memo" ? null : (
                          isOwner && (
                            <UnapplyPaymentButton
                              paymentId={p.id}
                              version={p.version}
                            />
                          )
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
