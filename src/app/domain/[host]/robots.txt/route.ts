import type { NextRequest } from "next/server";
import { robotsResponse } from "@/lib/sites/seo-routes";

export const runtime = "nodejs";

/** A published site's robots.txt, reached through a domain the business connected. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ host: string }> }): Promise<Response> {
  const { host } = await params;
  return robotsResponse({ by: "domain", host: host.toLowerCase() }, req);
}
