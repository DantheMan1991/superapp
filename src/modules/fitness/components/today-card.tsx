"use client";

import Link from "next/link";
import { ArrowRight, Check, Play, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dayOf, hourIn, partOfDay, type DayItem, type DaySession } from "../core/day";
import { countOf } from "../core/program";
import { doneDaysWords, type PhaseGate } from "../core/progress";
import { POSTURE_CHECK_HREF } from "../posture/components/posture-mark";
import { openSessionFor } from "./workout/session-store";
import { useSessionSync, useStoredSessions } from "./workout/use-session-sync";

/**
 * TODAY, ON THE WORKOUTS HOME (docs/help/fitness/overview.md; F2c, approved
 * from a mockup). The program last followed, on the phase of its last
 * workout: the day's sessions so far ("Morning · 4 sets"), what is left and
 * of which exercises, and one tap to do it. Once every exercise has had its
 * sets, it says so and asks nothing.
 *
 * The day is the server's sessions and the phone's own, added up by
 * core/day.ts, so a morning done without signal is already on it. And it keeps
 * sending: a workout finished without signal goes up from here too.
 *
 * AND THE PHASE (F3): its done days toward the gate, this week against the
 * program's sessions a week, and, once the gate opens, the next phase with a
 * link to move on. Worked out on the server from every session.
 *
 * AND A POSTURE CHECK (posture slice 3c), when one is due to mark the
 * program's start or a phase's end, with the way into it.
 */
export function TodayCard({
  programId,
  programName,
  phaseIds,
  phaseNumber,
  phaseName,
  items,
  recent,
  today,
  timeZone,
  gate,
  week,
  nextOpen,
  posture,
}: {
  programId: string;
  programName: string;
  /** Every phase's id, in order, to find the phase an open session belongs to. */
  phaseIds: string[];
  /** 1-based: the phase of the last workout. */
  phaseNumber: number;
  phaseName: string;
  items: DayItem[];
  recent: DaySession[];
  /** The personal space's today, `YYYY-MM-DD`. */
  today: string;
  /** The space's timezone: "Morning" is read on its clock on the server and the phone alike. */
  timeZone: string;
  /** The phase's done days toward its gate (F3). */
  gate: PhaseGate;
  /** Done days this week, against the program's sessions a week. */
  week: { count: number; min: number | null; max: number | null };
  /** The next phase, once this one's gate has opened. */
  nextOpen: { number: number; name: string } | null;
  /** What to ask when a posture check is due (posture slice 3c); null when none is. */
  posture: string | null;
}) {
  const sessions = useStoredSessions();
  useSessionSync(sessions);
  const open = openSessionFor(sessions, programId);
  const openPhase = open ? phaseIds.indexOf(open.phaseId ?? "") + 1 : 0;
  const resume = open !== null && openPhase > 0;
  const day = dayOf(
    items,
    today,
    recent,
    sessions.filter((s) => s.doc.programId === programId).map((s) => s.doc),
    open?.id ?? null,
  );
  const leftNames = day.items.filter((item) => !item.optional && item.left > 0).map((item) => item.name);
  const whole = items.reduce((n, item) => (item.optional ? n : n + item.setsMin), 0);
  const href = `/personal/m/fitness/programs/${programId}/session?phase=${resume ? openPhase : phaseNumber}`;
  const target =
    week.min === null ? null : week.max !== null && week.max !== week.min ? `${week.min}–${week.max}` : `${week.min}`;
  const phaseLine = [
    doneDaysWords(gate),
    target === null ? `${countOf(week.count, "session", "sessions")} this week` : `This week: ${week.count} of ${target} sessions`,
  ].join(" · ");

  return (
    <section className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1" aria-labelledby="today-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id="today-heading" className="font-heading font-medium tracking-heading">
          Today
        </h2>
        <Link
          href={`/personal/m/fitness/programs/${programId}?phase=${phaseNumber}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {programName} · {phaseName}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{phaseLine}</p>
      {nextOpen && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-module-accent/50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Check className="size-4 text-module-accent" aria-hidden /> {`${nextOpen.name} is open`}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href={`/personal/m/fitness/programs/${programId}?phase=${nextOpen.number}`}>
              Move on <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      )}
      {posture && (
        <p className="flex items-start gap-2 text-sm">
          <ScanLine className="mt-0.5 size-4 shrink-0 text-module-accent" aria-hidden />
          <span>
            {`${posture} `}
            <Link href={POSTURE_CHECK_HREF} className="font-medium text-module-accent underline-offset-4 hover:underline">
              Start a posture check
            </Link>
          </span>
        </p>
      )}
      {day.parts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {resume
            ? `A session is open on this phone for ${open.phaseName || `phase ${openPhase}`}.`
            : `Nothing yet today: ${countOf(items.length, "exercise", "exercises")}, ${countOf(whole, "set", "sets")}.`}
        </p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {day.parts.map((part) => (
            <li key={part.id} className="flex items-center gap-1.5">
              <Check className="size-4 shrink-0 text-module-accent" aria-hidden />
              {`${partOfDay(hourIn(timeZone, part.startedAt))} · ${countOf(part.sets, "set", "sets")}${part.finished ? "" : " · not finished"}`}
            </li>
          ))}
        </ul>
      )}
      {day.complete ? (
        <p className="text-sm font-medium text-module-accent">Every set done today.</p>
      ) : (
        <>
          {day.parts.length > 0 && leftNames.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {`${countOf(day.left, "set", "sets")} left: ${leftNames.join(", ")}.`}
            </p>
          )}
          <Button asChild size="sm">
            <Link href={href}>
              <Play aria-hidden />
              {resume ? "Resume" : day.parts.length > 0 ? "Do the rest" : "Start today's session"}
            </Link>
          </Button>
        </>
      )}
    </section>
  );
}
