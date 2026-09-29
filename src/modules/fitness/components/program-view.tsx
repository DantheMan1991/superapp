import Link from "next/link";
import { ArrowLeftRight, FileText, Pencil } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shiftDay, type DaySession } from "../core/day";
import { breathPace, countOf, prescription } from "../core/program";
import {
  calendarWeeks,
  effortWarning,
  feelOf,
  phaseGate,
  programDays,
  weekCount,
  weeksOnTarget,
} from "../core/progress";
import type { ReminderView } from "../core/reminders";
import { oneSideLine, onlySideOf, ruleWords, type Lean } from "../core/side";
import { dayItemsOf, type LoadedItem, type LoadedProgram } from "../program-ops";
import type { LastSession } from "../session-ops";
import type { SavedSide } from "../side-ops";
import { GateNotOpen, NextPhaseOpen, PhaseProgress } from "./phase-progress";
import { ReminderCard } from "./reminder-card";
import { SideCard } from "./side-card";
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
 *
 * PROGRESS (F3): the phase's done days toward its gate, the week, the last
 * four weeks, the effort warning and the feel, worked out here from every
 * session of the program (core/progress.ts). When the gate opens, the next
 * phase is offered with what is new in it; a phase whose gate has not opened
 * says so above its Start, which still works (the founder's call).
 *
 * REMINDERS (F4a): the program's morning and evening times, under its rules.
 *
 * YOUR SIDE (F4b): the self-assessment's card under them, each one-sided
 * exercise saying its side once it is known, and the next phase's gate box
 * pointing to the tests while they are untaken.
 */
export function ProgramView({
  program,
  phaseIndex,
  lastSession,
  today,
  sessions,
  timeZone,
  reminders,
  hasPhone,
  side,
}: {
  program: LoadedProgram;
  phaseIndex: number;
  lastSession: LastSession | null;
  /** The personal space's own today, `YYYY-MM-DD`. */
  today: string;
  /** Every session of the program, oldest first (`programSessions`): progress (F3) and the day (F2c). */
  sessions: DaySession[];
  /** The personal space's timezone. */
  timeZone: string;
  reminders: ReminderView[];
  /** The person has a phone registered for notifications. */
  hasPhone: boolean;
  /** What the program's tests found (F4b); null until they are taken. */
  side: SavedSide | null;
}) {
  const lean = side?.side ?? null;
  // The tests, while they are untaken, for a program that has them.
  const testsHref =
    program.assessment && program.assessment.tests.length > 0 && !side
      ? `/personal/m/fitness/programs/${program.id}/side`
      : null;
  const base = `/personal/m/fitness/programs/${program.id}`;
  const at = program.phases[phaseIndex] ? phaseIndex : 0;
  const phase = program.phases[at];
  // Around today, for the Start button's split day; all of it, for progress.
  const recent = sessions.filter((s) => s.localDay >= shiftDay(today, -1) && s.localDay <= shiftDay(today, 1));
  const days = programDays(program.phases.map((p) => ({ items: dayItemsOf(p) })), sessions);
  const gate = phase ? phaseGate(phase.minDoneDays, days.perPhase[at].done.length) : null;
  const previous = at > 0 ? program.phases[at - 1] : null;
  const previousGate = previous ? phaseGate(previous.minDoneDays, days.perPhase[at - 1].done.length) : null;
  const next = program.phases[at + 1] ?? null;
  const zone =
    program.effortMin != null ? { min: program.effortMin, max: program.effortMax ?? program.effortMin } : null;
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
          <div className="flex flex-wrap gap-2">
            {program.source === "imported" && (
              // What the first read left out (F4b): the side self-assessment and the one-sided exercises.
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}/read`}>
                  <FileText aria-hidden /> Read the PDF again
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/edit`}>
                <Pencil aria-hidden /> Edit program
              </Link>
            </Button>
          </div>
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

      <ReminderCard programId={program.id} reminders={reminders} hasPhone={hasPhone} />

      <SideCard program={program} saved={side} timeZone={timeZone} />

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
              {phase.minDoneDays != null ? ` · ${countOf(phase.minDoneDays, "day", "days")} before moving on` : ""}
            </p>
            {phase.notes && <p className="mt-2 text-sm">{phase.notes}</p>}
          </div>
          {previous && previousGate && <GateNotOpen previous={previous.name} gate={previousGate} />}
          {gate && gate.open && gate.needed !== null && next && next.items.length > 0 && (
            <NextPhaseOpen
              name={next.name}
              href={`${base}?phase=${at + 2}`}
              exerciseCount={next.items.length}
              {...newIn(phase.items, next.items)}
              oneSided={next.items.filter((item) => item.perSide && item.sideRule !== "both").length}
              testsHref={testsHref}
            />
          )}
          {gate && sessions.length > 0 && (
            <PhaseProgress
              gate={gate}
              nextName={next?.name ?? null}
              week={{
                count: weekCount(days.done, today),
                min: program.sessionsPerWeekMin,
                max: program.sessionsPerWeekMax,
              }}
              calendar={calendarWeeks(days.done, days.partial, today)}
              streak={
                program.sessionsPerWeekMin != null ? weeksOnTarget(days.done, today, program.sessionsPerWeekMin) : null
              }
              warning={effortWarning(sessions, zone, today)}
              feel={feelOf(sessions, phase.id)}
            />
          )}
          {phase.items.length > 0 && (
            <div className="space-y-2">
              <StartSessionButton
                programId={program.id}
                phaseIds={program.phases.map((p) => p.id)}
                phaseNumber={at + 1}
                items={dayItemsOf(phase)}
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
              <ExerciseCard key={item.id} item={item} index={i} lean={lean} />
            ))}
          </ol>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">This program has no phases yet. Edit it to add one.</p>
      )}
    </div>
  );
}

