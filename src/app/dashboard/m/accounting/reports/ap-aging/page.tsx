import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { ReportControls } from "@/modules/accounting/components/report-controls";
import { ReportTable } from "@/modules/accounting/components/report-table";
import { getSettings } from "@/modules/accounting/core";
import { getApAging } from "@/modules/accounting/payables/aging-feed";
import {
  formatCentsSigned,
  isValidIsoDate,
  todayInTimezone,
} from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

export default async function ApAgingPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(settings.bookkeepingTimezone);
    const asOf = sp.asOf && isValidIsoDate(sp.asOf) ? sp.asOf : today;
    const report = await getApAging(tx, ctx.tenant.id, asOf);
    return { settings, today, asOf, report };
  });

  const { report } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">A/P Aging</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.tenant.name} · open bills as of {report.asOf} by days past
            due. Voided bills are excluded.
          </p>
        </div>
        {report.overdueCents > 0 ? (
          <Badge variant="destructive">
            {formatCentsSigned(report.overdueCents)} overdue
          </Badge>
        ) : (
          <Badge className="bg-emerald-600 hover:bg-emerald-600">
            Nothing overdue
          </Badge>
        )}
      </div>

      <div className="print:hidden">
        <AccountingNav />
      </div>

      <ReportControls
        mode="asOf"
        today={data.today}
        fiscalYearStartMonth={data.settings.fiscalYearStartMonth}
        asOf={data.asOf}
      />

      {report.rows.length <= 1 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          No open bills as of this date.
        </p>
      ) : (
        <ReportTable
          rows={report.rows}
          columns={report.columns}
          amountHeader=""
        />
      )}
    </div>
  );
}
