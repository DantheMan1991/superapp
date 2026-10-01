"use client";

import { useEffect } from "react";
import { isPosturePath } from "@/lib/posture-lock";

/**
 * KEEPS THE POSTURE PAGES' LOCK WHERE IT BELONGS (src/lib/posture-lock.ts,
 * ADR 0122). The proxy turns the router's requests across the posture pages'
 * edge into full page loads; this catches what the proxy cannot see, such as
 * back and forward, which the router can answer from its cache:
 *
 * - IN without the lock: this page load began outside the posture pages, so
 *   the proxy never locked it. Load it again, whole, and the proxy will.
 * - OUT with the lock: the posture pages have left the screen, but this page
 *   load, and its lock, have not. Load where the person went, whole, so the
 *   lock stays behind instead of breaking the next page's videos.
 */
export function PostureLockGuard() {
  useEffect(() => {
    const load = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const began = load ? new URL(load.name).pathname : window.location.pathname;
    if (!isPosturePath(began)) {
      window.location.reload();
      return;
    }
    return () => {
      // After the commit that took the posture pages away the address has
      // moved on; after React's development double run it has not.
      window.setTimeout(() => {
        if (!isPosturePath(window.location.pathname)) window.location.reload();
      }, 0);
    };
  }, []);
  return null;
}
