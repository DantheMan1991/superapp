import type { NextRequest } from "next/server";
import { siteMapResponse } from "@/lib/sites/map";
import { lookupSiteByDomain } from "@/lib/sites/read";

export const runtime = "nodejs";

/** A published site's map, addressed by a domain the business connected. See `src/lib/sites/map.ts`. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ host: string; key: string }> },
): Promise<Response> {
  const { host, key } = await params;
  return siteMapResponse(await lookupSiteByDomain(host.toLowerCase()), key, req.headers.get("if-none-match"));
}
