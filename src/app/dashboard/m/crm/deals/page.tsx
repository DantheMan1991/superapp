import Link from "next/link";
import { Building2, KanbanSquare, User } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { CrmNav } from "@/modules/crm/components/crm-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { summarizeBoard } from "@/modules/crm/core/pipeline";
import { listDealsForPipeline } from "@/modules/crm/deal-ops";
import {
  ensureDefaultPipeline,
  listPipelines,
  loadPipeline,
} from "@/modules/crm/pipeline-ops";
import {
  MoveDealButton,
  PipelinePicker,
} from "@/modules/crm/components/deal-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * The board.
 *
 * COLUMNS COME FROM `summarizeBoard`, which returns a row for every stage
 * including the empty ones — a board that hid empty columns would quietly
 * change shape as deals moved, and "where did Proposal go" is not a question
 * anybody should have to ask.
 *
 * `{ role: ctx.role }` throughout: deals inherit the party's visibility, so a
 * staff member's board is missing the restricted accounts' cards entirely
 * rather than showing them greyed out.
 */
export default async function DealsBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const { pipeline: requested } = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const board = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const crmCtx = {
        tenantId: ctx.tenant.id,
        userId: ctx.userId,
        role: ctx.role,
      };
      // Provisions the default pipeline on first visit, for an owner. Staff
      // arriving first get the explanatory empty state below instead of a
      // silent failure.
      const { pipeline, stages } = requested
        ? await loadPipeline(tx, ctx.tenant.id, requested)
        : await ensureDefaultPipeline(tx, crmCtx).catch(() => null).then((p) =>
            p ?? { pipeline: null, stages: [] },
          );

      if (!pipeline) return null;

      return {
        pipeline,
        stages,
        deals: await listDealsForPipeline(tx, ctx.tenant.id, pipeline.id),
        pipelines: await listPipelines(tx, ctx.tenant.id),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  if (!board) {
    return (
      <div className="space-y-6">
        <PageHeader title="Board" />
        <CrmNav />
        <Panel>
          <EmptyState
            icon={<KanbanSquare />}
            title="No pipeline yet"
            description="An owner needs to set up the first pipeline before this board can be used."
          />
        </Panel>
      </div>
    );
  }

  const { pipeline, stages, deals, pipelines } = board;
  const live = stages.filter((s) => !s.archivedAt);
  const totals = summarizeBoard(live, deals.map((d) => d.deal));
  const totalById = new Map(totals.map((t) => [t.stageId, t]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={pipeline.name}
        description="Deals by stage, in this business's own words."
        actions={
          <>
            <PipelinePicker pipelines={pipelines} currentId={pipeline.id} />
            <Button asChild variant="outline" size="sm">
              <Link href={`${BASE}/pipelines`}>Stages</Link>
            </Button>
          </>
        }
      />

      <CrmNav />

      {live.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          This pipeline has no stages. Add some under Stages.
        </p>
      ) : (
        // Horizontal scroll on the BOARD only, never the page body. A board
        // with six stages does not fit a phone and should not try to.
        <div className="-mx-2 overflow-x-auto px-2 pb-2">
          <div className="flex min-w-max gap-3">
            {live.map((stage) => {
              const t = totalById.get(stage.id);
              const cards = deals.filter((d) => d.deal.stageId === stage.id);

              return (
                <section
                  key={stage.id}
                  className="flex w-72 shrink-0 flex-col gap-2 rounded-md border bg-muted/30 p-2"
                >
                  <header className="px-1 pt-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="truncate text-sm font-medium">
                        {stage.name}
                      </h2>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t?.count ?? 0}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t && t.amountCents > 0
                        ? `$${formatCents(t.amountCents)}`
                        : "—"}
                      {/* Says how many cards the total does NOT include, so a
                          column reading $0 with eight deals in it is legible. */}
                      {t && t.unvalued > 0 && ` · ${t.unvalued} unpriced`}
                    </p>
                  </header>

                  {cards.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      Nothing here.
                    </p>
                  ) : (
                    cards.map(({ deal, party }) => (
                      <article
                        key={deal.id}
                        className="rounded-md border bg-background p-3"
                      >
                        <Link
                          href={`${BASE}/deals/${deal.id}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {deal.title}
                        </Link>
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          {party.kind === "person" ? (
                            <User className="size-3 shrink-0" />
                          ) : (
                            <Building2 className="size-3 shrink-0" />
                          )}
                          <span className="truncate">{party.displayName}</span>
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-sm">
                            {deal.amountCents === null ? (
                              <span className="text-xs text-muted-foreground">
                                No amount yet
                              </span>
                            ) : (
                              `$${formatCents(deal.amountCents)}`
                            )}
                          </span>
                          <MoveDealButton
                            dealId={deal.id}
                            dealVersion={deal.version}
                            partyId={deal.partyId}
                            currentStageId={deal.stageId}
                            stages={live}
                          />
                        </div>
                        {deal.expectedCloseOn && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Expected {deal.expectedCloseOn}
                          </p>
                        )}
                        {stage.outcome !== "open" && deal.closedAt && (
                          <Badge variant="secondary" className="mt-2">
                            {stage.outcome === "won" ? "Won" : "Lost"}
                          </Badge>
                        )}
                      </article>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {deals.length >= 1000 && (
        <p className="text-xs text-muted-foreground">
          Showing the first 1000 deals on this pipeline.
        </p>
      )}
    </div>
  );
}
