import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { loadProgram } from "@/modules/fitness/program-ops";
import { lastSession } from "@/modules/fitness/session-ops";
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
  const [program, last] = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const loaded = await loadProgram(tx, ctx.tenant.id, id);
      return [loaded, loaded ? await lastSession(tx, ctx.tenant.id, id) : null] as const;
    },
    { role: ctx.role },
  );
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
      today={localDayIn(ctx.tenant.timezone)}
    />
  );
}

/** Today in the personal space's own clock, `YYYY-MM-DD`: "Last workout: today". */
function localDayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
