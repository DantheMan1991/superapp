import { notFound } from "next/navigation";
import { ScanLine } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { SavedReport } from "@/modules/fitness/posture/components/saved-report";

export const dynamic = "force-dynamic";

/**
 * A POSTURE CHECK'S REPORT (docs/help/fitness/posture-report.md; docs/
 * modules/posture.md, slice 2). The check is on the phone that took it, not
 * on this server (slice 3 changes that), so the page only frames it: the
 * report is read and drawn in the browser.
 */
export default async function PostureReportPage({ params }: { params: Promise<{ checkId: string }> }) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const { checkId } = await params;
  const id = z.string().uuid().safeParse(checkId);
  if (!id.success) notFound();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Posture report" description="How you stood, from a check kept on this phone." icon={<ScanLine />} />
      <SavedReport owner={ctx.tenant.id} checkId={id.data} backHref="/personal/m/fitness/posture" />
    </div>
  );
}
