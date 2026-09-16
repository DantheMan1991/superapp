import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  FileDiff,
  FileText,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import {
  contractBilling,
  getProject,
  jobCostReport,
  listChangeOrders,
  listContracts,
} from "@/packs/jobs/ops";
import { projectVitals } from "@/packs/jobs/vitals-ops";
import { listDailyLogs, listPunchItems } from "@/packs/jobs/field-ops";
import { selectionSummary } from "@/packs/jobs/selections-ops";
import { lapsedCertificatesForProject, waiverGaps } from "@/packs/jobs/compliance-ops";
import { listPhases } from "@/packs/jobs/schedule-ops";
import { PunchList } from "@/packs/jobs/components/punch-list";
import { StatusBadge, type StatusTone } from "@/packs/jobs/components/status-badge";
import { decisionsFor, type Decision, type DecisionKind } from "@/packs/jobs/decisions";
import { contractSummary } from "@/packs/jobs/contract-math";
import { barWidthPercent, spentOfBudgetPpm } from "@/packs/jobs/cost-math";
import {
  BILLING_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  PACK,
  PROJECT_DIMENSION,
  isBillingMethod,
  isContractStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";

/**
 * Overview: what this job needs somebody to do, and where it stands.
 *
 * ── THIS PAGE USED TO BE THE WHOLE MODULE ───────────────────────────────────
 *
 * Eleven `<Panel>`s stacked flat with no in-page navigation. `2a` gave the job
 * a section strip and moved the heavyweight panels to routes of their own; this
 * is the second half of that slice, which the strip shipped without: the two
 * columns the design actually drew.
 *
 * ── LEFT IS WHAT TO DO, RIGHT IS WHAT IT IS ─────────────────────────────────
 *
 * The left column is the working column — the decisions, then the money by
 * code, then the agreements behind it. The right rail is reference: who it is
 * for, what is coming, what is open, what happened. That split is the whole
 * point of two columns rather than one longer page, so a panel that answers
 * "what should I do" belongs on the left and one that answers "what is this"
 * belongs on the right.
 *
 * The summary panels for Estimates, Selections, Drawings and Cost codes are
 * gone from here: each has a tab of its own now, and a summary of a screen one
 * click away is a second place for the same figure to be wrong.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "jobs");
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [
        vitals,
        entity,
        enterprise,
        set,
        member,
        pack,
        costReport,
        contracts,
        changeOrders,
        billing,
        selections,
        gaps,
        certificates,
        phases,
        punch,
        days,
      ] = await Promise.all([
        /*
         * The same read the layout runs for the strip. A layout and a page get
         * their own renders and their own transactions, so this is a second
         * execution rather than a cached one — worth it, because the
         * over-billed decision has to be measured the SAME way the strip above
         * measures it, and `measureProject` is where that lives.
         */
        projectVitals(tx, ctx.tenant.id, project.id),
        tx
          .select({ name: schema.entities.name })
          .from(schema.entities)
          .where(
            and(
              eq(schema.entities.tenantId, ctx.tenant.id),
              eq(schema.entities.id, project.entityId),
            ),
          )
          .limit(1),
        project.enterpriseId
          ? tx
              .select({ name: schema.enterprises.name })
              .from(schema.enterprises)
              .where(
                and(
                  eq(schema.enterprises.tenantId, ctx.tenant.id),
                  eq(schema.enterprises.id, project.enterpriseId),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        project.costCodeSetId
          ? tx
              .select({ name: schema.jobCostCodeSets.name })
              .from(schema.jobCostCodeSets)
              .where(
                and(
                  eq(schema.jobCostCodeSets.tenantId, ctx.tenant.id),
                  eq(schema.jobCostCodeSets.id, project.costCodeSetId),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        tx
          .select({
            displayName: schema.dimensionMembers.displayName,
            isActive: schema.dimensionMembers.isActive,
          })
          .from(schema.dimensionMembers)
          .where(
            and(
              eq(schema.dimensionMembers.tenantId, ctx.tenant.id),
              eq(schema.dimensionMembers.dimensionType, PROJECT_DIMENSION),
              eq(schema.dimensionMembers.packEntityId, project.id),
            ),
          )
          .limit(1),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
        jobCostReport(tx, ctx.tenant.id, project.id),
        listContracts(tx, ctx.tenant.id, project.id),
        listChangeOrders(tx, ctx.tenant.id, project.id),
        contractBilling(tx, ctx.tenant.id, project.id),
        selectionSummary(tx, ctx.tenant.id, project.id, today),
        waiverGaps(tx, ctx.tenant.id, project.id),
        lapsedCertificatesForProject(tx, ctx.tenant.id, project.id, today),
        listPhases(tx, ctx.tenant.id, project.id, ctx.tenant.timezone, today),
        listPunchItems(tx, ctx.tenant.id, project.id),
        listDailyLogs(tx, ctx.tenant.id, project.id, { limit: 2 }),
      ]);
      return {
        project,
        vitals,
        entityName: entity[0]?.name ?? "—",
        clientName: vitals?.clientName ?? null,
        enterpriseName: enterprise[0]?.name ?? null,
        setName: set[0]?.name ?? null,
        member: member[0] ?? null,
        labels: pack.labels,
        costRows: costReport.rows,
        uncodedActualCents: costReport.uncodedActualCents,
        contracts,
        changeOrders,
        billing,
        selections,
        gaps,
        certificates,
        phases,
        punch,
        days,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { project, contracts, member } = data;
  const clientWord = labelFor(data.labels, "customer", "Customer");
  const canLog = allowsWrite(ctx.role, "member");
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");
  const symbol = ctx.tenant.currencySymbol;
  const { revisedOf, signedValue, signedCount, changesValue } = contractSummary(
    contracts,
    data.changeOrders,
  );

  /** Proposed and unanswered: not money until the owner says yes. */
  const proposed = data.changeOrders.filter((r) => r.changeOrder.status === "proposed");
  const decisions = decisionsFor({
    projectId: project.id,
    symbol,
    figures:
      data.vitals && data.vitals.valuation.kind === "measured"
        ? data.vitals.valuation.figures
        : null,
    costRows: data.costRows,
    selections: { pending: data.selections.pending, overdue: data.selections.overdue },
    proposedChanges: {
      count: proposed.length,
      cents: proposed.reduce((n, r) => n + r.changeOrder.valueCents, 0),
    },
    paidWaiverGaps: data.gaps.filter((g) => g.paid),
    lapsedCertificates: data.certificates,
  });

  const budgetTotal = data.costRows.reduce((sum, r) => sum + r.budgetCents, 0);
  const orderedOfBudgeted = data.costRows
    .filter((r) => r.hasBudget)
    .reduce((sum, r) => sum + r.committedCents, 0);
  const spentOfBudgeted = data.costRows
    .filter((r) => r.hasBudget)
    .reduce((sum, r) => sum + r.actualCents, 0);
  const budgetChanges = data.costRows.reduce((sum, r) => sum + r.changesCents, 0);

  return (
    /*
      `minmax(0,1fr)` ON THE BASE TRACK TOO, not just at `lg`. Below the
      breakpoint this is a one-column grid, and an implicit column is `auto`:
      it sizes to its CONTENT, so a wide row inside pushed the column past the
      viewport and the whole page scrolled sideways on a phone. The explicit
      track says the column may not exceed its container, and `min-w-0` on each
      column lets their flex children actually shrink inside it.
    */
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_316px]">
      {/* ── The working column ─────────────────────────────────────────── */}
      <div className="min-w-0 space-y-5">
        <Panel className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-medium tracking-heading">
              Needs a decision
            </h2>
            {decisions.length > 0 && (
              <span className="text-sm text-subtle-foreground tabular-nums">
                {decisions.length}
              </span>
            )}
          </div>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing is waiting on anybody. Billing is level with the work, no
              code is over its budget, and nothing is sitting with the client.
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {decisions.map((d) => (
                <DecisionRow key={d.kind} decision={d} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-medium tracking-heading">
              Job cost by code
            </h2>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/cost`}>All codes</Link>
            </Button>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {/*
              "The job is $40k over" is a fact; "the framing is $40k over" is a
              decision, and only the per-code view gets you the second one.
            */}
            {data.costRows.length === 0
              ? "No budget set. Until there is one, committed and actual say what has happened but not whether it was the plan."
              : `Budget ${formatMoneySign(budgetTotal, symbol)} against ${formatMoney(
                  orderedOfBudgeted,
                  symbol,
                )} ordered and ${formatMoney(spentOfBudgeted, symbol)} spent${
                  budgetChanges !== 0
                    ? `, after ${formatMoneySign(budgetChanges, symbol)} in approved changes`
                    : ""
                }.`}
          </p>
          {data.costRows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-40">Spent of budget</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Left</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.costRows.map((r) => {
                    const ppm = spentOfBudgetPpm(r);
                    const over = r.hasBudget && r.varianceCents < 0;
                    return (
                      <TableRow key={r.costCodeId} className={cn(over && "bg-destructive/5")}>
                        <TableCell className="font-mono text-xs">{r.code}</TableCell>
                        <TableCell className="max-w-[200px] whitespace-normal">
                          {r.name}
                          {!r.hasBudget && (
                            <span className="ml-2 rounded-4xl bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              Not budgeted
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {ppm === null ? (
                            <span className="text-xs text-muted-foreground">
                              No budget to measure against
                            </span>
                          ) : (
                            <>
                              <span
                                className={cn(
                                  "block text-xs tabular-nums",
                                  over ? "font-medium text-destructive" : "text-muted-foreground",
                                )}
                              >
                                {formatMoney(r.actualCents, symbol)} of{" "}
                                {formatMoney(r.budgetCents, symbol)}
                                {r.changesCents !== 0 && " revised"}
                              </span>
                              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <span
                                  className={cn(
                                    "block h-full rounded-full",
                                    over ? "bg-destructive" : "bg-module-accent",
                                  )}
                                  style={{ width: `${barWidthPercent(ppm)}%` }}
                                />
                              </span>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.committedCents, symbol)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            over && "font-medium text-destructive",
                          )}
                        >
                          {r.hasBudget ? formatMoneySign(r.varianceCents, symbol) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Ordered is what this job has committed; spent is what the books have
            been billed for it, by code.
            {data.uncodedActualCents !== 0 && (
              <>
                {" "}
                <span className="font-medium text-foreground">
                  {formatMoney(data.uncodedActualCents, symbol)}
                </span>{" "}
                has been spent with no cost code on the line — it is in the job
                total and in no row here.
              </>
            )}
          </p>
        </Panel>

        <Panel className="p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-medium tracking-heading">
              Contracts
            </h2>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/contracts`}>All contracts</Link>
            </Button>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {contracts.length === 0
              ? "No agreements yet. A job can have several — a design agreement, then drawings, then the build."
              : `Worth ${formatMoneySign(signedValue, symbol)} across ${signedCount} signed ${
                  signedCount === 1 ? "agreement" : "agreements"
                }${
                  changesValue !== 0
                    ? `, including ${formatMoneySign(changesValue, symbol)} in approved changes`
                    : ""
                }.`}
          </p>
          {contracts.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind</TableHead>
                    <TableHead>Billed by</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts.map((c) => {
                    const bill = data.billing.get(c.id);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="max-w-[180px] whitespace-normal font-medium">
                          <Link
                            href={`/dashboard/m/jobs/${project.id}/contracts/${c.id}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {slugLabel(c.kind)}
                          </Link>
                          {c.name && (
                            <span className="block text-xs font-normal text-muted-foreground">
                              {c.name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[140px] whitespace-normal text-xs text-muted-foreground">
                          {isBillingMethod(c.billingMethod)
                            ? BILLING_METHOD_LABELS[c.billingMethod]
                            : slugLabel(c.billingMethod)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoneySign(revisedOf(c), symbol)}
                          {revisedOf(c) !== (c.valueCents ?? 0) && (
                            <span className="block text-xs text-muted-foreground">
                              orig. {formatMoney(c.valueCents ?? 0, symbol)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(bill?.billedCents ?? 0, symbol)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={CONTRACT_TONES[c.status] ?? "quiet"}>
                            {isContractStatus(c.status)
                              ? CONTRACT_STATUS_LABELS[c.status]
                              : c.status}
                          </StatusBadge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      </div>

      {/* ── The reference rail ─────────────────────────────────────────── */}
      <div className="min-w-0 space-y-5">
        <Panel className="p-5">
          <h2 className="mb-3 font-heading text-sm font-medium tracking-heading">
            Details
          </h2>
          <dl className="space-y-1">
            {(
              [
                [clientWord, data.clientName ?? "—"],
                ["Company", data.entityName],
                ["Division", data.enterpriseName ?? "Whole business"],
                [
                  "Kind of work",
                  project.deliveryMethod
                    ? slugLabel(project.deliveryMethod)
                    : "Not decided yet",
                ],
                ["Cost codes", data.setName ?? "No list"],
                ["Starts", project.startsOn ?? "—"],
                ["Ends", project.endsOn ?? "—"],
                /*
                 * SAID OUT LOUD, because nothing else would say it. A project
                 * whose `dimension_members` row failed to write is an entity no
                 * report can group by, and the only other way to notice is a
                 * report quietly missing a column.
                 */
                [
                  "Charged to",
                  member
                    ? `${member.displayName}${member.isActive ? "" : " (archived)"}`
                    : "Not a cost object — this should not happen; tell us",
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 py-1">
                <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
                <dd className="text-right text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {project.notes && (
            <p className="mt-3 border-t border-divider pt-3 text-sm whitespace-pre-wrap text-muted-foreground">
              {project.notes}
            </p>
          )}
        </Panel>

        <Panel className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-medium tracking-heading">
              Next on the schedule
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/schedule`}>All</Link>
            </Button>
          </div>
          {(() => {
            // Not done, soonest first — the same rule the board's card follows.
            const next = data.phases
              .filter((p) => p.phase.status !== "done")
              .slice(0, 3);
            if (next.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  Nothing scheduled. A phase is a stretch of work with dates, and
                  it lands on the company calendar.
                </p>
              );
            }
            return (
              <ul className="space-y-2.5">
                {next.map((p) => (
                  <li key={p.phase.id} className="flex gap-3">
                    <span
                      className={cn(
                        "w-16 shrink-0 text-xs tabular-nums",
                        p.overdue ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {p.startOn}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{p.phase.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.phase.kind === "milestone"
                          ? "Milestone"
                          : `${p.durationDays} ${p.durationDays === 1 ? "day" : "days"} · ${p.phase.status}`}
                        {p.overdue && <span className="text-destructive"> · overdue</span>}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Panel>

        <Panel className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-medium tracking-heading">
              Punch list
            </h2>
            <span className="text-xs text-subtle-foreground">
              {data.punch.filter((p) => p.completedAt === null).length} open
            </span>
          </div>
          <PunchList
            projectId={project.id}
            canEdit={canLog}
            items={data.punch.map((p) => ({
              id: p.id,
              title: p.title,
              notes: p.notes,
              dueOn: p.dueOn,
              done: p.completedAt !== null,
            }))}
          />
        </Panel>

        <Panel className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-medium tracking-heading">
              Last days logged
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/log`}>All</Link>
            </Button>
          </div>
          {data.days.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No days logged yet.
              {!documentsOn && " Photos need Documents switched on."}
            </p>
          ) : (
            <ul className="space-y-3">
              {data.days.map((day) => (
                <li key={day.log.id}>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {day.log.logDate}
                    {day.crews.length > 0 &&
                      ` · ${day.crews.reduce((n, c) => n + c.workers, 0)} on site`}
                  </p>
                  {day.log.notes && (
                    <p className="mt-0.5 line-clamp-3 text-sm">{day.log.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Kept beside the rows it colours, as on the Contracts tab. */
const CONTRACT_TONES: Record<string, StatusTone> = {
  signed: "good",
  complete: "good",
  proposed: "pending",
  declined: "quiet",
  cancelled: "quiet",
};

const DECISION_ICONS: Record<DecisionKind, typeof AlertTriangle> = {
  over_billed: TrendingUp,
  code_over: AlertTriangle,
  selection_overdue: Clock,
  selection_pending: Clock,
  change_proposed: FileDiff,
  waiver_gap: FileText,
  certificate: ShieldAlert,
};

function DecisionRow({ decision }: { decision: Decision }) {
  const Icon = DECISION_ICONS[decision.kind] ?? ClipboardList;
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          decision.severity === "bad" ? "text-destructive" : "text-warning-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{decision.title}</p>
        <p className="text-xs text-muted-foreground">{decision.why}</p>
      </div>
      <Button variant="outline" size="sm" asChild className="shrink-0 whitespace-nowrap">
        <Link href={decision.action.href}>{decision.action.label}</Link>
      </Button>
    </li>
  );
}
