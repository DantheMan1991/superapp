import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { loadProgram } from "@/modules/fitness/program-ops";
import { ProgramView } from "@/modules/fitness/components/program-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A saved program, to follow (docs/help/fitness/program.md). `?phase=2` opens a phase. */
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
  const program = await withTenant(ctx.tenant.id, (tx) => loadProgram(tx, ctx.tenant.id, id), {
    role: ctx.role,
  });
  if (!program) notFound();
  const raw = (await searchParams).phase;
  const asked = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  const phaseIndex = Number.isFinite(asked) && asked >= 1 && asked <= program.phases.length ? asked - 1 : 0;
  return <ProgramView program={program} phaseIndex={phaseIndex} />;
}
