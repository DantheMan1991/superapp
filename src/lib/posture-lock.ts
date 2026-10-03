/**
 * THE POSTURE PAGES' LOCK (docs/modules/posture.md; ADR 0118's second lock,
 * ADR 0122), and since Health's progress photos (H2b, ADR 0128) the same lock
 * on their pages: every page that shows a picture of a body taken on the phone.
 * Pure and dependency-free: the proxy runs it on every request, and each locked
 * area's layout guard in the browser.
 *
 * A posture check's pictures never leave the phone because nothing we wrote
 * sends one (ADR 0118). This is the second lock. A posture page carries a
 * content security policy that lets it reach this site and Clerk's sign-in
 * service and nothing else, so no script on it, ours or a library's, can send
 * a picture to another server: not a request, not an image, not a frame.
 *
 * A policy belongs to a page load, and Next moves between screens without one.
 * Left alone, a posture page reached from Workouts would run unlocked, and the
 * lock would follow the person out to every page after it, breaking the videos
 * and everything else that needs another server. So the posture pages are
 * loaded whole: the router's requests across their edge, in or out, are
 * answered with a full page load (`postureCrossing`), and the posture layout's
 * guard reloads a page that got across without one (back and forward can, from
 * the router's cache).
 */

export const POSTURE_PREFIX = "/personal/m/fitness/posture";

/** Health's progress photos (H2b, ADR 0128): taken and compared on the phone, never sent. */
export const HEALTH_PHOTOS_PREFIX = "/personal/m/health/photos";

/** A group of pages under one lock: the router crossing its edge loads the page whole. */
export type LockedArea = "posture" | "health-photos";

const LOCKED_AREAS: readonly { area: LockedArea; prefix: string; wasm: boolean }[] = [
  // The pose model runs as WebAssembly.
  { area: "posture", prefix: POSTURE_PREFIX, wasm: true },
  { area: "health-photos", prefix: HEALTH_PHOTOS_PREFIX, wasm: false },
];

/** Which locked area a page is in: its prefix's own page and everything under it; null for every other page. */
export function lockedArea(pathname: string): LockedArea | null {
  for (const { area, prefix } of LOCKED_AREAS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return area;
  }
  return null;
}

/** A posture page: the posture check's own page and everything under it. */
export function isPosturePath(pathname: string): boolean {
  return lockedArea(pathname) === "posture";
}

/**
 * Clerk's Frontend API host, from a publishable key: `pk_live_` or `pk_test_`
 * and the base64 of the host with a `$` after it. Null for anything else.
 * Read from the key the page signs in with, so the development instance, a
 * preview and production each get their own (production's is
 * `clerk.yosherapp.com`).
 */
export function clerkFrontendApi(publishableKey: string | undefined): string | null {
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/]+={0,2})$/.exec(publishableKey ?? "");
  if (!match) return null;
  let decoded: string;
  try {
    decoded = atob(match[1]);
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host) ? host : null;
}

/**
 * The policy. Everything from this site; scripts only with the page's nonce
 * (Next puts it on its own) or from Clerk; WebAssembly where the area runs it
 * (the posture check's pose model; the progress photos run none); and
 * connections to this site and Clerk alone. Styles may be inline (React's style
 * attributes, Clerk's own), which sends nothing: anything a style would fetch
 * is held to the image and font rules. No frames, no plugins, no form posting
 * elsewhere, and no other site may frame the page.
 *
 * In development only: React needs `eval` for its error stacks, the dev server
 * talks over a WebSocket, and Clerk's development instance sends telemetry.
 */
export function lockCsp(input: {
  nonce: string;
  /** Clerk's Frontend API host (`clerkFrontendApi`); null leaves Clerk out. */
  clerk: string | null;
  /** The dev server's own socket origin, `ws://localhost:3000`; null outside development. */
  devSocket: string | null;
  area: LockedArea;
}): string {
  const clerk = input.clerk ? [`https://${input.clerk}`] : [];
  const dev = input.devSocket !== null;
  const wasm = LOCKED_AREAS.find((a) => a.area === input.area)?.wasm ? ["'wasm-unsafe-eval'"] : [];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${input.nonce}'`, ...wasm, ...clerk, ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:", "https://img.clerk.com"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...clerk, ...(dev ? [input.devSocket as string, "https://clerk-telemetry.com"] : [])]],
    ["media-src", ["'self'", "blob:"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/** The posture pages' policy (`lockCsp` for the posture area), as ADR 0122 wrote it. */
export function postureCsp(input: { nonce: string; clerk: string | null; devSocket: string | null }): string {
  return lockCsp({ ...input, area: "posture" });
}

/**
 * The path a request came from, when the browser said and it was this site;
 * null otherwise. Judged by the request's own `Host`, which the browser sets
 * from the same address the referrer names: the server's idea of its own
 * origin can differ (`next start` behind a port, a proxy in front).
 */
export function sameSitePath(referer: string | null, host: string): string | null {
  if (!referer) return null;
  try {
    const from = new URL(referer);
    return from.host === host ? from.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Whether a request is a script fetching, rather than the browser loading a
 * page. The browser says so itself in `Sec-Fetch-Dest`, which no script can
 * set: `document` for a page load, `empty` for a fetch. Next's own `rsc`
 * header would say "the router" more exactly, but in production Next hides it
 * from the proxy ("users only see page requests, never data requests"), so it
 * is the answer only where a browser sends no `Sec-Fetch-Dest`.
 */
export function fetchedByScript(secFetchDest: string | null, rsc: string | null): boolean {
  return secFetchDest !== null ? secFetchDest === "empty" : rsc === "1";
}

/**
 * What the proxy does with a request.
 *
 * - `full-load`: a script on one side of a locked area's edge fetching a page
 *   on the other, which is the router moving there (a navigation or a
 *   prefetch). The answer is not the router's kind, which Next takes as "load
 *   this page whole" (`fetchServerResponse`): in, the page gets its own lock;
 *   out, the next page leaves the lock behind. Between two locked areas too,
 *   since each has its own policy. Only pages: a locked page's fetch of an API
 *   (the coach's voice) is no crossing.
 * - `lock`: a whole page load of a locked page, which gets the policy.
 * - `pass`: anything else, including the router moving between two pages of
 *   one area, which share the lock already on the page.
 *
 * With no word of where a request came from (`fromPath` null), the router's
 * requests pass, and the area's layout guard catches a page that crossed.
 */
export function lockCrossing(input: {
  pathname: string;
  method: string;
  /** A script's fetch rather than a page load (`fetchedByScript`). */
  fetched: boolean;
  fromPath: string | null;
}): "full-load" | "lock" | "pass" {
  const to = lockedArea(input.pathname);
  const read = input.method === "GET" || input.method === "HEAD";
  if (input.fetched) {
    const page = read && !input.pathname.startsWith("/api/");
    return page && input.fromPath !== null && lockedArea(input.fromPath) !== to ? "full-load" : "pass";
  }
  return to !== null && read ? "lock" : "pass";
}

/** ADR 0122's name for `lockCrossing`, from when the posture pages were the only ones locked. */
export const postureCrossing = lockCrossing;

/** A fresh nonce for one page load: 16 random bytes, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}
