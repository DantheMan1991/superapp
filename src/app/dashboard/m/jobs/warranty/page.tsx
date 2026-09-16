import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor, pluralOf } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/packs/jobs/components/status-badge";
import { listClaimsAcrossJobs, listWarrantyPeriods } from "@/packs/jobs/warranty-ops";
import { EXPIRING_WITHIN_DAYS, monthsWord, warrantyStanding, type WarrantyState } from "@/packs/jobs/warranty-math";
import { CLAIM_STANDING_LABELS, PACK, WARRANTY_DECISION_LABELS, type ClaimStanding, type WarrantyDecision } from "@/packs/jobs/vocabulary";

/**
 * Warranty across jobs (ADR 0076): every open claim in the workspace with
 * the job it is on, and every job whose warranty is running — soonest to
 * end first, so the last walk-through gets booked before the period does.
 * Read-only here; the claim is recorded and decided on its job's tab.
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function WarrantyAcrossJobsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [claims, periods, pack] = await Promise.all([
        listClaimsAcrossJobs(tx, ctx.tenant.id),
        listWarrantyPeriods(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return { claims, periods, labels: pack.labels };
    },
    { role: ctx.role },
  );

  const projectWordCap = labelFor(data.labels, "project", "Project");
  const projectsWordCap = pluralOf(projectWordCap, "Project", "Projects");
  const projectWord = projectWordCap.toLowerCase();
  const projectsWord = projectsWordCap.toLowerCase();
  const open = data.claims.filter((c) => c.standing === "open" || c.standing === "scheduled");
  const closed = data.claims.filter((c) => c.standing === "done" || c.standing === "not_covered").slice(0, 10);
  const periods = data.periods.map((p) => ({ ...p, standing: warrantyStanding(p, today) }));
  const running = periods.filter((p) => p.standing.state === "running" || p.standing.state === "expiring");
  const expiring = periods.filter((p) => p.standing.state === "expiring");
  const openJobs = new Set(open.map((c) => c.projectId)).size;

  const description =
    data.claims.length === 0 && periods.length === 0
      ? `Nothing under warranty yet. A ${projectWord}'s Warranty tab holds its period and the claims that come in after it is done.`
      : `${open.length === 0 ? "No open claims" : `${plural(open.length, "open claim", "open claims")} on ${plural(openJobs, projectWord, projectsWord)}`} · ${
          running.length === 0 ? `no ${projectsWord} under warranty` : `${plural(running.length, projectWord, projectsWord)} under warranty`
        }${expiring.length > 0 ? `, ${expiring.length} ending within ${EXPIRING_WITHIN_DAYS} days` : ""}.`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Warranty"
        description={description}
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/m/jobs">
              <ChevronLeft className="mr-1 size-4" /> {projectsWordCap}
            </Link>
          </Button>
        }
      />

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">Open claims</h2>
          <span className="text-xs text-muted-foreground">Newest reported first · recorded and decided on the {projectWord}&apos;s Warranty tab</span>
        </div>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open claims.</p>
        ) : (
          <div className="relative w-full min-w-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">{projectWordCap}</th>
                  <th className="px-2 py-1.5 text-left">No.</th>
                  <th className="px-2 py-1.5 text-left">What</th>
                  <th className="px-2 py-1.5 text-left">Reported</th>
                  <th className="px-2 py-1.5 text-left">Trade</th>
                  <th className="px-2 py-1.5 text-left">Standing</th>
                  <th className="px-2 py-1.5 text-left">Decision</th>
                </tr>
              </thead>
              <tbody>
                {open.map((row) => {
                  const c = row.claim;
                  const decision = c.decision as WarrantyDecision;
                  return (
                    <tr key={c.id} className="border-t align-top">
                      <td className="px-2 py-1.5">
                        <Link href={`/dashboard/m/jobs/${row.projectId}/warranty#claim-${c.id}`} className="font-medium underline-offset-2 hover:underline">
                          {row.projectNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">{row.projectName}</p>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{c.number}</td>
                      <td className="px-2 py-1.5">
                        {c.title}
                        {c.location && <p className="text-xs text-muted-foreground">{c.location}</p>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {c.reportedOn}
                        {c.reportedBy && <p className="text-xs text-muted-foreground">by {c.reportedBy}</p>}
                        {row.withinWarranty === false && <p className="text-xs text-destructive">Outside the warranty period</p>}
                      </td>
                      <td className="px-2 py-1.5">{row.partyName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-1.5">
                        <StatusBadge tone={STANDING_TONES[row.standing]}>{CLAIM_STANDING_LABELS[row.standing]}</StatusBadge>
                        {row.work?.dueOn && <p className="mt-0.5 text-xs text-muted-foreground">{row.work.dueOn}</p>}
                      </td>
                      <td className="px-2 py-1.5">{decision === "pending" ? <span className="text-muted-foreground">—</span> : WARRANTY_DECISION_LABELS[decision]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">Under warranty</h2>
          <span className="text-xs text-muted-foreground">Soonest to end first</span>
        </div>
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {projectWord} has a warranty period set. An owner sets it on the {projectWord}&apos;s Warranty tab: the months, and the day it was substantially complete.</p>
        ) : (
          <div className="relative w-full min-w-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">{projectWordCap}</th>
                  <th className="px-2 py-1.5 text-left">Substantial completion</th>
                  <th className="px-2 py-1.5 text-left">Warranty</th>
                  <th className="px-2 py-1.5 text-left">Ends</th>
                  <th className="px-2 py-1.5 text-left">Standing</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.projectId} className="border-t align-top">
                    <td className="px-2 py-1.5">
                      <Link href={`/dashboard/m/jobs/${p.projectId}/warranty`} className="font-medium underline-offset-2 hover:underline">
                        {p.projectNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">{p.projectName}</p>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{p.substantialCompletionOn}</td>
                    <td className="px-2 py-1.5">{monthsWord(p.warrantyMonths)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{p.expiresOn}</td>
                    <td className="px-2 py-1.5">
                      <StatusBadge tone={PERIOD_TONES[p.standing.state]}>{PERIOD_WORDS[p.standing.state]}</StatusBadge>
                      {p.standing.daysLeft !== null && p.standing.state !== "expired" && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{plural(p.standing.daysLeft, "day", "days")} left</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {closed.length > 0 && (
        <Panel className="p-5">
          <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">Recently closed</h2>
          <ul className="space-y-1 text-sm">
            {closed.map((row) => (
              <li key={row.claim.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/dashboard/m/jobs/${row.projectId}/warranty#claim-${row.claim.id}`} className="font-medium underline-offset-2 hover:underline">
                  {row.projectNumber} · {row.claim.number}
                </Link>
                <span>{row.claim.title}</span>
                <span className="text-xs text-muted-foreground">
                  {row.standing === "not_covered"
                    ? `Not covered ${row.claim.decidedOn}`
                    : `${CLAIM_STANDING_LABELS[row.standing]}${row.claim.decision !== "pending" ? ` · ${WARRANTY_DECISION_LABELS[row.claim.decision as WarrantyDecision].toLowerCase()} ${row.claim.decidedOn}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
