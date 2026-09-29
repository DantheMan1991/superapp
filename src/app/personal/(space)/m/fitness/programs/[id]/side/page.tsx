import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { countOf } from "@/modules/fitness/core/program";
import { loadProgram } from "@/modules/fitness/program-ops";
import { loadSide } from "@/modules/fitness/side-ops";
import { SideTests } from "@/modules/fitness/components/side-tests";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Take a program's side self-assessment (docs/help/fitness/side.md; F4b part
 * 2): the tests, one at a time, and the side they find, saved on the program's
 * enrollment. Reached from the program page's Your side card.
 */
export default async function SidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const [program, saved] = await withTenant(
    ctx.tenant.id,
    (tx) => Promise.all([loadProgram(tx, ctx.tenant.id, id), loadSide(tx, ctx.tenant.id, id)]),
    { role: ctx.role },
  );
  if (!program) notFound();
  const assessment = program.assessment;
  const base = `/personal/m/fitness/programs/${program.id}`;

  if (!assessment || assessment.tests.length === 0) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-6">
        <PageHeader title="Find your side" description={program.name} />
        <p className="text-sm">
          This program has no self-assessment. Add one in the editor, or read the program&apos;s PDF again to find it.
        </p>
        <Link href={base} className="text-sm text-module-accent underline-offset-4 hover:underline">
          Back to the program
        </Link>
      </div>
    );
  }

  const taken = saved
    ? `Taken ${saved.assessedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ctx.tenant.timezone })}: ${saved.side ? `you lean ${saved.side}.` : "no side was clear."}`
    : null;
  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <PageHeader
        title="Find your side"
        description={`${program.name}: ${countOf(assessment.tests.length, "test", "tests")}, a few minutes.`}
      />
      <SideTests
        programId={program.id}
        tests={assessment.tests}
        least={assessment.least}
        video={
          assessment.video
            ? {
                id: assessment.video.id,
                startS: assessment.video.startS,
                endS: assessment.video.endS,
                embeddable: assessment.video.embeddable,
              }
            : null
        }
        notes={assessment.notes}
        oneSided={program.phases.flatMap((phase, p) =>
          phase.items
            .filter((item) => item.perSide && item.sideRule !== "both")
            .map((item) => ({
              id: item.id,
              phase: p + 1,
              name: item.exercise.name,
              rule: item.sideRule,
              means: item.sideMeans,
            })),
        )}
        previous={taken}
      />
    </div>
  );
}
