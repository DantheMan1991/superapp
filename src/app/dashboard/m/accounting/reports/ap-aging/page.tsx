import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
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
    const today = todayInTimezone(ctx.tenant.timezone);
    const asOf = sp.asOf && isValidIsoDate(sp.asOf) ? sp.asOf : today;
    const report = await getApAging(tx, ctx.tenant.id, asOf);
    return { settings, today, asOf, report };
  });

  const { report } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="A/P Aging"
        description={
          <>
            {ctx.tenant.name} · open bills as of {report.asOf} by days past due.
            Voided bills are excluded.
          </>
        }
        actions={
          report.overdueCents > 0 ? (
            <Badge variant="destructive">
              {formatCentsSigned(report.overdueCents)} overdue
            </Badge>
          ) : (
            <Badge className="bg-success/12 text-success-foreground hover:bg-success/12">
              Nothing overdue
            </Badge>
          )
        }
      />

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
        <Panel>
          <EmptyState
            icon={<Hourglass />}
            title="Nothing outstanding"
            description="No open bills as of this date."
          />
        </Panel>
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
