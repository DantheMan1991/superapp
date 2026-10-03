"use client";

import { useEffect } from "react";
import { lockedArea, type LockedArea } from "@/lib/posture-lock";

/**
 * KEEPS A LOCKED AREA'S LOCK WHERE IT BELONGS (src/lib/posture-lock.ts,
 * ADR 0122; the posture pages, and Health's progress photos since ADR 0128).
 * The proxy turns the router's requests across the area's edge into full
 * page loads; this catches what the proxy cannot see, such as back and
 * forward, which the router can answer from its cache:
 *
 * - IN without the lock: this page load began outside the area, so the proxy
 *   never locked it for this area. Load it again, whole, and the proxy will.
 * - OUT with the lock: the area's pages have left the screen, but this page
 *   load, and its lock, have not. Load where the person went, whole, so the
 *   lock stays behind instead of breaking the next page's videos.
 */
export function PageLockGuard({ area }: { area: LockedArea }) {
  useEffect(() => {
    const load = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const began = load ? new URL(load.name).pathname : window.location.pathname;
    if (lockedArea(began) !== area) {
      window.location.reload();
      return;
    }
    return () => {
      // After the commit that took the area's pages away the address has moved
      // on; after React's development double run it has not.
      window.setTimeout(() => {
        if (lockedArea(window.location.pathname) !== area) window.location.reload();
      }, 0);
    };
  }, [area]);
  return null;
}
