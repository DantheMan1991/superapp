"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/** Nothing to subscribe to: the snapshot flips once, when hydration ends. */
const subscribe = () => () => {};

/**
 * Renders nothing until hydration has finished, then renders `children`.
 *
 * **FOR A CHILD WHOSE FIRST CLIENT RENDER CANNOT BE MADE TO MATCH THE SERVER'S
 * HTML.** Clerk's `<OrganizationSwitcher>` and `<UserButton>` are the case this
 * was written for: both render `clerk.loaded && <ClerkHostRenderer/>` — a
 * condition read DURING RENDER, and one that is always false on the server
 * because `clerk.browser.js` only exists in a browser. If that script happens to
 * finish loading before React's first client render, the client produces a whole
 * subtree the server never emitted, and React reports "Hydration failed because
 * the server rendered HTML didn't match the client".
 *
 * **IT IS A RACE, WHICH IS WHY IT LOOKED LIKE A PAGE BUG.** Clerk.js is remote
 * and the app's chunks are local, so on a fast machine Clerk loses and nothing
 * is logged; on a slower one, or a slow route, it wins and every dashboard page
 * logs a mismatch — which then gets blamed on whatever page you were looking at.
 * Deferring to after hydration removes the race instead of winning it: the
 * server renders nothing, the first client render renders nothing, they agree by
 * construction, and the widgets mount a tick later exactly as they already did.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the server
 * snapshot is what React uses while hydrating, so this needs no state written
 * from an effect — which `react-hooks/set-state-in-effect` rightly flags.
 *
 * **NOT A GENERAL ESCAPE HATCH.** Anything wrapped in this is invisible to
 * server-rendered HTML, so it is wrong for content — no text, no navigation, no
 * figure. It is for third-party widgets that mount themselves.
 */
export function AfterHydration({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return hydrated ? <>{children}</> : null;
}
