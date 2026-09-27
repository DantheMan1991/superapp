import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { ImportForm } from "@/modules/fitness/components/import-form";

export const dynamic = "force-dynamic";
/**
 * The draft is a server action invoked from THIS page, and it runs as long as
 * Claude takes to read a program — about a minute, longer for a long one. A
 * server action's time limit is its page's, so it is set here.
 */
export const maxDuration = 300;

/** Import a program from a PDF (docs/help/fitness/import.md). */
export default async function ImportProgramPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="Import a program"
        description="A PDF you were given. Claude drafts it into phases and exercises, and you check the draft before anything is saved."
      />
      <ImportForm />
    </div>
  );
}
