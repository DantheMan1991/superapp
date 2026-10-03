import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { askedDay } from "@/modules/health/core/days";
import { lastPlunge } from "@/modules/health/log-ops";
import { PlungeTimer } from "@/modules/health/components/plunge-timer";

export const dynamic = "force-dynamic";

/**
 * The cold plunge timer (docs/help/health/plunge.md, H1): the water starts at
 * the last plunge's. `?day=` an earlier day (H2): typed in, for that day.
 */
export default async function PlungePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  const last = await withTenant(ctx.tenant.id, (tx) => lastPlunge(tx, ctx.tenant.id), { role: ctx.role });
  const search = await searchParams;
  const today = todayInTimezone(ctx.tenant.timezone);
  const day = askedDay(typeof search.day === "string" ? search.day : null, today);
  return <PlungeTimer lastWaterF={last?.waterF ?? null} typed={search.typed === "1"} day={day === today ? null : day} />;
}
