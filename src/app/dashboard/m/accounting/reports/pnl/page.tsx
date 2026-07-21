import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { ReportControls } from "@/modules/accounting/components/report-controls";
import { ReportTable } from "@/modules/accounting/components/report-table";
import { ReportToolbar } from "@/modules/accounting/components/report-toolbar";
import {
  getProfitAndLoss,
  getSettings,
  listDimensionMembers,
} from "@/modules/accounting/core";
import { presetRange } from "@/modules/accounting/lib/dates";
import { isValidIsoDate, todayInTimezone } from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    compare?: string;
    dim?: string;
    zero?: string;
  }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  const compare =
    sp.compare === "prev-period" || sp.compare === "prev-year"
      ? sp.compare
      : undefined;
  const dim = !compare && sp.dim?.match(/^[a-z0-9_]+$/) ? sp.dim : undefined;

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(settings.bookkeepingTimezone);
    const fallback = presetRange("this-month", today, settings.fiscalYearStartMonth);
    const from = sp.from && isValidIsoDate(sp.from) ? sp.from : fallback.from;
    const to = sp.to && isValidIsoDate(sp.to) ? sp.to : fallback.to;
    const report = await getProfitAndLoss(tx, ctx.tenant.id, {
      from,
      to,
      compare,
      dimensionType: dim,
      showZero: sp.zero === "1",
    });
    const members = await listDimensionMembers(tx, ctx.tenant.id);
    const dimensionTypes = [...new Set(members.map((m) => m.dimensionType))];
    return { settings, today, from, to, report, dimensionTypes };
  });

  const { report } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Profit &amp; Loss
          </h1>
          <p className="text-sm text-muted-foreground">
            {ctx.tenant.name} · {report.period.from} to {report.period.to}
            {report.comparison &&
              ` · vs ${report.comparison.from} to ${report.comparison.to}`}
          </p>
        </div>
        <ReportToolbar
          exportParams={{
            report: "pnl",
            from: data.from,
            to: data.to,
            compare,
            dim,
          }}
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
        compare={compare}
        compareOptions={[
          ["prev-period", "Previous period"],
          ["prev-year", "Previous year"],
        ]}
        dim={dim}
        dimensionTypes={data.dimensionTypes}
      />

      <ReportTable
        rows={report.rows}
        columns={report.columns}
        amountHeader={`${report.period.from} – ${report.period.to}`}
        comparisonHeader={
          report.comparison
            ? `${report.comparison.from} – ${report.comparison.to}`
            : undefined
        }
      />
    </div>
  );
}
