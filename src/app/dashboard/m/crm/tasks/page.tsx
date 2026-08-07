import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { listAssignableMembers, memberLabel } from "@/lib/team";
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
 * Grouped against the TENANT's today (`tenants.timezone`, 0086), so "Overdue"
 * flips when the business's day does. This used to group against the server's
 * today and said so: the only timezone in the platform lived in
 * `accounting_settings`, and reading another module's table from here is what
 * the isolation rule forbids. The shared setting it was waiting for now exists.
 *
 * The per-row badge is still computed in the BROWSER, which is a second clock
 * and therefore a second answer for anyone working away from the business's
 * timezone. Deliberate for now — see docs/modules/timezone.md.
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
        // In the caller's own transaction, so the picker can only ever offer
        // people this person could already find.
        members: await listAssignableMembers(tx, ctx.tenant.id),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  const today = todayInTimezone(ctx.tenant.timezone);
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
        <AddTaskButton
          label="Add a follow-up"
          members={data.members.map((m) => ({
            clerkUserId: m.clerkUserId,
            label: memberLabel(m),
          }))}
          currentUserId={ctx.userId}
        />
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
