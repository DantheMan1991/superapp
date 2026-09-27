"use client";

import Link from "next/link";
import { CloudOff, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countOf } from "../core/program";
import { openSessionFor } from "./workout/session-store";
import { useSessionSync, useStoredSessions } from "./workout/use-session-sync";

/**
 * "Start today's session", or "Resume" when one is open on this phone, on the
 * phase it is open for. Also where a workout finished without signal goes up
 * to the server: this button keeps sending while the program page is open.
 */
export function StartSessionButton({
  programId,
  phaseIds,
  phaseNumber,
}: {
  programId: string;
  /** Every phase's id, in order, to find the phase an open session belongs to. */
  phaseIds: string[];
  /** 1-based: the phase on screen, which a new session starts. */
  phaseNumber: number;
}) {
  const sessions = useStoredSessions();
  const sync = useSessionSync(sessions);
  const open = openSessionFor(sessions, programId);
  const openPhase = open ? phaseIds.indexOf(open.phaseId ?? "") + 1 : 0;
  const resume = open !== null && openPhase > 0;
  const base = `/personal/m/fitness/programs/${programId}/session`;

  return (
    <div className="space-y-1.5">
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href={`${base}?phase=${resume ? openPhase : phaseNumber}`}>
          <Play aria-hidden /> {resume ? "Resume today's session" : "Start today's session"}
        </Link>
      </Button>
      {resume && (
        <p className="text-sm text-muted-foreground">
          Open for {open.phaseName || `phase ${openPhase}`}. It picks up at the set you were on.
        </p>
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
