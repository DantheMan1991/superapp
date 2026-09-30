import Link from "next/link";
import { Dumbbell, FileText, Loader2, Plus, TriangleAlert, Upload } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeAgo } from "@/lib/last-seen";
import { localDayIn, shiftDay, type DaySession } from "./core/day";
import { countOf } from "./core/program";
import { phaseGate, programDays, weekCount } from "./core/progress";
import { listOpenImports } from "./import-ops";
import { dayItemsOf, listPrograms, loadProgram, type LoadedProgram } from "./program-ops";
import { latestFollowed, programSessions } from "./session-ops";
import { DiscardImportButton } from "./components/discard-import-button";
import { TodayCard } from "./components/today-card";
import { PostureCard } from "./posture/components/posture-card";

/**
 * WORKOUTS — the tool's front page (docs/help/fitness/overview.md).
 *
 * Today's workout on the program last followed (F2c: the day so far, what is
 * left, one tap to do it), the way into the posture check (docs/modules/
 * posture.md), the programs the person has, and any draft still waiting for
 * them: one being drafted, one ready to review, one that failed.
 * A personal tool: this
 * only ever renders inside a personal space, behind `requirePersonalSpace`
 * and a module gate that refuses it anywhere else (ADR 0111).
 */
export async function FitnessModule({ ctx }: { ctx: TenantContext }) {
  const now = new Date();
  const today = localDayIn(ctx.tenant.timezone, now);
  const [programs, imports, followed] = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [programs, imports, latest] = await Promise.all([
        listPrograms(tx, ctx.tenant.id),
        listOpenImports(tx, ctx.tenant.id),
        latestFollowed(tx, ctx.tenant.id),
      ]);
      // Today is for the program of the last workout, on that workout's phase:
      // one still in the list (a put-away program has no today).
      const listed = latest && programs.some((program) => program.id === latest.programId);
      const program = listed ? await loadProgram(tx, ctx.tenant.id, latest.programId) : null;
      if (!program || program.phases.length === 0) return [programs, imports, null] as const;
      const at = Math.max(0, program.phases.findIndex((phase) => phase.id === latest?.phaseId));
      const sessions = await programSessions(tx, ctx.tenant.id, program.id);
      return [programs, imports, { program, phaseIndex: at, sessions }] as const;
    },
    { role: ctx.role },
  );

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href="/personal/m/fitness/new">
          <Plus aria-hidden /> Build one by hand
        </Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/personal/m/fitness/import">
          <Upload aria-hidden /> Import a program
        </Link>
      </Button>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Workouts"
        description="Follow a program you were given, or build your own, with the videos playing right here."
        icon={<Dumbbell />}
        actions={actions}
      />

      {followed && followed.program.phases[followed.phaseIndex].items.length > 0 && (
        <FollowedToday followed={followed} today={today} timeZone={ctx.tenant.timezone} />
      )}

      <PostureCard />

      {imports.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading font-medium tracking-heading">Drafts</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
            {imports.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText className="size-5 shrink-0 text-module-accent" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{row.fileName}</div>
                  <div className="text-sm text-muted-foreground">
                    {row.status === "drafting" && (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Drafting, started{" "}
                        {describeAgo(row.createdAt, now)}
                      </span>
                    )}
                    {row.status === "draft" && `Ready to review · ${countOf(row.pageCount, "page", "pages")}`}
                    {row.status === "failed" && (
                      <span className="inline-flex items-start gap-1 text-destructive">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {row.error ?? "The program could not be drafted."}
                      </span>
                    )}
                  </div>
                </div>
                {row.status === "draft" && (
                  <Button asChild size="sm">
                    <Link href={`/personal/m/fitness/import/${row.id}`}>Review</Link>
                  </Button>
                )}
                {row.status === "failed" && (
                  <DiscardImportButton importId={row.id} variant="outline" size="sm" />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* A draft waiting is the next step already; "start with the program
          you were given" beneath it would send the person back to the start. */}
      {programs.length === 0 ? (
        imports.length === 0 && (
          <EmptyState
            panel
            icon={<Dumbbell />}
            title="Start with the program you were given"
            description="Import its PDF and check the draft before it is saved, or build a program by hand."
            action={actions}
          />
        )
      ) : (
        <section className="space-y-2">
          <h2 className="font-heading font-medium tracking-heading">Your programs</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {programs.map((program) => (
              <li key={program.id}>
                <Link
                  href={`/personal/m/fitness/programs/${program.id}`}
                  className="block h-full rounded-2xl bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-2"
                >
                  <div className="font-medium">{program.name}</div>
                  {program.author && <div className="text-sm text-muted-foreground">{program.author}</div>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      {program.phaseCount} {program.phaseCount === 1 ? "phase" : "phases"} ·{" "}
                      {program.exerciseCount} {program.exerciseCount === 1 ? "exercise" : "exercises"}
                    </span>
                    <Badge variant="outline">{program.source === "imported" ? "Imported" : "By hand"}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The Today card for the program last followed (F2c), with its phase's done
 * days, this week, and whether the next phase has opened (F3), all worked out
 * here from every session of the program.
 */
function FollowedToday({
  followed,
  today,
  timeZone,
}: {
  followed: { program: LoadedProgram; phaseIndex: number; sessions: DaySession[] };
  today: string;
  timeZone: string;
}) {
  const { program, phaseIndex, sessions } = followed;
  const phase = program.phases[phaseIndex];
  const next = program.phases[phaseIndex + 1] ?? null;
  const days = programDays(program.phases.map((p) => ({ items: dayItemsOf(p) })), sessions);
  const gate = phaseGate(phase.minDoneDays, days.perPhase[phaseIndex].done.length);
  return (
    <TodayCard
      programId={program.id}
      programName={program.name}
      phaseIds={program.phases.map((p) => p.id)}
      phaseNumber={phaseIndex + 1}
      phaseName={phase.name}
      items={dayItemsOf(phase)}
      recent={sessions.filter((s) => s.localDay >= shiftDay(today, -1) && s.localDay <= shiftDay(today, 1))}
      today={today}
      timeZone={timeZone}
      gate={gate}
      week={{ count: weekCount(days.done, today), min: program.sessionsPerWeekMin, max: program.sessionsPerWeekMax }}
      nextOpen={gate.open && gate.needed !== null && next && next.items.length > 0 ? { number: phaseIndex + 2, name: next.name } : null}
    />
  );
}
