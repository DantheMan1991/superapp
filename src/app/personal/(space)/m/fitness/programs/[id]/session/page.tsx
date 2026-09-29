import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { isSynthesisConfigured } from "@/lib/speech/synthesis";
import { localDayIn, shiftDay } from "@/modules/fitness/core/day";
import { loadProgram, sessionPlan } from "@/modules/fitness/program-ops";
import { recentSessions } from "@/modules/fitness/session-ops";
import { loadSide } from "@/modules/fitness/side-ops";
import { loadLevels } from "@/modules/fitness/level-ops";
import { WorkoutScreen } from "@/modules/fitness/components/workout/workout-screen";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WORKOUT MODE for one phase of a program (docs/help/fitness/workout.md).
 * `?phase=2` is the phase; without it, the first. The screen is a client
 * component over the whole page: everything it does is kept on the phone and
 * sent from there (components/workout/session-store.ts).
 *
 * It is given the program's sessions from the day before today to the day
 * after (F2c): a session later in the day picks up what the morning left, and
 * the phone adds the day up from these and its own (core/day.ts).
 *
 * And the person's side, once the program's tests have found one (F4b): an
 * exercise the program does on one side is that side only. And their level
 * of each exercise with levels (F4c).
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
  const today = localDayIn(ctx.tenant.timezone, new Date());
  const [program, recent, side, levels] = await withTenant(
    ctx.tenant.id,
    (tx) =>
      Promise.all([
        loadProgram(tx, ctx.tenant.id, id),
        recentSessions(tx, ctx.tenant.id, id, shiftDay(today, -1), shiftDay(today, 1)),
        loadSide(tx, ctx.tenant.id, id),
        loadLevels(tx, ctx.tenant.id, id),
      ]),
    { role: ctx.role },
  );
  if (!program) notFound();
  const raw = (await searchParams).phase;
  const asked = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  const phaseIndex = Number.isFinite(asked) && asked >= 1 && asked <= program.phases.length ? asked - 1 : 0;
  const phase = program.phases[phaseIndex];
  // A phase with nothing in it has no session to run.
  if (!phase || phase.items.length === 0) notFound();
  return (
    <WorkoutScreen
      plan={sessionPlan(program, phaseIndex, side?.side ?? null, levels)}
      programHref={`/personal/m/fitness/programs/${program.id}?phase=${phaseIndex + 1}`}
      recent={recent}
      today={today}
      timeZone={ctx.tenant.timezone}
      naturalVoice={isSynthesisConfigured()}
    />
  );
}
