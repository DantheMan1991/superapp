import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { authorizedPartiesFromEnv } from "@/lib/authorized-parties";
import { MAINTENANCE_HTML, shouldServeMaintenance } from "@/lib/maintenance";
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
    const target = siteRewrite(kind, req.nextUrl.pathname);
    if (target === null) return;
    const url = req.nextUrl.clone();
    url.pathname = target;
    return NextResponse.rewrite(url);
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
    "/((?!_next|[^?]*\\.(?:html?|css|mjs|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
