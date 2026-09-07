import Link from "next/link";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
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
import { LinkRow } from "@/components/app/link-row";
import { ListSearch } from "@/components/app/list-search";
import { Pager } from "@/components/app/pager";
import { ilikePattern, pageFrom, pageWindow, searchTerm } from "@/lib/list-query";
import { depositOptionsFor } from "@/modules/accounting/lib/deposit-options";
import { listPaymentMethods } from "@/modules/accounting/invoicing/catalogue";
import { RecordPaymentButton } from "./record-payment-dialog";
import { CompanyPicker } from "@/modules/accounting/components/company-picker";
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
import { entityScopeCondition } from "@/modules/accounting/core";
import { reportEntityOr404 } from "@/modules/accounting/lib/report-entity";
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

/** Rows per page. The list used to stop dead at 200 with no way past. */
const PAGE_SIZE = 50;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    f?: string;
    bucket?: string;
    entity?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;
  const bucket = isArBucket(sp.bucket) ? sp.bucket : null;
  // A bucket is a sharper question than a lifecycle status, so choosing one
  // takes over the list; the status pills stay visible and clear it.
  const filter = bucket ? FILTERS[3] : (FILTERS.find((f) => f.key === sp.f) ?? FILTERS[0]);
  const term = searchTerm(sp.q);
  const pattern = term ? ilikePattern(term) : null;

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const today = todayInTimezone(ctx.tenant.timezone);
    /**
     * THE WHOLE PAGE TAKES THE SCOPE, not just the header figure. The MoneyBar,
     * the bucket tallies and the table all read the same `entity`, because a
     * list showing one company's invoices under another company's "overdue"
     * total is the kind of screen somebody makes a decision from.
     */
    const entityView = await reportEntityOr404(
      tx,
      ctx.tenant.id,
      sp.entity,
      // A list of invoices, not a statement — nothing on it is intercompany.
      "declined",
    );
    const inScope = entityScopeCondition(entityView.scope, schema.invoices.entityId);
    const aging = await getArAging(tx, ctx.tenant.id, today, entityView.scope);

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
      .where(and(eq(schema.invoices.tenantId, ctx.tenant.id), inScope))
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
        // Set once a deposit has banked the payment out of Undeposited Funds
        // (a voided deposit clears the link, so the row comes back here).
        depositDate: schema.deposits.depositDate,
      })
      .from(schema.invoicePayments)
      .innerJoin(
        schema.accounts,
        and(
          eq(schema.accounts.tenantId, schema.invoicePayments.tenantId),
          eq(schema.accounts.id, schema.invoicePayments.depositAccountId),
        ),
      )
      .leftJoin(
        schema.deposits,
        and(
          eq(schema.deposits.tenantId, schema.invoicePayments.tenantId),
          eq(schema.deposits.id, schema.invoicePayments.depositId),
        ),
      )
      .where(eq(schema.invoicePayments.tenantId, ctx.tenant.id));

    /**
     * `Not deposited` is money still in the drawer: recorded into Undeposited
     * Funds and banked by no deposit. `Deposited` is money that reached the
     * bank recently, by either road — straight into a register when it was
     * recorded, or through a deposit, dated the day of the DEPOSIT rather
     * than the day of the payment, because that is the day it reached the bank.
     */
    const since = addDaysIso(today, -RECENT_DAYS);
    const undepositedByInvoice = new Map<string, number>();
    const depositedByInvoice = new Map<string, number>();
    for (const p of payments) {
      const bankedOn =
        p.subtype === "undeposited_funds" ? p.depositDate : p.paymentDate;
      const target = !bankedOn
        ? undepositedByInvoice
        : bankedOn >= since
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
     * as a real predicate. Filtering after the page's LIMIT would quietly
     * show a subset of a page rather than the first page of the bucket.
     *
     * ONE predicate for the count and the page, built once, so "of 312"
     * and the rows can never describe different lists. The search reads the
     * number, the customer's name and the memo — what somebody remembers
     * about an invoice — as one case-insensitive contains.
     */
    const rowWhere = and(
      eq(schema.invoices.tenantId, ctx.tenant.id),
      inScope,
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
      ...(pattern
        ? [
            or(
              ilike(schema.invoices.invoiceNumber, pattern),
              ilike(schema.customers.name, pattern),
              ilike(schema.invoices.memo, pattern),
            ),
          ]
        : []),
    );
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.invoices)
      .innerJoin(
        schema.customers,
        and(
          eq(schema.customers.tenantId, schema.invoices.tenantId),
          eq(schema.customers.id, schema.invoices.customerId),
        ),
      )
      .where(rowWhere);
    const window = pageWindow(pageFrom(sp.page), PAGE_SIZE, total);
    const invoices = await tx
      .select({
        id: schema.invoices.id,
        number: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        issueDate: schema.invoices.issueDate,
        dueDate: schema.invoices.dueDate,
        totalCents: schema.invoices.totalCents,
        customerName: schema.customers.name,
        entityId: schema.invoices.entityId,
        // The row's Record payment sends it as the CAS version, like the page.
        version: schema.invoices.version,
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
      .where(rowWhere)
      .groupBy(
        schema.invoices.id,
        schema.invoices.invoiceNumber,
        schema.invoices.status,
        schema.invoices.issueDate,
        schema.invoices.dueDate,
        schema.invoices.totalCents,
        schema.customers.name,
        schema.invoices.entityId,
        schema.invoices.version,
      )
      .orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.createdAt))
      .limit(PAGE_SIZE)
      .offset(window.offset);

    /**
     * What the row's Record payment needs: every active register (other
     * companies' included, labelled per row by `depositOptionsFor`), the
     * Undeposited Funds account, and the payment methods — the same three
     * lists the invoice page loads for the same dialog. Owners only, because
     * only owners get the button.
     */
    const registers =
      ctx.role === "owner"
        ? await tx.query.bankAccounts.findMany({
            where: and(
              eq(schema.bankAccounts.tenantId, ctx.tenant.id),
              eq(schema.bankAccounts.isActive, true),
            ),
            columns: { accountId: true, name: true, entityId: true },
          })
        : [];
    const undeposited =
      ctx.role === "owner"
        ? await tx.query.accounts.findFirst({
            where: and(
              eq(schema.accounts.tenantId, ctx.tenant.id),
              eq(schema.accounts.subtype, "undeposited_funds"),
              eq(schema.accounts.isSystem, true),
            ),
            columns: { id: true },
          })
        : null;
    const paymentMethods =
      ctx.role === "owner"
        ? (await listPaymentMethods(tx, ctx.tenant.id, { activeOnly: true })).map(
            (m) => ({ code: m.code, name: m.name }),
          )
        : [];
    return {
      invoices,
      window,
      aging,
      today,
      tally,
      inBucket,
      entityView,
      registers,
      undepositedAccountId: undeposited?.id ?? null,
      paymentMethods,
    };
  });
  const isOwner = ctx.role === "owner";

  // The column appears only for a tenant with more than one company.
  const companyName = new Map(data.entityView.entities.map((e) => [e.id, e.name]));
  const showCompany = data.entityView.entities.length > 1;

  // Every link out of this page keeps the company scope and the search term.
  // A bucket or a status pill that dropped either would widen the list at
  // the moment it narrowed it. None of them keeps the page: a new filter is
  // a new list, read from its first page.
  const href = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(extra);
    if (sp.entity) p.set("entity", sp.entity);
    if (term) p.set("q", term);
    const s = p.toString();
    return `/dashboard/m/accounting/sales/invoices${s ? `?${s}` : ""}`;
  };
  // What the pager must carry: the filter and bucket the reader is inside.
  const keep = {
    ...(sp.f && !bucket ? { f: sp.f } : {}),
    ...(bucket ? { bucket } : {}),
  };

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
        clearHref={href()}
        buckets={AR_BUCKETS.map((key) => ({
          key,
          label: AR_BUCKET_LABEL[key],
          cents: data.tally[key][0],
          count: data.tally[key][1],
          href: href({ bucket: key }),
          alarm: key === "overdue",
        }))}
      />

      {bucket === "not_deposited" && data.tally.not_deposited[1] > 0 && (
        // The tile filters the list; the deposit itself is made on Banking.
        // This is the one place the two meet, so the tile has somewhere to go.
        <p className="text-sm text-muted-foreground print:hidden">
          These payments are waiting in Undeposited Funds.{" "}
          {isOwner ? (
            <Link
              href="/dashboard/m/accounting/banking/deposits/new"
              className="underline hover:no-underline"
            >
              Record a deposit
            </Link>
          ) : (
            "An owner banks them from Banking → Deposits."
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SalesNav />
        <div className="flex flex-wrap items-center gap-3">
        <ListSearch placeholder="Search number, customer or memo" />
        <CompanyPicker
          entities={data.entityView.entities.map((e) => ({
            id: e.id,
            name: e.name,
          }))}
        />
        <FilterPills
          activeKey={filter.key}
          items={FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            href: href({ f: f.key }),
          }))}
          className="print:hidden"
        />
        </div>
      </div>

      <DataTable
        isEmpty={data.invoices.length === 0}
        empty={
          <EmptyState
            icon={<Receipt />}
            title={
              term
                ? `Nothing matches “${term}”`
                : filter.key === "all"
                  ? "Bill your first customer"
                  : `Nothing under ${filter.label}`
            }
            description={
              term
                ? "Try fewer words, or clear the search."
                : filter.key === "all"
                  ? "Raise an invoice and the receivable posts to the ledger for you."
                  : "The other filters may have what you are looking for."
            }
            action={
              !term && filter.key === "all" ? (
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
              {showCompany && <TableHead>Company</TableHead>}
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              {isOwner && <TableHead />}
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
              const href = `/dashboard/m/accounting/sales/invoices/${inv.id}`;
              return (
                // The whole row opens the invoice; the number stays a real
                // link inside it. See link-row.tsx for what a row click
                // deliberately leaves alone.
                <LinkRow key={inv.id} href={href}>
                  <TableCell className="font-mono text-xs">
                    <Link className="hover:underline" href={href}>
                      {inv.number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">
                    {inv.customerName}
                  </TableCell>
                  {showCompany && (
                    <TableCell className="text-xs text-muted-foreground">
                      {companyName.get(inv.entityId) ?? "—"}
                    </TableCell>
                  )}
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
                  {isOwner && (
                    // Always visible, never hover-revealed: on a phone there
                    // is no hover, and this is the button the phone is for.
                    <TableCell className="whitespace-nowrap text-right">
                      {["issued", "partial"].includes(inv.status) && (
                        <RecordPaymentButton
                          invoice={{
                            id: inv.id,
                            version: inv.version,
                            number: inv.number,
                            balanceCents: balance,
                          }}
                          depositOptions={depositOptionsFor({
                            registers: data.registers,
                            companies: data.entityView.entities,
                            undepositedAccountId: data.undepositedAccountId,
                            entityId: inv.entityId,
                          })}
                          today={data.today}
                          paymentMethods={data.paymentMethods}
                          className="h-7"
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
        noun={{ one: "invoice", many: "invoices" }}
        hrefFor={(page) => href({ ...keep, ...(page > 1 ? { page: String(page) } : {}) })}
      />
    </div>
  );
}
