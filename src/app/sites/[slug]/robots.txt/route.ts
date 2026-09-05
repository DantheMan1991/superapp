import type { NextRequest } from "next/server";
import { robotsResponse } from "@/lib/sites/seo-routes";

export const runtime = "nodejs";

/** A published site's robots.txt, by its free address; the proxy sends a site host's `/robots.txt` here. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  return robotsResponse({ by: "slug", slug }, req);
}
