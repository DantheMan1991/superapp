import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { ReportControls } from "@/modules/accounting/components/report-controls";
import { ReportTable } from "@/modules/accounting/components/report-table";
import { ReportToolbar } from "@/modules/accounting/components/report-toolbar";
import { getBalanceSheet, getSettings } from "@/modules/accounting/core";
import { isValidIsoDate, todayInTimezone } from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; compare?: string; zero?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;
  const compare = sp.compare === "prev-year" ? sp.compare : undefined;

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(settings.bookkeepingTimezone);
    const asOf = sp.asOf && isValidIsoDate(sp.asOf) ? sp.asOf : today;
    const report = await getBalanceSheet(tx, ctx.tenant.id, {
      asOf,
      compare,
      showZero: sp.zero === "1",
    });
    return { settings, today, asOf, report };
  });

  const { report } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Balance Sheet
            </h1>
            {report.balanced ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                In balance
              </Badge>
            ) : (
              <Badge variant="destructive">OUT OF BALANCE</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {ctx.tenant.name} · as of {report.asOf} · fiscal year begins{" "}
            {report.fyStart}
          </p>
        </div>
        <ReportToolbar
          exportParams={{ report: "balance-sheet", asOf: data.asOf, compare }}
        />
      </div>

      <div className="print:hidden">
        <AccountingNav />
      </div>

      <ReportControls
        mode="asOf"
        today={data.today}
        fiscalYearStartMonth={data.settings.fiscalYearStartMonth}
        asOf={data.asOf}
        compare={compare}
        compareOptions={[["prev-year", "Previous year"]]}
      />

      <ReportTable
        rows={report.rows}
        amountHeader={`As of ${report.asOf}`}
        comparisonHeader={
          report.comparison ? `As of ${report.comparison.asOf}` : undefined
        }
      />
    </div>
  );
}
