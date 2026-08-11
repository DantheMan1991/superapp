import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { ShoppingCart } from "lucide-react";
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
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getApAging } from "@/modules/accounting/payables/aging-feed";
import { toSafeCents } from "@/modules/accounting/lib/money";
import {
  formatCentsSigned,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import { PurchasesNav } from "../purchases-nav";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "open", label: "Open" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
] as const;

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  awaiting_approval: "secondary",
  approved: "default",
  partial: "default",
  paid: "secondary",
  void: "outline",
};

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "all";

  const data = await withTenant(tenantId, async (tx) => {
    const statusFilter =
      tab === "all"
        ? undefined
        : tab === "open"
          ? ["approved", "partial"]
          : [tab];
    const bills = await tx
      .select({
        bill: schema.bills,
        vendorName: schema.vendors.name,
        paidCents: sql<string>`coalesce((select sum(${schema.billPayments.amountCents}) from ${schema.billPayments} where ${schema.billPayments.tenantId} = ${schema.bills.tenantId} and ${schema.billPayments.billId} = ${schema.bills.id}), 0)`,
      })
      .from(schema.bills)
      .innerJoin(
        schema.vendors,
        and(
          eq(schema.vendors.tenantId, schema.bills.tenantId),
          eq(schema.vendors.id, schema.bills.vendorId),
        ),
      )
      .where(
        and(
          eq(schema.bills.tenantId, tenantId),
          statusFilter
            ? inArray(
                schema.bills.status,
                statusFilter as ("approved" | "partial")[],
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.bills.billDate), desc(schema.bills.createdAt))
      .limit(200);
    const today = todayInTimezone(ctx.tenant.timezone);
    const aging = await getApAging(tx, tenantId, today);
    return { bills, aging };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bills"
        description={
          <>
            What {ctx.tenant.name} owes vendors —{" "}
            <span className="tabular-nums">
              {formatCentsSigned(data.aging.totalCents)}
            </span>{" "}
            outstanding
            {data.aging.overdueCents > 0 && (
              <>
                {" · "}
                <span className="font-medium text-destructive tabular-nums">
                  {formatCentsSigned(data.aging.overdueCents)} overdue
                </span>
              </>
            )}
            .
          </>
        }
        actions={
          <Button asChild size="sm">
            <Link href="/dashboard/m/accounting/purchases/bills/new">
              New bill
            </Link>
          </Button>
        }
      />

      <AccountingNav />

      {/* Sub-nav and status filter share one row, as on the invoices page. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PurchasesNav />
        <FilterPills
          activeKey={tab}
          items={TABS.map((t) => ({
            key: t.key,
            label: t.label,
            href: `/dashboard/m/accounting/purchases/bills?tab=${t.key}`,
          }))}
          className="print:hidden"
        />
      </div>

      <DataTable
        isEmpty={data.bills.length === 0}
        empty={
          <EmptyState
            icon={<ShoppingCart />}
            title={tab === "all" ? "Record your first bill" : "Nothing here"}
            description={
              tab === "all"
                ? "Add one directly, or open the Inbox and use “Create bill” on an emailed one."
                : "Another status filter may have what you are after."
            }
            action={
              tab === "all" ? (
                <Button asChild size="sm">
                  <Link href="/dashboard/m/accounting/purchases/bills/new">
                    New bill
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
              <TableHead>Vendor</TableHead>
              <TableHead className="hidden sm:table-cell">Invoice #</TableHead>
              <TableHead>Bill date</TableHead>
              <TableHead className="hidden sm:table-cell">Due</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.bills.map(({ bill, vendorName, paidCents }) => {
              const balance = bill.totalCents - toSafeCents(paidCents);
              return (
                <TableRow key={bill.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-2 hover:underline"
                      href={`/dashboard/m/accounting/purchases/bills/${bill.id}`}
                    >
                      {vendorName}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                    {bill.billNumber || "—"}
                  </TableCell>
                  <TableCell className="text-sm">{bill.billDate}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {bill.dueDate ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCentsSigned(bill.totalCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {bill.status === "void"
                      ? "—"
                      : formatCentsSigned(
                          ["draft", "awaiting_approval"].includes(bill.status)
                            ? bill.totalCents
                            : balance,
                        )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[bill.status] ?? "outline"}>
                      {bill.status.replaceAll("_", " ")}
                    </Badge>
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
