import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { lastPlunge } from "@/modules/health/log-ops";
import { PlungeTimer } from "@/modules/health/components/plunge-timer";

export const dynamic = "force-dynamic";

/** The cold plunge timer (docs/help/health/plunge.md, H1): the water starts at the last plunge's. */
export default async function PlungePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  const last = await withTenant(ctx.tenant.id, (tx) => lastPlunge(tx, ctx.tenant.id), { role: ctx.role });
  const search = await searchParams;
  return <PlungeTimer lastWaterF={last?.waterF ?? null} typed={search.typed === "1"} />;
}
