import Link from "next/link";
import { and, eq, notInArray } from "drizzle-orm";
import { Users } from "lucide-react";
import { schema, withTenant } from "@/db";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { roleMayManageWorkers } from "@/modules/time/core/errors";
import {
  AddWorker,
  OvertimeRulesetPicker,
  PayFrequencyPicker,
  RoundingPicker,
  WeekStartPicker,
  WorkerActiveButton,
  WorkerSignInPicker,
} from "@/modules/time/components/people-controls";
import { startOfWeek, todayInTimezone } from "@/lib/timezone";
import { formatCents } from "@/modules/time/core/pay";
import {
  DeleteRateButton,
  SetRateButton,
} from "@/modules/time/components/rate-controls";
import { listRates } from "@/modules/time/rate-ops";
import { listWorkers } from "@/modules/time/read";
import { payFrequencyLabel } from "@/modules/time/core/periods";
import { roundingLabel } from "@/modules/time/core/rounding";
import { rulesetFor } from "@/modules/time/core/rulesets";
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

  const { workers, members, prefs, candidates, rates } = await withTenant(
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
        /*
         * Comes back EMPTY for anybody who is not an owner — the policy on
         * `time_rates` carries `app_current_tenant_role() = 'owner'`, and this
         * `withTenant` passes the reader's real role. The panel below is not
         * rendered at all in that case, so nothing has to decide whether an
         * empty list means "none" or "not for you".
         */
        rates: await listRates(tx, ctx.tenant.id),
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
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
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
        <Panel>
          <ul className="divide-y divide-divider">
            {workers.map((worker) => (
              <li
                key={worker.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
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
                  <span className="text-xs text-subtle-foreground">
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
        </Panel>
      )}

      {/* OWNERS ONLY, and the RLS policy says so too. The screen asks the same
          predicate the action's gate asks, so a control is never drawn for
          somebody whose press would be refused. */}
      {canManage && workers.length > 0 && (
        <Panel className="p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium tracking-heading">
              Pay rates
              <span className="ml-2 text-xs font-normal text-subtle-foreground">
                only owners can see this
              </span>
            </h2>
            <SetRateButton
              workers={workers
                .filter((w) => w.isActive)
                .map((w) => ({ id: w.id, name: w.name }))}
              today={todayInTimezone(ctx.tenant.timezone)}
            />
          </div>
          {rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody has a rate yet. Hours are still recorded and added up
              without one — a rate is what turns them into a figure.
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {rates.map((rate) => {
                const name =
                  workers.find((w) => w.id === rate.workerId)?.name ?? "Somebody";
                return (
                  <li
                    key={rate.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm first:pt-0"
                  >
                    <span className="w-40 shrink-0 truncate font-medium">
                      {name}
                    </span>
                    <span className="tabular-nums">
                      {formatCents(rate.payRateCents)}/hr
                    </span>
                    <span className="text-xs text-subtle-foreground">
                      from {rate.effectiveOn}
                    </span>
                    {rate.billRateCents !== null && (
                      <span className="text-xs text-muted-foreground">
                        charged out at {formatCents(rate.billRateCents)}
                      </span>
                    )}
                    {rate.burdenPercent > 0 && (
                      <span className="text-xs text-muted-foreground">
                        +{rate.burdenPercent}% on-costs
                      </span>
                    )}
                    <span className="ml-auto">
                      <DeleteRateButton
                        rateId={rate.id}
                        summary={`${name}, ${formatCents(rate.payRateCents)} an hour from ${rate.effectiveOn}`}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-subtle-foreground">
            A change is a new row with a new start date. Nothing worked before
            that date is re-priced.
          </p>
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel className="p-4">
          <h2 className="mb-2 text-sm font-medium tracking-heading">
            Your week starts on
          </h2>
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
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-2 text-sm font-medium tracking-heading">
            Round clocked time to
          </h2>
          {canManage ? (
            <RoundingPicker roundingMinutes={prefs.roundingMinutes} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {roundingLabel(prefs.roundingMinutes)}.
            </p>
          )}
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-2 text-sm font-medium tracking-heading">
            People are paid
          </h2>
          {canManage ? (
            <PayFrequencyPicker
              frequency={prefs.payFrequency}
              anchor={prefs.periodAnchor}
              weekExample={startOfWeek(
                todayInTimezone(ctx.tenant.timezone),
                prefs.weekStartsOn,
              )}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {payFrequencyLabel(prefs.payFrequency)}.
            </p>
          )}
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-2 text-sm font-medium tracking-heading">
            Overtime rules
          </h2>
          {canManage ? (
            <OvertimeRulesetPicker slug={prefs.overtimeRuleset} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {rulesetFor(prefs.overtimeRuleset).summary}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
