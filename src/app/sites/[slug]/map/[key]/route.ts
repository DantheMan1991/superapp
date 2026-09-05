import type { NextRequest } from "next/server";
import { siteMapResponse } from "@/lib/sites/map";
import { lookupSiteBySlug } from "@/lib/sites/read";

export const runtime = "nodejs";

/** A published site's map, addressed by the site's free address. See `src/lib/sites/map.ts`. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; key: string }> },
): Promise<Response> {
  const { slug, key } = await params;
  return siteMapResponse(await lookupSiteBySlug(slug), key, req.headers.get("if-none-match"));
}
