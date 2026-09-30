import { notFound } from "next/navigation";
import { ScanLine } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { getPostureCheck, listPostureChecks } from "@/modules/fitness/posture/check-ops";
import { summarize } from "@/modules/fitness/posture/core/history";
import { CheckReport } from "@/modules/fitness/posture/components/check-report";

export const dynamic = "force-dynamic";

/**
 * A POSTURE CHECK'S REPORT (docs/help/fitness/posture-report.md; docs/
 * modules/posture.md, slices 2 and 3): the check from the account, with every
 * other check summarized beside it for the comparison and the noise. A check
 * the account does not have yet is read from the phone that took it, in the
 * browser (`CheckReport`).
 */
export default async function PostureReportPage({ params }: { params: Promise<{ checkId: string }> }) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const { checkId } = await params;
  const id = z.string().uuid().safeParse(checkId);
  if (!id.success) notFound();

  const { check, history } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      check: await getPostureCheck(tx, ctx.tenant.id, id.data),
      history: (await listPostureChecks(tx, ctx.tenant.id)).map(summarize),
    }),
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
        backHref="/personal/m/fitness/posture"
      />
    </div>
  );
}
