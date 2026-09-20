import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { PageHeader } from "@/components/app/page-header";
import { interviewGateFrom } from "@/packs/jobs/interview-gate";
import { loadWalk, walkView } from "@/packs/jobs/walk-ops";
import { PACK } from "@/packs/jobs/vocabulary";
import { WalkScreen } from "@/packs/jobs/components/walk-screen";

/**
 * WALKING AN ESTIMATE (X2a, ADR 0098).
 *
 * **A 404 WHEN THE LAYER IS OFF**, the outline screen's rule: a business
 * either has this or does not, and a page that says "you do not have this"
 * advertises something nobody can buy yet.
 *
 * **A REDIRECT WHEN THERE IS NO WALK**, rather than an empty screen with a
 * start button on it. The button lives on the estimate, where the choice of
 * which outline to walk belongs; arriving here with nothing running means a
 * stale link or a finished walk, and the estimate is where both of those
 * want to go.
 */
export default async function WalkPage({
  params,
}: {
  params: Promise<{ id: string; estimateId: string }>;
}) {
  const { id, estimateId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const estimateHref = `/dashboard/m/jobs/${id}/estimates/${estimateId}`;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK);
      const gate = interviewGateFrom(pack.config);
      if (!gate.available) return { gate, walk: null };
      return { gate, walk: await loadWalk(tx, ctx.tenant.id, estimateId) };
    },
    { role: ctx.role },
  );
  if (!data.gate.available) notFound();
  if (!data.walk || data.walk.interview.status !== "running") redirect(estimateHref);

  const view = walkView(data.walk);

  return (
    <div className="space-y-4">
      <Link
        href={estimateHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back to the estimate
      </Link>

      <PageHeader
        title="Walking the estimate"
        description={`${view.outlineName} — answer as you would on site. It asks one thing at a time, and it will ask things this list does not have.`}
      />

      <WalkScreen
        initial={view}
        projectId={id}
        estimateId={estimateId}
        estimateHref={estimateHref}
      />
    </div>
  );
}
