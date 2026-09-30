"use client";

import { useEffect } from "react";
import { readNativeBridge } from "@/lib/native-bridge";

/**
 * THE SCREEN STAYS ON while a session is open (docs/modules/fitness.md, F2)
 * or a posture check runs (docs/modules/posture.md): nobody can tap a phone
 * awake from the floor mid-breath, or from three meters away.
 *
 * Inside the app (1.0.8 and later), the shell's own switch
 * (`FLAG_KEEP_SCREEN_ON` through the KeepAwake plugin), because a WebView's
 * Screen Wake Lock is not to be relied on. Everywhere else, the browser's
 * Screen Wake Lock, which is released whenever the page is hidden and so is
 * asked for again each time the page comes back. Where there is neither (an
 * older phone, an older app build), this does nothing and the phone sleeps as
 * usual.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const native = typeof window === "undefined" ? null : (readNativeBridge(window)?.keepAwake ?? null);
    if (native) {
      void native.keepAwake().catch(() => {});
      return () => {
        void native.allowSleep().catch(() => {});
      };
    }
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
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
