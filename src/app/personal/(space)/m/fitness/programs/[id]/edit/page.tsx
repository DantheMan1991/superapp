import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { loadProgram, programToInput } from "@/modules/fitness/program-ops";
import { ProgramEditor } from "@/modules/fitness/components/program-editor";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edit a saved program (docs/help/fitness/editor.md). Every row keeps its id,
 * and the save is checked against the version opened here.
 */
export default async function EditProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const program = await withTenant(ctx.tenant.id, (tx) => loadProgram(tx, ctx.tenant.id, id), {
    role: ctx.role,
  });
  if (!program) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title={`Edit ${program.name}`} description="Change anything; nothing is saved until Save program." />
      <ProgramEditor
        initial={programToInput(program)}
        mode={{ kind: "edit", programId: program.id, version: program.version }}
      />
    </div>
  );
}
