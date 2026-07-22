import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
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
import { getSettings } from "@/modules/accounting/core";
import { loadInvoiceLines } from "@/modules/accounting/invoicing/invoices";
import { paidCentsFor } from "@/modules/accounting/invoicing/payments";
import {
  formatCentsSigned,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import { SalesNav } from "../../sales-nav";
import { InvoiceBuilder } from "../invoice-builder";
import { InvoiceActions } from "./invoice-detail-controls";

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
    const settings = await getSettings(tx, ctx.tenant.id);
    return {
      invoice,
      customer,
      lines,
      accounts,
      payments,
      paid,
      bankAccounts,
      undeposited,
      customersActive,
      today: todayInTimezone(settings.bookkeepingTimezone),
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

      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {invoice.invoiceNumber}
            </h1>
            <Badge variant={STATUS_BADGE[invoice.status] ?? "outline"}>
              {invoice.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {customer?.name} · issued {invoice.issueDate}
            {invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}
            {invoice.memo ? ` · ${invoice.memo}` : ""}
          </p>
        </div>
        {!editing && (
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
          />
        )}
      </div>

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
          invoice={{
            id: invoice.id,
            version: invoice.version,
            customerId: invoice.customerId,
            invoiceNumber: invoice.invoiceNumber,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            memo: invoice.memo,
            lines: lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
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
                      <TableCell className="text-sm">{l.description || "—"}</TableCell>
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
    </div>
  );
}
