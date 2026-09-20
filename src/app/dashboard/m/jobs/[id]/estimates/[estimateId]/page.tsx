import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { getProject, listContracts, listCostCodes } from "@/packs/jobs/ops";
import { getEstimate, priceBookRows, unitsInUse } from "@/packs/jobs/estimating-ops";
import { listEstimateShares } from "@/packs/jobs/estimate-shares";
import { listAssemblies } from "@/packs/jobs/assembly-ops";
import { formatQuantity } from "@/packs/jobs/billing-math";
import { EstimateEditor } from "@/packs/jobs/components/estimate-editor";
import { WalkStart } from "@/packs/jobs/components/walk-start";
import { interviewGateFrom } from "@/packs/jobs/interview-gate";
import { listOutlines } from "@/packs/jobs/outline-ops";
import { asWalkAnswers, loadWalk } from "@/packs/jobs/walk-ops";
import { reckoningFor } from "@/packs/jobs/walk-reckoning-ops";
import { PACK, slugLabel } from "@/packs/jobs/vocabulary";

/**
 * One estimate. The editor is the WHOLE page: it owns its height, its own
 * header — the estimate's title, its status, what the client pays and the one
 * button that sends it — and its own internal scrolling, so nothing a builder
 * needs to keep their place scrolls away on an estimate of eighty lines (E8).
 *
 * That is why there is no `<PageHeader>` here and no second panel underneath:
 * the job's own header, vitals and tabs are the layout's, and a sibling panel
 * below a fixed-height one would be stranded off the bottom of the screen. The
 * by-cost-code table moved INSIDE the editor as its fourth folded section.
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
      /**
       * THE WALK IS A LAYER, so it is read here and drawn ABOVE the editor —
       * never threaded through it (X2a, ADR 0098). Off, and none of this is
       * fetched and nothing is rendered.
       */
      const gate = interviewGateFrom(pack.config);
      const latest = gate.available ? await loadWalk(tx, ctx.tenant.id, estimateId) : null;
      /**
       * **A FINISHED WALK IS NOT A FINISHED BID** (X4), so the estimate says
       * what the last one left behind. Reckoned only when there IS a finished
       * walk — the reads are cheap but this page is not, and a business that
       * has never walked this estimate pays nothing for the feature.
       */
      const left =
        latest && latest.interview.status === "finished"
          ? await reckoningFor(tx, ctx.tenant.id, {
              interviewId: latest.interview.id,
              projectId: id,
              steps: latest.steps,
              answers: asWalkAnswers(latest.answers),
            })
          : null;
      const walk = gate.available
        ? { outlines: await listOutlines(tx, ctx.tenant.id), running: latest, left }
        : null;
      return { project, row, contracts, codes, labels: pack.labels, units, prices, assemblies, shares, walk };
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

  /** The estimate's coordinates for its own header: the job, and the agreement it prices. */
  const projectLabel = [
    `${projectWord} ${project.number}`,
    project.address,
    row.contract
      ? `${slugLabel(row.contract.kind)}${row.contract.name ? ` · ${row.contract.name}` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /** Only offered on an estimate a walk could actually write to. */
  const walkable =
    data.walk !== null && canEdit && row.estimate.status !== "accepted";
  const running =
    data.walk?.running && data.walk.running.interview.status === "running"
      ? data.walk.running
      : null;
  const left = running ? null : (data.walk?.left ?? null);

  return (
    <>
      {walkable && (
        <WalkStart
          projectId={project.id}
          estimateId={row.estimate.id}
          outlines={(data.walk?.outlines ?? [])
            .filter((o) => o.outline.isActive && o.summary.steps > 0)
            .map((o) => ({
              id: o.outline.id,
              name: o.outline.name,
              isDefault: o.outline.isDefault,
              steps: o.summary.steps,
            }))}
          running={
            running
              ? {
                  stepTitle: running.step?.title ?? "",
                  covered: running.progress.covered,
                  steps: running.progress.steps,
                }
              : null
          }
          left={left ? { blocking: left.blocking.length, priced: left.priced } : null}
        />
      )}
    <EstimateEditor
      key={`${row.estimate.id}:${row.estimate.version}`}
      projectId={project.id}
      projectLabel={projectLabel}
      prices={data.prices}
      assemblies={assemblyOptions}
      // What the SAVED lines add up to per code, worked out on the server. It is
      // the editor's fourth folded section now, not a panel underneath it.
      byCode={row.byCode.map((c) => ({
        costCodeId: c.costCodeId,
        codeLabel: c.codeLabel,
        costCents: c.costCents,
        priceCents: c.priceCents,
      }))}
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
          section: g.section,
          showLines: g.showLines,
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
    </>
  );
}
