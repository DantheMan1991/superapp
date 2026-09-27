"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  closeStaleSessions,
  isPending,
  readSessions,
  sendPending,
  sessionsOnTheServer,
  subscribeSessions,
  type StoredSession,
} from "./session-store";

/** The sessions kept on this phone, as a React value (session-store.ts). */
export function useStoredSessions(): StoredSession[] {
  return useSyncExternalStore(subscribeSessions, readSessions, sessionsOnTheServer);
}

export interface SyncState {
  /** Everything is on the server; sending now; or no signal, kept on the phone. */
  status: "saved" | "saving" | "waiting";
  /** How many sessions the server does not have yet. */
  pending: number;
  /** The server's last refusal, when it answered with one. */
  refused: string | null;
}

/** 3 s, 10 s, 30 s, then every minute: a phone out of signal is not hammered. */
function backoffMs(attempt: number): number {
  return [3_000, 10_000, 30_000][attempt] ?? 60_000;
}

/**
 * KEEP SENDING UNTIL THE SERVER HAS EVERYTHING: a moment after each change,
 * straight away when the phone comes back online, and on a backoff while it
 * is not. Mounted by the workout screen and by the program page, so a session
 * finished without signal goes up the next time either is open.
 */
export function useSessionSync(sessions: StoredSession[]): SyncState {
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = sessions.filter(isPending);
  const refused = pending.find((session) => session.refused)?.refused ?? null;

  // A session left open on an earlier day is closed where its last set was.
  useEffect(() => {
    closeStaleSessions(new Date());
  }, []);

  useEffect(() => {
    if (pending.length === 0) return;
    let cancelled = false;
    let retry: number | undefined;
    const send = window.setTimeout(
      () => {
        void sendPending().then((result) => {
          // Always, even after this effect was replaced: a send that got through
          // while the screen moved on must still clear "Kept on this phone" (the
          // first drive saw it linger into the next change).
          setOffline(result === "offline");
          if (cancelled || result === "sent") return;
          retry = window.setTimeout(() => setAttempt((n) => n + 1), backoffMs(attempt));
        });
      },
      // A beat after a change, so a burst of taps goes as one request.
      attempt === 0 ? 600 : 0,
    );
    const online = () => setAttempt((n) => n + 1);
    window.addEventListener("online", online);
    return () => {
      cancelled = true;
      window.clearTimeout(send);
      window.clearTimeout(retry);
      window.removeEventListener("online", online);
    };
    // `sessions` changes with every set, which is exactly when to send.
  }, [sessions, pending.length, attempt]);

  return {
    status: pending.length === 0 ? "saved" : offline ? "waiting" : "saving",
    pending: pending.length,
    refused,
  };
}
