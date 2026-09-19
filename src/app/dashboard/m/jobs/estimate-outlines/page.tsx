import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ListChecks } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { packContext } from "@/lib/packs/tenant-context";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { listCostCodeSets } from "@/packs/jobs/ops";
import { listOutlines } from "@/packs/jobs/outline-ops";
import { interviewGateFrom } from "@/packs/jobs/interview-gate";
import { PACK } from "@/packs/jobs/vocabulary";
import {
  DeleteOutlineButton,
  DuplicateOutlineButton,
  MakeDefaultOutlineButton,
  NewOutlineButton,
} from "@/packs/jobs/components/outline-controls";

/**
 * ESTIMATE OUTLINES: every way this business walks an estimate (X1, ADR 0098).
 *
 * **BEHIND THE GATE, AND A 404 WHEN IT IS SHUT.** The interview is a layer
 * over estimating that a business either has or does not, and a screen that
 * renders "you do not have this" for everybody else is a screen advertising
 * something they cannot buy yet. `notFound()` is the honest answer.
 *
 * Owner-only to write, readable by anybody — the chart of cost's division,
 * for the chart of cost's reason: an estimator being walked through an
 * outline has to be able to read it.
 */
export default async function EstimateOutlinesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const isOwner = allowsWrite(ctx.role, "owner");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK);
      const gate = interviewGateFrom(pack.config);
      if (!gate.available) return { gate, outlines: [], costCodeSets: [] };
      return {
        gate,
        outlines: await listOutlines(tx, ctx.tenant.id),
        costCodeSets: await listCostCodeSets(tx, ctx.tenant.id),
      };
    },
    { role: ctx.role },
  );
  if (!data.gate.available) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Jobs
      </Link>

      <PageHeader
        title="Estimate outlines"
        description="The order you price a job in, and what you ask yourself at each stop. Keep one per kind of job."
        actions={
          isOwner ? (
            <NewOutlineButton
              costCodeSets={data.costCodeSets.map((s) => ({
                id: s.id,
                name: s.name,
                isDefault: s.isDefault,
              }))}
            />
          ) : null
        }
      />

      {data.outlines.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="No outlines yet"
          description={
            isOwner
              ? "Start one from a cost code list — your chart of cost is already your phases in the order you build them — then prune it and write your own questions in."
              : "An owner sets these up."
          }
          action={
            isOwner ? (
              <NewOutlineButton
                costCodeSets={data.costCodeSets.map((s) => ({
                  id: s.id,
                  name: s.name,
                  isDefault: s.isDefault,
                }))}
              />
            ) : undefined
          }
        />
      ) : (
        data.outlines.map(({ outline, summary }) => (
          <Panel key={outline.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/m/jobs/estimate-outlines/${outline.id}`}
                    className="font-heading text-sm font-medium tracking-heading hover:underline"
                  >
                    {outline.name}
                  </Link>
                  {outline.isDefault && <Badge variant="secondary">Default</Badge>}
                  {!outline.isActive && <Badge variant="secondary">Retired</Badge>}
                </div>
                {outline.notes && (
                  <p className="mt-1 text-sm text-muted-foreground">{outline.notes}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {summary.steps} {summary.steps === 1 ? "step" : "steps"},{" "}
                  {summary.questions}{" "}
                  {summary.questions === 1 ? "question" : "questions"}
                  {summary.silentSteps > 0 &&
                    ` · ${summary.silentSteps} asking nothing`}
                  {summary.uncodedSteps > 0 &&
                    ` · ${summary.uncodedSteps} with no cost code`}
                </p>
              </div>
              {isOwner && (
                <div className="flex flex-wrap items-center gap-1">
                  {!outline.isDefault && (
                    <MakeDefaultOutlineButton outlineId={outline.id} />
                  )}
                  <DuplicateOutlineButton
                    outlineId={outline.id}
                    name={outline.name}
                  />
                  <DeleteOutlineButton
                    outlineId={outline.id}
                    name={outline.name}
                    steps={summary.steps}
                  />
                </div>
              )}
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
