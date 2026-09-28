import Link from "next/link";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DaySession } from "../core/day";
import { breathPace, countOf, prescription } from "../core/program";
import type { LoadedItem, LoadedProgram } from "../program-ops";
import type { LastSession } from "../session-ops";
import { StartSessionButton } from "./start-session-button";
import { VideoPlayer } from "./video-player";

/**
 * A SAVED PROGRAM, TO FOLLOW (docs/help/fitness/program.md): its rules at the
 * top, the phases as chips, and the chosen phase's exercises in order, each
 * with its video playing in the page, what to do, and how to know it is being
 * done right.
 *
 * A server component: the phase is `?phase=` in the URL, the house's device
 * for view state, so a link or a refresh lands on the same phase. Without it
 * the page opens on the phase of the last workout, so every chip names its
 * phase outright. Only the video player and the Start button are client code.
 */
export function ProgramView({
  program,
  phaseIndex,
  lastSession,
  today,
  recent,
  timeZone,
}: {
  program: LoadedProgram;
  phaseIndex: number;
  lastSession: LastSession | null;
  /** The personal space's own today, `YYYY-MM-DD`. */
  today: string;
  /** The program's sessions around today: the Start button adds up a split day from them (F2c). */
  recent: DaySession[];
  /** The personal space's timezone. */
  timeZone: string;
}) {
  const base = `/personal/m/fitness/programs/${program.id}`;
  const phase = program.phases[phaseIndex] ?? program.phases[0];
  const facts = [
    range(program.sessionsPerWeekMin, program.sessionsPerWeekMax, "session a week", "sessions a week"),
    program.effortMin != null ? `effort ${range(program.effortMin, program.effortMax, "", "")} of 10` : null,
    program.breathOutS != null || program.breathInS != null
      ? `breathe ${breathPace(program).outS} s out, ${breathPace(program).inS} s in`
      : null,
  ].filter((fact): fact is string => fact !== null && fact !== "");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title={program.name}
        description={[
          program.author,
          program.source === "imported" ? "Imported from a PDF" : "Built by hand",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`${base}/edit`}>
              <Pencil aria-hidden /> Edit program
            </Link>
          </Button>
        }
      />

      {(facts.length > 0 || program.notes) && (
        <section className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
          {facts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {facts.map((fact) => (
                <Badge key={fact} variant="secondary">
                  {fact}
                </Badge>
              ))}
            </div>
          )}
          {program.notes && <p className="text-sm leading-relaxed">{program.notes}</p>}
        </section>
      )}

      {program.phases.length > 1 && (
        <nav aria-label="Phases" className="flex flex-wrap gap-2">
          {program.phases.map((p, i) => (
            <Link
              key={p.id}
              href={`${base}?phase=${i + 1}`}
              aria-current={p.id === phase?.id ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                p.id === phase?.id
                  ? "border-module-accent bg-module-accent/10 font-medium text-module-accent"
                  : "border-border hover:bg-muted",
              )}
            >
              {p.name}
            </Link>
          ))}
        </nav>
      )}

      {phase ? (
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-medium tracking-heading">{phase.name}</h2>
            <p className="text-sm text-muted-foreground">
              {phase.items.length} {phase.items.length === 1 ? "exercise" : "exercises"}, in this order
              {phase.minDoneDays != null ? ` · ${phase.minDoneDays} days before moving on` : ""}
            </p>
            {phase.notes && <p className="mt-2 text-sm">{phase.notes}</p>}
          </div>
          {phase.items.length > 0 && (
            <div className="space-y-2">
              <StartSessionButton
                programId={program.id}
                phaseIds={program.phases.map((p) => p.id)}
                phaseNumber={phaseIndex + 1}
                items={phase.items.map((item) => ({
                  itemId: item.id,
                  name: item.exercise.name,
                  optional: item.optional,
                  setsMin: item.setsMin,
                  setsMax: item.setsMax,
                }))}
                recent={recent}
                today={today}
                timeZone={timeZone}
              />
              {/* A workout today on this phase is the Start button's own line: "Today: Morning · 4 sets". */}
              {lastSession && !(lastSession.localDay === today && lastSession.phaseId === phase.id) && (
                <p className="text-sm text-muted-foreground">
                  Last workout: {dayWords(lastSession.localDay, today)} · {lastSession.phaseName || "a phase since removed"}{" "}
                  · {countOf(lastSession.sets, "set", "sets")}
                  {lastSession.feelBefore != null && lastSession.feelAfter != null
                    ? ` · felt ${lastSession.feelBefore} before, ${lastSession.feelAfter} after`
                    : ""}
                  {lastSession.finishedAt ? "" : " · not finished"}
                </p>
              )}
            </div>
          )}
          <ol className="space-y-4">
            {phase.items.map((item, i) => (
              <ExerciseCard key={item.id} item={item} index={i} />
            ))}
          </ol>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">This program has no phases yet. Edit it to add one.</p>
      )}
    </div>
  );
}

function ExerciseCard({ item, index }: { item: LoadedItem; index: number }) {
  const [main, ...others] = item.exercise.videos;
  return (
    <li className="overflow-hidden rounded-2xl bg-card shadow-elevation-1">
      {main && (
        <VideoPlayer
          videoId={main.id}
          startS={main.startS}
          endS={main.endS}
          embeddable={main.embeddable}
          title={item.exercise.name}
        />
      )}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-medium">
            <span className="text-muted-foreground">{index + 1} · </span>
            {item.exercise.name}
            {item.optional && (
              <Badge variant="outline" className="ml-2 align-middle">
                Optional
              </Badge>
            )}
          </h3>
          <Badge variant="secondary">{prescription({ ...item, unit: item.exercise.unit })}</Badge>
        </div>
        {item.exercise.purpose && <p className="text-sm text-muted-foreground">{item.exercise.purpose}</p>}
        {item.exercise.cues.length > 0 && (
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Doing it right</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
              {item.exercise.cues.map((cue) => (
                <li key={cue}>{cue}</li>
              ))}
            </ul>
          </div>
        )}
        {item.notes && <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">{item.notes}</p>}
        {others.map((video, v) => (
          // The same video can be here twice, each playing a different part.
          <details key={`${video.id}-${v}`} className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {video.label ?? "Another video"}
            </summary>
            <VideoPlayer
              videoId={video.id}
              startS={video.startS}
              endS={video.endS}
              embeddable={video.embeddable}
              title={`${item.exercise.name}, ${video.label ?? "another video"}`}
            />
          </details>
        ))}
      </div>
    </li>
  );
}

function range(min: number | null, max: number | null, one: string, many: string): string | null {
  if (min == null) return null;
  const span = max != null && max !== min ? `${min}–${max}` : String(min);
  const word = (max ?? min) === 1 ? one : many;
  return word ? `${span} ${word}` : span;
}

/** "today", "yesterday", or the date: when a workout was, in the person's own days. */
function dayWords(localDay: string, today: string): string {
  if (localDay === today) return "today";
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (localDay === yesterday.toISOString().slice(0, 10)) return "yesterday";
  return new Date(`${localDay}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
