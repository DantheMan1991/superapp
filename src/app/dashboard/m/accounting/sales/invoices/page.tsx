import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { getSettings } from "@/modules/accounting/core";
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
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(settings.bookkeepingTimezone);
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">
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
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/dashboard/m/accounting/sales/invoices/new">New invoice</Link>
        </Button>
      </div>

      <AccountingNav />
      <SalesNav />

      <div className="flex gap-1 border-b pb-px">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/dashboard/m/accounting/sales/invoices?f=${f.key}`}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium",
              filter.key === f.key
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {data.invoices.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No invoices here yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
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
                    const balance =
                      inv.status === "void" ? 0 : inv.totalCents - paid;
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
