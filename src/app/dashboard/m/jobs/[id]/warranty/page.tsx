import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatMoney } from "@/lib/money";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { todayInTimezone } from "@/lib/timezone";
import { Panel } from "@/components/app/panel";
import { StatusBadge, type StatusTone } from "@/packs/jobs/components/status-badge";
import { getDefaultCostCodeSet, getProject, jobCostRows, listCommitments, listCostCodes } from "@/packs/jobs/ops";
import { listClaims, type ClaimRow } from "@/packs/jobs/warranty-ops";
import { listBackChargesForProject } from "@/packs/jobs/back-charges-ops";
import { claimsSentence, monthsWord, periodSentence, summariseClaims, warrantyStanding, type WarrantyState } from "@/packs/jobs/warranty-math";
import {
  ClaimDecisionDialog,
  ClaimDialog,
  ClaimDoneCheckbox,
  ClaimScheduleDialog,
  DeleteClaimButton,
  WarrantyPeriodDialog,
} from "@/packs/jobs/components/warranty-forms";
import {
  CLAIM_STANDING_LABELS,
  PACK,
  WARRANTY_DECISION_LABELS,
  type ClaimStanding,
  type WarrantyDecision,
} from "@/packs/jobs/vocabulary";

/**
 * A job's warranty (ADR 0076): the period — months from substantial
 * completion, the end date derived — and the claims that come in after the
 * job is done, each with where it stands. A claim's work is an ordinary
 * Work item linked to the claim; the tick here and the tick in Work are one
 * fact. The money is the job's: what was spent under the claims' cost codes
 * is read from the job cost report, never kept here.
 */

const STANDING_TONES: Record<ClaimStanding, StatusTone> = {
  open: "pending",
  scheduled: "info",
  done: "good",
  not_covered: "quiet",
};

const PERIOD_TONES: Record<WarrantyState, StatusTone> = {
  unset: "quiet",
  not_started: "info",
  running: "good",
  expiring: "pending",
  expired: "quiet",
};

const PERIOD_WORDS: Record<WarrantyState, string> = {
  unset: "No period",
  not_started: "Not started",
  running: "Under warranty",
  expiring: "Ending soon",
  expired: "Ended",
};

/** Open and scheduled first, newest first within each; done and not covered after. */
function byAttention(a: ClaimRow, b: ClaimRow): number {
  const live = (r: ClaimRow) => (r.standing === "open" || r.standing === "scheduled" ? 0 : 1);
  return live(a) - live(b) || b.claim.number - a.claim.number;
}

