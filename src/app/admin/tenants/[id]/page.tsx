import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withSystem, schema } from "@/db";
import { moduleRegistry } from "@/modules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  SubscriptionStatusBadge,
  TenantStatusBadge,
} from "@/components/status-badge";
import {
  AddNoteForm,
  ConvertProspectForm,
  ModuleToggle,
  TenantStatusSelect,
} from "./controls";
import {
  AllotmentForm,
  EntryEditRow,
  ManualLogForm,
  TimerControls,
} from "../../retainers/controls";
import { getLedgerIntegrity } from "@/modules/accounting/core";
import { formatCents } from "@/modules/accounting/lib/money";
import { loadRetainerView } from "@/lib/retainer";
import {
  formatMinutesAsHours,
  todayInRetainerTz,
} from "@/lib/retainer-core";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await withSystem(async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, id),
    });
    if (!tenant) return null;

    const [allModules, tenantMods, subscription, notes, audit, members, discoveries, retainerView, timeEntries] =
      await Promise.all([
        tx.query.modules.findMany({ orderBy: asc(schema.modules.sortOrder) }),
        tx.query.tenantModules.findMany({
          where: eq(schema.tenantModules.tenantId, tenant.id),
        }),
        tx.query.subscriptions.findFirst({
          where: eq(schema.subscriptions.tenantId, tenant.id),
        }),
        tx.query.tenantNotes.findMany({
          where: eq(schema.tenantNotes.tenantId, tenant.id),
          orderBy: desc(schema.tenantNotes.createdAt),
          limit: 20,
        }),
        tx.query.auditLog.findMany({
          where: eq(schema.auditLog.tenantId, tenant.id),
          orderBy: desc(schema.auditLog.createdAt),
          limit: 15,
        }),
        tx
          .select({
            membership: schema.memberships,
            profile: schema.profiles,
          })
          .from(schema.memberships)
          .innerJoin(
            schema.profiles,
            eq(schema.memberships.profileId, schema.profiles.id),
          )
          .where(eq(schema.memberships.tenantId, tenant.id)),
        tx.query.audits.findMany({
          where: eq(schema.audits.tenantId, tenant.id),
          orderBy: desc(schema.audits.updatedAt),
        }),
        loadRetainerView(tx, tenant.id),
        tx.query.retainerTimeEntries.findMany({
          where: eq(schema.retainerTimeEntries.tenantId, tenant.id),
          orderBy: [
            desc(schema.retainerTimeEntries.workDate),
            desc(schema.retainerTimeEntries.createdAt),
          ],
          limit: 15,
        }),
      ]);

    // Read-only ledger health check (the "withSystem never writes
    // accounting rows" rule is untouched — this only reads).
    const accountingEnabled = tenantMods.some(
      (m) => m.moduleId === "accounting" && m.enabled,
    );
    const ledgerIntegrity = accountingEnabled
      ? await getLedgerIntegrity(tx, tenant.id)
      : null;

    return { tenant, allModules, tenantMods, subscription, notes, audit, members, discoveries, ledgerIntegrity, retainerView, timeEntries };
  });

  if (!data) notFound();
  const { tenant, allModules, tenantMods, subscription, notes, audit, members, discoveries, ledgerIntegrity, retainerView, timeEntries } =
    data;
  const today = todayInRetainerTz();
  const isProspect = !tenant.clerkOrgId;

  const enabledBySlug = new Map(
    tenantMods.map((tm) => [tm.moduleId, tm.enabled]),
  );

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All clients
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {tenant.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="capitalize">{tenant.industry}</span>
            {tenant.contactName && (
              <>
                <span>·</span>
                <span>{tenant.contactName}</span>
              </>
            )}
            <span>·</span>
            <span>
              {isProspect ? "Added" : "Client since"}{" "}
              {tenant.createdAt.toLocaleDateString()}
            </span>
            <TenantStatusBadge status={tenant.status} />
          </div>
        </div>
        <TenantStatusSelect tenantId={tenant.id} status={tenant.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Discovery</CardTitle>
              <CardDescription>
                Audit engagements for this business — the conversation, the
                health check, the build spec.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {discoveries.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No discovery yet.
                </p>
              )}
              {discoveries.map((d) => (
                <Link
                  key={d.id}
                  href={`/admin/audits/${d.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/60"
                >
                  <span>
                    Started {d.createdAt.toLocaleDateString()}
                    {d.report && " · report ready"}
                  </span>
                  <Badge variant="secondary" className="capitalize">
                    {d.status.replace("_", " ")}
                  </Badge>
                </Link>
              ))}
              <Button asChild variant="secondary" size="sm">
                <Link href={`/admin/audits/new?tenant=${tenant.id}`}>
                  Start discovery
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Modules</CardTitle>
              <CardDescription>
                Switch capabilities on and off for this client. &ldquo;Coming
                soon&rdquo; modules are named, empty slots — sellable, not yet
                built.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              {allModules.map((mod) => {
                const implemented = !!moduleRegistry[mod.id];
                const available = mod.status === "available" && implemented;
                return (
                  <div
                    key={mod.id}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{mod.name}</span>
                        {!available && (
                          <Badge variant="outline" className="text-xs">
                            coming soon
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {mod.description}
                      </p>
                    </div>
                    <ModuleToggle
                      tenantId={tenant.id}
                      moduleId={mod.id}
                      enabled={enabledBySlug.get(mod.id) ?? false}
                      available={available}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Retainer</CardTitle>
              <CardDescription>
                Monthly included hours and your logged work. The client sees
                the meter and every note on their Hours page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium">
                    {formatMinutesAsHours(retainerView.usage.usedMinutes)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    of {formatMinutesAsHours(retainerView.usage.includedMinutes)}{" "}
                    used this month ·{" "}
                    {formatMinutesAsHours(
                      retainerView.usage.purchasedMinutesRemaining,
                    )}{" "}
                    purchased left
                  </span>{" "}
                  {retainerView.usage.isOver ? (
                    <Badge variant="destructive">
                      Over by{" "}
                      {formatMinutesAsHours(
                        retainerView.usage.unpaidOverageMinutes,
                      )}
                    </Badge>
                  ) : retainerView.usage.isNearLimit ? (
                    <Badge variant="outline">Near limit</Badge>
                  ) : null}
                </div>
                <AllotmentForm
                  tenantId={tenant.id}
                  includedHours={retainerView.usage.includedMinutes / 60}
                />
              </div>
              <Separator />
              <TimerControls
                tenantId={tenant.id}
                timerStartedAt={
                  retainerView.retainer?.timerStartedAt?.toISOString() ?? null
                }
                timerNote={retainerView.retainer?.timerNote ?? null}
              />
              <Separator />
              <ManualLogForm tenantId={tenant.id} today={today} />
              {timeEntries.length > 0 && (
                <>
                  <Separator />
                  <div className="divide-y">
                    {timeEntries.map((entry) => (
                      <EntryEditRow key={entry.id} entry={entry} today={today} />
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
              <CardDescription>
                Private CRM notes — never visible to the client.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AddNoteForm tenantId={tenant.id} />
              <Separator />
              <ul className="space-y-3">
                {notes.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    No notes yet.
                  </li>
                )}
                {notes.map((note) => (
                  <li key={note.id} className="rounded-md bg-muted/60 p-3">
                    <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {note.createdAt.toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {isProspect && (
            <Card className="border-brand/40">
              <CardHeader>
                <CardTitle className="text-base">Prospect</CardTitle>
                <CardDescription>
                  CRM record only — no platform workspace yet. Converting
                  creates their login workspace and keeps all history.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ConvertProspectForm
                  tenantId={tenant.id}
                  contactEmail={tenant.contactEmail}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subscription</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <SubscriptionStatusBadge
                  status={subscription?.status ?? "none"}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Plan</span>
                <span>{subscription?.planName ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Renews</span>
                <span>
                  {subscription?.currentPeriodEnd
                    ? subscription.currentPeriodEnd.toLocaleDateString()
                    : "—"}
                </span>
              </div>
              <p className="pt-2 text-xs text-muted-foreground">
                Billing state syncs automatically from Stripe. The client
                manages payment from their dashboard&apos;s Billing page.
              </p>
            </CardContent>
          </Card>

          {ledgerIntegrity && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ledger integrity</CardTitle>
                <CardDescription>
                  Independent check that the books balance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Books</span>
                  {ledgerIntegrity.balanced ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">
                      Balanced
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      Off by {formatCents(Math.abs(ledgerIntegrity.totalCents))}
                    </Badge>
                  )}
                </div>
                {ledgerIntegrity.unbalancedEntries.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-destructive">
                      Unbalanced entries:
                    </p>
                    {ledgerIntegrity.unbalancedEntries.map((e) => (
                      <p key={e.entryId} className="font-mono text-xs text-muted-foreground">
                        {e.entryId} ({formatCents(Math.abs(e.balanceCents))})
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">People</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {members.length === 0 && (
                  <li className="text-muted-foreground">
                    No members yet — the owner hasn&apos;t accepted the invite.
                  </li>
                )}
                {members.map(({ membership, profile }) => (
                  <li
                    key={membership.id}
                    className="flex items-center justify-between"
                  >
                    <span>{profile.name ?? profile.email}</span>
                    <Badge variant="secondary" className="capitalize">
                      {membership.role}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {audit.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    Nothing logged yet.
                  </li>
                )}
                {audit.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <span className="font-mono">{entry.action}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {entry.createdAt.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
