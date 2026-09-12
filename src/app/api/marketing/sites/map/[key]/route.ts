import { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/auth";
import { memberMapResponse } from "@/lib/sites/map";

export const runtime = "nodejs";

/**
 * The site's map for signed-in members of its tenant: the editor's draft
 * preview reads from here, so a map of a site nobody has published yet is
 * drawn only for the people building it. The key must be the one the site
 * holds; anything else is the same 404 as no map at all.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  const ctx = await resolveTenantContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // WHICH SITE. A tenant may have several (ADR 0045); this used to serve
  // whichever came first, which drew one site's pin in the other's colour.
  // A missing or unknown id is the same 404 as no map at all.
  const siteId = req.nextUrl.searchParams.get("site") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(siteId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return memberMapResponse(
    { tenantId: ctx.tenant.id, role: ctx.role },
    siteId,
    key,
    req.headers.get("if-none-match"),
  );
}
