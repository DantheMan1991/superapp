import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { hasPushDevice } from "@/lib/notifications/push";
import { localDayIn } from "@/modules/fitness/core/day";
import { loadProgram } from "@/modules/fitness/program-ops";
import { loadReminders } from "@/modules/fitness/reminder-ops";
import { lastSession, programSessions } from "@/modules/fitness/session-ops";
import { loadSide } from "@/modules/fitness/side-ops";
import { latestTries, loadLevels } from "@/modules/fitness/level-ops";
import { ProgramView } from "@/modules/fitness/components/program-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A saved program, to follow (docs/help/fitness/program.md). `?phase=2` opens
 * a phase; without it, the phase of the last workout, so the page opens on
 * the phase the person is on.
 */
export default async function ProgramPage({
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
  const [[program, last, sessions, reminders, side, levels, tries], hasPhone] = await Promise.all([
    withTenant(
      ctx.tenant.id,
      async (tx) => {
        const loaded = await loadProgram(tx, ctx.tenant.id, id);
        if (!loaded) return [null, null, [], [], null, {}, new Map()] as const;
        const leveled = loaded.phases.flatMap((phase) => phase.items.filter((i) => i.progression).map((i) => i.id));
        return [
          loaded,
          await lastSession(tx, ctx.tenant.id, id),
          // Every session: the phase's progress and gate (F3), and today's split day (F2c).
          await programSessions(tx, ctx.tenant.id, id),
          // The morning and evening reminders (F4a).
          await loadReminders(tx, ctx.tenant.id, id),
          // What the program's tests found (F4b).
          await loadSide(tx, ctx.tenant.id, id),
          // The level of each exercise with levels, and its latest go (F4c).
          await loadLevels(tx, ctx.tenant.id, id),
          await latestTries(tx, ctx.tenant.id, leveled),
        ] as const;
      },
      { role: ctx.role },
    ),
    hasPushDevice(ctx.userId),
  ]);
  if (!program) notFound();
  const raw = (await searchParams).phase;
  const asked = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  const lastPhase = last?.phaseId ? program.phases.findIndex((phase) => phase.id === last.phaseId) : -1;
  const phaseIndex =
    Number.isFinite(asked) && asked >= 1 && asked <= program.phases.length
      ? asked - 1
      : lastPhase >= 0
        ? lastPhase
        : 0;
  return (
    <ProgramView
      program={program}
      phaseIndex={phaseIndex}
      lastSession={last}
      today={today}
      sessions={sessions}
      timeZone={ctx.tenant.timezone}
      reminders={reminders}
      hasPhone={hasPhone}
      side={side}
      levels={levels}
      tries={tries}
    />
  );
}
