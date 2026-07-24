import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Lock } from "lucide-react";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getSettings, getTrialBalance } from "@/modules/accounting/core";
import {
  formatCents,
  isValidIsoDate,
  todayInTimezone,
} from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  const { tb, asOf, settings } = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(settings.bookkeepingTimezone);
    const asOf = sp.asOf && isValidIsoDate(sp.asOf) ? sp.asOf : today;
    const tb = await getTrialBalance(tx, ctx.tenant.id, asOf);
    return { tb, asOf, settings };
  });

  const inBalance = tb.totalNetCents === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trial Balance</h1>
          <p className="text-sm text-muted-foreground">
            Every account&apos;s balance as of {asOf} — the two columns must
            agree.
          </p>
        </div>
        {inBalance ? (
          <Badge className="bg-emerald-600 hover:bg-emerald-600">In balance</Badge>
        ) : (
          <Badge variant="destructive">OUT OF BALANCE</Badge>
        )}
      </div>

      <AccountingNav />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <form className="flex items-end gap-2" action="/dashboard/m/accounting/trial-balance">
          <div className="space-y-1.5">
            <label htmlFor="asOf" className="text-xs font-medium text-muted-foreground">
              As of
            </label>
            <Input id="asOf" name="asOf" type="date" defaultValue={asOf} className="h-9" />
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

      <Card>
        <CardContent className="p-0">
          {tb.rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing posted yet as of this date.
            </p>
          ) : (
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
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.account.code}
                    </TableCell>
                    <TableCell className="text-sm">{r.account.name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.debitCents ? formatCents(r.debitCents) : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.creditCents ? formatCents(r.creditCents) : ""}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell />
                  <TableCell className="text-sm">Totals</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCents(tb.totalDebitCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCents(tb.totalCreditCents)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
