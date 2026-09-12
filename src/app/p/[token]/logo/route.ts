import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { hashIp } from "@/lib/public-token";
import { resolvePreview } from "@/lib/sites/previews";
import { siteLogoResponse } from "@/lib/sites/logo";

export const runtime = "nodejs";

/**
 * The site's logo under a preview token (ADR 0046).
 *
 * `/sites/<slug>/logo` would serve this perfectly well — the logo route has
 * no published check, because a logo is public by nature. The route exists
 * anyway so that **`/p/<token>/` mirrors `/sites/<slug>/` completely**: in
 * preview mode the token stands in for the slug everywhere, and one address
 * shape that did not follow the rule would be the one somebody forgets.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const hit = await resolvePreview(token, hashIp(ip));
  if (!hit.ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  // `siteLogoResponse` reads the site's own brand kit by id and never looks
  // at the status — a logo is public by nature (ADR 0018) — so the token's
  // resolution is everything this needs.
  return siteLogoResponse(
    { tenantId: hit.tenantId, id: hit.siteId, status: "draft" },
    req.headers.get("if-none-match"),
  );
}
