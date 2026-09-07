import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FileText } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { ReportControls } from "@/modules/accounting/components/report-controls";
import { getSettings, listEntities } from "@/modules/accounting/core";
import { loadCustomerStatement } from "@/modules/accounting/invoicing/statements";
import { presetRange } from "@/modules/accounting/lib/dates";
import {
  formatCents,
  formatCentsSigned,
  isValidIsoDate,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import { SalesNav } from "../../../sales-nav";
import { PrintStatementButton } from "./statement-controls";

export const dynamic = "force-dynamic";

/**
 * One customer's statement: the balance coming into the period, every
 * invoice and payment inside it with a running balance, the balance going
 * out, and the open invoices that make it up. What a bookkeeper sends at
 * month end; printed with the business header, like an invoice.
 */
export default async function CustomerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(ctx.tenant.timezone);
    const fallback = presetRange("this-month", today, settings.fiscalYearStartMonth);
    const from = sp.from && isValidIsoDate(sp.from) ? sp.from : fallback.from;
    const to = sp.to && isValidIsoDate(sp.to) ? sp.to : fallback.to;
    const loaded = await loadCustomerStatement(tx, ctx.tenant.id, id, { from, to });
    if (!loaded) return null;
    return {
      ...loaded,
      from,
      to,
      today,
      fiscalYearStartMonth: settings.fiscalYearStartMonth,
      entities: await listEntities(tx, ctx.tenant.id, { includeInactive: true }),
    };
  });
  if (!data) notFound();
  const { customer, statement } = data;
  const companyName = new Map(data.entities.map((e) => [e.id, e.name]));
  const showCompany = data.entities.length > 1;
  const nothing = statement.lines.length === 0 && statement.closingCents === 0;

  return (
    <div className="space-y-6">
      {/* Print-only business header, the shape the printed invoice has. */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">{ctx.tenant.name}</h1>
        <p className="mt-2 text-lg font-semibold">Statement</p>
        <p className="text-sm">
          {customer.name}
          {customer.address ? ` — ${customer.address}` : ""}
        </p>
        <p className="text-sm">
          {statement.from} to {statement.to}
        </p>
      </div>

      <PageHeader
        className="print:hidden"
        title="Statement"
        description={
          <>
            {customer.name} · {statement.from} to {statement.to} ·{" "}
            <span className="font-mono font-medium tabular-nums">
              {formatCentsSigned(statement.closingCents)}
            </span>{" "}
            owed at the end
          </>
        }
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/m/accounting/sales/customers">Customers</Link>
            </Button>
            <PrintStatementButton />
          </>
        }
      />

      <div className="print:hidden">
        <AccountingNav />
      </div>
      <div className="print:hidden">
        <SalesNav />
      </div>

      <ReportControls
        mode="range"
        today={data.today}
        fiscalYearStartMonth={data.fiscalYearStartMonth}
        from={statement.from}
        to={statement.to}
      />

      {nothing ? (
        <Panel>
          <EmptyState
            icon={<FileText />}
            title="Nothing owed, nothing happened"
            description="No invoice was issued and no payment arrived in this period, and the customer owed nothing coming into it."
          />
        </Panel>
      ) : (
        <DataTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Detail</TableHead>
                {showCompany && <TableHead className="hidden sm:table-cell">Company</TableHead>}
                <TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {statement.from}
                </TableCell>
                <TableCell className="font-medium">Balance forward</TableCell>
                {showCompany && <TableCell className="hidden sm:table-cell" />}
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCentsSigned(statement.forwardCents)}
                </TableCell>
              </TableRow>
              {statement.lines.map((line, index) => (
                <TableRow key={`${line.kind}-${line.invoiceId}-${index}`}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {line.date}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/m/accounting/sales/invoices/${line.invoiceId}`}
                      className="font-mono text-xs hover:underline print:no-underline"
                    >
                      {line.invoiceNumber}
                    </Link>{" "}
                    <span className="text-muted-foreground">{line.detail}</span>
                  </TableCell>
                  {showCompany && (
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {companyName.get(line.entityId) ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono tabular-nums">
                    {line.chargeCents ? formatCents(line.chargeCents) : ""}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {line.paymentCents ? formatCents(line.paymentCents) : ""}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatCentsSigned(line.balanceCents)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {statement.to}
                </TableCell>
                <TableCell>Closing balance</TableCell>
                {showCompany && <TableCell className="hidden sm:table-cell" />}
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCents(statement.chargesCents)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCents(statement.paymentsCents)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCentsSigned(statement.closingCents)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DataTable>
      )}

      {statement.openInvoices.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-heading text-base font-medium tracking-heading">
            Open invoices as of {statement.to}
          </h2>
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  {showCompany && <TableHead className="hidden sm:table-cell">Company</TableHead>}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.openInvoices.map((i) => {
                  const overdue = !!i.dueDate && i.dueDate < statement.to;
                  return (
                    <TableRow key={i.invoiceId}>
                      <TableCell>
                        <Link
                          href={`/dashboard/m/accounting/sales/invoices/${i.invoiceId}`}
                          className="font-mono text-xs hover:underline print:no-underline"
                        >
                          {i.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {i.issueDate}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {i.dueDate ?? "—"}
                        {overdue && (
                          <Badge variant="destructive" className="ml-2 print:hidden">
                            overdue
                          </Badge>
                        )}
                      </TableCell>
                      {showCompany && (
                        <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                          {companyName.get(i.entityId) ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCents(i.totalCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCents(i.balanceCents)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
        </div>
      )}
    </div>
  );
}
