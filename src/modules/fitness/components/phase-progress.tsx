import Link from "next/link";
import { ArrowLeftRight, ArrowRight, Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { countOf } from "../core/program";
import { doneDaysWords, newExercisesWords, type CalendarDay, type FeelSummary, type PhaseGate } from "../core/progress";
import { VideoPlayer } from "./video-player";

/**
 * A PHASE'S PROGRESS (docs/help/fitness/program.md; F3, approved from a
 * mockup): the phase bar toward its done days, this week against the
 * program's sessions a week, the last four weeks, the effort warning, and how
 * the body felt before and after. All of it worked out on the server from the
 * sessions logged (core/progress.ts).
 */
export function PhaseProgress({
  gate,
  nextName,
  week,
  calendar,
  streak,
  warning,
  feel,
}: {
  gate: PhaseGate;
  /** The phase after this one, if there is one: "Phase 2 opens at 14". */
  nextName: string | null;
  week: { count: number; min: number | null; max: number | null };
  calendar: CalendarDay[][];
  /** Weeks in a row on target; null when the program sets no sessions a week. */
  streak: number | null;
  warning: string | null;
  feel: FeelSummary | null;
}) {
  const needed = gate.needed;
  const target =
    week.min === null ? null : week.max !== null && week.max !== week.min ? `${week.min}–${week.max}` : `${week.min}`;
  return (
    <section className="space-y-4 rounded-2xl bg-card p-4 shadow-elevation-1" aria-label="Progress in this phase">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className={cn("flex items-center gap-1.5 font-medium", gate.open && needed !== null && "text-module-accent")}>
            {gate.open && needed !== null && <Check className="size-4" aria-hidden />}
            {doneDaysWords(gate)}
          </span>
          {needed !== null && !gate.open && nextName && (
            <span className="text-sm text-muted-foreground">{`${nextName} opens at ${needed}`}</span>
          )}
        </div>
        {needed !== null && (
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Done days in this phase"
            aria-valuemin={0}
            aria-valuemax={needed}
            aria-valuenow={Math.min(gate.done, needed)}
          >
            <div
              className="h-full rounded-full bg-module-accent"
              style={{ width: `${Math.round((Math.min(gate.done, needed) / needed) * 100)}%` }}
            />
          </div>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          A done day is one whose sessions did every exercise&apos;s sets.
        </p>
      </div>

      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>This week</span>
        <span>
          <span className="font-medium tabular-nums">{week.count}</span>
          <span className="text-muted-foreground">
            {target === null ? ` ${week.count === 1 ? "session" : "sessions"}` : ` of ${target} sessions`}
          </span>
        </span>
      </div>

      <CalendarGrid calendar={calendar} streak={streak} />

      {warning && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {warning}
        </p>
      )}

      {feel && <FeelChart feel={feel} />}
    </section>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const STATE_WORDS = { done: "done", partial: "some sets", none: "nothing", ahead: "still to come" } as const;

function CalendarGrid({ calendar, streak }: { calendar: CalendarDay[][]; streak: number | null }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Last 4 weeks</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground" aria-hidden>
        {WEEKDAYS.map((letter, i) => (
          <span key={i}>{letter}</span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {calendar.flat().map((cell) => (
          <li
            key={cell.day}
            aria-label={`${dayLabel(cell.day)}: ${STATE_WORDS[cell.state]}${cell.today ? ", today" : ""}`}
            className={cn(
              "h-4 rounded-[3px]",
              cell.state === "done" && "bg-module-accent",
              cell.state === "partial" && "border border-module-accent/60 bg-module-accent/20",
              cell.state === "none" && "bg-muted",
              cell.state === "ahead" && "bg-muted/40",
              cell.today && "ring-2 ring-foreground/40 ring-offset-1 ring-offset-card",
            )}
          />
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-[2px] bg-module-accent" aria-hidden /> Done
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-[2px] border border-module-accent/60 bg-module-accent/20" aria-hidden /> Some sets
        </span>
        {streak !== null && streak > 0 && (
          <span className="ml-auto font-medium text-foreground">
            {streak === 1 ? "On target this week" : `${streak} weeks in a row on target`}
          </span>
        )}
      </div>
    </div>
  );
}

/** Before and after, each session a point, on the 0–10 scale: before gray, after the tool's color. */
function FeelChart({ feel }: { feel: FeelSummary }) {
  const w = 200;
  const h = 44;
  const x = (i: number) => (feel.series.length === 1 ? w / 2 : (i / (feel.series.length - 1)) * w);
  const y = (v: number) => h - 2 - (v / 10) * (h - 4);
  const line = (key: "before" | "after") => feel.series.map((point, i) => `${x(i)},${y(point[key])}`).join(" ");
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>How you felt</span>
        <span className="text-xs text-muted-foreground">{countOf(feel.sessions, "session", "sessions")}</span>
      </div>
      <p className="text-lg font-medium tabular-nums">
        {feel.before} <span className="text-sm font-normal text-muted-foreground">before</span> → {feel.after}{" "}
        <span className="text-sm font-normal text-muted-foreground">after, on average</span>
      </p>
      {feel.series.length > 1 && (
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-11 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`How your body felt before and after your last ${feel.series.length} sessions`}
        >
          <polyline points={line("before")} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <polyline points={line("after")} fill="none" className="stroke-module-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <p className="text-xs text-muted-foreground">Gray is before, and the colored line after, out of 10.</p>
    </div>
  );
}

/**
 * THE GATE, OPEN: the next phase, what is new in it with the first new
 * exercise's video, and the button to move on. The app never moves the
 * person on by itself. When the next phase does exercises on one side and the
 * program's tests are untaken (F4b), it says so and points to them first.
 */
export function NextPhaseOpen({
  name,
  href,
  exerciseCount,
  newNames,
  video,
  oneSided = 0,
  testsHref = null,
}: {
  name: string;
  href: string;
  exerciseCount: number;
  newNames: string[];
  video: { id: string; startS: number | null; endS: number | null; embeddable: boolean | null; title: string } | null;
  /** How many of the next phase's exercises the program does on one side. */
  oneSided?: number;
  /** The program's tests, while they are untaken; null once they are, or when it has none. */
  testsHref?: string | null;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-module-accent/50 bg-card p-4">
      <p className="font-medium">{`${name} is open`}</p>
      <p className="text-sm text-muted-foreground">{newExercisesWords(exerciseCount, newNames)}</p>
      {oneSided > 0 && testsHref && (
        <div className="space-y-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <p className="flex items-start gap-2">
            <ArrowLeftRight className="mt-0.5 size-4 shrink-0 text-module-accent" aria-hidden />
            {`${name} has ${countOf(oneSided, "exercise", "exercises")} done on one side. Take the tests first, to find yours.`}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={testsHref}>Take the tests</Link>
          </Button>
        </div>
      )}
      {video && (
        <div className="overflow-hidden rounded-xl">
          <VideoPlayer
            videoId={video.id}
            startS={video.startS}
            endS={video.endS}
            embeddable={video.embeddable}
            title={video.title}
          />
        </div>
      )}
      <Button asChild>
        <Link href={href}>
          {`Move on to ${name}`} <ArrowRight aria-hidden />
        </Link>
      </Button>
      <p className="text-xs text-muted-foreground">Or keep going here. It never moves you on by itself.</p>
    </div>
  );
}

/** A phase whose gate has not opened: said above its Start, which still works (his call). */
export function GateNotOpen({ previous, gate }: { previous: string; gate: PhaseGate }) {
  if (gate.open || gate.needed === null) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
      {`Opens after ${gate.needed} done days of ${previous} (${gate.done} so far). The program says not to skip a phase.`}
    </p>
  );
}
