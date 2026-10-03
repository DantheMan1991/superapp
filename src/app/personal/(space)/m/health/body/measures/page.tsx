import Link from "next/link";
import { ArrowLeft, Ruler } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listMeasures } from "@/modules/health/body-ops";
import { HEALTH_HOME } from "@/modules/health/log-ops";
import { MeasureManager } from "@/modules/health/components/measure-manager";

export const dynamic = "force-dynamic";

/** Your tape measures (docs/help/health/measures.md, H2): what Measure asks for, and which way is better for each. */
export default async function MeasuresPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  const measures = await withTenant(ctx.tenant.id, (tx) => listMeasures(tx, ctx.tenant.id), { role: ctx.role });
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`${HEALTH_HOME}/body`}>
          <ArrowLeft aria-hidden /> Body
        </Link>
      </Button>
      <PageHeader
        title="Your tape measures"
        description="Choose what you measure, and which way is better for each."
        icon={<Ruler />}
      />
      <MeasureManager measures={measures} />
    </div>
  );
}
