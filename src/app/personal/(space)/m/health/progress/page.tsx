import Link from "next/link";
import { ArrowLeft, ChartColumn } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { contributedRows } from "@/lib/progress-sources/resolve";
import { todayInTimezone } from "@/lib/timezone";
import { progressWindows, weekLabel } from "@/modules/health/core/progress";
import { HEALTH_HOME } from "@/modules/health/log-ops";
import { ownRows } from "@/modules/health/progress-ops";
import { DayWatch } from "@/modules/health/components/day-watch";
import { ProgressView } from "@/modules/health/components/progress-view";

export const dynamic = "force-dynamic";

/**
 * PROGRESS (docs/help/health/progress.md, H1; the founder's call: by week, the
 * last four weeks): Health's own rows, then what the other personal tools
 * contribute through the progress slot (Workouts' workout days and feel).
 */
export default async function ProgressPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  const today = todayInTimezone(ctx.tenant.timezone);
  const windows = progressWindows(today);
  const [own, others] = await Promise.all([
    withTenant(ctx.tenant.id, (tx) => ownRows(tx, ctx.tenant.id, windows), { role: ctx.role }),
    contributedRows(ctx.tenant.id, windows, ctx.role),
  ]);
  const rows = [...own, ...others.found];
  const first = windows[0];
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <DayWatch today={today} timeZone={ctx.tenant.timezone} />
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={HEALTH_HOME}>
          <ArrowLeft aria-hidden /> Health
        </Link>
      </Button>
      <PageHeader
        title="Progress"
        description={`The last four weeks, from ${weekLabel(first)}. Each bar is seven days; the newest, on the right, ends today.`}
        icon={<ChartColumn />}
      />
      <ProgressView rows={rows} windows={windows} />
      {others.failed.length > 0 && (
        <p className="text-sm text-muted-foreground">{`${others.failed.join(" and ")} could not be read just now. Reload the page to try again.`}</p>
      )}
    </div>
  );
}
