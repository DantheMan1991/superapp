"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { checkForNewMailAction } from "../actions";

/**
 * "New mail appears without reloading."
 *
 * Mounted on the MAIL ROUTE ONLY, never in the dashboard layout — otherwise
 * every page in the product would start polling a mail server on behalf of
 * people who are looking at an invoice.
 *
 * Every rule below exists to keep a background tab from costing anything:
 *
 *  - PAUSED while hidden. Browsers already throttle timers in background tabs
 *    to >=60s; pausing outright makes the intent explicit and stops billing a
 *    function invocation for a tab nobody is looking at.
 *  - SLOWER while visible but blurred (a second monitor) than while focused.
 *  - IMMEDIATE poll on becoming visible again. This is the interaction that
 *    actually matters — somebody tabs back and expects to see what arrived.
 *  - JITTERED, so N tabs across N users do not align into a thundering herd.
 *  - BACKS OFF when quiet, and again on failure.
 *  - STOPS DEAD on a credential error, because a revoked token will not fix
 *    itself and retrying it forever is how you get rate-limited by your own
 *    mail server.
 */

const FOCUSED_MS = 45_000;
const BLURRED_MS = 120_000;
/** After this many quiet polls, stretch the interval. */
const QUIET_THRESHOLD = 3;
const QUIET_MS = 90_000;
const MAX_BACKOFF_MS = 300_000;

function jitter(ms: number): number {
  // ±15%, so identical clients drift apart instead of synchronising.
  return Math.round(ms * (0.85 + Math.random() * 0.3));
}

export function MailPoller({ mailboxId }: { mailboxId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quiet = useRef(0);
  const failures = useRef(0);
  const stopped = useRef(false);
  const inFlight = useRef(false);

  // `schedule` and `run` refer to each other. Going through a ref is what stops
  // `schedule` capturing the FIRST render's `run` and polling forever with a
  // stale mailboxId — a bug that would only show after switching mailboxes.
  const runRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (stopped.current) return;
    timer.current = setTimeout(() => void runRef.current(), jitter(ms));
  }, []);

  const run = useCallback(async () => {
    if (stopped.current || inFlight.current) return;
    if (document.visibilityState !== "visible") {
      // Do not poll a hidden tab at all; the visibilitychange handler will
      // fire an immediate check when it comes back.
      return;
    }

    inFlight.current = true;
    try {
      const result = await checkForNewMailAction({ mailboxId });
      if ("error" in result) {
        failures.current += 1;
        if (result.stop) {
          stopped.current = true;
          return;
        }
        // 45s → 90 → 180 → 300 cap. An unreachable mail server must not become
        // a hammering loop.
        schedule(Math.min(FOCUSED_MS * 2 ** failures.current, MAX_BACKOFF_MS));
        return;
      }

      failures.current = 0;
      if (result.changed) {
        quiet.current = 0;
        router.refresh();
      } else {
        quiet.current += 1;
      }

      const base = document.hasFocus() ? FOCUSED_MS : BLURRED_MS;
      schedule(quiet.current >= QUIET_THRESHOLD ? Math.max(base, QUIET_MS) : base);
    } finally {
      inFlight.current = false;
    }
  }, [mailboxId, router, schedule]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    stopped.current = false;
    schedule(FOCUSED_MS);

    const onVisible = () => {
      if (document.visibilityState !== "visible" || stopped.current) return;
      // Somebody just came back to the tab — check now, not in 45 seconds.
      quiet.current = 0;
      void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [run, schedule]);

  // Renders nothing. It is a behaviour, not a control.
  return null;
}
