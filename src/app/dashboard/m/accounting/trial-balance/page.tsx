import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { Lock, Scale } from "lucide-react";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getSettings, getTrialBalance } from "@/modules/accounting/core";
import { reportEntityOr404 } from "@/modules/accounting/lib/report-entity";
import {
  formatCents,
  isValidIsoDate,
  todayInTimezone,
} from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; basis?: string; entity?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  // Anything that is not exactly "cash" is accrual: an unreadable query string
  // must never silently produce the other basis.
  const basis = sp.basis === "cash" ? "cash" : "accrual";

  const { tb, asOf, settings, entityView } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const settings = await getSettings(tx, ctx.tenant.id);
      const today = todayInTimezone(ctx.tenant.timezone);
      const asOf = sp.asOf && isValidIsoDate(sp.asOf) ? sp.asOf : today;
      const entityView = await reportEntityOr404(tx, ctx.tenant.id, sp.entity);
      const tb = await getTrialBalance(
        tx,
        ctx.tenant.id,
        asOf,
        entityView.scope,
        basis,
      );
      return { tb, asOf, settings, entityView };
    },
  );

  const inBalance = tb.totalNetCents === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trial Balance"
        description={
          <>
            Every account&apos;s balance as of {asOf} — the two columns must
            agree. {basis === "cash" ? "Cash" : "Accrual"} basis.
            {entityView.stampLabel ? ` · ${entityView.stampLabel}` : ""}
          </>
        }
        actions={
          inBalance ? (
            // The hardcoded emerald-600 predates the token set; `--success` is
            // the same intent and follows the theme.
            <Badge className="bg-success/12 text-success-foreground hover:bg-success/12">
              In balance
            </Badge>
          ) : (
            <Badge variant="destructive">Out of balance</Badge>
          )
        }
      />

      <AccountingNav />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <form className="flex items-end gap-2" action="/dashboard/m/accounting/trial-balance">
          <div className="space-y-1.5">
            <label htmlFor="asOf" className="text-xs font-medium text-muted-foreground">
              As of
            </label>
            <Input id="asOf" name="asOf" type="date" defaultValue={asOf} className="h-9" />
          </div>
          {entityView.entities.length > 1 && (
            <div className="space-y-1.5">
              <label
                htmlFor="entity"
                className="text-xs font-medium text-muted-foreground"
              >
                Company
              </label>
              <select
                id="entity"
                name="entity"
                defaultValue={sp.entity ?? ""}
                className="border-input h-9 w-52 rounded-md border bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="">All companies (combined)</option>
                {entityView.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="basis" className="text-xs font-medium text-muted-foreground">
              Basis
            </label>
            <select
              id="basis"
              name="basis"
              defaultValue={basis}
              className="border-input h-9 w-32 rounded-md border bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="accrual">Accrual</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <Button type="submit" variant="outline" size="sm">
            Run
          </Button>
        </form>
        <Link
          href="/dashboard/m/accounting/close"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Lock className="h-3.5 w-3.5" />
          {settings.closedThrough
            ? `Closed through ${settings.closedThrough}`
            : "Books open"}
          {" · manage on the Close page"}
        </Link>
      </div>

      <DataTable
        isEmpty={tb.rows.length === 0}
        empty={
          <EmptyState
            icon={<Scale />}
            title="Nothing posted as of this date"
            description="Try a later date, or post an entry to start the books."
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tb.rows.map((r) => (
              <TableRow key={r.account.id}>
                <TableCell className="font-mono text-xs text-subtle-foreground tabular-nums">
                  {r.account.code}
                </TableCell>
                <TableCell className="text-sm">{r.account.name}</TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {r.debitCents ? formatCents(r.debitCents) : ""}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {r.creditCents ? formatCents(r.creditCents) : ""}
                </TableCell>
              </TableRow>
            ))}
            {/* The totals row is the point of this report, so it keeps a
                heavier rule than the divider between accounts. */}
            <TableRow className="border-t-2 border-border font-semibold">
              <TableCell />
              <TableCell className="text-sm">Totals</TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">
                {formatCents(tb.totalDebitCents)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">
                {formatCents(tb.totalCreditCents)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
