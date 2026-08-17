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
import { CompanyPicker } from "@/modules/accounting/components/company-picker";
import { MoneyBar } from "@/modules/accounting/components/money-bar";
import {
  AP_BUCKETS,
  AP_BUCKET_LABEL,
  RECENT_DAYS,
  documentBucket,
  isApBucket,
  obligationFor,
  type ApBucket,
  type ObligationTone,
} from "@/modules/accounting/lib/obligation";
import { addDaysIso } from "@/modules/accounting/lib/dates";
import { getApAging } from "@/modules/accounting/payables/aging-feed";
import { toSafeCents } from "@/modules/accounting/lib/money";
import {
  formatCentsSigned,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import { entityScopeCondition } from "@/modules/accounting/core";
import { reportEntityOr404 } from "@/modules/accounting/lib/report-entity";
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

/** Obligation tone -> badge. `destructive` is spent only on overdue money. */
const TONE_BADGE: Record<ObligationTone, "default" | "secondary" | "destructive" | "outline"> = {
  overdue: "destructive",
  due: "default",
  neutral: "secondary",
  settled: "outline",
};

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; bucket?: string; entity?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;
  const sp = await searchParams;
  const bucket = isApBucket(sp.bucket) ? sp.bucket : null;
  // A bucket takes over the list; the status tabs stay visible and clear it.
  const tab = bucket ? "all" : TABS.some((t) => t.key === sp.tab) ? sp.tab! : "all";

  const data = await withTenant(tenantId, async (tx) => {
    const today = todayInTimezone(ctx.tenant.timezone);
    // The bar, the buckets and the table all read one scope — see the invoice
    // list for why a half-scoped list is worse than an unscoped one.
    const entityView = await reportEntityOr404(
      tx,
      tenantId,
      sp.entity,
      // A list of bills, not a statement: consolidation eliminates ledger
      // legs, and a bill one company paid for another is still that
      // company's bill to a real vendor outside the group.
      "declined",
    );
    const inScope = entityScopeCondition(entityView.scope, schema.bills.entityId);

    /**
     * The bar covers EVERY bill, not the 200 the table shows — a total that
     * silently described a page would be the number somebody trusts to decide
     * whether to worry.
     */
    const allRows = await tx
      .select({
        id: schema.bills.id,
        status: schema.bills.status,
        dueDate: schema.bills.dueDate,
        totalCents: schema.bills.totalCents,
        paidCents: sql<string>`coalesce((select sum(${schema.billPayments.amountCents}) from ${schema.billPayments} where ${schema.billPayments.tenantId} = ${schema.bills.tenantId} and ${schema.billPayments.billId} = ${schema.bills.id}), 0)`,
      })
      .from(schema.bills)
      .where(and(eq(schema.bills.tenantId, tenantId), inScope));

    const recentPayments = await tx
      .select({
        billId: schema.billPayments.billId,
        amountCents: schema.billPayments.amountCents,
        paymentDate: schema.billPayments.paymentDate,
      })
      .from(schema.billPayments)
      .where(eq(schema.billPayments.tenantId, tenantId));

    const since = addDaysIso(today, -RECENT_DAYS);
    const paidRecentlyByBill = new Map<string, number>();
    for (const p of recentPayments) {
      if (p.paymentDate < since) continue;
      paidRecentlyByBill.set(
        p.billId,
        (paidRecentlyByBill.get(p.billId) ?? 0) + p.amountCents,
      );
    }

    const tally: Record<ApBucket, [number, number]> = {
      overdue: [0, 0],
      not_due: [0, 0],
      awaiting_approval: [0, 0],
      paid_recently: [0, 0],
    };
    const inBucket = new Map<string, Set<string>>();
    const put = (key: string, id: string) => {
      const set = inBucket.get(key) ?? new Set<string>();
      set.add(id);
      inBucket.set(key, set);
    };
    for (const row of allRows) {
      const balance = row.totalCents - toSafeCents(row.paidCents);
      // A bill awaiting approval is an obligation on a PERSON, not yet on the
      // ledger, so it gets its own bucket rather than being folded into the
      // date-based ones.
      if (row.status === "awaiting_approval") {
        tally.awaiting_approval[0] += balance;
        tally.awaiting_approval[1] += 1;
        put("awaiting_approval", row.id);
      }
      const doc = documentBucket({
        status: row.status,
        dueDate: row.dueDate,
        balanceCents: balance,
        today,
      });
      if (doc && row.status !== "awaiting_approval") {
        tally[doc][0] += balance;
        tally[doc][1] += 1;
        put(doc, row.id);
      }
      const recent = paidRecentlyByBill.get(row.id) ?? 0;
      if (recent > 0) {
        tally.paid_recently[0] += recent;
        tally.paid_recently[1] += 1;
        put("paid_recently", row.id);
      }
    }

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
          inScope,
          statusFilter
            ? inArray(
                schema.bills.status,
                statusFilter as ("approved" | "partial")[],
              )
            : undefined,
          // An empty bucket becomes `false` rather than `id in ('')`, which
          // would be a uuid type error at the database.
          bucket
            ? (inBucket.get(bucket)?.size ?? 0) > 0
              ? inArray(schema.bills.id, [...inBucket.get(bucket)!])
              : sql`false`
            : undefined,
        ),
      )
      .orderBy(desc(schema.bills.billDate), desc(schema.bills.createdAt))
      .limit(200);
    const aging = await getApAging(tx, tenantId, today, entityView.scope);
    return { bills, aging, today, tally, inBucket, entityView };
  });

  const companyName = new Map(data.entityView.entities.map((e) => [e.id, e.name]));
  const showCompany = data.entityView.entities.length > 1;
  // Every link out keeps the scope — see the invoice list.
  const q = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    if (sp.entity) p.set("entity", sp.entity);
    const s = p.toString();
    return `/dashboard/m/accounting/purchases/bills${s ? `?${s}` : ""}`;
  };

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

      <MoneyBar
        noun="bill"
        activeKey={bucket}
        clearHref={q()}
        buckets={AP_BUCKETS.map((key) => ({
          key,
          label: AP_BUCKET_LABEL[key],
          cents: data.tally[key][0],
          count: data.tally[key][1],
          href: q({ bucket: key }),
          alarm: key === "overdue",
        }))}
      />

      {/* Sub-nav and status filter share one row, as on the invoices page. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PurchasesNav />
        <div className="flex flex-wrap items-center gap-3">
        <CompanyPicker
          entities={data.entityView.entities.map((e) => ({
            id: e.id,
            name: e.name,
          }))}
        />
        <FilterPills
          activeKey={tab}
          items={TABS.map((t) => ({
            key: t.key,
            label: t.label,
            href: q({ tab: t.key }),
          }))}
          className="print:hidden"
        />
        </div>
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
              {showCompany && <TableHead>Company</TableHead>}
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
              const obligation = obligationFor({
                status: bill.status,
                dueDate: bill.dueDate,
                balanceCents: balance,
                today: data.today,
              });
              const awaiting = bill.status === "awaiting_approval";
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
                  {showCompany && (
                    <TableCell className="text-xs text-muted-foreground">
                      {companyName.get(bill.entityId) ?? "—"}
                    </TableCell>
                  )}
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
                    {/* Awaiting approval is an obligation on a PERSON and has
                        no date to be late against, so it keeps its own label
                        rather than being rendered as a due date. */}
                    <Badge variant={awaiting ? "secondary" : TONE_BADGE[obligation.tone]}>
                      {awaiting ? "Awaiting approval" : obligation.label}
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
