import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { hashIp } from "@/lib/public-token";
import { memberMapResponse } from "@/lib/sites/map";
import { resolvePreview } from "@/lib/sites/previews";

export const runtime = "nodejs";

/**
 * The site's drawn map under a preview token (ADR 0046).
 *
 * `memberMapResponse` is the right helper and not `siteMapResponse`: the
 * second one serves PUBLISHED sites only, and the whole point here is a site
 * that is not published yet. The token is what stands in for the session it
 * otherwise wants, and the site id comes from the token rather than from the
 * caller — a preview can only ever draw the map of the site it was made for.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; key: string }> },
): Promise<Response> {
  const { token, key } = await params;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const hit = await resolvePreview(token, hashIp(ip));
  if (!hit.ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  return memberMapResponse(
    { tenantId: hit.tenantId, role: "staff" },
    hit.siteId,
    key,
    req.headers.get("if-none-match"),
  );
}
