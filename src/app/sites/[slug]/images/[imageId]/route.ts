import type { NextRequest } from "next/server";
import { siteImageResponse } from "@/lib/sites/images";
import { lookupSiteBySlug } from "@/lib/sites/read";

export const runtime = "nodejs";

/** A published site's photo, addressed by the site's free address. See `src/lib/sites/images.ts`. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; imageId: string }> },
): Promise<Response> {
  const { slug, imageId } = await params;
  return siteImageResponse(await lookupSiteBySlug(slug), imageId, req.headers.get("if-none-match"));
}
