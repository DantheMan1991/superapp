import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { FilterPills } from "@/components/app/filter-pills";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getArAging } from "@/modules/accounting/invoicing/aging-feed";
import {
  formatCentsSigned,
  todayInTimezone,
  toSafeCents,
} from "@/modules/accounting/lib/money";
import { SalesNav } from "../sales-nav";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  issued: "default",
  partial: "default",
  paid: "outline",
  void: "outline",
};

const FILTERS = [
  { key: "open", label: "Open", statuses: ["issued", "partial"] },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "all", label: "All", statuses: [] },
] as const;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.f) ?? FILTERS[0];

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const today = todayInTimezone(ctx.tenant.timezone);
    const invoices = await tx
      .select({
        id: schema.invoices.id,
        number: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        issueDate: schema.invoices.issueDate,
        dueDate: schema.invoices.dueDate,
        totalCents: schema.invoices.totalCents,
        customerName: schema.customers.name,
        paidCents: sql<string>`coalesce(sum(${schema.invoicePayments.amountCents}), 0)`,
      })
      .from(schema.invoices)
      .innerJoin(
        schema.customers,
        and(
          eq(schema.customers.tenantId, schema.invoices.tenantId),
          eq(schema.customers.id, schema.invoices.customerId),
        ),
      )
      .leftJoin(
        schema.invoicePayments,
        and(
          eq(schema.invoicePayments.tenantId, schema.invoices.tenantId),
          eq(schema.invoicePayments.invoiceId, schema.invoices.id),
        ),
      )
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenant.id),
          ...(filter.statuses.length > 0
            ? [inArray(schema.invoices.status, [...filter.statuses])]
            : []),
        ),
      )
      .groupBy(
        schema.invoices.id,
        schema.invoices.invoiceNumber,
        schema.invoices.status,
        schema.invoices.issueDate,
        schema.invoices.dueDate,
        schema.invoices.totalCents,
        schema.customers.name,
      )
      .orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.createdAt))
      .limit(200);
    const aging = await getArAging(tx, ctx.tenant.id, today);
    return { invoices, aging, today };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description={
          <>
            {formatCentsSigned(data.aging.totalCents)} outstanding
            {data.aging.overdueCents > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="font-medium text-destructive">
                  {formatCentsSigned(data.aging.overdueCents)} overdue
                </span>
              </>
            )}
          </>
        }
        actions={
          <Button asChild size="sm">
            <Link href="/dashboard/m/accounting/sales/invoices/new">
              New invoice
            </Link>
          </Button>
        }
      />

      <AccountingNav />

      {/*
        One row where there were two. `SalesNav` picks the list, the pills filter
        it, and putting them on the same line is what takes this page from three
        rows of navigation above the first invoice down to one and a half. They
        are visually distinct — accent-tinted versus solid — so eight adjacent
        pills do not read as one control. See filter-pills.tsx.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SalesNav />
        <FilterPills
          activeKey={filter.key}
          items={FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            href: `/dashboard/m/accounting/sales/invoices?f=${f.key}`,
          }))}
          className="print:hidden"
        />
      </div>

      <DataTable
        isEmpty={data.invoices.length === 0}
        empty={
          <EmptyState
            icon={<Receipt />}
            title={
              filter.key === "all"
                ? "Bill your first customer"
                : `Nothing under ${filter.label}`
            }
            description={
              filter.key === "all"
                ? "Raise an invoice and the receivable posts to the ledger for you."
                : "The other filters may have what you are looking for."
            }
            action={
              filter.key === "all" ? (
                <Button asChild size="sm">
                  <Link href="/dashboard/m/accounting/sales/invoices/new">
                    New invoice
                  </Link>
                </Button>
              ) : undefined
            }
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.invoices.map((inv) => {
              const paid = toSafeCents(inv.paidCents);
              const balance = inv.status === "void" ? 0 : inv.totalCents - paid;
              const overdue =
                balance > 0 &&
                !!inv.dueDate &&
                inv.dueDate < data.today &&
                inv.status !== "draft";
              return (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">
                    <Link
                      className="hover:underline"
                      href={`/dashboard/m/accounting/sales/invoices/${inv.id}`}
                    >
                      {inv.number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {inv.customerName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {inv.issueDate}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "whitespace-nowrap font-mono text-xs",
                      overdue && "font-semibold text-destructive",
                    )}
                  >
                    {inv.dueDate ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[inv.status] ?? "outline"}>
                      {inv.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCentsSigned(inv.totalCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCentsSigned(balance)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
