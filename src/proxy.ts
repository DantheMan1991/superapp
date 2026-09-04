import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hostToSiteSlug, siteDomainFromEnv } from "@/lib/sites/slug";

/**
 * clerkMiddleware only attaches auth context to the request. Authorization
 * happens where the data lives — requireSuperAdmin / requireTenant /
 * requireTenantOwner in every protected layout, page, and server action —
 * per Clerk's resource-based auth guidance. Path matching here would be a
 * second, weaker source of truth.
 *
 * The one thing this file decides for itself is WHICH SITE a request is for.
 * A request to `<slug>.<SITE_DOMAIN>` is a tenant's public website, and it
 * is rewritten to `/hosted/<slug>/<path>` so the same route renders it
 * whether it arrived by hostname or by `/sites/<slug>` on the platform host.
 * `/logo` on a site host is the site's logo route. Nothing else about the
 * request changes: the rewrite is invisible to the visitor, and a request to
 * the platform's own host is untouched (`hostToSiteSlug` returns null for
 * it, for `www`, and for anything with two labels).
 *
 * `siteDomainFromEnv` is read per request rather than at module load on
 * purpose: the proxy's runtime does not promise module state survives, and an
 * environment read is cheap. Kept pure — `src/lib/sites/slug.ts` imports
 * nothing, because this runs before anything else on every request.
 */
export default clerkMiddleware((_auth, req) => {
  const slug = hostToSiteSlug(
    req.headers.get("host") ?? "",
    siteDomainFromEnv(process.env),
  );
  if (!slug) return;
  const url = req.nextUrl.clone();
  const pathname = url.pathname;
  // Framework and API paths are the platform's, on any host.
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/")) return;
  url.pathname =
    pathname === "/logo"
      ? `/sites/${slug}/logo`
      : `/hosted/${slug}${pathname === "/" ? "" : pathname}`;
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
