import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { Calculator } from "lucide-react";
import { withTenant, schema } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSettings, ledgerIsBalanced } from "./core";
import { formatCentsSigned, toSafeCents } from "./lib/money";
import { AccountingNav } from "./components/accounting-nav";

/** Module home — overview of the ledger's state. */
export async function AccountingModule({ ctx }: { ctx: TenantContext }) {
  const tenantId = ctx.tenant.id;
  const data = await withTenant(tenantId, async (tx) => {
    const [accountCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.tenantId, tenantId),
          eq(schema.accounts.isActive, true),
        ),
      );
    const statusCounts = await tx
      .select({
        status: schema.journalEntries.status,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.tenantId, tenantId))
      .groupBy(schema.journalEntries.status);
    const balanced = await ledgerIsBalanced(tx, tenantId);
    const settings = await getSettings(tx, tenantId);
    const [unreviewed] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bankTransactions)
      .where(
        and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
      );
    const openInvoices = await tx
      .select({
        total: sql<string>`coalesce(sum(${schema.invoices.totalCents}), 0)`,
      })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.tenantId, tenantId),
          sql`${schema.invoices.status} in ('issued', 'partial')`,
        ),
      );
    const openPaid = await tx
      .select({
        paid: sql<string>`coalesce(sum(${schema.invoicePayments.amountCents}), 0)`,
      })
      .from(schema.invoicePayments)
      .innerJoin(
        schema.invoices,
        and(
          eq(schema.invoices.tenantId, schema.invoicePayments.tenantId),
          eq(schema.invoices.id, schema.invoicePayments.invoiceId),
        ),
      )
      .where(
        and(
          eq(schema.invoicePayments.tenantId, tenantId),
          sql`${schema.invoices.status} in ('issued', 'partial')`,
        ),
      );
    const arOutstandingCents =
      toSafeCents(openInvoices[0]?.total ?? 0) - toSafeCents(openPaid[0]?.paid ?? 0);
    const [receiptInbox] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, tenantId),
          eq(schema.documents.status, "inbox"),
        ),
      );
    const openBills = await tx
      .select({
        total: sql<string>`coalesce(sum(${schema.bills.totalCents}), 0)`,
      })
      .from(schema.bills)
      .where(
        and(
          eq(schema.bills.tenantId, tenantId),
          sql`${schema.bills.status} in ('approved', 'partial')`,
        ),
      );
    const openBillsPaid = await tx
      .select({
        paid: sql<string>`coalesce(sum(${schema.billPayments.amountCents}), 0)`,
      })
      .from(schema.billPayments)
      .innerJoin(
        schema.bills,
        and(
          eq(schema.bills.tenantId, schema.billPayments.tenantId),
          eq(schema.bills.id, schema.billPayments.billId),
        ),
      )
      .where(
        and(
          eq(schema.billPayments.tenantId, tenantId),
          sql`${schema.bills.status} in ('approved', 'partial')`,
        ),
      );
    const [awaitingApproval] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bills)
      .where(
        and(
          eq(schema.bills.tenantId, tenantId),
          eq(schema.bills.status, "awaiting_approval"),
        ),
      );
    const apOutstandingCents =
      toSafeCents(openBills[0]?.total ?? 0) -
      toSafeCents(openBillsPaid[0]?.paid ?? 0);
    return {
      accountCount: accountCount.n,
      statusCounts,
      balanced,
      settings,
      unreviewed: unreviewed.n,
      arOutstandingCents,
      receiptInbox: receiptInbox.n,
      apOutstandingCents,
      awaitingApproval: awaitingApproval.n,
    };
  });

  const count = (s: string) =>
    data.statusCounts.find((r) => r.status === s)?.n ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Calculator className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Accounting</h1>
            <p className="text-sm text-muted-foreground">
              Double-entry books for {ctx.tenant.name}.
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/dashboard/m/accounting/journal/new">New entry</Link>
        </Button>
      </div>

      <AccountingNav />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ledger health</CardDescription>
            <CardTitle className="text-base">
              {data.balanced ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">
                  In balance
                </Badge>
              ) : (
                <Badge variant="destructive">Out of balance</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Debits equal credits across all posted entries.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active accounts</CardDescription>
            <CardTitle className="text-2xl">{data.accountCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link className="underline-offset-2 hover:underline" href="/dashboard/m/accounting/accounts">
              Manage the chart of accounts
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Posted entries</CardDescription>
            <CardTitle className="text-2xl">{count("posted")}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {count("draft")} draft{count("draft") === 1 ? "" : "s"} ·{" "}
            {count("void")} void
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Accounts receivable</CardDescription>
            <CardTitle className="text-2xl">
              {formatCentsSigned(data.arOutstandingCents)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link
              className="underline-offset-2 hover:underline"
              href="/dashboard/m/accounting/reports/ar-aging"
            >
              Open invoices — see the aging report
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Bank feed</CardDescription>
            <CardTitle className="text-2xl">{data.unreviewed}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link
              className="underline-offset-2 hover:underline"
              href="/dashboard/m/accounting/banking"
            >
              {data.unreviewed === 0
                ? "Nothing waiting for review"
                : "Transactions waiting for review"}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Accounts payable</CardDescription>
            <CardTitle className="text-2xl">
              {formatCentsSigned(data.apOutstandingCents)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link
              className="underline-offset-2 hover:underline"
              href="/dashboard/m/accounting/purchases/bills"
            >
              {data.awaitingApproval > 0
                ? `${data.awaitingApproval} bill${data.awaitingApproval === 1 ? "" : "s"} awaiting approval`
                : "Open bills — see A/P aging"}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Inbox</CardDescription>
            <CardTitle className="text-2xl">{data.receiptInbox}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link
              className="underline-offset-2 hover:underline"
              href="/dashboard/m/accounting/receipts"
            >
              {data.receiptInbox === 0
                ? "Nothing waiting to be filed"
                : "Documents waiting to be filed"}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Books closed through</CardDescription>
            <CardTitle className="text-2xl">
              {data.settings.closedThrough ?? "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link
              href="/dashboard/m/accounting/close"
              className="underline-offset-2 hover:underline"
            >
              Month-end close, review &amp; export →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
