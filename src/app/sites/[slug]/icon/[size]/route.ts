import type { NextRequest } from "next/server";
import { siteIconResponse } from "@/lib/sites/icon";
import { lookupSiteBySlug } from "@/lib/sites/read";

export const runtime = "nodejs";

/** A published site's icon at 32, 180 or 512 pixels; the proxy sends a site host's `/favicon.ico` and `/apple-touch-icon.png` here. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; size: string }> }): Promise<Response> {
  const { slug, size } = await params;
  return siteIconResponse(await lookupSiteBySlug(slug), size, req.headers.get("if-none-match"));
}
