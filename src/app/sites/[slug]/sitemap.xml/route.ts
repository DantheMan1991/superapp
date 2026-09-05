import type { NextRequest } from "next/server";
import { sitemapResponse } from "@/lib/sites/seo-routes";

export const runtime = "nodejs";

/** A published site's sitemap, by its free address; the proxy sends a site host's `/sitemap.xml` here. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  return sitemapResponse({ by: "slug", slug }, req);
}
