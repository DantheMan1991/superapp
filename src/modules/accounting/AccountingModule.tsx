import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { Calculator } from "lucide-react";
import { withTenant, schema } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { getSettings, ledgerIsBalancedPerEntity, listEntities } from "./core";
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
    // PER ENTITY, not combined. Two companies out by equal and opposite
    // amounts sum to zero, so a combined check would report a healthy ledger
    // in exactly the case a mis-scoped write produces.
    const balanced = await ledgerIsBalancedPerEntity(tx, tenantId);
    const entities = await listEntities(tx, tenantId);
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
          // Receipts captured by this module only — see documents.ts.
          eq(schema.documents.origin, "accounting"),
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
      entityCount: entities.length,
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
      <PageHeader
        title="Accounting"
        description={`Double-entry books for ${ctx.tenant.name}.`}
        icon={<Calculator />}
        actions={
          <Button asChild>
            <Link href="/dashboard/m/accounting/journal/new">New entry</Link>
          </Button>
        }
      />

      <AccountingNav />

      {/*
        Eight `StatCard`s where there were eight hand-built cards. Three of them
        had drifted onto different value sizes, and every footnote was its own
        inline link; `href` now makes the whole card the target, which is both a
        larger hit area and one less thing to style per card.
      */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Ledger health"
          value={data.balanced ? "In balance" : "Out of balance"}
          tone={data.balanced ? "success" : "destructive"}
          footnote={
            data.entityCount > 1
              ? "Debits equal credits within every company."
              : "Debits equal credits across all posted entries."
          }
        />
        {/*
          The COMPANIES card is the only entry point to the legal-entity screen,
          and it is deliberately here rather than an eleventh tab in
          `AccountingNav`: that strip was rebuilt because ten tabs already
          wrapped onto two lines, and most tenants have exactly one company for
          ever. It still has to exist at one, because adding the second is how a
          tenant ever gets to two (ADR 0010).
        */}
        <StatCard
          label="Companies"
          value={data.entityCount}
          href="/dashboard/m/accounting/companies"
          footnote={
            data.entityCount === 1
              ? "One set of books. Add another for a second LLC."
              : "Each keeps its own books — reports can scope to one"
          }
        />
        <StatCard
          label="Active accounts"
          value={data.accountCount}
          href="/dashboard/m/accounting/accounts"
          footnote="Manage the chart of accounts"
        />
        <StatCard
          label="Posted entries"
          value={count("posted")}
          footnote={
            <>
              {count("draft")} draft{count("draft") === 1 ? "" : "s"} ·{" "}
              {count("void")} void
            </>
          }
        />
        <StatCard
          label="Accounts receivable"
          value={formatCentsSigned(data.arOutstandingCents)}
          href="/dashboard/m/accounting/reports/ar-aging"
          footnote="Open invoices — see the aging report"
        />
        <StatCard
          label="Bank feed"
          value={data.unreviewed}
          href="/dashboard/m/accounting/banking"
          footnote={
            data.unreviewed === 0
              ? "Nothing waiting for review"
              : "Transactions waiting for review"
          }
        />
        <StatCard
          label="Accounts payable"
          value={formatCentsSigned(data.apOutstandingCents)}
          href="/dashboard/m/accounting/purchases/bills"
          footnote={
            data.awaitingApproval > 0
              ? `${data.awaitingApproval} bill${data.awaitingApproval === 1 ? "" : "s"} awaiting approval`
              : "Open bills — see A/P aging"
          }
        />
        <StatCard
          label="Inbox"
          value={data.receiptInbox}
          href="/dashboard/m/accounting/receipts"
          footnote={
            data.receiptInbox === 0
              ? "Nothing waiting to be filed"
              : "Documents waiting to be filed"
          }
        />
        <StatCard
          label="Books closed through"
          value={data.settings.closedThrough ?? "—"}
          href="/dashboard/m/accounting/close"
          footnote="Month-end close, review and export"
        />
      </div>
    </div>
  );
}
