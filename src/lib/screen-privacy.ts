"use client";

import { useEffect } from "react";
import { readNativeBridge } from "@/lib/native-bridge";

/**
 * NO SCREENSHOTS WHILE A BODY IS ON THE SCREEN (ADR 0118; the posture check,
 * docs/modules/posture.md, and Health's progress photos, ADR 0128).
 *
 * Inside the app (1.0.8 and later) the shell sets `FLAG_SECURE` while
 * `active`: no screenshot, no screen recording, no picture in the app
 * switcher, and the screen dimmed behind a system dialog such as the camera
 * prompt. Released as soon as the screen is left. In a browser nothing a page
 * can do stops a screenshot, and nothing happens here; the guides say so.
 */
export function useScreenPrivacy(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const privacy = readNativeBridge(window)?.privacy ?? null;
    if (!privacy) return;
    void privacy.enable({ android: { dimBackground: true, privacyModeOnActivityHidden: "dim" } }).catch(() => {});
    return () => {
      void privacy.disable().catch(() => {});
    };
  }, [active]);
}
