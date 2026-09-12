import Link from "next/link";
import { Clock } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatTimeInTimezone } from "@/lib/timezone";
import { roleMayWrite } from "@/modules/time/core/errors";
import { Kiosk } from "@/modules/time/components/kiosk";
import { listOpenPunches, listWorkers } from "@/modules/time/read";

export const dynamic = "force-dynamic";

/**
 * The shared clock — a tablet by the barn door.
 *
 * **ONLY PEOPLE WITH A PIN APPEAR**, which is what makes this list a roster of
 * who uses the shared device rather than a directory of everybody the business
 * keeps hours for. A worker with no PIN is not hidden from the clock by a
 * setting; they simply have no way to use it, and the page says so plainly
 * rather than showing a name that cannot be tapped.
 *
 * Readable by anybody who may write time, and NOT owners-only. The tablet
 * should be signed in as a member of staff: it is standing in a barn, and
 * whoever walks past has whatever that session has — which is an argument for
 * the session being as small as possible, not for making the clock harder to
 * reach. The guide says so in as many words.
 */
export default async function TimeClockPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "time");

  const { workers, open } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      workers: await listWorkers(tx, ctx.tenant.id),
      open: await listOpenPunches(tx, ctx.tenant.id),
    }),
    { role: ctx.role, userId: ctx.userId },
  );

  const inSince = new Map(
    open.map((p) => [
      p.workerId,
      formatTimeInTimezone(p.startedAt, ctx.tenant.timezone),
    ]),
  );

  const roster = workers
    .filter((w) => w.isActive && w.hasPin)
    .map((w) => ({
      id: w.id,
      name: w.name,
      clockedInSince: inSince.get(w.id) ?? null,
    }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clock"
        description="Tap your name, type your PIN."
        icon={<Clock />}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/m/time">Time</Link>
          </Button>
        }
      />

      {!roleMayWrite(ctx.role) ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">
          An accountant&rsquo;s access is read-only, so this device cannot
          punch.
        </p>
      ) : (
        <Kiosk workers={roster} />
      )}
    </div>
  );
}
