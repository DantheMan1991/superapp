import "server-only";
import { NextResponse } from "next/server";
import { withTenant } from "@/db";
import { streamBlobResponse } from "@/lib/blob-stream";
import { resolveBrandFor } from "@/lib/brand/read";
import type { SiteHit } from "./read";

/**
 * The public logo for a site that has already been resolved — by slug or by
 * a connected domain. The route ADR 0018 said would exist "the day the
 * website needs it": a logo is public by definition, the address is the
 * site's own, and this is the one blob stream in the product with a public
 * cache header. The kit is read inside the tenant's context; a site with no
 * logo, or no site, is a plain 404.
 */
export async function siteLogoResponse(
  hit: SiteHit | null,
  ifNoneMatch: string | null,
): Promise<Response> {
  if (!hit) return NextResponse.json({ error: "not found" }, { status: 404 });
  const brand = await withTenant(hit.tenantId, (tx) => resolveBrandFor(tx, hit.tenantId, null));
  if (!brand.logo) return NextResponse.json({ error: "not found" }, { status: 404 });
  const response = await streamBlobResponse({
    pathname: brand.logo.pathname,
    mimeType: brand.logo.mimeType,
    fileName: brand.logo.mimeType === "image/png" ? "logo.png" : "logo.jpg",
    disposition: "inline",
    ifNoneMatch: ifNoneMatch ?? undefined,
    cacheControl: "public, max-age=300, stale-while-revalidate=86400",
  });
  return response ?? NextResponse.json({ error: "not found" }, { status: 404 });
}
