"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * THE PARTS OF A TOOL THIS PERSON MAY NOT OPEN, as route prefixes (ADR 0095).
 *
 * ── WHY PREFIXES RATHER THAN KEYS ───────────────────────────────────────────
 *
 * `CategoryStrip` is the one primitive eight of the module nav strips render
 * through, so filtering there hides every denied section in the product with a
 * single change — the same trick `requireModuleEnabled` pulls for the pages.
 * But it is a CLIENT component and holds only hrefs, and turning an href back
 * into `accounting:reports` would need the feature registry, which imports
 * every module's `Component` and can never cross to the client.
 *
 * So the SERVER does the translation once, in the dashboard layout, and hands
 * down the finished list of paths. The client compares strings.
 *
 * ── IT IS NOT A SECRET, AND IT IS NOT A BOUNDARY ────────────────────────────
 *
 * Shipping somebody their own restrictions to the browser is fine: ADR 0093
 * makes `access_levels` readable by the member it restricts, on the grounds
 * that what you may not open is not a secret from you. And nothing here is
 * load-bearing — every one of these pages refuses server-side whether or not
 * the tab was drawn. This exists so the menu and the page agree, which is the
 * difference between a permission screen that works and one that produces bug
 * reports.
 */
const DeniedPaths = createContext<readonly string[]>([]);

export function AccessProvider({
  deniedPaths,
  children,
}: {
  deniedPaths: readonly string[];
  children: ReactNode;
}) {
  return <DeniedPaths.Provider value={deniedPaths}>{children}</DeniedPaths.Provider>;
}

/**
 * True when this href is inside a part the person may not open.
 *
 * Segment-boundary aware, because `/…/report` must not swallow `/…/reports` —
 * the bug every naive `startsWith` has, and the one `areaForPath` guards
 * against on the server side of the same question.
 */
export function useIsDenied(): (href: string) => boolean {
  const denied = useContext(DeniedPaths);
  return (href: string) => {
    if (denied.length === 0) return false;
    const segments = href.replace(/\/+$/, "").split("/");
    return denied.some((pattern) => {
      const parts = pattern.split("/");
      if (parts.length > segments.length) return false;
      // `*` matches one segment, so a job's tabs — which live under the job's
      // own id — can be named at all. Without it the client would compare
      // `/dashboard/m/jobs/*/estimates` against a real uuid and never match,
      // and the tab would stay in the strip while its page refused.
      return parts.every((p, i) => p === "*" || p === segments[i]);
    });
  };
}
