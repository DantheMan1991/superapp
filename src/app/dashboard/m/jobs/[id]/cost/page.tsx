import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { getProject, jobCostReport, listCostCodes } from "@/packs/jobs/ops";
import { BudgetEditor } from "@/packs/jobs/components/budget-editor";

/**
 * Job cost: the budget by code, what has been ordered against it and what has
 * been spent.
 *
 * Lifted out of the project page's flat panel stack unchanged (jobs redesign
 * 2a). The job's identity, its vitals and the section strip are the layout's.
 */
export default async function JobCostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const budgetTotal = data.costRows.reduce((sum, r) => sum + r.budgetCents, 0);
  /**
   * Ordered against BUDGETED codes only, so the headline compares like with
   * like. A code somebody ordered against and never budgeted still shows as its
   * own row — flagged — rather than silently inflating the comparison.
   */
  const committedOfBudgeted = data.costRows
    .filter((r) => r.hasBudget)
    .reduce((sum, r) => sum + r.committedCents, 0);
  const spentOfBudgeted = data.costRows
    .filter((r) => r.hasBudget)
    .reduce((sum, r) => sum + r.actualCents, 0);
  /** How much of the revised budget is approved changes. */
  const budgetChanges = data.costRows.reduce((sum, r) => sum + r.changesCents, 0);

  return (
    <>
      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Job cost
          </h2>
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
                Same shape as the cost-code-set picker rule above.
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
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE QUESTION THIS PANEL ANSWERS, said in words. "The job is $40k
            over" is a fact; "the framing is $40k over" is a decision, and only
            the per-code view gets you the second one.
          */}
          {data.costRows.length === 0
            ? "No budget set. Until there is one, committed and actual say what has happened but not whether it was the plan."
            : `Budget ${formatMoneySign(budgetTotal, symbol)} against ${formatMoney(
                committedOfBudgeted,
                symbol,
              )} ordered and ${formatMoney(spentOfBudgeted, symbol)} spent${
                budgetChanges !== 0
                  ? `, after ${formatMoneySign(budgetChanges, symbol)} in approved changes`
                  : ""
              }.`}
        </p>

        {data.costRows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.costRows.map((r) => (
                  <TableRow key={r.costCodeId}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>
                      {r.name}
                      {!r.hasBudget && (
                        /*
                         * THE MOST INTERESTING ROW ON THE PAGE: something was
                         * ordered against a code nobody budgeted. Easy to leave
                         * out of the query and the one a builder most wants to
                         * see.
                         */
                        <Badge variant="secondary" className="ml-2">
                          Not budgeted
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        REVISED, with the original underneath only when a
                        change moved it — the same shape as the contract's
                        value one panel up, because it is the same line:
                        original + approved changes = revised.
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
                        ledger sliced to the job's cost object, then split by
                        code. The column slices 3 to 6 said out loud they could
                        not show.
                      */}
                      {formatMoney(r.actualCents, symbol)}
                    </TableCell>
                    <TableCell
                      className={
                        "text-right tabular-nums " +
                        (r.varianceCents < 0 ? "text-destructive font-medium" : "")
                      }
                    >
                      {r.hasBudget ? formatMoneySign(r.varianceCents, symbol) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Ordered is what has been committed on this job; spent is what the
          books have been billed for it, by code. Left is the budget less the
          greater of the two — what the code will cost at least.
          {data.uncodedActualCents !== 0 && (
            <>
              {" "}
              <span className="font-medium text-foreground">
                {formatMoney(data.uncodedActualCents, symbol)}
              </span>{" "}
              has been spent on this job with no cost code on the line; it is in
              the job&apos;s total below and in no row here. Add the code on the
              bill in Accounting.
            </>
          )}
        </p>
      </Panel>
    </>
  );
}
