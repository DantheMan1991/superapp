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
import { MoneyBar } from "@/modules/accounting/components/money-bar";
import {
  AR_BUCKETS,
  AR_BUCKET_LABEL,
  RECENT_DAYS,
  documentBucket,
  isArBucket,
  obligationFor,
  type ObligationTone,
} from "@/modules/accounting/lib/obligation";
import { addDaysIso } from "@/modules/accounting/lib/dates";
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

/**
 * The obligation's tone as a badge variant. `destructive` is spent only on
 * genuinely overdue money — if "due in 3 days" were red too, neither would
 * mean anything.
 */
const TONE_BADGE: Record<ObligationTone, "default" | "secondary" | "destructive" | "outline"> = {
  overdue: "destructive",
  due: "default",
  neutral: "secondary",
  settled: "outline",
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
  searchParams: Promise<{ f?: string; bucket?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;
  const bucket = isArBucket(sp.bucket) ? sp.bucket : null;
  // A bucket is a sharper question than a lifecycle status, so choosing one
  // takes over the list; the status pills stay visible and clear it.
  const filter = bucket ? FILTERS[3] : (FILTERS.find((f) => f.key === sp.f) ?? FILTERS[0]);

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const today = todayInTimezone(ctx.tenant.timezone);
    const aging = await getArAging(tx, ctx.tenant.id, today);

    /**
     * The bar's figures cover EVERY invoice, not the 200 the table shows.
     * A total that silently described a page would be worse than no total —
     * it is the number somebody reads to decide whether to worry.
     */
    const allRows = await tx
      .select({
        id: schema.invoices.id,
        status: schema.invoices.status,
        dueDate: schema.invoices.dueDate,
        totalCents: schema.invoices.totalCents,
        paidCents: sql<string>`coalesce(sum(${schema.invoicePayments.amountCents}), 0)`,
      })
      .from(schema.invoices)
      .leftJoin(
        schema.invoicePayments,
        and(
          eq(schema.invoicePayments.tenantId, schema.invoices.tenantId),
          eq(schema.invoicePayments.invoiceId, schema.invoices.id),
        ),
      )
      .where(eq(schema.invoices.tenantId, ctx.tenant.id))
      .groupBy(
        schema.invoices.id,
        schema.invoices.status,
        schema.invoices.dueDate,
        schema.invoices.totalCents,
      );

    /**
     * Where each payment landed. `undeposited_funds` is a SUBTYPE, not an id,
     * so this reads the account rather than hard-coding 1250 — a tenant may
     * have renamed or renumbered it.
     */
    const payments = await tx
      .select({
        invoiceId: schema.invoicePayments.invoiceId,
        amountCents: schema.invoicePayments.amountCents,
        paymentDate: schema.invoicePayments.paymentDate,
        subtype: schema.accounts.subtype,
      })
      .from(schema.invoicePayments)
      .innerJoin(
        schema.accounts,
        and(
          eq(schema.accounts.tenantId, schema.invoicePayments.tenantId),
          eq(schema.accounts.id, schema.invoicePayments.depositAccountId),
        ),
      )
      .where(eq(schema.invoicePayments.tenantId, ctx.tenant.id));

    const since = addDaysIso(today, -RECENT_DAYS);
    const undepositedByInvoice = new Map<string, number>();
    const depositedByInvoice = new Map<string, number>();
    for (const p of payments) {
      const target =
        p.subtype === "undeposited_funds"
          ? undepositedByInvoice
          : p.paymentDate >= since
            ? depositedByInvoice
            : null;
      if (!target) continue;
      target.set(p.invoiceId, (target.get(p.invoiceId) ?? 0) + p.amountCents);
    }

    const tally = { overdue: [0, 0], not_due: [0, 0], not_deposited: [0, 0], deposited: [0, 0] };
    const inBucket = new Map<string, Set<string>>();
    for (const row of allRows) {
      const balance = row.totalCents - toSafeCents(row.paidCents);
      const doc = documentBucket({
        status: row.status,
        dueDate: row.dueDate,
        balanceCents: balance,
        today,
      });
      const keys: string[] = [];
      if (doc) {
        tally[doc][0] += balance;
        tally[doc][1] += 1;
        keys.push(doc);
      }
      // The money buckets are about payments received, so they count what
      // ARRIVED rather than what is still owed.
      const und = undepositedByInvoice.get(row.id) ?? 0;
      if (und > 0) {
        tally.not_deposited[0] += und;
        tally.not_deposited[1] += 1;
        keys.push("not_deposited");
      }
      const dep = depositedByInvoice.get(row.id) ?? 0;
      if (dep > 0) {
        tally.deposited[0] += dep;
        tally.deposited[1] += 1;
        keys.push("deposited");
      }
      for (const k of keys) {
        const set = inBucket.get(k) ?? new Set<string>();
        set.add(row.id);
        inBucket.set(k, set);
      }
    }

    /**
     * The displayed page is fetched LAST, so an active bucket can be applied
     * as a real predicate. Filtering after `limit(200)` would quietly show a
     * subset of a page rather than the first page of the bucket.
     */
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
          // An EMPTY bucket becomes `false`, not `id in ('')` — the column is
          // a uuid, so an empty-string sentinel is a type error at the
          // database rather than a query that matches nothing.
          ...(bucket
            ? [
                (inBucket.get(bucket)?.size ?? 0) > 0
                  ? inArray(schema.invoices.id, [...inBucket.get(bucket)!])
                  : sql`false`,
              ]
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
    return { invoices, aging, today, tally, inBucket };
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
      <MoneyBar
        noun="invoice"
        activeKey={bucket}
        clearHref="/dashboard/m/accounting/sales/invoices"
        buckets={AR_BUCKETS.map((key) => ({
          key,
          label: AR_BUCKET_LABEL[key],
          cents: data.tally[key][0],
          count: data.tally[key][1],
          href: `/dashboard/m/accounting/sales/invoices?bucket=${key}`,
          alarm: key === "overdue",
        }))}
      />

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
              const obligation = obligationFor({
                status: inv.status,
                dueDate: inv.dueDate,
                balanceCents: balance,
                today: data.today,
              });
              const overdue = obligation.tone === "overdue";
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
                    {/* The obligation, not the lifecycle state: "Overdue 60
                        days" is what a reader can act on, where `issued` only
                        says what the software did. */}
                    <Badge variant={TONE_BADGE[obligation.tone]}>
                      {obligation.label}
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
