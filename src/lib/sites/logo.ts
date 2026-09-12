import "server-only";
import { NextResponse } from "next/server";
import { withTenant } from "@/db";
import { streamBlobResponse } from "@/lib/blob-stream";
import { resolveBrandForSite } from "@/lib/brand/read";
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
  // The SITE's logo, not the business's (ADR 0045): a site that was given
  // its own brand must serve its own mark here, or the header still reads
  // as the parent business. A site with no kit of its own resolves to the
  // business's, so nothing changed for a business with one brand.
  const brand = await withTenant(hit.tenantId, (tx) =>
    resolveBrandForSite(tx, hit.tenantId, hit.id),
  );
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
