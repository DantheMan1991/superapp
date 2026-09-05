import type { NextRequest } from "next/server";
import { siteShareResponse } from "@/lib/sites/share";

export const runtime = "nodejs";

/** A published page's share image, by the site's free address. See `src/lib/sites/share.ts`. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; key: string }> }): Promise<Response> {
  const { slug, key } = await params;
  return siteShareResponse({ by: "slug", slug }, key, req.headers.get("if-none-match"));
}
