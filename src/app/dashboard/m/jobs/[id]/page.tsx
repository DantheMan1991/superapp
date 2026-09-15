import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
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
import { formatMoney, formatMoneySign } from "@/lib/money";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { todayInTimezone } from "@/lib/timezone";
import { getProject, listContracts, listCostCodes } from "@/packs/jobs/ops";
import { listDailyLogs, listPunchItems } from "@/packs/jobs/field-ops";
import { selectionSummary } from "@/packs/jobs/selections-ops";
import { listEstimates } from "@/packs/jobs/estimating-ops";
import { listPhases, scheduleSummary } from "@/packs/jobs/schedule-ops";
import { drawingsSummary } from "@/packs/jobs/drawings-ops";
import { PunchList } from "@/packs/jobs/components/punch-list";
import { DailyLogForm } from "@/packs/jobs/components/daily-log-form";
import { SelectionForm } from "@/packs/jobs/components/selection-form";
import { PhaseForm } from "@/packs/jobs/components/phase-form";
import { NewEstimateDialog } from "@/packs/jobs/components/estimate-editor";
import { AddDrawingSetDialog } from "@/packs/jobs/components/drawing-set-form";
import {
  ESTIMATE_STATUS_LABELS,
  PACK,
  PROJECT_DIMENSION,
  isEstimateStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";

/**
 * Overview: what the job is, and a look into each of its sections.
 *
 * ── THIS PAGE USED TO BE THE WHOLE MODULE ───────────────────────────────────
 *
 * It was eleven `<Panel>`s stacked flat — Details, Contracts, Change orders,
 * Job cost, Ordered, Estimates, Selections, Drawings, Schedule, On site, Punch
 * list, Cost codes — with no in-page navigation, so finding the job cost table
 * meant scrolling past four other tables first. Jobs redesign 2a gave the job a
 * section strip and moved the four heavyweight panels to routes of their own:
 * Contracts, Changes, Job cost and Ordered. The identity, the vitals strip and
 * the strip itself belong to `layout.tsx`, which is why this file starts at a
 * fragment rather than a page header.
 *
 * What is left here is the job's own details plus a summary of each section
 * that has its own page — each one a few rows and a link onward. **It reads
 * only what those summaries render**: the contracts, commitments, change
 * orders, cost report and compliance reads all moved out with their panels,
 * and a page that kept fetching them would be paying for four tables nobody
 * can see.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "jobs");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [
        entity,
        party,
        enterprise,
        set,
        codes,
        contracts,
        parties,
        member,
        pack,
        days,
        punch,
        selections,
        estimates,
        phases,
        drawings,
      ] = await Promise.all([
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
        project.partyId
          ? tx
              .select({ name: schema.parties.displayName })
              .from(schema.parties)
              .where(
                and(
                  eq(schema.parties.tenantId, ctx.tenant.id),
                  eq(schema.parties.id, project.partyId),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
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
        project.costCodeSetId
          ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
          : Promise.resolve([]),
        // Still read here: a selection is raised against a contract, so the
        // form on this page needs the list to pick from.
        listContracts(tx, ctx.tenant.id, project.id),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
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
        // The field: the last few days, and what is open on the walk-through.
        listDailyLogs(tx, ctx.tenant.id, project.id, { limit: 5 }),
        listPunchItems(tx, ctx.tenant.id, project.id),
        selectionSummary(
          tx,
          ctx.tenant.id,
          project.id,
          todayInTimezone(ctx.tenant.timezone),
        ),
        listEstimates(tx, ctx.tenant.id, project.id),
        listPhases(
          tx,
          ctx.tenant.id,
          project.id,
          ctx.tenant.timezone,
          todayInTimezone(ctx.tenant.timezone),
        ),
        drawingsSummary(tx, ctx.tenant.id, project.id),
      ]);
      return {
        project,
        entityName: entity[0]?.name ?? "—",
        clientName: party[0]?.name ?? null,
        enterpriseName: enterprise[0]?.name ?? null,
        setName: set[0]?.name ?? null,
        codes,
        contracts,
        parties,
        member: member[0] ?? null,
        labels: pack.labels,
        days,
        punch,
        selections,
        estimates,
        phases,
        drawings,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { project, codes, contracts, member } = data;
  const projectWord = labelFor(data.labels, "project", "Project");
  const clientWord = labelFor(data.labels, "customer", "Customer");
  /** The field is a chore: whoever is on the site logs the day and ticks the list. */
  const canLog = allowsWrite(ctx.role, "member");
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");
  const canFile = canLog && roleMayWrite(ctx.role);
  const symbol = ctx.tenant.currencySymbol;

  return (
    <>
      <Panel className="p-5">
        <h2 className="mb-3 font-heading text-sm font-medium tracking-heading">
          Details
        </h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
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
            <div key={label} className="flex justify-between gap-4 border-b border-border/50 py-1.5">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {project.notes && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {project.notes}
          </p>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Estimates
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/estimates`}>All estimates</Link>
            </Button>
            {canLog && <NewEstimateDialog projectId={project.id} />}
          </div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE FRONT END OF THE JOB (ADR 0069): what it was priced at before
            anybody signed. Newest first; the accepted one is the contract's.
          */}
          {data.estimates.length === 0
            ? "Nothing priced yet. An estimate is the job's cost and price line by line; accepted, it becomes the contract's value, the budget and the schedule of values."
            : `${data.estimates.length} ${data.estimates.length === 1 ? "estimate" : "estimates"}: ${data.estimates
                .slice(0, 3)
                .map(
                  (e) =>
                    `${e.estimate.number} ${formatMoney(e.totals.totalCents, symbol)} (${
                      isEstimateStatus(e.estimate.status) ? ESTIMATE_STATUS_LABELS[e.estimate.status].toLowerCase() : e.estimate.status
                    })`,
                )
                .join(" · ")}${data.estimates.length > 3 ? " · …" : ""}.`}
        </p>
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Selections
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/selections`}>All selections</Link>
            </Button>
            {canLog && (
              <SelectionForm
                projectId={project.id}
                contracts={contracts.map((c) => ({
                  id: c.id,
                  label: `${slugLabel(c.kind)}${c.name ? ` · ${c.name}` : ""}`,
                }))}
                costCodes={data.codes
                  .filter((c) => c.isActive)
                  .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
                parties={data.parties}
                documentsOn={false}
                tenantId={ctx.tenant.id}
                canPhoto={false}
              />
            )}
          </div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            WHAT THE CLIENT STILL OWES, and what it is costing against the
            allowances — the custom builder's other daily number (ADR 0067).
            Computed from the rows on the selections page; nothing stored.
          */}
          {data.selections.count === 0
            ? "Nothing to choose yet. Selections are the decisions the client owes — tile, countertops, fixtures — each with the allowance the contract set aside and the date it is needed by."
            : `${data.selections.count} ${data.selections.count === 1 ? "selection" : "selections"}, ${data.selections.pending} pending${
                data.selections.overdue > 0 ? ` (${data.selections.overdue} overdue)` : ""
              } · allowances ${formatMoney(data.selections.allowancesCents, symbol)}${
                data.selections.count - data.selections.pending > 0
                  ? ` · chosen ${formatMoney(data.selections.chosenCents, symbol)}, ${
                      data.selections.differenceCents >= 0 ? "over" : "under"
                    } by ${formatMoney(Math.abs(data.selections.differenceCents), symbol)}`
                  : ""
              }${
                data.selections.toRaiseCents !== 0
                  ? ` · ${formatMoneySign(data.selections.toRaiseCents, symbol)} approved and not yet raised as a change order`
                  : ""
              }.`}
        </p>
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Drawings
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/drawings`}>All sheets</Link>
            </Button>
            {documentsOn && canFile && (
              <AddDrawingSetDialog projectId={project.id} tenantId={ctx.tenant.id} parties={data.parties} today={todayInTimezone(ctx.tenant.timezone)} />
            )}
          </div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE SET IN ONE SENTENCE (ADR 0072): every sheet is a page of a PDF
            in Documents, and the current set is derived from the issues'
            dates, never kept as a flag.
          */}
          {data.drawings.sets === 0
            ? documentsOn
              ? "No drawings yet. A set is an issue of the drawings — the permit set, ASI 3 — as a PDF; each page with a sheet number becomes a sheet, and the newest issue of every number is the current set."
              : "Drawings need Documents switched on: a set is a PDF in the cabinet, read into sheets."
            : `${data.drawings.sheets} ${data.drawings.sheets === 1 ? "sheet" : "sheets"} in the current set from ${data.drawings.sets} ${
                data.drawings.sets === 1 ? "issue" : "issues"
              }; newest ${data.drawings.latestSetName}, dated ${data.drawings.latestIssuedOn}${
                data.drawings.superseded > 0 ? `, ${data.drawings.superseded} superseded` : ""
              }.`}
        </p>
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Schedule
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/schedule`}>All phases</Link>
            </Button>
            {canLog && (
              <PhaseForm
                projectId={project.id}
                parties={data.parties}
                codes={data.codes.filter((c) => c.isActive).map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
                others={data.phases.map((r) => ({ id: r.phase.id, name: r.phase.name, endOn: r.endOn }))}
              />
            )}
          </div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            WHEN, in one sentence (ADR 0071): the phases are calendar items on
            the business's Job schedule; the pack sums them here.
          */}
          {(() => {
            const today = todayInTimezone(ctx.tenant.timezone);
            const sum = scheduleSummary(data.phases, today);
            if (sum.count === 0) {
              return "No phases yet. A schedule is the job's phases in order — site work, foundation, framing, roof — each with the days it takes and the trade doing it.";
            }
            const current = data.phases.filter((r) => r.phase.status === "underway").map((r) => r.phase.name);
            const next = data.phases.find((r) => r.phase.status === "planned" && r.startOn >= today);
            return `${sum.count} ${sum.count === 1 ? "phase" : "phases"} from ${sum.startOn} to ${sum.endOn}: ${sum.done} done${
              current.length > 0 ? `, underway: ${current.join(", ")}` : ""
            }${next ? `, next ${next.phase.name} on ${next.startOn}` : ""}${sum.overdue > 0 ? `, ${sum.overdue} overdue` : ""}.`;
          })()}
        </p>
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            On site
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/log`}>All days</Link>
            </Button>
            {canLog && <DailyLogForm projectId={project.id} parties={data.parties} />}
          </div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE DAILY REPORT, said in its own terms: one per day, who was
            there, what happened. The tell box writes the same rows —
            "poured the garage slab at Oak Row, four guys, six hours".
          */}
          {data.days.length === 0
            ? "No days logged yet. One report per day: the weather, what happened, who was on site, the photos."
            : `${data.days.length} ${data.days.length === 1 ? "day" : "days"} logged, latest ${data.days[0].log.logDate}.`}
        </p>
        {data.days.length > 0 && (
          <ul className="divide-y divide-border/50">
            {data.days.map((day) => (
              <li key={day.log.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{day.log.logDate}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      day.crews.length > 0
                        ? `${day.crews.reduce((n, c) => n + c.workers, 0)} on site`
                        : null,
                      day.photoCount > 0
                        ? `${day.photoCount} ${day.photoCount === 1 ? "photo" : "photos"}`
                        : null,
                      day.log.weather || null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {day.log.notes && (
                  <p className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">
                    {day.log.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="p-5">
        <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">
          Punch list
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            WORK ITEMS, linked to this job — never a second task engine. What
            is open here is open in Work too, with whoever it is on.
          */}
          {data.punch.filter((p) => p.completedAt === null).length === 0
            ? "Nothing open."
            : `${data.punch.filter((p) => p.completedAt === null).length} open.`}
        </p>
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
        <h2 className="font-heading text-sm font-medium tracking-heading">
          Cost codes
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {data.setName
            ? `This ${projectWord.toLowerCase()} is budgeted against ${data.setName}.`
            : "No cost code list is attached, so there is nothing to charge against yet."}
        </p>
        {codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No codes in this list yet.{" "}
            <Link href="/dashboard/m/jobs/cost-codes" className="underline">
              Add some
            </Link>
            .
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell>{c.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </>
  );
}
