import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  classifyHost,
  platformHostsFromEnv,
  siteDomainFromEnv,
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
 * `/logo` on either kind of site host is that site's logo route. The rewrite
 * is invisible to the visitor, and nothing else about the request changes.
 * The environment is read per request rather than at module load: the
 * proxy's runtime does not promise module state survives, and the read is
 * cheap. No database here — a host that is not ours becomes a path, and the
 * page does the lookup.
 */
export default clerkMiddleware((_auth, req) => {
  const kind = classifyHost(req.headers.get("host") ?? "", {
    siteDomain: siteDomainFromEnv(process.env),
    platformHosts: platformHostsFromEnv(process.env),
  });
  if (kind.kind === "platform") return;
  const url = req.nextUrl.clone();
  const pathname = url.pathname;
  // Framework and API paths are the platform's, on any host.
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/")) return;
  const logoBase = kind.kind === "site" ? `/sites/${kind.slug}` : `/domain/${kind.host}`;
  const pageBase = kind.kind === "site" ? `/hosted/${kind.slug}` : `/domain/${kind.host}`;
  url.pathname =
    pathname === "/logo"
      ? `${logoBase}/logo`
      : `${pageBase}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
});

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
