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
  return memberMapResponse({ tenantId: ctx.tenant.id, role: ctx.role }, key, req.headers.get("if-none-match"));
}
