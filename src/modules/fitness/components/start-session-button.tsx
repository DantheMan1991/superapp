"use client";

import Link from "next/link";
import { Check, CloudOff, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dayOf, dayPartsWords, hourIn, type DayItem, type DayProgress, type DaySession } from "../core/day";
import { countOf } from "../core/program";
import { openSessionFor } from "./workout/session-store";
import { useSessionSync, useStoredSessions } from "./workout/use-session-sync";

/**
 * "Start today's session", or "Resume" when one is open on this phone, on the
 * phase it is open for. Also where a workout finished without signal goes up
 * to the server: this button keeps sending while the program page is open.
 *
 * ON A SPLIT DAY (F2c) it knows the day: after a morning half it reads "Do the
 * rest of today" and says what the day has had and what is left; once every
 * exercise has had its sets, "Start another session". The day is the
 * server's sessions and the phone's own, added up by core/day.ts.
 */
export function StartSessionButton({
  programId,
  phaseIds,
  phaseNumber,
  items,
  recent,
  today,
  timeZone,
}: {
  programId: string;
  /** Every phase's id, in order, to find the phase an open session belongs to. */
  phaseIds: string[];
  /** 1-based: the phase on screen, which a new session starts. */
  phaseNumber: number;
  /** The phase on screen's items, as a day adds them up. */
  items: DayItem[];
  /** The program's sessions around today, from the server. */
  recent: DaySession[];
  /** The personal space's today, `YYYY-MM-DD`. */
  today: string;
  /**
   * The space's timezone, for "Morning": the server renders this first, and
   * the space's own clock is the one both sides read the same.
   */
  timeZone: string;
}) {
  const sessions = useStoredSessions();
  const sync = useSessionSync(sessions);
  const open = openSessionFor(sessions, programId);
  const openPhase = open ? phaseIds.indexOf(open.phaseId ?? "") + 1 : 0;
  const resume = open !== null && openPhase > 0;
  const base = `/personal/m/fitness/programs/${programId}/session`;
  const day: DayProgress = dayOf(
    items,
    today,
    recent,
    sessions.filter((s) => s.doc.programId === programId).map((s) => s.doc),
    open?.id ?? null,
  );
  const label = resume
    ? "Resume today's session"
    : day.complete
      ? "Start another session"
      : day.parts.length > 0
        ? "Do the rest of today"
        : "Start today's session";

  return (
    <div className="space-y-1.5">
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href={`${base}?phase=${resume ? openPhase : phaseNumber}`}>
          <Play aria-hidden /> {label}
        </Link>
      </Button>
      {resume ? (
        <p className="text-sm text-muted-foreground">
          Open for {open.phaseName || `phase ${openPhase}`}. It picks up at the set you were on.
        </p>
      ) : (
        day.parts.length > 0 && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-module-accent" aria-hidden />
            {day.complete
              ? `Today's sets are done: ${dayPartsWords(day, (iso) => hourIn(timeZone, iso))}.`
              : `Today: ${dayPartsWords(day, (iso) => hourIn(timeZone, iso))}. ${countOf(day.left, "set", "sets")} left.`}
          </p>
        )
      )}
      {sync.pending > 0 && sync.status === "waiting" && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CloudOff className="size-4 shrink-0" aria-hidden />
          {countOf(sync.pending, "workout", "workouts")} on this phone not sent yet. It goes when there is signal.
        </p>
      )}
    </div>
  );
}
