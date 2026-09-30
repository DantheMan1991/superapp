import { notFound } from "next/navigation";
import { ScanLine } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { localDayIn } from "@/modules/fitness/core/day";
import { listPostureChecks } from "@/modules/fitness/posture/check-ops";
import { markLabels } from "@/modules/fitness/posture/core/marks";
import { marksOfPrograms } from "@/modules/fitness/posture/marks-ops";
import { summarize } from "@/modules/fitness/posture/core/history";
import { CheckReport } from "@/modules/fitness/posture/components/check-report";

export const dynamic = "force-dynamic";

/**
 * A POSTURE CHECK'S REPORT (docs/help/fitness/posture-report.md; docs/
 * modules/posture.md, slices 2 and 3): the check from the account, with every
 * other check summarized beside it for the comparison and the noise. A check
 * the account does not have yet is read from the phone that took it, in the
 * browser (`CheckReport`). A check that marked a workout program's start or
 * a phase's end says so, and so do the checks it can be compared with
 * (slice 3c).
 */
export default async function PostureReportPage({ params }: { params: Promise<{ checkId: string }> }) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const { checkId } = await params;
  const id = z.string().uuid().safeParse(checkId);
  if (!id.success) notFound();

  const today = localDayIn(ctx.tenant.timezone, new Date());
  const { check, history, labels } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const all = await listPostureChecks(tx, ctx.tenant.id);
      const { marks } = await marksOfPrograms(tx, ctx.tenant.id, all, today);
      return {
        check: all.find((c) => c.id === id.data) ?? null,
        history: all.map(summarize),
        labels: markLabels(marks),
      };
    },
    { role: ctx.role },
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Posture report" description="How you stood, from one posture check." icon={<ScanLine />} />
      <CheckReport
        owner={ctx.tenant.id}
        checkId={id.data}
        fromAccount={check}
        history={history}
        labels={labels}
        backHref="/personal/m/fitness/posture"
      />
    </div>
  );
}
