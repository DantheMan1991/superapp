import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { groupTasks, type DueBucket } from "@/modules/crm/core/timeline";
import {
  listOpenTasks,
  listRecentlyCompletedTasks,
  resolveTaskParties,
} from "@/modules/crm/timeline-ops";
import {
  AddTaskButton,
  TaskToggle,
} from "@/modules/crm/components/timeline-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

const GROUP_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  soon: "This week",
  later: "Later",
  someday: "Someday",
};

/**
 * Everything outstanding, across every record.
 *
 * GROUPED ON THE SERVER USING THE SERVER'S TODAY, which is a known and stated
 * limitation rather than an oversight: a tenant in a timezone far from UTC will
 * see a task flip to "Overdue" a few hours early or late. Fixing it properly
 * means storing the tenant's bookkeeping timezone and grouping against that —
 * `accounting_settings` already holds one, but reading another module's table
 * from here is exactly what the isolation rule forbids, so it waits for a
 * shared setting. The per-row badge is computed in the BROWSER and is correct.
 */
export default async function TasksPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const open = await listOpenTasks(tx, ctx.tenant.id);
      const done = await listRecentlyCompletedTasks(tx, ctx.tenant.id);
      return {
        open,
        done,
        partyNames: await resolveTaskParties(tx, ctx.tenant.id, [...open, ...done]),
      };
    },
    { role: ctx.role },
  );

  const today = new Date().toISOString().slice(0, 10);
  const groups = groupTasks(data.open, today);
  const order: DueBucket[] = ["overdue", "today", "soon", "later", "someday"];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={BASE}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            All records
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            {data.open.length === 0
              ? "Nothing outstanding."
              : `${data.open.length} outstanding.`}
          </p>
        </div>
        {/* No party: a standalone follow-up is a first-class thing here. */}
        <AddTaskButton label="Add a follow-up" />
      </div>

      {data.open.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing to chase. Follow-ups added from a record show up here too.
        </p>
      ) : (
        order
          .filter((bucket) => groups[bucket].length > 0)
          .map((bucket) => (
            <section key={bucket} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">{GROUP_LABELS[bucket]}</h2>
                {bucket === "overdue" && (
                  <Badge variant="destructive">{groups[bucket].length}</Badge>
                )}
              </div>
              <ul className="divide-y rounded-md border">
                {groups[bucket].map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {task.partyId ? (
                          <Link
                            href={`${BASE}/records/${task.partyId}`}
                            className="hover:underline"
                          >
                            {data.partyNames.get(task.partyId) ?? "a record"}
                          </Link>
                        ) : (
                          "Not attached to a record"
                        )}
                        {task.dueOn && ` · due ${task.dueOn}`}
                      </p>
                    </div>
                    <TaskToggle task={task} />
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}

      {data.done.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Recently done
            </h2>
            <ul className="divide-y rounded-md border">
              {data.done.map((task) => (
                <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-muted-foreground line-through">
                      {task.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {task.partyId
                        ? (data.partyNames.get(task.partyId) ?? "a record")
                        : "Not attached to a record"}
                      {task.completedAt &&
                        ` · ${task.completedAt.toISOString().slice(0, 10)}`}
                    </p>
                  </div>
                  <TaskToggle task={task} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
