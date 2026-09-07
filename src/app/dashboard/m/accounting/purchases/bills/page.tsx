import Link from "next/link";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
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
import { LinkRow } from "@/components/app/link-row";
import { ListSearch } from "@/components/app/list-search";
import { Pager } from "@/components/app/pager";
import { ilikePattern, pageFrom, pageWindow, searchTerm } from "@/lib/list-query";
import { paidFromRegistersFor } from "@/modules/accounting/lib/deposit-options";
import { ApproveBillButton } from "./approve-bill-button";
import { RecordBillPaymentButton } from "./record-bill-payment-dialog";
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

/** Rows per page. The list used to stop dead at 200 with no way past. */
const PAGE_SIZE = 50;

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    bucket?: string;
    entity?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;
  const sp = await searchParams;
  const bucket = isApBucket(sp.bucket) ? sp.bucket : null;
  // A bucket takes over the list; the status tabs stay visible and clear it.
  const tab = bucket ? "all" : TABS.some((t) => t.key === sp.tab) ? sp.tab! : "all";
  const term = searchTerm(sp.q);
  const pattern = term ? ilikePattern(term) : null;

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
    // One predicate for the count and the page — see the invoice list. The
    // search reads the vendor's name, the vendor's invoice number and the
    // memo, which is what somebody remembers about a bill.
    const vendorJoin = and(
      eq(schema.vendors.tenantId, schema.bills.tenantId),
      eq(schema.vendors.id, schema.bills.vendorId),
    );
    const rowWhere = and(
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
      pattern
        ? or(
            ilike(schema.vendors.name, pattern),
            ilike(schema.bills.billNumber, pattern),
            ilike(schema.bills.memo, pattern),
          )
        : undefined,
    );
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.bills)
      .innerJoin(schema.vendors, vendorJoin)
      .where(rowWhere);
    const window = pageWindow(pageFrom(sp.page), PAGE_SIZE, total);
    const bills = await tx
      .select({
        bill: schema.bills,
        vendorName: schema.vendors.name,
        paidCents: sql<string>`coalesce((select sum(${schema.billPayments.amountCents}) from ${schema.billPayments} where ${schema.billPayments.tenantId} = ${schema.bills.tenantId} and ${schema.billPayments.billId} = ${schema.bills.id}), 0)`,
      })
      .from(schema.bills)
      .innerJoin(schema.vendors, vendorJoin)
      .where(rowWhere)
      .orderBy(desc(schema.bills.billDate), desc(schema.bills.createdAt))
      .limit(PAGE_SIZE)
      .offset(window.offset);
    const aging = await getApAging(tx, tenantId, today, entityView.scope);
    /**
     * What the row's Record payment needs: every active register, other
     * companies' included, labelled per row by `paidFromRegistersFor` — the
     * same list the bill page loads for the same dialog. Owners only,
     * because only owners get the button.
     */
    const registers =
      ctx.role === "owner"
        ? await tx.query.bankAccounts.findMany({
            where: and(
              eq(schema.bankAccounts.tenantId, tenantId),
              eq(schema.bankAccounts.isActive, true),
            ),
            columns: { accountId: true, name: true, kind: true, entityId: true },
          })
        : [];
    return { bills, window, aging, today, tally, inBucket, entityView, registers };
  });
  const isOwner = ctx.role === "owner";

  const companyName = new Map(data.entityView.entities.map((e) => [e.id, e.name]));
  const showCompany = data.entityView.entities.length > 1;
  // Every link out keeps the scope and the search term, and drops the page
  // — see the invoice list.
  const href = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    if (sp.entity) p.set("entity", sp.entity);
    if (term) p.set("q", term);
    const s = p.toString();
    return `/dashboard/m/accounting/purchases/bills${s ? `?${s}` : ""}`;
  };
  const keep = {
    ...(tab !== "all" && !bucket ? { tab } : {}),
    ...(bucket ? { bucket } : {}),
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
        clearHref={href()}
        buckets={AP_BUCKETS.map((key) => ({
          key,
          label: AP_BUCKET_LABEL[key],
          cents: data.tally[key][0],
          count: data.tally[key][1],
          href: href({ bucket: key }),
          alarm: key === "overdue",
        }))}
      />

      {/* Sub-nav and status filter share one row, as on the invoices page. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PurchasesNav />
        <div className="flex flex-wrap items-center gap-3">
        <ListSearch placeholder="Search vendor, invoice # or memo" />
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
            href: href({ tab: t.key }),
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
            title={
              term
                ? `Nothing matches “${term}”`
                : tab === "all"
                  ? "Record your first bill"
                  : "Nothing here"
            }
            description={
              term
                ? "Try fewer words, or clear the search."
                : tab === "all"
                  ? "Add one directly, or open the Inbox and use “Create bill” on an emailed one."
                  : "Another status filter may have what you are after."
            }
            action={
              !term && tab === "all" ? (
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
              {isOwner && <TableHead />}
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
              const href = `/dashboard/m/accounting/purchases/bills/${bill.id}`;
              return (
                // The whole row opens the bill; the vendor's name stays a real
                // link inside it. See link-row.tsx for what a row click leaves
                // alone.
                <LinkRow key={bill.id} href={href}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-2 hover:underline"
                      href={href}
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
                  {isOwner && (
                    // Always visible, never hover-revealed: on a phone there
                    // is no hover, and these are the buttons the phone is for.
                    <TableCell className="whitespace-nowrap text-right">
                      {["draft", "awaiting_approval"].includes(bill.status) && (
                        <ApproveBillButton
                          billId={bill.id}
                          version={bill.version}
                          className="h-7"
                        />
                      )}
                      {["approved", "partial"].includes(bill.status) && (
                        <RecordBillPaymentButton
                          variant="outline"
                          className="h-7"
                          bill={{ id: bill.id, version: bill.version, remainingCents: balance }}
                          today={data.today}
                          registers={paidFromRegistersFor({
                            registers: data.registers,
                            companies: data.entityView.entities,
                            entityId: bill.entityId,
                          })}
                        />
                      )}
                    </TableCell>
                  )}
                </LinkRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>

      <Pager
        window={data.window}
        noun={{ one: "bill", many: "bills" }}
        hrefFor={(page) => href({ ...keep, ...(page > 1 ? { page: String(page) } : {}) })}
      />
    </div>
  );
}