export default async function WarrantyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const symbol = ctx.tenant.currencySymbol;
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const setId = project.costCodeSetId ?? (await getDefaultCostCodeSet(tx, ctx.tenant.id))?.id ?? null;
      const [claims, backCharges, parties, orders, codes, pack] = await Promise.all([
        listClaims(tx, ctx.tenant.id, project),
        listBackChargesForProject(tx, ctx.tenant.id, project.id),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        listCommitments(tx, ctx.tenant.id, project.id),
        setId ? listCostCodes(tx, ctx.tenant.id, setId) : Promise.resolve([]),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      // The job cost report is read only when a claim names a code: it is the heavier query on the page.
      const codeIds = new Set(claims.map((c) => c.claim.costCodeId).filter((x): x is string => x !== null));
      const costRows = codeIds.size > 0 ? (await jobCostRows(tx, ctx.tenant.id, project.id)).filter((r) => codeIds.has(r.costCodeId)) : [];
      return { project, claims, backCharges, parties, orders, codes, costRows, labels: pack.labels };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, claims } = data;
  const canEdit = allowsWrite(ctx.role, "member");
  const isOwner = allowsWrite(ctx.role, "owner");
  const projectWord = labelFor(data.labels, "project", "Project");
  const period = { substantialCompletionOn: project.substantialCompletionOn, warrantyMonths: project.warrantyMonths };
  const standing = warrantyStanding(period, today);
  const counts = summariseClaims(claims.map((c) => c.standing));
  const onJob = new Set(data.orders.map((o) => o.commitment.partyId));
  const partyOptions = data.parties
    .map((p) => ({ id: p.id, name: p.name, onJob: onJob.has(p.id) }))
    .sort((a, b) => Number(b.onJob) - Number(a.onJob) || a.name.localeCompare(b.name));
  const codeOptions = data.codes.map((c) => ({ id: c.id, label: `${c.code} ${c.name}` }));
  const spentCents = data.costRows.reduce((s, r) => s + r.actualCents, 0);
  /** What has been charged back to the trade for each claim (ADR 0077), by claim. */
  const chargedBack = new Map<string, { amountCents: number; deducted: boolean }>();
  for (const b of data.backCharges) {
    const claimId = b.backCharge.warrantyClaimId;
    if (!claimId || b.standing === "void") continue;
    const seen = chargedBack.get(claimId) ?? { amountCents: 0, deducted: true };
    chargedBack.set(claimId, {
      amountCents: seen.amountCents + b.backCharge.amountCents,
      deducted: seen.deducted && b.standing === "deducted",
    });
  }
  const sorted = [...claims].sort(byAttention);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-heading">Warranty</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{`${projectWord} ${project.number} · ${periodSentence(period, standing)} ${claimsSentence(counts)}`}</p>
        </div>
        {canEdit && <ClaimDialog projectId={project.id} today={today} parties={partyOptions} codes={codeOptions} />}
      </div>

      <Panel className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">The period</h2>
          {isOwner && <WarrantyPeriodDialog projectId={project.id} warrantyMonths={project.warrantyMonths} substantialCompletionOn={project.substantialCompletionOn} />}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Substantial completion</dt>
            <dd className="mt-0.5">{project.substantialCompletionOn ?? <span className="text-muted-foreground">Not set</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Warranty</dt>
            <dd className="mt-0.5">{project.warrantyMonths !== null ? monthsWord(project.warrantyMonths) : <span className="text-muted-foreground">Not set</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ends</dt>
            <dd className="mt-0.5">{standing.expiresOn ?? <span className="text-muted-foreground">—</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Standing</dt>
            <dd className="mt-0.5">
              <StatusBadge tone={PERIOD_TONES[standing.state]}>{PERIOD_WORDS[standing.state]}</StatusBadge>
            </dd>
          </div>
        </dl>
        {standing.state === "unset" && (
          <p className="mt-3 text-xs text-muted-foreground">
            {isOwner
              ? "Set the months and the day the job was substantially complete, and every claim will say whether it came in inside the period."
              : "No period has been set. An owner sets the months and the completion date."}
          </p>
        )}
        {data.costRows.length > 0 && (
          <p className="mt-3 text-sm">
            <span className="font-medium tabular-nums">{formatMoney(spentCents, symbol)}</span>
            <span className="text-muted-foreground">
              {" "}
              spent under the claims&apos; cost {data.costRows.length === 1 ? "code" : "codes"} ({data.costRows.map((r) => r.code).join(", ")}) — from the job cost report, which is where the bills land.
            </span>
          </p>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">Claims</h2>
          <span className="text-xs text-muted-foreground">Open first, then the rest, newest first</span>
        </div>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No claims yet. When the owner calls about something after the job is done, record it here: the call goes on record and a work item is raised to go and look.
          </p>
        ) : (
          <div className="relative w-full min-w-0 overflow-x-auto">
            <table className="w-full min-w-[64rem] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-2 py-1.5 text-left">No.</th>
                  <th className="min-w-[18rem] px-2 py-1.5 text-left">What</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-left">Reported</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-left">Trade</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-left">Cost code</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-left">Standing</th>
                  <th className="min-w-[12rem] px-2 py-1.5 text-left">Decision</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const c = row.claim;
                  const decision = c.decision as WarrantyDecision;
                  return (
                    <tr key={c.id} id={`claim-${c.id}`} className="border-t align-top">
                      <td className="px-2 py-1.5 tabular-nums">
                        <div className="flex items-center gap-2">
                          {canEdit && <ClaimDoneCheckbox projectId={project.id} id={c.id} number={c.number} done={row.standing === "done"} disabled={row.standing === "not_covered"} />}
                          <span>{c.number}</span>
                        </div>
                      </td>
                      <td className="min-w-[18rem] px-2 py-1.5">
                        <span className={row.standing === "done" || row.standing === "not_covered" ? "text-muted-foreground" : "font-medium"}>{c.title}</span>
                        {(c.location || c.notes) && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{[c.location || null, c.notes || null].filter(Boolean).join(" · ")}</p>
                        )}
                        {(() => {
                          const back = chargedBack.get(c.id);
                          if (!back) return null;
                          return (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatMoney(back.amountCents, symbol)} charged back to the trade
                              {back.deducted ? "" : ", not yet deducted"}
                            </p>
                          );
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {c.reportedOn}
                        {c.reportedBy && <p className="text-xs text-muted-foreground">by {c.reportedBy}</p>}
                        {row.withinWarranty === false && <p className="text-xs text-destructive">Outside the warranty period</p>}
                      </td>
                      <td className="min-w-[8rem] px-2 py-1.5">{row.partyName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.codeLabel ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-1.5">
                        <StatusBadge tone={STANDING_TONES[row.standing]}>{CLAIM_STANDING_LABELS[row.standing]}</StatusBadge>
                        {row.work?.dueOn && row.standing === "scheduled" && <p className="mt-0.5 text-xs text-muted-foreground">{row.work.dueOn}</p>}
                        {!row.work && row.standing !== "not_covered" && <p className="mt-0.5 text-xs text-muted-foreground">No work item — cleared in Work</p>}
                      </td>
                      <td className="px-2 py-1.5">
                        {decision === "pending" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <StatusBadge tone={decision === "covered" ? "good" : "quiet"}>{WARRANTY_DECISION_LABELS[decision]}</StatusBadge>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {c.decidedOn}
                              {c.decisionNote ? ` · ${c.decisionNote}` : ""}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        {canEdit && (
                          <div className="flex items-center justify-end gap-0.5">
                            {row.standing !== "not_covered" && (
                              <ClaimScheduleDialog projectId={project.id} claim={{ id: c.id, number: c.number, dueOn: row.work?.dueOn ?? null }} />
                            )}
                            <ClaimDecisionDialog
                              projectId={project.id}
                              today={today}
                              claim={{ id: c.id, number: c.number, decision, decisionNote: c.decisionNote, decidedOn: c.decidedOn }}
                            />
                            <ClaimDialog
                              key={`${c.id}:${c.version}`}
                              projectId={project.id}
                              today={today}
                              parties={partyOptions}
                              codes={codeOptions}
                              existing={{
                                id: c.id,
                                version: c.version,
                                number: c.number,
                                title: c.title,
                                location: c.location,
                                reportedOn: c.reportedOn,
                                reportedBy: c.reportedBy,
                                partyId: c.partyId,
                                costCodeId: c.costCodeId,
                                notes: c.notes,
                              }}
                            />
                            {isOwner && <DeleteClaimButton projectId={project.id} id={c.id} number={c.number} />}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