function ExerciseCard({ item, index, lean }: { item: LoadedItem; index: number; lean: Lean | null }) {
  const [main, ...others] = item.exercise.videos;
  // Once the side is known (F4b): this exercise's own side, and its sets are one side each.
  const only = lean ? onlySideOf(item, lean) : null;
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
          <Badge variant="secondary">
            {prescription({ ...item, unit: item.exercise.unit, perSide: only ? false : item.perSide })}
          </Badge>
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
        {only && lean ? (
          // Its side, once the person's is known (F4b).
          <p className="flex items-start gap-2 text-sm">
            <ArrowLeftRight className="mt-0.5 size-4 shrink-0 text-module-accent" aria-hidden />
            {oneSideLine(item.sideMeans, only, lean)}
          </p>
        ) : (
          ruleWords(item.sideRule, item.sideMeans) && (
            // The program's one-sided rule (F4b), before the person's side is known.
            <p className="flex items-start gap-2 text-sm">
              <ArrowLeftRight className="mt-0.5 size-4 shrink-0 text-module-accent" aria-hidden />
              {`For someone who leans to a side: ${ruleWords(item.sideRule, item.sideMeans)?.toLowerCase()}. Otherwise both sides.`}
            </p>
          )
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

/**
 * What the next phase brings that this one does not, by name (each phase's
 * exercises are rows of their own), and the video of the first new one, or of
 * its first exercise when nothing is new.
 */
function newIn(current: LoadedItem[], next: LoadedItem[]) {
  const known = new Set(current.map((item) => item.exercise.name.trim().toLowerCase()));
  const fresh = next.filter((item) => !known.has(item.exercise.name.trim().toLowerCase()));
  const shown = fresh[0] ?? next[0];
  const video = shown?.exercise.videos[0];
  return {
    newNames: fresh.map((item) => item.exercise.name),
    video: video
      ? { id: video.id, startS: video.startS, endS: video.endS, embeddable: video.embeddable, title: shown.exercise.name }
      : null,
  };
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
