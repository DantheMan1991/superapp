import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { streamBlobResponse } from "@/lib/blob-stream";
import { resolveBrandFor } from "@/lib/brand/read";
import { lookupSiteBySlug } from "@/lib/sites/read";

export const runtime = "nodejs";

/**
 * The public logo, addressed by the site rather than by the kit: the route
 * ADR 0018 said would exist "the day the website needs it". A logo is public
 * by definition, and the address is the site's own, so this is the one
 * blob stream in the product with a public cache header. The slug still goes
 * through the same trusted lookup as a page, and the kit is read inside the
 * tenant's context; a site with no logo — or no site — is a plain 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse | Response> {
  const { slug } = await params;
  const hit = await lookupSiteBySlug(slug);
  if (!hit) return NextResponse.json({ error: "not found" }, { status: 404 });
  const brand = await withTenant(hit.tenantId, (tx) =>
    resolveBrandFor(tx, hit.tenantId, null),
  );
  if (!brand.logo) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const response = await streamBlobResponse({
    pathname: brand.logo.pathname,
    mimeType: brand.logo.mimeType,
    fileName: brand.logo.mimeType === "image/png" ? "logo.png" : "logo.jpg",
    disposition: "inline",
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
    cacheControl: "public, max-age=300, stale-while-revalidate=86400",
  });
  if (!response) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return response;
}
