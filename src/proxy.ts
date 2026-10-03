import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { authorizedPartiesFromEnv } from "@/lib/authorized-parties";
import { MAINTENANCE_HTML, shouldServeMaintenance } from "@/lib/maintenance";
import { nativeAppEntryRedirect } from "@/lib/native-app-core";
import {
  clerkFrontendApi,
  fetchedByScript,
  lockCrossing,
  lockCsp,
  lockedArea,
  newNonce,
  sameSitePath,
} from "@/lib/posture-lock";
import {
  classifyHost,
  platformHostsFromEnv,
  siteDomainFromEnv,
  siteRewrite,
} from "@/lib/sites/slug";

/**
 * clerkMiddleware only attaches auth context to the request. Authorization
 * happens where the data lives — requireSuperAdmin / requireTenant /
 * requireTenantOwner in every protected layout, page, and server action —
 * per Clerk's resource-based auth guidance. Path matching here would be a
 * second, weaker source of truth.
 *
 * The one thing this file decides for itself is WHICH SITE a request is for
 * (`classifyHost`, pure and dependency-free, because this runs before
 * anything else on every request):
 *
 *   - the platform's own hosts (the app, a Vercel preview, a laptop) pass;
 *   - `<slug>.<SITE_DOMAIN>` is a site's free address and is rewritten to
 *     `/hosted/<slug>/…`;
 *   - any other hostname is a domain a business connected (ADR 0020) and is
 *     rewritten to `/domain/<host>/…`, where the page resolves it to a site
 *     through one trusted lookup or answers 404.
 *
 * `/logo` and `/images/<id>` on either kind of site host are that site's
 * asset routes (`siteRewrite`, pure and tested beside `classifyHost`). The
 * rewrite is invisible to the visitor, and nothing else about the request
 * changes. The environment is read per request rather than at module load:
 * the proxy's runtime does not promise module state survives, and the read
 * is cheap. No database here — a host that is not ours becomes a path, and
 * the page does the lookup.
 *
 * One thing this file STAMPS on every request it passes: `x-yosher-method`
 * and `x-yosher-path`, set from the request itself and overwriting anything
 * a client sent under those names. `headers()` in a server component has no
 * method, and the support view (back-office slice 4, src/lib/auth.ts) turns
 * on exactly that: a live session is honoured for a GET and refused for a
 * server action or any other method. The stamp is the only way the resolver
 * can tell, and this is the only place that may set it.
 *
 * And one page group gets a LOCK: the posture check's pages carry a content
 * security policy that lets them reach this site and Clerk and nothing else,
 * and the router's requests across their edge are turned into full page loads
 * so the policy is on every posture page and on no other (src/lib/
 * posture-lock.ts, ADR 0122).
 *
 * Two environment switches ride on the same per-request read:
 *
 *   - `MAINTENANCE_MODE=1` closes the platform's own hosts with a 503 while
 *     a cutover rewrites ids underneath them (src/lib/maintenance.ts). A
 *     business's site never involves a session and stays up; webhooks and
 *     crons are exempt inside the helper.
 *   - `authorizedParties`, Clerk's origin allowlist, is derived from the app
 *     URL for a production instance only (src/lib/authorized-parties.ts).
 */
export default clerkMiddleware(
  (_auth, req) => {
    const kind = classifyHost(req.headers.get("host") ?? "", {
      siteDomain: siteDomainFromEnv(process.env),
      platformHosts: platformHostsFromEnv(process.env),
    });
    if (
      kind.kind === "platform" &&
      shouldServeMaintenance(req.nextUrl.pathname, process.env)
    ) {
      return new NextResponse(MAINTENANCE_HTML, {
        status: 503,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "retry-after": "600",
          "cache-control": "no-store",
        },
      });
    }
    // The mobile app asking for the front page goes to the dashboard
    // (src/lib/native-app-core.ts): the landing page is for browsers.
    if (kind.kind === "platform") {
      const entry = nativeAppEntryRedirect(
        req.nextUrl.pathname,
        req.headers.get("user-agent"),
      );
      if (entry) return NextResponse.redirect(new URL(entry, req.url));
    }
    const stamped = new Headers(req.headers);
    stamped.set("x-yosher-method", req.method);
    stamped.set("x-yosher-path", req.nextUrl.pathname);
    // The locked pages (src/lib/posture-lock.ts, ADR 0122; Health's photos,
    // ADR 0128): a page load gets the policy and its nonce, which Next reads
    // off the request and puts on its own scripts; the router crossing a
    // locked area's edge gets a full page load instead.
    const posture =
      kind.kind === "platform"
        ? lockCrossing({
            pathname: req.nextUrl.pathname,
            method: req.method,
            fetched: fetchedByScript(req.headers.get("sec-fetch-dest"), req.headers.get("rsc")),
            fromPath: sameSitePath(req.headers.get("referer"), req.headers.get("host") ?? req.nextUrl.host),
          })
        : "pass";
    if (posture === "full-load") {
      return new NextResponse("This page loads whole.", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-yosher-full-load": lockedArea(req.nextUrl.pathname) ?? "unlocked",
        },
      });
    }
    let csp: string | null = null;
    const area = posture === "lock" ? lockedArea(req.nextUrl.pathname) : null;
    if (area !== null) {
      const nonce = newNonce();
      csp = lockCsp({
        area,
        nonce,
        clerk: clerkFrontendApi(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
        devSocket:
          process.env.NODE_ENV === "development"
            ? `ws://${req.headers.get("host") ?? "localhost"}`
            : null,
      });
      stamped.set("content-security-policy", csp);
      stamped.set("x-nonce", nonce);
    }
    const target = siteRewrite(kind, req.nextUrl.pathname);
    if (target === null) {
      const res = NextResponse.next({ request: { headers: stamped } });
      if (csp) res.headers.set("Content-Security-Policy", csp);
      return res;
    }
    const url = req.nextUrl.clone();
    url.pathname = target;
    return NextResponse.rewrite(url, { request: { headers: stamped } });
  },
  // A callback rather than an object, so the key kind and the app URL are
  // read per request like everything else here.
  () => ({ authorizedParties: authorizedPartiesFromEnv(process.env) }),
);

export const config = {
  matcher: [
    // Skip Next.js internals and all static files. `mjs` is listed
    // explicitly because MapLibre's worker and its sibling chunk are served
    // from `public/maplibre/`, and `js(?!on)` does not match a `.mjs` suffix.
    // `wasm` and `task` are the posture check's pose model in `public/pose/`
    // (docs/modules/posture.md): 46 MB a phone should never have to pass
    // through Clerk for, or be refused with maintenance mode's 503.
    // `voice-commands/` is hands-free's listener (docs/modules/voice-commands.md),
    // 15 MB for the same reason, whose model is a `.data` file: the folder is
    // skipped whole, rather than every path with ".data" somewhere in it.
    "/((?!_next|voice-commands/|[^?]*\\.(?:html?|css|mjs|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|wasm|task)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
