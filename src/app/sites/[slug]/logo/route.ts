import type { NextRequest } from "next/server";
import { siteLogoResponse } from "@/lib/sites/logo";
import { lookupSiteBySlug } from "@/lib/sites/read";

export const runtime = "nodejs";

/** The public logo, addressed by the site's free address. See `src/lib/sites/logo.ts`. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return siteLogoResponse(await lookupSiteBySlug(slug), req.headers.get("if-none-match"));
}
