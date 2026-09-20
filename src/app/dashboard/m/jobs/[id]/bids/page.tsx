import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft, HardHat } from "lucide-react";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { packContext } from "@/lib/packs/tenant-context";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { getProject, listCostCodes } from "@/packs/jobs/ops";
import { listBidPackages } from "@/packs/jobs/bids-ops";
import { interviewGateFrom } from "@/packs/jobs/interview-gate";
import { PACK } from "@/packs/jobs/vocabulary";
import {
  AwardBidButton,
  CloseBidPackageButton,
  CopyBidLinkButton,
  InviteButton,
  NewBidPackageButton,
  RevokeBidLinkButton,
} from "@/packs/jobs/components/bid-controls";

/**
 * WHAT THIS JOB HAS ASKED SUBCONTRACTORS FOR, AND WHAT THEY SAID (X3).
 *
 * **THE SPREAD IS WHY THIS IS A TABLE AND NOT A NUMBER.** Three prices
 * within a few per cent means the scope is understood and any of them is
 * safe; one at half the others means somebody has read it differently, and
 * that is worth knowing before it is the cheapest bid on the estimate.
 *
 * Behind the interview's gate, so a 404 when the layer is off — the outline
 * screen's rule.
 */
export default async function BidsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const canWrite = allowsWrite(ctx.role, "member");
  const symbol = ctx.tenant.currencySymbol;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK);
      const gate = interviewGateFrom(pack.config);
      if (!gate.available) return { gate, project: null, packages: [], codes: [], parties: [] };
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return { gate, project: null, packages: [], codes: [], parties: [] };
      return {
        gate,
        project,
        packages: await listBidPackages(tx, ctx.tenant.id, project.id),
        codes: project.costCodeSetId
          ? (await listCostCodes(tx, ctx.tenant.id, project.costCodeSetId))
              .filter((c) => c.isActive)
              .map((c) => ({ code: c.code, name: c.name }))
          : [],
        parties: await tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .orderBy(asc(schema.parties.displayName))
          .limit(500),
      };
    },
    { role: ctx.role },
  );
  if (!data.gate.available || !data.project) notFound();

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/m/jobs/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {data.project.number} {data.project.name}
      </Link>

      <PageHeader
        icon={<HardHat />}
        title="Prices from subcontractors"
        description="One scope, the subs you want a number from, and what came back. They answer on a link — no sign-in, and they see only the scope you write."
        actions={
          canWrite ? (
            <NewBidPackageButton projectId={data.project.id} codes={data.codes} />
          ) : null
        }
      />

      {data.packages.length === 0 ? (
        <EmptyState
          icon={<HardHat />}
          title="Nothing out for price yet"
          description="Write a scope, pick the subcontractors you want a number from, and send each of them their link. What comes back sits side by side here."
          action={
            canWrite ? (
              <NewBidPackageButton projectId={data.project.id} codes={data.codes} />
            ) : undefined
          }
        />
      ) : (
        data.packages.map(({ pkg, invitations, summary }) => (
          <Panel key={pkg.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-sm font-medium tracking-heading">
                    {pkg.title}
                  </h2>
                  {pkg.costCode && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {pkg.costCode}
                    </span>
                  )}
                  {pkg.status === "closed" && <Badge variant="secondary">Closed</Badge>}
                  {pkg.dueOn && <Badge variant="outline">Wanted by {pkg.dueOn}</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {summary.asked} asked · {summary.bid} priced
                  {summary.declined > 0 && ` · ${summary.declined} said no`}
                  {summary.opened > 0 && ` · ${summary.opened} looked`}
                  {summary.silent > 0 && ` · ${summary.silent} silent`}
                  {summary.lowestCents !== null &&
                    summary.highestCents !== null &&
                    summary.lowestCents !== summary.highestCents &&
                    ` · ${formatMoney(summary.lowestCents, symbol)} to ${formatMoney(
                      summary.highestCents,
                      symbol,
                    )}`}
                </p>
              </div>
              {canWrite && (
                <div className="flex flex-wrap items-center gap-1">
                  {pkg.status === "open" && (
                    <InviteButton
                      projectId={data.project.id}
                      packageId={pkg.id}
                      parties={data.parties}
                    />
                  )}
                  <CloseBidPackageButton
                    projectId={data.project.id}
                    packageId={pkg.id}
                    status={pkg.status}
                  />
                </div>
              )}
            </div>

            {pkg.scope && (
              <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm text-muted-foreground">
                {pkg.scope}
              </p>
            )}

            {invitations.length === 0 ? (
              <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                Nobody has been asked yet.
              </p>
            ) : (
              <ul className="mt-3 border-t">
                {invitations.map(({ invitation, partyName, standing }) => (
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        {partyName}
                        {invitation.isAwarded && <Badge>Going with this</Badge>}
                        <Badge variant={standing === "bid" ? "secondary" : "outline"}>
                          {standing}
                        </Badge>
                      </p>
                      {invitation.replyNote && (
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                          {invitation.replyNote}
                        </p>
                      )}
                      {invitation.repliedName && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {invitation.repliedName}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {invitation.amountCents !== null && (
                        <p className="text-sm font-medium">
                          {formatMoney(invitation.amountCents, symbol)}
                        </p>
                      )}
                      {canWrite && (
                        <>
                          {invitation.amountCents !== null && !invitation.isAwarded && (
                            <AwardBidButton
                              projectId={data.project.id}
                              invitationId={invitation.id}
                            />
                          )}
                          {standing !== "revoked" && (
                            <CopyBidLinkButton
                              projectId={data.project.id}
                              invitationId={invitation.id}
                            />
                          )}
                          {standing === "waiting" || standing === "opened" ? (
                            <RevokeBidLinkButton
                              projectId={data.project.id}
                              invitationId={invitation.id}
                            />
                          ) : null}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
