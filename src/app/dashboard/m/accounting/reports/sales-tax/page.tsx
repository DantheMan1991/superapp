import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Percent } from "lucide-react";
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
import { reportEntityOr404 } from "@/modules/accounting/lib/report-entity";
import { getSettings, getTaxSummary } from "@/modules/accounting/core";
import { formatRatePpm } from "@/modules/accounting/invoicing/tax";
import { presetRange } from "@/modules/accounting/lib/dates";
import {
  formatCentsSigned,
  isValidIsoDate,
  todayInTimezone,
} from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

/**
 * Sales tax collected, by rate — the figures a return form asks for, next to
 * what the ledger says is owed.
 *
 * The two come from different places on purpose (see `core/tax-summary.ts`),
 * and the difference between them is SHOWN rather than reconciled away. A
 * non-zero difference is normal: tax charged in earlier periods and not yet
 * remitted is still in the account.
 */
export default async function SalesTaxReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; entity?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(ctx.tenant.timezone);
    const fallback = presetRange("this-month", today, settings.fiscalYearStartMonth);
    const from = sp.from && isValidIsoDate(sp.from) ? sp.from : fallback.from;
    const to = sp.to && isValidIsoDate(sp.to) ? sp.to : fallback.to;
    const entityView = await reportEntityOr404(
      tx,
      ctx.tenant.id,
      sp.entity,
      // DECLINED: both halves read things intercompany cannot reach — invoices
      // for the per-rate figures, the sales-tax control for what is owed. And a
      // return is filed by a legal entity, so the group is not a filer this
      // report has anything to say to.
      "declined",
    );
    const report = await getTaxSummary(tx, ctx.tenant.id, {
      scope: entityView.scope,
      from,
      to,
    });
    return { settings, today, from, to, report, entityView };
  });

  const { report } = data;
  const hasRows = report.rows.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Tax Summary"
        description={
          <>
            {data.entityView.stampLabel ?? ctx.tenant.name} · {report.from} to{" "}
            {report.to} · accrual basis (invoice date)
          </>
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
        entity={sp.entity}
        entities={data.entityView.entities}
      />

      <Panel
        isEmpty={!hasRows}
        empty={
          <EmptyState
            icon={<Percent />}
            title="No invoices in this period"
            description="This report covers invoices issued between the two dates. Drafts and voided invoices are excluded — neither charged anybody anything."
          />
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rate</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Taxable sales</TableHead>
                <TableHead className="text-right">Non-taxable sales</TableHead>
                <TableHead className="text-right">Tax collected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.rateId ?? "none"}>
                  <TableCell className="text-sm">
                    {r.name}
                    {r.rateId && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {formatRatePpm(r.ratePpm)}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {r.invoiceCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatCentsSigned(r.taxableCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatCentsSigned(r.exemptCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatCentsSigned(r.taxCents)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-border font-semibold">
                <TableCell className="text-sm">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatCentsSigned(report.totals.taxableCents)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatCentsSigned(report.totals.exemptCents)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatCentsSigned(report.totals.taxCents)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Panel>

      {/* The reconciliation. Two sources, one screen — see core/tax-summary.ts. */}
      {report.liabilityCents !== null && (
        <Panel>
          <div className="border-b border-divider bg-muted/40 px-4 py-2 text-sm font-medium">
            Against the ledger
          </div>
          <dl className="divide-y divide-divider">
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-sm">
                Tax charged in this period
                <span className="block text-xs text-muted-foreground">
                  From the invoices above.
                </span>
              </dt>
              <dd className="font-mono text-sm tabular-nums">
                {formatCentsSigned(report.totals.taxCents)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-sm">
                Owed as at {report.to}
                <span className="block text-xs text-muted-foreground">
                  The Sales Tax Payable balance, from the ledger. Ties to the
                  balance sheet.
                </span>
              </dt>
              <dd className="font-mono text-sm tabular-nums">
                {formatCentsSigned(report.liabilityCents)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-sm">
                Difference
                <span className="block text-xs text-muted-foreground">
                  Normally not zero. Tax charged in earlier periods and not yet
                  remitted sits in the balance, and a payment to the tax
                  authority reduces it without touching any invoice.
                </span>
              </dt>
              <dd className="font-mono text-sm tabular-nums">
                {formatCentsSigned(report.differenceCents ?? 0)}
              </dd>
            </div>
          </dl>
        </Panel>
      )}

      <p className="text-xs text-muted-foreground">
        Accrual basis: tax is counted in the period the invoice was issued, not
        when the customer paid. If you file on a cash basis, this report is not
        the figure to file — that recognition is not built yet. Tax collected
        never appears on the profit and loss; it is a liability until you remit
        it, which you record as a payment or a journal against Sales Tax
        Payable.
      </p>
    </div>
  );
}
