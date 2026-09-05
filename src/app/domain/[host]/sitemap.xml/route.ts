import type { NextRequest } from "next/server";
import { sitemapResponse } from "@/lib/sites/seo-routes";

export const runtime = "nodejs";

/** A published site's sitemap, reached through a domain the business connected. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ host: string }> }): Promise<Response> {
  const { host } = await params;
  return sitemapResponse({ by: "domain", host: host.toLowerCase() }, req);
}
