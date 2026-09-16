import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge, type StatusTone } from "@/packs/jobs/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getProject } from "@/packs/jobs/ops";
import { listEstimates } from "@/packs/jobs/estimating-ops";
import { NewEstimateDialog } from "@/packs/jobs/components/estimate-editor";
import { ESTIMATE_STATUS_LABELS, PACK, isEstimateStatus, slugLabel } from "@/packs/jobs/vocabulary";

/**
 * Every estimate on a job, newest first: what it costs, what it is priced at,
 * the margin, and what it became (ADR 0069).
 */
export default async function EstimatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [rows, pack] = await Promise.all([
        listEstimates(tx, ctx.tenant.id, project.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return { project, rows, labels: pack.labels };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, rows } = data;
  const canEdit = allowsWrite(ctx.role, "member");
  const symbol = ctx.tenant.currencySymbol;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-heading">Estimates</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {`${rows.length} ${rows.length === 1 ? "estimate" : "estimates"}`}
          </p>
        </div>
        {canEdit ? <NewEstimateDialog projectId={project.id} /> : null}
      </div>

      <DataTable
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<FileText />}
            title="No estimates yet"
            description="An estimate is the job priced before anybody signs — lines of cost and price by cost code, with overhead and profit below — and, accepted, it becomes the contract's value, the budget and the schedule of values."
            action={canEdit ? <NewEstimateDialog projectId={project.id} /> : null}
          />
        }
      >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Contract</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.estimate.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/dashboard/m/jobs/${project.id}/estimates/${row.estimate.id}`}
                        className="hover:underline"
                      >
                        {row.estimate.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {row.estimate.title || "—"}
                      <span className="block text-xs text-muted-foreground">
                        {row.lines.length} {row.lines.length === 1 ? "line" : "lines"}
                        {row.estimate.sentOn ? ` · sent ${row.estimate.sentOn}` : ""}
                        {row.estimate.validUntil ? ` · valid to ${row.estimate.validUntil}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(row.totals.costCents, symbol)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(row.totals.totalCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneySign(row.totals.marginCents, symbol)}
                      {row.totals.marginPpm !== null && (
                        <span className="block text-xs text-muted-foreground">
                          {(row.totals.marginPpm / 10_000).toFixed(1)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={ESTIMATE_TONES[row.estimate.status] ?? "quiet"}>
                        {isEstimateStatus(row.estimate.status)
                          ? ESTIMATE_STATUS_LABELS[row.estimate.status]
                          : row.estimate.status}
                      </StatusBadge>
                      {row.estimate.decidedOn && (
                        <span className="block text-xs text-muted-foreground">{row.estimate.decidedOn}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.contract ? (
                        <Link
                          href={`/dashboard/m/jobs/${project.id}/contracts/${row.contract.id}`}
                          className="hover:underline"
                        >
                          {slugLabel(row.contract.kind)}
                          {row.contract.name ? ` · ${row.contract.name}` : ""}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/api/jobs/estimates/${row.estimate.id}/pdf`} target="_blank" rel="noopener noreferrer">
                          <FileText className="mr-1.5 size-4" /> Proposal
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
      </DataTable>

        <p className="text-xs text-muted-foreground">
          Cost is what the lines add up to at their unit costs; total is their price with overhead and profit on
          top; margin is the difference. Several estimates on one job is ordinary — a bid is revised, and a design
          phase is priced before the build.
        </p>
    </div>
  );
}

/**
 * An estimate's status as a tone. `accepted` is the one that became money;
 * `sent` is out with the client and going the right way, so it is `info` and
 * not amber; `draft` is still yours to finish.
 */
const ESTIMATE_TONES: Record<string, StatusTone> = {
  accepted: "good",
  sent: "info",
  draft: "pending",
  declined: "quiet",
  superseded: "quiet",
};
