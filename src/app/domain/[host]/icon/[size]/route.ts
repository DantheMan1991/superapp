import type { NextRequest } from "next/server";
import { siteIconResponse } from "@/lib/sites/icon";
import { lookupSiteByDomain } from "@/lib/sites/read";

export const runtime = "nodejs";

/** A published site's icon, reached through a domain the business connected. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ host: string; size: string }> }): Promise<Response> {
  const { host, size } = await params;
  return siteIconResponse(await lookupSiteByDomain(host.toLowerCase()), size, req.headers.get("if-none-match"));
}
