"use client";

import { useEffect } from "react";
import { localDayOf, visitStorageKey } from "@/lib/sites/views-core";

/**
 * Reports one page view to `/api/sites/view` after the page has drawn.
 *
 * The browser keeps its own "counted today" note under a key for this site
 * and this calendar day, and says `first: true` the first time it reports
 * on a day — that is the whole of how a visitor is told from a view. No
 * cookie is set, nothing about the person leaves the browser beyond the
 * page it looked at, and older days' notes are cleared as they go by.
 *
 * `sendBeacon` when the browser has it (it survives the tab closing), a
 * keep-alive fetch otherwise, and silence on any failure: a visit that goes
 * uncounted is not the visitor's problem.
 */
export function ViewBeacon({ slug, path }: { slug: string; path: string }) {
  useEffect(() => {
    let first = false;
    try {
      const prefix = visitStorageKey(slug, "");
      const key = visitStorageKey(slug, localDayOf(new Date()));
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix) && k !== key) localStorage.removeItem(k);
      }
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        first = true;
      }
    } catch {
      // Storage refused (private window, a strict browser): a view, not a visitor.
    }
    const body = JSON.stringify({ site: slug, path, first });
    try {
      const queued =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon("/api/sites/view", new Blob([body], { type: "text/plain" }));
      if (!queued) {
        void fetch("/api/sites/view", {
          method: "POST",
          body,
          keepalive: true,
          headers: { "content-type": "text/plain" },
        }).catch(() => undefined);
      }
    } catch {
      // Nothing to do.
    }
  }, [slug, path]);
  return null;
}
