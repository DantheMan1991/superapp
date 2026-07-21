import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { ReportControls } from "@/modules/accounting/components/report-controls";
import { ReportToolbar } from "@/modules/accounting/components/report-toolbar";
import { getCashActivity, getSettings } from "@/modules/accounting/core";
import { presetRange } from "@/modules/accounting/lib/dates";
import {
  formatCentsSigned,
  isValidIsoDate,
  todayInTimezone,
} from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

export default async function CashActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(settings.bookkeepingTimezone);
    const fallback = presetRange("this-month", today, settings.fiscalYearStartMonth);
    const from = sp.from && isValidIsoDate(sp.from) ? sp.from : fallback.from;
    const to = sp.to && isValidIsoDate(sp.to) ? sp.to : fallback.to;
    const report = await getCashActivity(tx, ctx.tenant.id, { from, to });
    return { settings, today, from, to, report };
  });

  const { report } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Cash Activity
          </h1>
          <p className="text-sm text-muted-foreground">
            {ctx.tenant.name} · {report.period.from} to {report.period.to}
          </p>
        </div>
        <ReportToolbar
          exportParams={{ report: "cash", from: data.from, to: data.to }}
        />
      </div>

      <div className="print:hidden">
        <AccountingNav />
      </div>

      <ReportControls
        mode="range"
        today={data.today}
        fiscalYearStartMonth={data.settings.fiscalYearStartMonth}
        from={data.from}
        to={data.to}
      />

      {report.groups.map((group) => (
        <Card key={group.key}>
          <CardContent className="p-0">
            <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
              {group.label}
            </div>
            {group.rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No activity in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">
                        {group.key === "credit_card" ? "Charges" : "Money in"}
                      </TableHead>
                      <TableHead className="text-right">
                        {group.key === "credit_card" ? "Payments" : "Money out"}
                      </TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map((r) => (
                      <TableRow key={r.accountId}>
                        <TableCell className="text-sm">
                          <span className="mr-2 font-mono text-xs text-muted-foreground">
                            {r.code}
                          </span>
                          {r.label}
                        </TableCell>
                        {[r.openingCents, r.inCents, r.outCents, r.netCents, r.closingCents].map(
                          (cents, i) => (
                            <TableCell
                              key={i}
                              className="text-right font-mono text-sm"
                            >
                              {formatCentsSigned(cents)}
                            </TableCell>
                          ),
                        )}
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell className="text-sm">Total</TableCell>
                      {[
                        group.totals.openingCents,
                        group.totals.inCents,
                        group.totals.outCents,
                        group.totals.netCents,
                        group.totals.closingCents,
                      ].map((cents, i) => (
                        <TableCell key={i} className="text-right font-mono text-sm">
                          {formatCentsSigned(cents)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
