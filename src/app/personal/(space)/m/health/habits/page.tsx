import Link from "next/link";
import { ArrowLeft, ListChecks } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listHabits } from "@/modules/health/habit-ops";
import { HEALTH_HOME } from "@/modules/health/log-ops";
import { HabitManager } from "@/modules/health/components/habit-manager";

export const dynamic = "force-dynamic";

/** Your habits (docs/help/health/habits.md, H1): the list Today marks from. */
export default async function HabitsPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  const habits = await withTenant(ctx.tenant.id, (tx) => listHabits(tx, ctx.tenant.id), { role: ctx.role });
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={HEALTH_HOME}>
          <ArrowLeft aria-hidden /> Health
        </Link>
      </Button>
      <PageHeader
        title="Your habits"
        description="Add your own to mark them done on Today: a sauna, stretching, a supplement."
        icon={<ListChecks />}
      />
      <HabitManager habits={habits.map((h) => ({ id: h.id, name: h.name, unit: h.unit }))} />
    </div>
  );
}
