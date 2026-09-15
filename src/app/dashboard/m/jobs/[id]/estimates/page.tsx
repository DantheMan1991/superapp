import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
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
  const projectWord = labelFor(data.labels, "project", "Project");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Estimates"
        description={`${projectWord} ${project.number} · ${rows.length} ${rows.length === 1 ? "estimate" : "estimates"}`}
        actions={canEdit ? <NewEstimateDialog projectId={project.id} /> : null}
      />

      <Panel className="p-5">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No estimates yet. An estimate is the job priced before anybody signs — lines of cost and price by cost
            code, with overhead and profit below — and, accepted, it becomes the contract&apos;s value, the budget
            and the schedule of values.
          </p>
        ) : (
          <div className="overflow-x-auto">
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
                      <Badge variant={row.estimate.status === "accepted" ? "default" : "secondary"}>
                        {isEstimateStatus(row.estimate.status)
                          ? ESTIMATE_STATUS_LABELS[row.estimate.status]
                          : row.estimate.status}
                      </Badge>
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
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Cost is what the lines add up to at their unit costs; total is their price with overhead and profit on
          top; margin is the difference. Several estimates on one job is ordinary — a bid is revised, and a design
          phase is priced before the build.
        </p>
      </Panel>
    </div>
  );
}
