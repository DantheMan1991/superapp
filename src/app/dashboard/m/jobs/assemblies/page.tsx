import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { PageHeader } from "@/components/app/page-header";
import { listAssemblies } from "@/packs/jobs/assembly-ops";
import { thousandthsToQuantityString } from "@/packs/jobs/billing-math";
import { PACK } from "@/packs/jobs/vocabulary";
import {
  AssemblyLibrary,
  type AssemblyListRow,
} from "@/packs/jobs/components/assembly-library";

/**
 * THE ASSEMBLY LIBRARY (X10).
 *
 * Tenant-wide, beside the cost codes and the estimate outlines, because an
 * assembly is how THIS BUSINESS writes an item rather than anything about
 * one job. Member-wide to read and write: building the library is the
 * estimating, the same call `saveItemAsAssembly` already made.
 */
export default async function AssembliesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const rows = await withTenant(
    ctx.tenant.id,
    async (tx) =>
      (await listAssemblies(tx, ctx.tenant.id)).map<AssemblyListRow>((a) => ({
        id: a.assembly.id,
        name: a.assembly.name,
        per: `${thousandthsToQuantityString(a.assembly.drivingQuantityThousandths)} ${a.assembly.drivingUnit}`.trim(),
        lineCount: a.lineCount,
        costCents: a.costCents,
        notes: a.assembly.notes,
      })),
    { role: ctx.role },
  );

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Projects
      </Link>

      <PageHeader
        title="Assemblies"
        description="The items you build the same way every time — your lines, your wording, your split between labour, material and equipment. The walk uses these instead of working the lines out for itself."
      />

      <AssemblyLibrary
        rows={rows}
        canWrite={allowsWrite(ctx.role, "member")}
        symbol={ctx.tenant.currencySymbol ?? null}
      />
    </div>
  );
}
