import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { loadProgram } from "@/modules/fitness/program-ops";
import { sessionCount } from "@/modules/fitness/session-ops";
import { ReadAgain } from "@/modules/fitness/components/read-again";

export const dynamic = "force-dynamic";
/**
 * Reading the PDF again is a server action invoked from THIS page, and it runs
 * as long as Claude takes to read the program: about a minute. A server
 * action's time limit is its page's, so it is set here, as the import sets it.
 */
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a saved program's PDF again (docs/help/fitness/program.md; F4b): what
 * the app did not read the first time, merged into the program and opened in
 * the editor to check.
 */
export default async function ReadAgainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const [program, sessions] = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const loaded = await loadProgram(tx, ctx.tenant.id, id);
      return [loaded, loaded ? await sessionCount(tx, ctx.tenant.id, id) : 0] as const;
    },
    { role: ctx.role },
  );
  if (!program) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Read the PDF again"
        description={`Adds to ${program.name} what the first read left out: the side self-assessment, and the exercises done on one side. Your workouts stay with the program.`}
      />
      <ReadAgain programId={program.id} sessions={sessions} />
    </div>
  );
}
