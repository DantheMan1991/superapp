import Link from "next/link";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { BookOpen } from "lucide-react";
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
import {
  getGeneralLedger,
  getSettings,
  listAccounts,
} from "@/modules/accounting/core";
import { reportEntityOr404 } from "@/modules/accounting/lib/report-entity";
import { presetRange } from "@/modules/accounting/lib/dates";
import {
  formatCentsSigned,
  isValidIsoDate,
  todayInTimezone,
} from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

/** Entry sources read as jargon; these are what a person would call them. */
const SOURCE_LABEL: Record<string, string> = {
  manual: "Journal",
  invoice: "Invoice",
  invoice_payment: "Payment",
  bill: "Bill",
  bill_payment: "Bill payment",
  bank_import: "Bank",
  opening_balance: "Opening",
  recurring: "Recurring",
  reversal: "Reversal",
  intercompany: "Between companies",
  depreciation: "Depreciation",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    account?: string;
    entity?: string;
  }>;
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
    const accounts = await listAccounts(tx, ctx.tenant.id);
    // Validated against the tenant's own COA, not just shape: an id that is a
    // uuid but belongs to nobody here should mean "all", not an empty report.
    const account =
      sp.account && UUID.test(sp.account) && accounts.some((a) => a.id === sp.account)
        ? sp.account
        : "";
    const entityView = await reportEntityOr404(tx, ctx.tenant.id, sp.entity);
    const report = await getGeneralLedger(tx, ctx.tenant.id, {
      scope: entityView.scope,
      from,
      to,
      ...(account ? { accountIds: [account] } : {}),
    });
    return { settings, today, from, to, account, accounts, report, entityView };
  });

  const { report } = data;
  const selected = data.accounts.find((a) => a.id === data.account);

  return (
    <div className="space-y-6">
      <PageHeader
        title="General Ledger"
        description={
          <>
            {data.entityView.stampLabel ?? ctx.tenant.name} · {report.period.from}{" "}
            to {report.period.to}
            {selected ? ` · ${selected.code} ${selected.name}` : ""} · accrual
            basis
          </>
        }
        actions={
          <ReportToolbar
            exportParams={{
              report: "general-ledger",
              from: data.from,
              to: data.to,
              ...(data.account ? { accountIds: [data.account] } : {}),
              entity: sp.entity,
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
        account={data.account}
        accounts={data.accounts.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
        }))}
        entity={sp.entity}
        entities={data.entityView.entities}
      />

      {report.truncated && (
        // Never a silent cap. A ledger that quietly shows part of a period
        // reads as a complete one, which is the worst way for this report to
        // be wrong.
        <div className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          Showing the first{" "}
          <strong className="tabular-nums">{report.lineCount}</strong> of{" "}
          <strong className="tabular-nums">{report.matchedLineCount}</strong>{" "}
          lines. Closing balances below are as at the last line shown, not the
          end of the period — narrow the dates or pick a single account to see
          the whole thing.
        </div>
      )}

      {report.accounts.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<BookOpen />}
            title="Nothing posted in this period"
            description="Only posted entries appear here — drafts and voided entries are never part of the ledger."
          />
        </Panel>
      ) : (
        report.accounts.map((account) => (
          <Panel key={account.accountId}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider bg-muted/40 px-4 py-2">
              <p className="text-sm font-medium">
                <span className="mr-2 font-mono text-xs text-muted-foreground">
                  {account.code}
                </span>
                {account.name}
              </p>
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                Opening {formatCentsSigned(account.openingCents)} · Closing{" "}
                {formatCentsSigned(account.closingCents)}
              </p>
            </div>

            {account.lines.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No movement in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead className="w-28">Type</TableHead>
                      <TableHead>Memo</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={5}
                        className="text-xs text-muted-foreground"
                      >
                        Opening balance
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {formatCentsSigned(account.openingCents)}
                      </TableCell>
                    </TableRow>

                    {account.lines.map((line, i) => (
                      <TableRow key={`${line.entryId}-${i}`}>
                        <TableCell className="font-mono text-xs tabular-nums">
                          <Link
                            href={`/dashboard/m/accounting/journal/${line.entryId}`}
                            className="hover:underline"
                          >
                            {line.entryDate}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {SOURCE_LABEL[line.source] ?? line.source}
                        </TableCell>
                        <TableCell className="text-sm">
                          {line.lineMemo || line.entryMemo || (
                            <span className="text-subtle-foreground">—</span>
                          )}
                          {line.lineMemo && line.entryMemo && (
                            <span className="ml-2 text-xs text-subtle-foreground">
                              {line.entryMemo}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {line.debitCents
                            ? formatCentsSigned(line.debitCents)
                            : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {line.creditCents
                            ? formatCentsSigned(line.creditCents)
                            : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {formatCentsSigned(line.runningCents)}
                        </TableCell>
                      </TableRow>
                    ))}

                    <TableRow className="border-t-2 border-border font-semibold">
                      <TableCell colSpan={3} className="text-sm">
                        Closing balance
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {formatCentsSigned(account.debitTotalCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {formatCentsSigned(account.creditTotalCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {formatCentsSigned(account.closingCents)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
