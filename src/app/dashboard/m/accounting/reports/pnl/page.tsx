import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { ReportControls } from "@/modules/accounting/components/report-controls";
import { ReportTable } from "@/modules/accounting/components/report-table";
import { ReportToolbar } from "@/modules/accounting/components/report-toolbar";
import {
  LedgerError,
  friendlyMessage,
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
    basis?: string;
    spread?: string;
  }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  const spread = sp.spread === "month" ? ("month" as const) : undefined;
  const compare =
    !spread && (sp.compare === "prev-period" || sp.compare === "prev-year")
      ? sp.compare
      : undefined;
  const dim =
    !compare && !spread && sp.dim?.match(/^[a-z0-9_]+$/) ? sp.dim : undefined;
  // Anything that is not exactly "cash" is accrual: an unreadable query string
  // must never silently produce the other basis.
  const basis = sp.basis === "cash" ? "cash" : "accrual";

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(ctx.tenant.timezone);
    const fallback = presetRange("this-month", today, settings.fiscalYearStartMonth);
    const from = sp.from && isValidIsoDate(sp.from) ? sp.from : fallback.from;
    const to = sp.to && isValidIsoDate(sp.to) ? sp.to : fallback.to;
    // A range too long for monthly columns is REFUSED by core rather than
    // quietly shortened, so the page has to catch it and say so — the
    // alternative is a 500 on a query string somebody can type.
    let report = null;
    let rangeError: string | null = null;
    try {
      report = await getProfitAndLoss(tx, ctx.tenant.id, {
        from,
        to,
        compare,
        dimensionType: dim,
        spread,
        showZero: sp.zero === "1",
        basis,
      });
    } catch (err) {
      if (!(err instanceof LedgerError)) throw err;
      rangeError = friendlyMessage(err);
    }
    const members = await listDimensionMembers(tx, ctx.tenant.id);
    const dimensionTypes = [...new Set(members.map((m) => m.dimensionType))];
    return { settings, today, from, to, report, rangeError, dimensionTypes };
  });

  const { report } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit & Loss"
        description={
          <>
            {ctx.tenant.name} · {data.from} to {data.to}
            {report?.comparison &&
              ` · vs ${report.comparison.from} to ${report.comparison.to}`}
            {spread === "month" && " · by month"}
            {` · ${basis === "cash" ? "Cash" : "Accrual"} basis`}
          </>
        }
        actions={
          <ReportToolbar
            exportParams={{
              report: "pnl",
              from: data.from,
              to: data.to,
              compare,
              dim,
              spread,
              basis,
            }}
          />
        }
      />

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
        basis={basis}
        showBasis
        spread={spread}
        showSpread
      />

      {data.rangeError ? (
        <div className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          {data.rangeError}
        </div>
      ) : (
        report && (
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
        )
      )}
    </div>
  );
}
