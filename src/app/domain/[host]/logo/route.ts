import type { NextRequest } from "next/server";
import { DOMAIN_RE } from "@/lib/sites/domains";
import { siteLogoResponse } from "@/lib/sites/logo";
import { lookupSiteByDomain } from "@/lib/sites/read";

export const runtime = "nodejs";

/**
 * The public logo, addressed by a connected domain: `src/proxy.ts` rewrites
 * `/logo` on such a host here. See `src/lib/sites/logo.ts`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ host: string }> },
): Promise<Response> {
  const host = decodeURIComponent((await params).host).toLowerCase();
  const hit = DOMAIN_RE.test(host) ? await lookupSiteByDomain(host) : null;
  return siteLogoResponse(hit, req.headers.get("if-none-match"));
}
