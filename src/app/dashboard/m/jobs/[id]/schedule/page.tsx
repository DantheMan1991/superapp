import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProject, listCostCodes } from "@/packs/jobs/ops";
import { ensureJobCalendar, listPhases, scheduleSummary } from "@/packs/jobs/schedule-ops";
import { daysBetween, weeksCovering } from "@/packs/jobs/schedule-math";
import { PhaseForm } from "@/packs/jobs/components/phase-form";
import { PACK, PHASE_STATUS_LABELS, isPhaseStatus } from "@/packs/jobs/vocabulary";

const DAY_PX = 8;
const WEEK_PX = DAY_PX * 7;

function weekLabel(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * A job's schedule: every phase and milestone on one timeline, soonest
 * first, with who does it, how long, what it follows and where it stands
 * (ADR 0071). The bars are the calendar items themselves — the same dates
 * the company calendar and the phone feed show — drawn by the pack.
 */
export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const timeZone = ctx.tenant.timezone;
  const today = todayInTimezone(timeZone);
  const isOwner = allowsWrite(ctx.role, "owner");
  // The business's Job schedule calendar is made by an owner; an owner opening
  // the schedule makes it, so whoever adds the first phase after that may.
  if (isOwner) {
    await withTenant(ctx.tenant.id, (tx) => ensureJobCalendar(tx, { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role }), {
      role: ctx.role,
      userId: ctx.userId,
    });
  }

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [rows, codes, parties, pack] = await Promise.all([
        listPhases(tx, ctx.tenant.id, project.id, timeZone, today),
        project.costCodeSetId ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId) : Promise.resolve([]),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return { project, rows, codes, parties, labels: pack.labels };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, rows } = data;
  const canEdit = allowsWrite(ctx.role, "member");
  const projectWord = labelFor(data.labels, "project", "Project");
  const summary = scheduleSummary(rows, today);
  const codeOptions = data.codes.filter((c) => c.isActive).map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }));
  const others = rows.map((r) => ({ id: r.phase.id, name: r.phase.name, endOn: r.endOn }));

  const gridStart = summary.startOn && summary.startOn < today ? summary.startOn : today;
  const gridEnd = summary.endOn && summary.endOn > today ? summary.endOn : today;
  const weeks = weeksCovering(gridStart, gridEnd);
  const origin = weeks[0];
  const gridWidth = weeks.length * WEEK_PX;
  const todayLeft = daysBetween(origin, today) * DAY_PX;

  const sentence =
    summary.count === 0
      ? "No phases yet. A schedule is the job's phases in order — site work, foundation, framing, roof — each with the days it takes and the trade doing it, and the milestones between."
      : `${summary.count - summary.milestones} ${summary.count - summary.milestones === 1 ? "phase" : "phases"}${
          summary.milestones > 0 ? ` and ${summary.milestones} ${summary.milestones === 1 ? "milestone" : "milestones"}` : ""
        } from ${summary.startOn} to ${summary.endOn} (${summary.spanDays} days): ${summary.done} done, ${summary.underway} underway${
          summary.overdue > 0 ? `, ${summary.overdue} overdue` : ""
        }.`;

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/m/jobs/${project.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {project.number} · {project.name}
      </Link>
      <PageHeader
        title="Schedule"
        description={`${projectWord} ${project.number} · ${sentence}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/m/scheduling">
                <CalendarDays className="mr-1.5 size-4" /> Company calendar
              </Link>
            </Button>
            {canEdit && <PhaseForm projectId={project.id} parties={data.parties} codes={codeOptions} others={others} />}
          </div>
        }
      />

      <Panel className="p-5">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{sentence}</p>
        ) : (
          <div className="relative w-full min-w-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="min-w-[14rem] px-2 py-1.5 text-left">Phase</th>
                  <th className="min-w-[9rem] px-2 py-1.5 text-left">Who</th>
                  <th className="px-2 py-1.5 text-left">Starts</th>
                  <th className="px-2 py-1.5 text-left">Ends</th>
                  <th className="px-2 py-1.5 text-right">Days</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 text-left" style={{ minWidth: gridWidth }}>
                    <div className="relative flex" style={{ width: gridWidth }}>
                      {weeks.map((w) => (
                        <span key={w} className="shrink-0 border-l border-border/60 pl-1 font-normal" style={{ width: WEEK_PX }}>
                          {weekLabel(w)}
                        </span>
                      ))}
                    </div>
                  </th>
                  {canEdit && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const left = daysBetween(origin, r.startOn) * DAY_PX;
                  const width = r.durationDays * DAY_PX;
                  const milestone = r.phase.kind === "milestone";
                  const tone =
                    r.phase.status === "done"
                      ? "bg-emerald-500/80"
                      : r.phase.status === "underway"
                        ? "bg-primary"
                        : "bg-muted-foreground/35";
                  return (
                    <tr key={r.phase.id} className="border-t border-border/50 align-top">
                      <td className="px-2 py-2">
                        <div className="font-medium">
                          {milestone && <span className="mr-1.5 inline-block size-2.5 rotate-45 bg-foreground align-middle" />}
                          {r.phase.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.predecessor
                            ? `after ${r.predecessor.name}${r.phase.lagDays !== 0 ? ` ${r.phase.lagDays > 0 ? "+" : ""}${r.phase.lagDays}d` : ""}`
                            : milestone
                              ? "milestone"
                              : "no predecessor"}
                          {r.codeLabel ? ` · ${r.codeLabel}` : ""}
                        </div>
                      </td>
                      <td className="px-2 py-2">{r.partyName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                        {r.startOn}
                        {r.lateToStart && <span className="block text-xs text-destructive">not started</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{milestone ? "—" : r.endOn}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{milestone ? "—" : r.durationDays}</td>
                      <td className="px-2 py-2">
                        <Badge variant={r.phase.status === "done" ? "default" : "secondary"}>
                          {isPhaseStatus(r.phase.status) ? PHASE_STATUS_LABELS[r.phase.status] : r.phase.status}
                        </Badge>
                        {r.overdue && <span className="block text-xs text-destructive">overdue</span>}
                      </td>
                      <td className="px-2 py-2">
                        <div className="relative h-6" style={{ width: gridWidth }}>
                          {weeks.map((w, i) => (
                            <span
                              key={w}
                              className="absolute top-0 h-full border-l border-border/40"
                              style={{ left: i * WEEK_PX }}
                            />
                          ))}
                          <span className="absolute top-0 h-full border-l-2 border-destructive/70" style={{ left: todayLeft }} title={`Today, ${today}`} />
                          {milestone ? (
                            <span
                              className={`absolute top-1.5 size-3 rotate-45 ${tone} ${r.overdue ? "ring-2 ring-destructive" : ""}`}
                              style={{ left: left + 2 }}
                              title={`${r.phase.name} · ${r.startOn}`}
                            />
                          ) : (
                            <span
                              className={`absolute top-1 h-4 rounded-sm ${tone} ${r.overdue ? "ring-2 ring-destructive" : ""}`}
                              style={{ left, width: Math.max(width, DAY_PX) }}
                              title={`${r.phase.name} · ${r.startOn} to ${r.endOn}`}
                            />
                          )}
                        </div>
                      </td>
                      {canEdit && (
                        <td className="px-1 py-1">
                          <PhaseForm
                            // A dialog's state outlives a refresh; a pushed phase changes dates without a version bump, so the dates key it too.
                            key={`${r.phase.id}:${r.phase.version}:${r.startOn}:${r.endOn}`}
                            projectId={project.id}
                            parties={data.parties}
                            codes={codeOptions}
                            others={others}
                            existing={{
                              id: r.phase.id,
                              version: r.phase.version,
                              name: r.phase.name,
                              kind: r.phase.kind,
                              startOn: r.startOn,
                              endOn: r.endOn,
                              predecessorId: r.phase.predecessorId,
                              lagDays: r.phase.lagDays,
                              partyId: r.phase.partyId,
                              costCodeId: r.phase.costCodeId,
                              status: r.phase.status,
                              notes: r.phase.notes,
                            }}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          A phase follows another finish-to-start, with a lag in days when it need not wait for the last day, or a
          negative one when it overlaps. Move a phase later and everything that follows it moves with it, keeping its
          length; nothing is ever pulled earlier. Every phase is on the business&apos;s <em>Job schedule</em> calendar,
          so the company calendar and the phone feed carry it.
        </p>
      </Panel>
    </div>
  );
}
