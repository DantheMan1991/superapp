import Link from "next/link";
import { notFound } from "next/navigation";
import { Calculator } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { FilterPills } from "@/components/app/filter-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { getProject, jobCostReport, listCostCodes } from "@/packs/jobs/ops";
import { BudgetEditor } from "@/packs/jobs/components/budget-editor";
import {
  COST_FILTERS,
  COST_FILTER_LABELS,
  type CostFilterKey,
  barWidthPercent,
  costFilterCounts,
  costTotals,
  isCostFilterKey,
  matchesCostFilter,
  ofBudgetLabel,
  ofBudgetPpm,
} from "@/packs/jobs/cost-math";

/**
 * Job cost: the budget by code, against what has been ordered and spent.
 *
 * ── THE QUESTION THIS PAGE ANSWERS ──────────────────────────────────────────
 *
 * "The job is $40k over" is a fact; "the framing is $40k over" is a decision,
 * and only the per-code view gets you the second one. Everything on the page
 * serves that: the pills go straight to the codes in trouble, the bar says how
 * full each one is at a glance, and the totals row compares like with like.
 *
 * Promoted from a panel on the project page to a tab of its own (jobs redesign
 * 3a). The job's identity, its vitals and the section strip are the layout's.
 */
export default async function JobCostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const filter: CostFilterKey = isCostFilterKey(sp.f) ? sp.f : "all";
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "jobs");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [codes, costReport] = await Promise.all([
        project.costCodeSetId
          ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
          : Promise.resolve([]),
        jobCostReport(tx, ctx.tenant.id, project.id),
      ]);
      return {
        project,
        codes,
        costRows: costReport.rows,
        uncodedActualCents: costReport.uncodedActualCents,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { project } = data;
  const isOwner = allowsWrite(ctx.role, "owner");
  const symbol = ctx.tenant.currencySymbol;

  /**
   * Budgeted codes only, for both the sentence and the totals row — through
   * ONE function, so the headline and the row underneath the table cannot
   * drift into disagreeing about what is being compared.
   */
  const totals = costTotals(data.costRows);
  const counts = costFilterCounts(data.costRows);
  const visible = data.costRows.filter((r) => matchesCostFilter(r, filter));
  /**
   * TWO TOTALS, AND THEY ARE ANSWERING DIFFERENT QUESTIONS. The sentence above
   * the table describes the JOB — it must not move when somebody clicks a pill,
   * the same rule the module home's stat cards follow. The row under the table
   * belongs to the TABLE, so it totals what is actually on screen; a footer
   * summing rows the reader cannot see is a footer that lies.
   */
  const shownTotals = costTotals(visible);
  const base = `/dashboard/m/jobs/${project.id}/cost`;
  const href = (next: CostFilterKey) => (next === "all" ? base : `${base}?f=${next}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-heading">Job cost</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {/*
              THE QUESTION THIS PAGE ANSWERS, said in words, before any table.
            */}
            {data.costRows.length === 0
              ? "No budget set. Until there is one, committed and actual say what has happened but not whether it was the plan."
              : `Budget ${formatMoneySign(totals.budgetCents, symbol)} against ${formatMoney(
                  totals.committedCents,
                  symbol,
                )} ordered and ${formatMoney(totals.actualCents, symbol)} spent${
                  totals.changesCents !== 0
                    ? `, after ${formatMoneySign(totals.changesCents, symbol)} in approved changes`
                    : ""
                }.`}
          </p>
        </div>
        {isOwner && (
          <BudgetEditor
            projectId={project.id}
            /*
              ACTIVE CODES, PLUS ANY THAT ALREADY CARRY A BUDGET. A retired
              code is one the business has stopped using, so offering it for a
              NEW budget is the same mistake as offering it on a bill — which
              `updateCostCode` already prevents by archiving its cost object.
              But a figure already set against one has to stay visible and
              editable, or retiring a code would strand money nobody can reach.
            */
            codes={data.codes
              .filter(
                (c) =>
                  c.isActive ||
                  data.costRows.some(
                    (r) => r.costCodeId === c.id && r.originalCents !== null,
                  ),
              )
              .map((c) => ({ id: c.id, code: c.code, name: c.name }))}
            /*
              THE ORIGINAL, never the revised. The editor writes
              `original_cents`; handing it the revised figure would save the
              approved changes into the original and count them twice.
            */
            existing={Object.fromEntries(
              data.costRows
                .filter((r) => r.originalCents !== null)
                .map((r) => [r.costCodeId, r.originalCents as number]),
            )}
          />
        )}
      </div>

      {data.costRows.length > 0 && (
        <FilterPills
          variant="solid"
          activeKey={filter}
          items={COST_FILTERS.filter((key) => key === "all" || counts[key] > 0).map(
            (key) => ({
              key,
              label: COST_FILTER_LABELS[key],
              href: href(key),
              count: counts[key],
            }),
          )}
        />
      )}

      <DataTable
        isEmpty={visible.length === 0}
        empty={
          <EmptyState
            icon={<Calculator />}
            title={
              data.costRows.length === 0
                ? "No budget yet"
                : `No ${COST_FILTER_LABELS[filter].toLowerCase()}`
            }
            description={
              data.costRows.length === 0
                ? "Set a budget by cost code and every order and bill against this job can be measured against it."
                : "Nothing under this filter — which is the good outcome."
            }
            action={
              data.costRows.length > 0 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={base}>Show all codes</Link>
                </Button>
              ) : null
            }
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead className="w-32">Of budget</TableHead>
              <TableHead className="text-right">Left</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const ppm = ofBudgetPpm(r);
              const over = r.hasBudget && r.varianceCents < 0;
              return (
                <TableRow
                  key={r.costCodeId}
                  /* Attention, not disablement — the hover wash is `bg-muted/60`. */
                  className={cn(over && "bg-destructive/5")}
                >
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>
                    {r.name}
                    {!r.hasBudget && (
                      /*
                       * THE MOST INTERESTING ROW ON THE PAGE: something was
                       * ordered against a code nobody budgeted. Easy to leave
                       * out of the query and the one a builder most wants to
                       * see — which is why it also has a pill of its own.
                       */
                      <Badge variant="secondary" className="ml-2">
                        Not budgeted
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/*
                      REVISED, with the original underneath only when a change
                      moved it — the same shape as the contract's value, because
                      it is the same line: original + approved = revised.
                    */}
                    {r.hasBudget ? formatMoneySign(r.budgetCents, symbol) : "—"}
                    {r.changesCents !== 0 && (
                      <span className="block text-xs text-muted-foreground">
                        orig.{" "}
                        {r.originalCents === null
                          ? "—"
                          : formatMoney(r.originalCents, symbol)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.committedCents, symbol)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/*
                      THIS JOB'S SPEND ON THIS CODE, and nobody else's: the
                      ledger sliced to the job's cost object, then split by code.
                    */}
                    {formatMoney(r.actualCents, symbol)}
                  </TableCell>
                  <TableCell>
                    {/*
                      Measured on the GREATER of ordered and spent — the same
                      figure `Left` subtracts, so the bar and the number beside
                      it can never tell different stories. The figure is not
                      capped; the bar is.
                    */}
                    <span
                      className={cn(
                        "block text-xs tabular-nums",
                        over ? "font-medium text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {ppm === null ? "no budget" : `${ofBudgetLabel(ppm)}%`}
                    </span>
                    {ppm !== null && (
                      <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            over ? "bg-destructive" : "bg-module-accent",
                          )}
                          style={{ width: `${barWidthPercent(ppm)}%` }}
                        />
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      over && "font-medium text-destructive",
                    )}
                  >
                    {r.hasBudget ? formatMoneySign(r.varianceCents, symbol) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {/*
            BUDGETED CODES ONLY, and the row says so. A code somebody ordered
            against and never budgeted has no budget side to compare, so adding
            it in would make the total a comparison of unlike things.
          */}
          {shownTotals.budgetedCount > 0 && (
            <tfoot className="border-t border-border font-medium">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={2} className="text-xs text-muted-foreground">
                  {shownTotals.budgetedCount === 1
                    ? "1 budgeted code"
                    : `${shownTotals.budgetedCount} budgeted codes`}
                  {shownTotals.unbudgetedCount > 0 &&
                    ` · ${shownTotals.unbudgetedCount} not budgeted, left out`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoneySign(shownTotals.budgetCents, symbol)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(shownTotals.committedCents, symbol)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(shownTotals.actualCents, symbol)}
                </TableCell>
                <TableCell />
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    shownTotals.varianceCents < 0 && "text-destructive",
                  )}
                >
                  {formatMoneySign(shownTotals.varianceCents, symbol)}
                </TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </DataTable>

      <p className="text-xs text-muted-foreground">
        Ordered is what has been committed on this job; spent is what the books
        have been billed for it, by code. Left is the budget less the greater of
        the two — what the code will cost at least.
        {data.uncodedActualCents !== 0 && (
          <>
            {" "}
            <span className="font-medium text-foreground">
              {formatMoney(data.uncodedActualCents, symbol)}
            </span>{" "}
            has been spent on this job with no cost code on the line; it is in
            the job&apos;s total and in no row here. Add the code on the bill in
            Accounting.
          </>
        )}
      </p>
    </div>
  );
}
