import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { ReportControls } from "@/modules/accounting/components/report-controls";
import { ReportTable } from "@/modules/accounting/components/report-table";
import { ReportToolbar } from "@/modules/accounting/components/report-toolbar";
import { ConsolidationNote } from "@/modules/accounting/components/consolidation-note";
import {
  getBalanceSheet,
  getSettings,
  residualIfConsolidated,
} from "@/modules/accounting/core";
import { reportEntityOr404 } from "@/modules/accounting/lib/report-entity";
import { isValidIsoDate, todayInTimezone } from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{
    asOf?: string;
    compare?: string;
    zero?: string;
    basis?: string;
    entity?: string;
  }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;
  const compare = sp.compare === "prev-year" ? sp.compare : undefined;
  // Anything that is not exactly "cash" is accrual: an unreadable query string
  // must never silently produce the other basis.
  const basis = sp.basis === "cash" ? "cash" : "accrual";

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(ctx.tenant.timezone);
    const asOf = sp.asOf && isValidIsoDate(sp.asOf) ? sp.asOf : today;
    // OFFERED here: the balance sheet is where a group's affiliate balances
    // would otherwise be double-counted, and where eliminating them shows.
    const entityView = await reportEntityOr404(
      tx,
      ctx.tenant.id,
      sp.entity,
      "offered",
    );
    const report = await getBalanceSheet(tx, ctx.tenant.id, {
      scope: entityView.scope,
      asOf,
      compare,
      showZero: sp.zero === "1",
      basis,
    });
    const residual = await residualIfConsolidated(tx, ctx.tenant.id, entityView.scope, {
      asOf,
    });
    return { settings, today, asOf, report, entityView, residual };
  });

  const { report } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balance Sheet"
        description={
          <>
            {data.entityView.stampLabel ?? ctx.tenant.name} · as of {report.asOf} ·
            fiscal year begins{" "}
            {report.fyStart} · {basis === "cash" ? "Cash" : "Accrual"} basis
          </>
        }
        actions={
          <>
            {/* The balanced check belongs beside the export control rather than
                next to the title: it is the report's verdict, not its name. */}
            {report.balanced ? (
              <Badge className="bg-success/12 text-success-foreground hover:bg-success/12">
                In balance
              </Badge>
            ) : (
              <Badge variant="destructive">Out of balance</Badge>
            )}
            <ReportToolbar
              exportParams={{
                report: "balance-sheet",
                asOf: data.asOf,
                compare,
                basis,
                entity: sp.entity,
              }}
            />
          </>
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
        compare={compare}
        compareOptions={[["prev-year", "Previous year"]]}
        basis={basis}
        showBasis
        entity={sp.entity}
        entities={data.entityView.entities}
        offerConsolidated={data.entityView.offerConsolidated}
      />

      <ConsolidationNote residual={data.residual} />

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
