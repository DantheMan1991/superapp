"use client";

import { useEffect } from "react";

/**
 * THE SCREEN STAYS ON while a session is open (docs/modules/fitness.md, F2):
 * nobody can tap a phone awake from the floor mid-breath.
 *
 * The browser's Screen Wake Lock. It is released whenever the page is hidden,
 * so it is asked for again each time the page comes back. Where there is no
 * wake lock at all (an older phone, or a WebView without it; the Android
 * app's is an open item), this does nothing and the phone sleeps as usual.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (done) void next.release().catch(() => {});
        else lock = next;
      } catch {
        // Refused (battery saver, a page not visible yet): the phone sleeps as usual.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
