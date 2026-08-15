import Link from "next/link";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { isModuleEnabled } from "@/lib/modules";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { WorkItemRow } from "@/components/app/work-item-row";
import { CrmNav } from "@/modules/crm/components/crm-nav";
import {
  listOpenTasksOnRecords,
  listRecentlyCompletedTasksOnRecords,
} from "@/modules/crm/timeline-ops";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * Follow-ups on CRM records.
 *
 * THIS URL WAS A REDIRECT INTO WORK (slice 5b) AND IS A PAGE AGAIN.
 *
 * The redirect's reasoning was sound and is preserved: a CRM-filtered list
 * would silently drop unattached follow-ups — "ring the accountant back" — so
 * WORK is the complete list of what somebody owes, across every module. What
 * did not follow is that CRM may not have a view of its own work, and the two
 * claims were thrown out together. Working a record and then being ejected into
 * another module to see what is outstanding on it is the friction that brought
 * this back.
 *
 * So it scopes deliberately and SAYS SO rather than pretending to be
 * everything: follow-ups attached to a record, with a standing link to Work for
 * the rest. The rows are the shared `WorkItemRow`, so the verbs here are the
 * same ones on the record page and on an asset — see extension-model.md §4b.
 */
export default async function CrmFollowUpsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const [data, workOn] = await Promise.all([
    withTenant(
      ctx.tenant.id,
      async (tx) => ({
        open: await listOpenTasksOnRecords(tx, ctx.tenant.id),
        done: await listRecentlyCompletedTasksOnRecords(tx, ctx.tenant.id, 10),
        members: await listAssignableMembers(tx, ctx.tenant.id),
      }),
      { role: ctx.role, userId: ctx.userId },
    ),
    // Only offer the link if Work is switched on for this tenant. A dead link
    // to a module they do not have is worse than no link.
    isModuleEnabled(ctx.tenant.id, "work"),
  ]);

  const members = data.members.map((m) => ({
    clerkUserId: m.clerkUserId,
    label: memberLabel(m),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups"
        description="What is still outstanding on your records."
      />
      <CrmNav />

      {data.open.length === 0 ? (
        <EmptyState
          panel
          title="Nothing outstanding"
          description="Follow-ups you raise on a record show up here. Add one from the record itself."
        />
      ) : (
        <ul className="divide-y rounded-md border">
          {data.open.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{task.title}</p>
                {task.partyId && (
                  <Link
                    href={`${BASE}/records/${task.partyId}`}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    On this record
                  </Link>
                )}
              </div>
              <WorkItemRow
                item={{
                  id: task.id,
                  title: task.title,
                  dueOn: task.dueOn,
                  assigneeClerkUserId: task.assigneeClerkUserId,
                  completedAt: task.completedAt,
                  version: task.version,
                }}
                members={members}
                revalidate={`${BASE}/tasks`}
              />
            </li>
          ))}
        </ul>
      )}

      {data.done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Recently done</h2>
          <ul className="divide-y rounded-md border">
            {data.done.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <p className="min-w-0 text-sm text-muted-foreground">
                  {task.title}
                </p>
                <WorkItemRow
                  item={{
                    id: task.id,
                    title: task.title,
                    dueOn: task.dueOn,
                    assigneeClerkUserId: task.assigneeClerkUserId,
                    completedAt: task.completedAt,
                    version: task.version,
                  }}
                  members={members}
                  revalidate={`${BASE}/tasks`}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Says what it leaves out. The complete list is the whole reason Work
          exists, and a page that quietly filtered would recreate the problem
          slice 5b removed. */}
      <p className="text-xs text-muted-foreground">
        These are follow-ups attached to a record.{" "}
        {workOn ? (
          <>
            Work that is not about a record — and everything else outstanding —
            lives in{" "}
            <Link href="/dashboard/m/work" className="underline">
              Work
            </Link>
            .
          </>
        ) : (
          <>Work that is not about a record lives in the Work module.</>
        )}
      </p>
    </div>
  );
}
