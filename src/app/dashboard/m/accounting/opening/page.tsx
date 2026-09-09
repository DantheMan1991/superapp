import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { schema, withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import {
  getDefaultEntityId,
  isCodableAccount,
  listEntities,
} from "@/modules/accounting/core";
import { listCustomers } from "@/modules/accounting/invoicing/customers";
import { listVendors } from "@/modules/accounting/payables/vendors";
import { getOpeningPosition } from "@/modules/accounting/opening/position";
import { formatCents } from "@/modules/accounting/lib/money";
import { BooksStartControls } from "../close/close-controls";
import { OpeningDocumentDialog } from "./opening-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/accounting";

/**
 * The opening position (ADR 0037): the day the books begin, what was open
 * on it, and where the books stand on it.
 *
 * ONE COMPANY AT A TIME, like the Close page and for the same reason: an
 * opening balance is a fact about one set of books. Absent means the
 * tenant's default; an unknown id 404s rather than quietly showing another
 * company's position.
 */
export default async function OpeningPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;
  const tenantId = ctx.tenant.id;

  const data = await withTenant(
    tenantId,
    async (tx) => {
      const entities = await listEntities(tx, tenantId, { includeInactive: true });
      const defaultEntityId = await getDefaultEntityId(tx, tenantId);
      if (sp.entity && !entities.some((e) => e.id === sp.entity)) notFound();
      const entityId = sp.entity ?? defaultEntityId;
      const entity = entities.find((e) => e.id === entityId)!;

      const position = await getOpeningPosition(tx, tenantId, entityId);
      const [customers, vendors, accounts, registers] = await Promise.all([
        listCustomers(tx, tenantId),
        listVendors(tx, tenantId),
        tx.query.accounts.findMany({
          where: and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.isActive, true)),
          orderBy: [asc(schema.accounts.code)],
        }),
        tx.query.bankAccounts.findMany({
          where: eq(schema.bankAccounts.tenantId, tenantId),
          columns: { accountId: true },
        }),
      ]);
      const registerIds = new Set(registers.map((r) => r.accountId));
      const option = (a: (typeof accounts)[number]) => ({
        id: a.id,
        label: `${a.code} · ${a.name}`,
      });
      return {
        entities,
        entity,
        showPicker: entities.length > 1,
        position,
        customers: customers.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name })),
        vendors: vendors.map((v) => ({ id: v.id, name: v.name })),
        // The cash basis recognises the line's account when the money moves,
        // so the choice is the same one the invoice and bill forms offer.
        incomeAccounts: accounts
          .filter((a) => a.accountType === "income" && isCodableAccount(a, registerIds))
          .map(option),
        expenseAccounts: accounts
          .filter(
            (a) =>
              ["expense", "asset"].includes(a.accountType) && isCodableAccount(a, registerIds),
          )
          .map(option),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  const isOwner = ctx.role === "owner";
  const day = data.position.booksStartOn;
  const suffix = data.showPicker ? ` — ${data.entity.name}` : "";

  const invoiceStatus = (s: string) =>
    s === "paid" ? "paid" : s === "partial" ? "part paid" : s === "void" ? "void" : "open";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening position"
        description="What was open on the day the books began, and where they stand on that day."
      />

      <AccountingNav />

      {data.showPicker && (
        <div className="flex flex-wrap items-center gap-2">
          {data.entities.map((e) => (
            <Button
              key={e.id}
              asChild
              size="sm"
              variant={e.id === data.entity.id ? "secondary" : "ghost"}
            >
              <Link href={`${BASE}/opening?entity=${e.id}`}>
                {e.name}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {e.booksStartOn ? `begins ${e.booksStartOn}` : "no start day"}
                </span>
              </Link>
            </Button>
          ))}
        </div>
      )}

      {/* THE DAY. The same control as the Close page's card (ADR 0035): a
          conversion starts here, and this is where the rest of it is entered. */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Books begin on{suffix}</CardTitle>
            <CardDescription>
              {day
                ? `${day}. Everything below is as of this day. Nothing may be dated before it, and an imported statement drops the earlier lines.`
                : "Not set. Say when the books begin first — an open invoice or bill is dated on that day, and so is every balance below."}
            </CardDescription>
          </div>
          {isOwner && (
            <BooksStartControls
              entityId={data.entity.id}
              entityName={data.showPicker ? data.entity.name : undefined}
              booksStartOn={day}
            />
          )}
        </CardHeader>
      </Card>

      {/* OWED TO YOU. Real invoices, flagged (ADR 0037). */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Owed to you on that day{suffix}</CardTitle>
            <CardDescription>
              Invoices you had sent before the books began and had not been paid by then. Each is a
              real invoice: it ages, it can be paid, it appears on statements. On that day it
              counts as Opening Balance Equity rather than this year&apos;s sales; when it is paid,
              the cash basis counts it as income under the account you picked.
            </CardDescription>
          </div>
          {isOwner && (
            <OpeningDocumentDialog
              kind="invoice"
              entityId={data.entity.id}
              booksStartOn={day}
              parties={data.customers}
              accounts={data.incomeAccounts}
            />
          )}
        </CardHeader>
        <CardContent>
          {data.position.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded. If nobody owed you anything on that day, there is nothing to do
              here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden sm:table-cell">Issued</TableHead>
                    <TableHead className="hidden sm:table-cell">Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.position.invoices.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Link href={`${BASE}/sales/invoices/${i.id}`} className="underline-offset-4 hover:underline">
                          {i.number}
                        </Link>
                      </TableCell>
                      <TableCell>{i.customerName}</TableCell>
                      <TableCell className="hidden sm:table-cell">{i.issueDate}</TableCell>
                      <TableCell className="hidden sm:table-cell">{i.dueDate ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(i.totalCents)}</TableCell>
                      <TableCell>
                        <Badge variant={i.status === "paid" ? "secondary" : "outline"}>
                          {invoiceStatus(i.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* YOU OWED. Real bills, flagged. */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>You owed on that day{suffix}</CardTitle>
            <CardDescription>
              Bills you had received before the books began and had not paid by then. Each is a
              real bill: it ages and gets paid like any other. On that day it counts as Opening
              Balance Equity rather than this year&apos;s expense; when it is paid, the cash basis
              counts it under the account you picked.
            </CardDescription>
          </div>
          {isOwner && (
            <OpeningDocumentDialog
              kind="bill"
              entityId={data.entity.id}
              booksStartOn={day}
              parties={data.vendors}
              accounts={data.expenseAccounts}
            />
          )}
        </CardHeader>
        <CardContent>
          {data.position.bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded. If you owed nobody anything on that day, there is nothing to do
              here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="hidden sm:table-cell">Billed</TableHead>
                    <TableHead className="hidden sm:table-cell">Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.position.bills.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <Link href={`${BASE}/purchases/bills/${b.id}`} className="underline-offset-4 hover:underline">
                          {b.number || "—"}
                        </Link>
                      </TableCell>
                      <TableCell>{b.vendorName}</TableCell>
                      <TableCell className="hidden sm:table-cell">{b.billDate}</TableCell>
                      <TableCell className="hidden sm:table-cell">{b.dueDate ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(b.totalCents)}</TableCell>
                      <TableCell>
                        <Badge variant={b.status === "paid" ? "secondary" : "outline"}>
                          {invoiceStatus(b.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* WHERE THE BOOKS STAND. The accrual trial balance as of the day, with
          the plug named. */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Where the books stand on that day{suffix}</CardTitle>
            <CardDescription>
              {day
                ? `Every balance as of ${day}, before anything of this year moves. Opening Balance Equity is the plug: what has been entered so far, taken together. When every balance is in, your accountant moves it to retained earnings with one entry, and Export books on the Close page gives them all of it.`
                : "Set the day first. The balances below are read as of it."}
            </CardDescription>
          </div>
          {day && (
            <Button asChild variant="outline" size="sm">
              <Link href={`${BASE}/trial-balance?asOf=${day}${data.showPicker ? `&entity=${data.entity.id}` : ""}`}>
                Trial balance that day
              </Link>
            </Button>
          )}
        </CardHeader>
        {day && data.position.standing && (
          <CardContent>
            {data.position.standing.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing posted as of that day yet. A register&apos;s opening balance, an open
                invoice or bill, or a journal entry dated on it will appear here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.position.standing.rows.map((r) => {
                      const plug = r.account.id === data.position.obeAccountId;
                      return (
                        <TableRow key={r.account.id} className={plug ? "bg-muted/60" : undefined}>
                          <TableCell className={plug ? "font-medium" : undefined}>
                            <span className="tabular-nums text-muted-foreground">{r.account.code}</span>{" "}
                            {r.account.name}
                            {plug && (
                              <Badge variant="secondary" className="ml-2">
                                the plug
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.debitCents ? formatCents(r.debitCents) : ""}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.creditCents ? formatCents(r.creditCents) : ""}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="font-medium">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(data.position.standing.totalDebitCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(data.position.standing.totalCreditCents)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        Equipment owned before the books began, and the depreciation already taken on it, is
        entered on each asset&apos;s own page under Assets.
      </p>
    </div>
  );
}
