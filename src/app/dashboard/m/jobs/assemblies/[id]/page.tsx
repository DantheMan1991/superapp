import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { PageHeader } from "@/components/app/page-header";
import { getAssembly } from "@/packs/jobs/assembly-ops";
import { thousandthsToQuantityString } from "@/packs/jobs/billing-math";
import { PACK } from "@/packs/jobs/vocabulary";
import { AssemblyEditor } from "@/packs/jobs/components/assembly-editor";
import { toEditable } from "@/packs/jobs/assembly-math";

/** One assembly, open for editing (X10). */
export default async function AssemblyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const found = await withTenant(
    ctx.tenant.id,
    (tx) => getAssembly(tx, ctx.tenant.id, id),
    { role: ctx.role },
  );
  if (!found) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs/assemblies"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Assemblies
      </Link>

      <PageHeader
        title={found.assembly.name}
        description="What this item is made of, every time you use it. The walk drops these lines in rather than working out its own, which is how a phase comes out the same on every bid."
      />

      <AssemblyEditor
        key={`${found.assembly.id}:${found.assembly.version}`}
        id={found.assembly.id}
        version={found.assembly.version}
        initialName={found.assembly.name}
        initialClientNote={found.assembly.clientNote}
        initialNotes={found.assembly.notes}
        initialPer={thousandthsToQuantityString(found.assembly.drivingQuantityThousandths)}
        initialUnit={found.assembly.drivingUnit}
        initialLines={found.lines.map(toEditable)}
        canWrite={allowsWrite(ctx.role, "member")}
        symbol={ctx.tenant.currencySymbol ?? null}
      />
    </div>
  );
}
