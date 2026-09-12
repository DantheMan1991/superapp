import Link from "next/link";
import { and, eq, notInArray } from "drizzle-orm";
import { Users } from "lucide-react";
import { schema, withTenant } from "@/db";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { roleMayManageWorkers } from "@/modules/time/core/errors";
import {
  AddWorker,
  RoundingPicker,
  WeekStartPicker,
  WorkerActiveButton,
  WorkerSignInPicker,
} from "@/modules/time/components/people-controls";
import { listWorkers } from "@/modules/time/read";
import { roundingLabel } from "@/modules/time/core/rounding";
import { getTimePrefs } from "@/modules/time/settings-ops";

export const dynamic = "force-dynamic";

/**
 * Who the business records hours for, and the one setting a week needs.
 *
 * OWNER-ONLY TO CHANGE, READABLE BY EVERYBODY. Knowing who is on the list is
 * ordinary — the Log time box offers these names to whoever is logging — while
 * adding to it is an owner's decision, because slice 5 hangs pay rates off
 * exactly these rows. The page asks `roleMayManageWorkers`, the same predicate
 * the action's gate asks, so the two cannot drift.
 */
export default async function TimePeoplePage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "time");
  const canManage = roleMayManageWorkers(ctx.role);

  const { workers, members, prefs, candidates } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const workers = await listWorkers(tx, ctx.tenant.id);
      /*
       * People the business already knows who are not workers yet, so a
       * subcontractor who is also a vendor becomes a worker rather than a
       * second record of the same human being.
       *
       * `notInArray` with an empty list is invalid SQL, hence the branch. The
       * list is people only: an organization does not work hours.
       */
      const taken = workers.map((w) => w.partyId);
      const candidates = await tx
        .select({
          id: schema.parties.id,
          name: schema.parties.displayName,
        })
        .from(schema.parties)
        .where(
          and(
            eq(schema.parties.tenantId, ctx.tenant.id),
            eq(schema.parties.kind, "person"),
            eq(schema.parties.isActive, true),
            ...(taken.length > 0 ? [notInArray(schema.parties.id, taken)] : []),
          ),
        )
        .orderBy(schema.parties.displayName)
        .limit(200);
      return {
        workers,
        candidates,
        members: await listAssignableMembers(tx, ctx.tenant.id),
        prefs: await getTimePrefs(tx, ctx.tenant.id),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  const memberOptions = members.map((m) => ({
    clerkUserId: m.clerkUserId,
    label: memberLabel(m),
  }));
  const labelByUser = new Map(memberOptions.map((m) => [m.clerkUserId, m.label]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="People"
        description="Everybody whose hours this business keeps."
        icon={<Users />}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/m/time">Time</Link>
            </Button>
            {canManage && (
              <AddWorker people={candidates} members={memberOptions} />
            )}
          </div>
        }
      />

      {!canManage && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Only an owner can change who is on this list.
        </p>
      )}

      {workers.length === 0 ? (
        <EmptyState
          panel
          icon={<Users />}
          title="Nobody here yet"
          description="Add the people whose hours you want to keep. They do not need to be able to sign in — a seasonal hand, a subcontractor or somebody who never opens the app all count."
          action={
            canManage ? (
              <AddWorker people={candidates} members={memberOptions} />
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border">
          <ul className="divide-y">
            {workers.map((worker) => (
              <li
                key={worker.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              >
                <span
                  className={`min-w-0 flex-1 truncate font-medium ${
                    worker.isActive ? "" : "text-muted-foreground line-through"
                  }`}
                >
                  {worker.name}
                </span>
                {canManage ? (
                  <WorkerSignInPicker
                    workerId={worker.id}
                    version={worker.version}
                    clerkUserId={worker.clerkUserId}
                    members={memberOptions}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {worker.clerkUserId
                      ? (labelByUser.get(worker.clerkUserId) ?? "Signs in")
                      : "No sign-in"}
                  </span>
                )}
                {canManage && (
                  <WorkerActiveButton
                    workerId={worker.id}
                    version={worker.version}
                    isActive={worker.isActive}
                    name={worker.name}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-medium">Your week starts on</h2>
          {canManage ? (
            <WeekStartPicker weekStartsOn={prefs.weekStartsOn} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Weeks run from{" "}
              {
                [
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ][prefs.weekStartsOn]
              }
              .
            </p>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-medium">Round clocked time to</h2>
          {canManage ? (
            <RoundingPicker roundingMinutes={prefs.roundingMinutes} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {roundingLabel(prefs.roundingMinutes)}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
