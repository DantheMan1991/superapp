import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { emptyProgram } from "@/modules/fitness/core/program";
import { ProgramEditor } from "@/modules/fitness/components/program-editor";

export const dynamic = "force-dynamic";

/** Build a program by hand (docs/help/fitness/editor.md): the review screen, started empty. */
export default async function NewProgramPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Build a program"
        description="Phases in order, and in each phase the exercises with what to do."
      />
      <ProgramEditor initial={emptyProgram()} mode={{ kind: "new" }} />
    </div>
  );
}
