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
import { getEstimate, priceBookRows, unitsInUse } from "@/packs/jobs/estimating-ops";
import { listEstimateShares } from "@/packs/jobs/estimate-shares";
import { listAssemblies } from "@/packs/jobs/assembly-ops";
import { formatQuantity } from "@/packs/jobs/billing-math";
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
      const [contracts, codes, pack, units, prices, assemblies] = await Promise.all([
        listContracts(tx, ctx.tenant.id, project.id),
        project.costCodeSetId ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId) : Promise.resolve([]),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
        // What the entry bar's grammar should recognise as a unit (ADR 0081).
        unitsInUse(tx, ctx.tenant.id),
        // What each line cost the last time it was priced (E4a) — shipped with
        // the page like the units, because the entry bar and the paste preview
        // answer as somebody types and cannot wait on a round trip.
        priceBookRows(tx, ctx.tenant.id),
        // The saved items this business can drop in (E6). Headers only — the
        // lines are fetched when one is actually chosen.
        listAssemblies(tx, ctx.tenant.id),
      ]);
      // The client links on this estimate, each standing read off the facts
      // against the version the estimate is at right now (E5c, ADR 0085).
      const shares = await listEstimateShares(tx, ctx.tenant.id, estimateId, row.estimate.version);
      return { project, row, contracts, codes, labels: pack.labels, units, prices, assemblies, shares };
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
  /** "per 320 sf" / "each", worded here so the editor holds no vocabulary. */
  const assemblyOptions = data.assemblies.map((a) => ({
    id: a.assembly.id,
    name: a.assembly.name,
    per:
      a.assembly.drivingQuantityThousandths === 1000 && a.assembly.drivingUnit === ""
        ? "each"
        : `per ${formatQuantity(a.assembly.drivingQuantityThousandths)}${a.assembly.drivingUnit ? ` ${a.assembly.drivingUnit}` : ""}`,
    lineCount: a.lineCount,
    costCents: a.costCents,
  }));
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
          prices={data.prices}
          assemblies={assemblyOptions}
          shares={data.shares.map((s) => ({
            id: s.share.id,
            standing: s.standing,
            expiresAt: s.share.expiresAt.toISOString(),
            viewCount: s.share.viewCount,
            lastViewedAt: s.share.lastViewedAt?.toISOString() ?? null,
            signedName: s.share.signedName,
            signedAt: s.share.signedAt?.toISOString() ?? null,
            signedTotalCents: s.share.signedTotalCents,
          }))}
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
            format: row.estimate.format,
            letter: row.estimate.letter,
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
