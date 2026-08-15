import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, ChevronLeft, Lock, Plus, User } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { CrmNav } from "@/modules/crm/components/crm-nav";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CrmError } from "@/modules/crm/core/errors";
import { loadRecord } from "@/modules/crm/party-ops";
import { listDealsForParty } from "@/modules/crm/deal-ops";
import {
  listActivitiesForParty,
  listTasksForParty,
  loadTimeline,
} from "@/modules/crm/timeline-ops";
import { listContactPoints } from "@/lib/parties/contacts";
import { ContactPoints } from "@/modules/crm/components/contact-points";
import { RecordAccess } from "@/modules/crm/components/record-access";
import { NoteExtractor } from "@/modules/crm/components/note-extractor";
import { listCollaborators } from "@/modules/crm/collaborator-ops";
import { Timeline } from "@/modules/crm/components/timeline";
import {
  AddTaskButton,
  LogActivityButton,
} from "@/modules/crm/components/timeline-controls";
import { RecordForm } from "@/modules/crm/components/record-form";
import {
  AddAffiliationButton,
  AdoptButton,
  ArchiveButton,
  EndAffiliationButton,
} from "@/modules/crm/components/record-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

export default async function RecordPage({
  params,
}: {
  params: Promise<{ partyId: string }>;
}) {
  const { partyId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  // `{ role: ctx.role }` is what lets RLS decide whether the CRM half of a
  // restricted record comes back at all. A staff member gets the identity and a
  // null `details`, which is indistinguishable from "never worked in CRM" — the
  // same deliberate ambiguity the mail template values have.
  const record = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      ...(await loadRecord(tx, ctx.tenant.id, partyId)),
      deals: await listDealsForParty(tx, ctx.tenant.id, partyId),
      contactPoints: await listContactPoints(tx, ctx.tenant.id, partyId),
      // Narrow by policy: an owner gets every grant, anybody else gets only
      // their own — so this is safe to load unconditionally and the panel
      // below decides whether it is worth showing.
      collaborators: await listCollaborators(tx, ctx.tenant.id, partyId),
      timeline: await loadTimeline(tx, ctx.tenant.id, partyId),
      activities: await listActivitiesForParty(tx, ctx.tenant.id, partyId),
      tasks: await listTasksForParty(tx, ctx.tenant.id, partyId),
      // In the caller's own transaction, so the picker can only ever offer
      // people this person could already find.
      members: await listAssignableMembers(tx, ctx.tenant.id),
    }),
    { role: ctx.role, userId: ctx.userId },
  ).catch((err) => {
    // A record in another tenant and a record that does not exist are the same
    // answer, because RLS removed it before this code ran. 404, never 403.
    if (err instanceof CrmError && err.code === "RECORD_NOT_FOUND") notFound();
    throw err;
  });

  const {
    party,
    details,
    affiliations,
    fieldDefs,
    deals,
    contactPoints,
    collaborators,
    timeline,
    activities,
    tasks,
    isCustomer,
    isVendor,
  } = record;
  const isOwner = ctx.role === "owner";
  const current = affiliations.filter((a) => !a.affiliation.endedOn);
  const former = affiliations.filter((a) => a.affiliation.endedOn);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        All records
      </Link>

      <PageHeader
        title={party.displayName}
        icon={party.kind === "person" ? <User /> : <Building2 />}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {isCustomer && <Badge variant="secondary">Customer</Badge>}
            {isVendor && <Badge variant="secondary">Vendor</Badge>}
            {!party.isActive && <Badge variant="outline">Archived</Badge>}
            {details?.visibility === "restricted" && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                Restricted
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            {!details && <AdoptButton partyId={party.id} />}
            <ArchiveButton
              partyId={party.id}
              partyVersion={party.version}
              isActive={party.isActive}
            />
          </>
        }
      />

      <CrmNav />

      {!details ? (
        <Panel>
          <EmptyState
            icon={party.kind === "person" ? <User /> : <Building2 />}
            title={isOwner ? "Not in the CRM yet" : "Nothing to show here"}
            description={
              isOwner
                ? "Add it to track a stage, notes and connections."
                : "You can see who this is, but not what the CRM holds on them — either nobody has worked this record yet, or it is restricted."
            }
            action={isOwner ? <AdoptButton partyId={party.id} /> : undefined}
          />
        </Panel>
      ) : (
        <>
          <RecordForm
            mode="edit"
            partyId={party.id}
            partyVersion={party.version}
            detailsVersion={details.version}
            isOwner={isOwner}
            fieldDefs={fieldDefs}
            // Stored values may include ids whose definition has since been
            // archived. They are passed through untouched and simply not
            // rendered — the write path merges rather than replaces, so an
            // unrelated save cannot drop them.
            initialCustom={(details.custom ?? {}) as Record<string, unknown>}
            initial={{
              kind: party.kind,
              displayName: party.displayName,
              givenName: party.givenName ?? "",
              familyName: party.familyName ?? "",
              legalName: party.legalName ?? "",
              lifecycleStage: details.lifecycleStage,
              source: details.source,
              notes: details.notes,
              visibility: details.visibility,
            }}
          />

          <Separator />

          <ContactPoints partyId={party.id} points={contactPoints} />

          {/*
            Only where it means something: a restricted record, seen by an
            owner. On a `members` record everybody can already see everything,
            so the panel would be a control that does nothing.
          */}
          {isOwner && details.visibility === "restricted" && (
            <>
              <Separator />
              <RecordAccess
                partyId={party.id}
                collaborators={collaborators}
                members={record.members.map((m) => ({
                  clerkUserId: m.clerkUserId,
                  label: memberLabel(m),
                  role: m.role,
                }))}
              />
            </>
          )}

          <Separator />

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">Timeline</h2>
                <p className="text-xs text-muted-foreground">
                  What was said, and what still has to happen.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <NoteExtractor
                  partyId={party.id}
                  members={record.members.map((m) => ({
                    clerkUserId: m.clerkUserId,
                    label: memberLabel(m),
                  }))}
                />
                <LogActivityButton partyId={party.id} />
                <AddTaskButton
                  partyId={party.id}
                  members={record.members.map((m) => ({
                    clerkUserId: m.clerkUserId,
                    label: memberLabel(m),
                  }))}
                  currentUserId={ctx.userId}
                />
              </div>
            </div>

            <Timeline
              items={timeline.items}
              activities={activities}
              tasks={tasks}
              partyId={party.id}
              // The same members the add dialog already offers, now also on
              // each follow-up — so reassigning one no longer means opening
              // Work.
              members={record.members.map((m) => ({
                clerkUserId: m.clerkUserId,
                label: memberLabel(m),
              }))}
              revalidate={`/dashboard/m/crm/records/${party.id}`}
            />
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">Deals</h2>
                <p className="text-xs text-muted-foreground">
                  Work in front of this record, and what came of it.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`${BASE}/records/${party.id}/deals/new`}>
                  <Plus className="mr-2 size-4" />
                  Add a deal
                </Link>
              </Button>
            </div>

            {deals.length === 0 ? (
              <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
                No deals yet.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {deals.map(({ deal, stage }) => (
                  <li
                    key={deal.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`${BASE}/deals/${deal.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {deal.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {deal.amountCents === null
                          ? "No amount yet"
                          : `$${formatCents(deal.amountCents)}`}
                      </p>
                    </div>
                    <Badge
                      variant={stage.outcome === "open" ? "secondary" : "outline"}
                    >
                      {stage.name}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">Connections</h2>
                <p className="text-xs text-muted-foreground">
                  {party.kind === "person"
                    ? "Where this person works, and where they used to."
                    : "Who works here, and who used to."}
                </p>
              </div>
              <AddAffiliationButton partyId={party.id} partyKind={party.kind} />
            </div>

            {affiliations.length === 0 ? (
              <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
                No connections yet.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {[...current, ...former].map(({ affiliation, counterparty }) => (
                  <li
                    key={affiliation.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`${BASE}/records/${counterparty.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {counterparty.displayName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {affiliation.title || "No role recorded"}
                        {affiliation.endedOn && ` · until ${affiliation.endedOn}`}
                      </p>
                    </div>
                    {affiliation.isPrimary && !affiliation.endedOn && (
                      <Badge variant="secondary">Primary</Badge>
                    )}
                    {!affiliation.endedOn && (
                      <EndAffiliationButton
                        affiliationId={affiliation.id}
                        expectedVersion={affiliation.version}
                        partyId={party.id}
                        counterpartyName={counterparty.displayName}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
