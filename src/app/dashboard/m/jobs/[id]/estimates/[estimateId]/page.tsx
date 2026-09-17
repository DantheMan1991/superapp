import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
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
import { getProject, listContracts, listCostCodes } from "@/packs/jobs/ops";
import { getEstimate, unitsInUse } from "@/packs/jobs/estimating-ops";
import { EstimateEditor } from "@/packs/jobs/components/estimate-editor";
import { ESTIMATE_STATUS_LABELS, PACK, isEstimateStatus, slugLabel } from "@/packs/jobs/vocabulary";

/**
 * One estimate: the editor, and beside it what the lines add up to by cost
 * code — the budget it would write, the price it would schedule.
 */
export default async function EstimatePage({ params }: { params: Promise<{ id: string; estimateId: string }> }) {
  const { id, estimateId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const row = await getEstimate(tx, ctx.tenant.id, estimateId);
      if (!row || row.estimate.projectId !== project.id) return null;
      const [contracts, codes, pack, units] = await Promise.all([
        listContracts(tx, ctx.tenant.id, project.id),
        project.costCodeSetId ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId) : Promise.resolve([]),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
        // What the entry bar's grammar should recognise as a unit (ADR 0081).
        unitsInUse(tx, ctx.tenant.id),
      ]);
      return { project, row, contracts, codes, labels: pack.labels, units };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, row } = data;
  const canEdit = allowsWrite(ctx.role, "member");
  const isOwner = allowsWrite(ctx.role, "owner");
  const symbol = ctx.tenant.currencySymbol;
  const projectWord = labelFor(data.labels, "project", "Project");
  const codeOptions = data.codes
    .filter((c) => c.isActive || row.lines.some((l) => l.costCodeId === c.id))
    .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }));
  const contractOptions = data.contracts.map((c) => ({
    id: c.id,
    label: `${slugLabel(c.kind)}${c.name ? ` · ${c.name}` : ""}`,
    status: c.status,
  }));

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/m/jobs/${project.id}/estimates`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {project.number} · {project.name} · estimates
      </Link>
      <PageHeader
        title={`${row.estimate.number}${row.estimate.title ? ` · ${row.estimate.title}` : ""}`}
        description={`${projectWord} ${project.number}${
          row.contract ? ` · ${slugLabel(row.contract.kind)}${row.contract.name ? ` · ${row.contract.name}` : ""}` : ""
        }`}
        actions={
          <Badge variant={row.estimate.status === "accepted" ? "default" : "secondary"}>
            {isEstimateStatus(row.estimate.status) ? ESTIMATE_STATUS_LABELS[row.estimate.status] : row.estimate.status}
          </Badge>
        }
      />

      <Panel className="p-5">
        <EstimateEditor
          key={`${row.estimate.id}:${row.estimate.version}`}
          projectId={project.id}
          estimate={{
            id: row.estimate.id,
            version: row.estimate.version,
            number: row.estimate.number,
            title: row.estimate.title,
            status: row.estimate.status,
            sentOn: row.estimate.sentOn,
            decidedOn: row.estimate.decidedOn,
            validUntil: row.estimate.validUntil,
            markupPpm: row.estimate.markupPpm,
            overheadPpm: row.estimate.overheadPpm,
            profitPpm: row.estimate.profitPpm,
            notes: row.estimate.notes,
            presentation: row.estimate.presentation,
            scope: row.estimate.scope,
            exclusions: row.estimate.exclusions,
            terms: row.estimate.terms,
            contractId: row.estimate.contractId,
            showCodeNumbers: row.estimate.showCodeNumbers,
            groups: row.groups.map((g) => ({
              id: g.id,
              name: g.name,
              clientNote: g.clientNote,
              priceMode: g.priceMode,
              fixedPriceCents: g.fixedPriceCents,
            })),
            lines: row.lines.map((l) => ({
              id: l.id,
              groupId: l.groupId,
              costCodeId: l.costCodeId,
              description: l.description,
              clientDescription: l.clientDescription,
              clientVisible: l.clientVisible,
              unit: l.unit,
              quantityThousandths: l.quantityThousandths,
              unitCostCents: l.unitCostCents,
              markupPpm: l.markupPpm,
              unitPriceCents: l.unitPriceCents,
            })),
          }}
          units={data.units}
          codes={codeOptions}
          contracts={contractOptions}
          canEdit={canEdit}
          isOwner={isOwner}
          symbol={symbol}
        />
      </Panel>

      {row.byCode.length > 0 && (
        <Panel className="p-5">
          <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">By cost code</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            What the saved lines add up to per code: the cost is what <em>Use as budget</em> writes, the price is
            what the job cost report will compare it with once the job is billed.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cost code</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.byCode.map((c) => (
                  <TableRow key={c.costCodeId ?? "none"}>
                    <TableCell className={c.costCodeId ? "" : "text-muted-foreground"}>
                      {c.codeLabel ?? "No cost code"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(c.costCents, symbol)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(c.priceCents, symbol)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </div>
  );
}
