import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { loadProgram, sessionPlan } from "@/modules/fitness/program-ops";
import { WorkoutScreen } from "@/modules/fitness/components/workout/workout-screen";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WORKOUT MODE for one phase of a program (docs/help/fitness/workout.md).
 * `?phase=2` is the phase; without it, the first. The screen is a client
 * component over the whole page: everything it does is kept on the phone and
 * sent from there (components/workout/session-store.ts).
 */
export default async function WorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const program = await withTenant(ctx.tenant.id, (tx) => loadProgram(tx, ctx.tenant.id, id), {
    role: ctx.role,
  });
  if (!program) notFound();
  const raw = (await searchParams).phase;
  const asked = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  const phaseIndex = Number.isFinite(asked) && asked >= 1 && asked <= program.phases.length ? asked - 1 : 0;
  const phase = program.phases[phaseIndex];
  // A phase with nothing in it has no session to run.
  if (!phase || phase.items.length === 0) notFound();
  return (
    <WorkoutScreen
      plan={sessionPlan(program, phaseIndex)}
      programHref={`/personal/m/fitness/programs/${program.id}?phase=${phaseIndex + 1}`}
    />
  );
}
