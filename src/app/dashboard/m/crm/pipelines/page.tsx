import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { CrmNav } from "@/modules/crm/components/crm-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import {
  ensureDefaultPipeline,
  listStages,
  loadPipeline,
} from "@/modules/crm/pipeline-ops";
import { PipelineManager } from "@/modules/crm/components/pipeline-manager";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * Stage settings. Owner-only to change, readable by everyone — the same split
 * as the custom fields page, and for the same reason: staff need to know what
 * the stages mean even though they cannot rename them.
 */
export default async function PipelinesPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const { pipeline: requested } = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const crmCtx = {
        tenantId: ctx.tenant.id,
        userId: ctx.userId,
        role: ctx.role,
      };
      const loaded = requested
        ? await loadPipeline(tx, ctx.tenant.id, requested)
        : await ensureDefaultPipeline(tx, crmCtx).catch(() => null);
      if (!loaded) return null;
      return {
        pipeline: loaded.pipeline,
        stages: await listStages(tx, ctx.tenant.id, loaded.pipeline.id, {
          includeArchived: true,
        }),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  const isOwner = ctx.role === "owner";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {/* The back link stays: this page is reached FROM the Board, so "Board"
          is a step up rather than a duplicate of the strip below. */}
      <Link
        href={`${BASE}/deals`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Board
      </Link>

      <PageHeader
        title={data?.pipeline.name ?? "Pipeline"}
        description="The steps a deal moves through, in this business's own words."
      />

      <CrmNav />

      {!data ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          An owner needs to set up the first pipeline.
        </p>
      ) : isOwner ? (
        <PipelineManager pipelineId={data.pipeline.id} stages={data.stages} />
      ) : (
        <>
          <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
            Only an owner can change these.
          </p>
          <ul className="divide-y rounded-md border">
            {data.stages
              .filter((s) => !s.archivedAt)
              .map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.outcome === "open"
                      ? `Still open · ${s.probability}% likely`
                      : s.outcome === "won"
                        ? "Closes as won"
                        : "Closes as lost"}
                  </p>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
